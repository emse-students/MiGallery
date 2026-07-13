import { json, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireSession } from '$lib/server/permissions';

import { createLogger } from '$lib/server/logger';

const log = createLogger('users-userId-photo-access');
interface UserInfo {
	id_user: string;
	name: string;
	first_name: string | null;
	last_name: string | null;
	photos_id: string | null;
	photos_asset_id: string | null;
}

/**
 * GET /api/users/[userId]/photo-access
 * Checks if the logged-in user has access to the specified user's photos
 *
 * Returns:
 * - hasAccess: boolean (true if admin, or if the user granted permission)
 * - reason: string (explanation of the access)
 * - user: { id_user, name, first_name, last_name, photos_id } si hasAccess est true
 */
export const GET: RequestHandler = async (event) => {
	const user = await requireSession(event);
	const targetUserId = (event.params as { userId?: string })?.userId;

	if (!targetUserId) {
		return json({ error: 'userId is required' }, { status: 400 });
	}

	try {
		const db = getDatabase();

		const getTargetUser = (): UserInfo | null => {
			return db
				.prepare(
					'SELECT id_user, name, first_name, last_name, photos_id, photos_asset_id FROM users WHERE id_user = ?'
				)
				.get(targetUserId) as UserInfo | null;
		};

		if (targetUserId === user.id_user) {
			const targetUser = getTargetUser();
			return json({
				success: true,
				hasAccess: true,
				reason: 'own_photos',
				user: targetUser
			});
		}

		if (user.role === 'admin') {
			const targetUser = getTargetUser();
			return json({
				success: true,
				hasAccess: true,
				reason: 'admin',
				user: targetUser
			});
		}

		const permission = db
			.prepare('SELECT 1 FROM photo_access_permissions WHERE owner_id = ? AND authorized_id = ?')
			.get(targetUserId, user.id_user);

		if (permission) {
			const targetUser = getTargetUser();
			return json({
				success: true,
				hasAccess: true,
				reason: 'granted',
				user: targetUser
			});
		}

		return json({
			success: true,
			hasAccess: false,
			reason: 'not_authorized'
		});
	} catch (e) {
		if (isHttpError(e)) {
			throw e;
		}
		const err = e as Error;
		log.error('GET /api/users/[userId]/photo-access error', err);
		return json({ error: err.message }, { status: 500 });
	}
};
