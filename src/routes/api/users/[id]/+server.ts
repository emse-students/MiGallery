import { json, isHttpError } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';
import { logEvent } from '$lib/server/logs';

const SYSTEM_USER_ID = 'dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782';

export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	const targetId = event.params.id;
	if (!targetId) {
		return json({ error: 'Bad Request' }, { status: 400 });
	}

	const db = getDatabase();
	const row = db
		.prepare(
			`SELECT
				id_user,
				name,
				first_name,
				last_name,
				photos_id,
				role,
				promo,
				name as nom,
				first_name as prenom,
				photos_id as id_photos,
				promo as promo_year
			FROM users WHERE id_user = ? LIMIT 1`
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

	if (targetId === SYSTEM_USER_ID) {
		return json({ error: 'Cannot modify system user' }, { status: 403 });
	}

	try {
		const body = (await event.request.json()) as {
			name?: string;
			first_name?: string | null;
			last_name?: string | null;
			role?: string;
			promo?: number | null;
			photos_id?: string | null;
		};
		const { name, first_name, last_name, role, promo, photos_id } = body;

		// Prevent admin from removing their own admin status
		if (auth.user && auth.user.id_user === targetId) {
			const effectiveRole = role || 'user';
			if (effectiveRole !== 'admin') {
				return json({ error: 'Admins cannot remove their own admin privileges' }, { status: 403 });
			}
		}

		if (role && !['user', 'admin', 'mitviste'].includes(role)) {
			return json({ error: 'Invalid role' }, { status: 400 });
		}

		const db = getDatabase();
		const stmt = db.prepare(
			'UPDATE users SET name = ?, first_name = ?, last_name = ?, role = ?, promo = ?, photos_id = ? WHERE id_user = ?'
		);
		const info = stmt.run(
			name || targetId,
			first_name || null,
			last_name || null,
			role || 'user',
			promo || null,
			photos_id || null,
			targetId
		);

		if (info.changes === 0) {
			return json({ error: 'User not found' }, { status: 404 });
		}

		const updated = db
			.prepare(
				`SELECT
					id_user,
					name,
					first_name,
					last_name,
					photos_id,
					role,
					promo,
					name as nom,
					first_name as prenom,
					photos_id as id_photos,
					promo as promo_year
				FROM users WHERE id_user = ?`
			)
			.get(targetId);
		try {
			await logEvent(event, 'update', 'user', targetId, {
				name,
				first_name,
				last_name,
				role,
				promo
			});
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

	if (targetId === SYSTEM_USER_ID) {
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
