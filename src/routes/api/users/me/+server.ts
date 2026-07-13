import { json, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireSession } from '$lib/server/permissions';

import { createLogger } from '$lib/server/logger';

const log = createLogger('users-me');
const SYSTEM_USER_ID = 'dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782';

/**
 * GET /api/users/me
 * Fetches the information of the logged-in user
 *
 * Note: This endpoint requires an active session (not API key)
 * because it identifies the user via their login session.
 */
export const GET: RequestHandler = async (event) => {
	try {
		const user = await requireSession(event);
		const db = getDatabase();

		const userData = db
			.prepare(
				`SELECT
					id_user,
					name,
					first_name,
					last_name,
					photos_id,
					role,
					promo
				FROM users WHERE id_user = ?`
			)
			.get(user.id_user);

		if (!userData) {
			return json({ error: 'User not found' }, { status: 404 });
		}

		return json({ success: true, user: userData });
	} catch (e) {
		if (isHttpError(e)) {
			throw e;
		}
		const err = e as Error;
		log.error('GET /api/users/me error', err);
		return json({ error: err.message }, { status: 500 });
	}
};

/**
 * DELETE /api/users/me
 * Deletes the account of the logged-in user
 *
 * This action is irreversible and deletes all data associated with the user.
 * Note: This endpoint requires an active session (not API key) for security reasons.
 */
export const DELETE: RequestHandler = async (event) => {
	const { cookies } = event;

	try {
		const user = await requireSession(event);
		const db = getDatabase();

		if (user.id_user === SYSTEM_USER_ID) {
			return json({ error: 'Cannot delete system user' }, { status: 403 });
		}

		const result = db.prepare('DELETE FROM users WHERE id_user = ?').run(user.id_user);

		if (result.changes === 0) {
			return json({ error: 'Failed to delete user' }, { status: 500 });
		}

		cookies.delete('current_user_id', { path: '/' });

		return json({ success: true, message: 'Account deleted successfully' });
	} catch (e) {
		if (isHttpError(e)) {
			throw e;
		}
		const err = e as Error;
		log.error('DELETE /api/users/me error', err);
		return json({ error: err.message }, { status: 500 });
	}
};
