import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireSession } from '$lib/server/permissions';

interface UserInfo {
	id_user: string;
	prenom: string;
	nom: string;
	id_photos: string | null;
}

/**
 * GET /api/users/[userId]/photo-access
 * Vérifie si l'utilisateur connecté a accès aux photos de l'utilisateur spécifié
 *
 * Retourne:
 * - hasAccess: boolean (true si admin, ou si l'utilisateur a donné l'autorisation)
 * - reason: string (explication de l'accès)
 * - user: { id_user, prenom, nom, id_photos } si hasAccess est true
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
				.prepare('SELECT id_user, prenom, nom, id_photos FROM users WHERE id_user = ?')
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
		const err = e as Error;
		console.error('GET /api/users/[userId]/photo-access error', err);
		return json({ error: err.message }, { status: 500 });
	}
};
