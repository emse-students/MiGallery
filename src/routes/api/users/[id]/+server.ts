import { json } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';

export const GET: RequestHandler = async (event) => {
	// get user by id - admin only
	await requireScope(event, 'admin');

	const targetId = event.params.id;
	if (!targetId) {
		return json({ error: 'Bad Request' }, { status: 400 });
	}

	const db = getDatabase();
	const row = db
		.prepare(
			'SELECT id_user, email, prenom, nom, id_photos, role, promo_year FROM users WHERE id_user = ? LIMIT 1'
		)
		.get(targetId);
	if (!row) {
		return json({ error: 'Not Found' }, { status: 404 });
	}
	return json({ success: true, user: row });
};

export const PUT: RequestHandler = async (event) => {
	// update user - admin only
	await requireScope(event, 'admin');

	const targetId = event.params.id;
	if (!targetId) {
		return json({ error: 'Bad Request' }, { status: 400 });
	}

	// Protect system user
	if (targetId === 'les.roots') {
		return json({ error: 'Cannot modify system user' }, { status: 403 });
	}

	try {
		const body = (await event.request.json()) as {
			email?: string;
			prenom?: string;
			nom?: string;
			role?: string;
			promo_year?: number | null;
			id_photos?: string | null;
		};
		const { email, prenom, nom, role, promo_year, id_photos } = body;

		// Validation
		if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return json({ error: 'Invalid email format' }, { status: 400 });
		}
		if (role && !['user', 'admin', 'mitviste'].includes(role)) {
			return json({ error: 'Invalid role' }, { status: 400 });
		}

		const db = getDatabase();
		const stmt = db.prepare(
			'UPDATE users SET email = ?, prenom = ?, nom = ?, role = ?, promo_year = ?, id_photos = ? WHERE id_user = ?'
		);
		const info = stmt.run(
			email || null,
			prenom || '',
			nom || '',
			role || 'user',
			promo_year || null,
			id_photos || null,
			targetId
		);

		if (info.changes === 0) {
			return json({ error: 'User not found' }, { status: 404 });
		}

		const updated = db
			.prepare(
				'SELECT id_user, email, prenom, nom, id_photos, role, promo_year FROM users WHERE id_user = ?'
			)
			.get(targetId);
		return json({ success: true, updated, changes: info.changes });
	} catch (e: unknown) {
		const err = ensureError(e);
		console.error('PUT /api/users/[id] error', err);
		return json({ success: false, error: err.message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	// delete user - admin only
	await requireScope(event, 'admin');

	const targetId = event.params.id;

	// Protect system user
	if (targetId === 'les.roots') {
		return json({ error: 'Cannot delete system user' }, { status: 403 });
	}

	const db = getDatabase();
	const info = db.prepare('DELETE FROM users WHERE id_user = ?').run(targetId);
	if (info.changes === 0) {
		return json({ error: 'User not found' }, { status: 404 });
	}
	return json({ success: true, changes: info.changes });
};
