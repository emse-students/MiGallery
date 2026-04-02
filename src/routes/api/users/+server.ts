import { json } from '@sveltejs/kit';
import type { UserRow } from '$lib/types/api';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';
import { logEvent } from '$lib/server/logs';
import { requireScope } from '$lib/server/permissions';

const SYSTEM_USER_ID = 'dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782';

export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	const db = getDatabase();
	const rows = db
		.prepare(
			`SELECT
				id_user,
				name,
				first_name,
				last_name,
				photos_id,
				role,
				promo,
				photos_id as id_photos,
				promo as promo_year
			FROM users
			WHERE id_user != ?
			ORDER BY promo DESC, name, first_name`
		)
		.all(SYSTEM_USER_ID) as UserRow[];
	return json({ success: true, users: rows });
};

export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	try {
		const body = (await event.request.json()) as {
			id_user?: string;
			name?: string;
			first_name?: string | null;
			last_name?: string | null;
			promo_year?: number | null;
			id_photos?: string | null;
			role?: string;
			promo?: number | null;
			photos_id?: string | null;
		};

		const id_user = body.id_user;
		const first_name = body.first_name ?? null;
		const last_name = body.last_name ?? null;
		const legacyName = [first_name, last_name].filter(Boolean).join(' ').trim();
		const name = body.name ?? (legacyName || null);
		const role = body.role ?? 'user';
		const promo = body.promo ?? body.promo_year ?? null;
		const photos_id = body.photos_id ?? body.id_photos ?? null;

		if (!id_user || !name) {
			return json({ error: 'id_user and name required' }, { status: 400 });
		}

		if (!['user', 'admin', 'mitviste'].includes(role)) {
			return json({ error: 'Invalid role' }, { status: 400 });
		}

		const db = getDatabase();
		const insert = db.prepare(
			'INSERT INTO users (id_user, name, first_name, last_name, role, promo, photos_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
		);
		const effectiveRole = id_user === SYSTEM_USER_ID ? 'admin' : role;
		const info = insert.run(id_user, name, first_name, last_name, effectiveRole, promo, photos_id);
		const created = db
			.prepare(
				`SELECT
					id_user,
					name,
					first_name,
					last_name,
					photos_id,
					role,
					promo,
					photos_id as id_photos,
					promo as promo_year
				FROM users WHERE id_user = ?`
			)
			.get(id_user) as UserRow | undefined;

		try {
			await logEvent(event, 'create', 'user', id_user, { name, first_name, last_name, role });
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
