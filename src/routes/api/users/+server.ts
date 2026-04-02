import { json } from '@sveltejs/kit';
import type { UserRow } from '$lib/types/api';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';
import { logEvent } from '$lib/server/logs';
import { requireScope } from '$lib/server/permissions';

export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	const db = getDatabase();
	const rows = db
		.prepare(
			'SELECT id_user, nom, id_photos, role, promo_year FROM users WHERE id_user != ? ORDER BY promo_year DESC, nom'
		)
		.all('dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782') as UserRow[];
	return json({ success: true, users: rows });
};

export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	try {
		const body = (await event.request.json()) as {
			id_user?: string;
			nom?: string;
			role?: string;
			promo_year?: number | null;
			id_photos?: string | null;
		};
		const { id_user, nom, role = 'user', promo_year = null, id_photos = null } = body;
		if (!id_user || !nom) {
			return json({ error: 'id_user and nom required' }, { status: 400 });
		}

		if (!['user', 'admin', 'mitviste'].includes(role)) {
			return json({ error: 'Invalid role' }, { status: 400 });
		}

		const db = getDatabase();
		const insert = db.prepare(
			'INSERT INTO users (id_user, nom, role, promo_year, id_photos) VALUES (?, ?, ?, ?, ?)'
		);
		const info = insert.run(id_user, nom, role, promo_year, id_photos);
		const created = db
			.prepare('SELECT id_user, nom, id_photos, role, promo_year FROM users WHERE id_user = ?')
			.get(id_user) as UserRow | undefined;

		try {
			await logEvent(event, 'create', 'user', id_user, { nom, role });
		} catch (logErr) {
			console.warn('logEvent failed (users POST):', logErr);
		}
		return json({ success: true, created, changes: info.changes });
	} catch (e) {
		const err = e as Error;
		console.error('POST /api/users error', err);
		if (
			err.message.includes('UNIQUE constraint failed') ||
			err.message.includes('SQLITE_CONSTRAINT_UNIQUE')
		) {
			return json({ success: false, error: 'User already exists' }, { status: 409 });
		}
		return json({ success: false, error: err.message }, { status: 500 });
	}
};
