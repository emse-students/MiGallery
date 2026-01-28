import { json, isHttpError } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';
import { logEvent } from '$lib/server/logs';

export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	const targetId = event.params.id;
	if (!targetId) {
		return json({ error: 'Bad Request' }, { status: 400 });
	}

	const db = getDatabase();
	const row = db
		.prepare(
			'SELECT id_user, email, prenom, nom, id_photos, role, promo_year, alumni_id FROM users WHERE id_user = ? LIMIT 1'
		)
		.get(targetId);
	if (!row) {
		return json({ error: 'Not Found' }, { status: 404 });
	}
	return json({ success: true, user: row });
};

export const PUT: RequestHandler = async (event) => {
	const auth = await requireScope(event, 'admin');

	const targetId = event.params.id;
	if (!targetId) {
		return json({ error: 'Bad Request' }, { status: 400 });
	}

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
			alumni_id?: string | null;
		};
		const { email, prenom, nom, role, promo_year, id_photos, alumni_id } = body;

		// Prevent admin from removing their own admin status
		if (auth.user && auth.user.id_user === targetId) {
			const effectiveRole = role || 'user';
			if (effectiveRole !== 'admin') {
				return json({ error: 'Admins cannot remove their own admin privileges' }, { status: 403 });
			}
		}

		if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return json({ error: 'Invalid email format' }, { status: 400 });
		}
		if (role && !['user', 'admin', 'mitviste'].includes(role)) {
			return json({ error: 'Invalid role' }, { status: 400 });
		}

		const db = getDatabase();
		const stmt = db.prepare(
			'UPDATE users SET email = ?, prenom = ?, nom = ?, role = ?, promo_year = ?, id_photos = ?, alumni_id = ? WHERE id_user = ?'
		);
		const info = stmt.run(
			email || null,
			prenom || '',
			nom || '',
			role || 'user',
			promo_year || null,
			id_photos || null,
			alumni_id || null, // Permet de retirer le lien si vide (null passé explicitement)
			targetId
		);

		if (info.changes === 0) {
			return json({ error: 'User not found' }, { status: 404 });
		}

		const updated = db
			.prepare(
				'SELECT id_user, email, prenom, nom, id_photos, role, promo_year, alumni_id FROM users WHERE id_user = ?'
			)
			.get(targetId);
		try {
			await logEvent(event, 'update', 'user', targetId, { email, prenom, nom, role, promo_year });
		} catch (logErr) {
			console.warn('logEvent failed (users PUT):', logErr);
		}
		return json({ success: true, updated, changes: info.changes });
	} catch (e: unknown) {
		if (isHttpError(e)) {
			throw e;
		}
		const err = ensureError(e);
		console.error('PUT /api/users/[id] error', err);
		return json({ success: false, error: err.message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	const auth = await requireScope(event, 'admin');

	const targetId = event.params.id;

	if (auth.user && auth.user.id_user === targetId) {
		return json({ error: 'Admins cannot delete their own account' }, { status: 403 });
	}

	if (targetId === 'les.roots') {
		return json({ error: 'Cannot delete system user' }, { status: 403 });
	}

	const db = getDatabase();
	const info = db.prepare('DELETE FROM users WHERE id_user = ?').run(targetId);
	if (info.changes === 0) {
		return json({ error: 'User not found' }, { status: 404 });
	}
	try {
		await logEvent(event, 'delete', 'user', targetId, null);
	} catch (logErr) {
		console.warn('logEvent failed (users DELETE):', logErr);
	}
	return json({ success: true, changes: info.changes });
};
