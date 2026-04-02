import { json, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireSession } from '$lib/server/permissions';

const SYSTEM_USER_ID = 'dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782';

/**
 * GET /api/users/me
 * Récupère les informations de l'utilisateur connecté
 *
 * Note: Cet endpoint requiert une session active (pas de clé API)
 * car il identifie l'utilisateur via sa session de connexion.
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
					promo,
					name as nom,
					first_name as prenom,
					photos_id as id_photos,
					promo as promo_year
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
		console.error('GET /api/users/me error', err);
		return json({ error: err.message }, { status: 500 });
	}
};

/**
 * DELETE /api/users/me
 * Supprime le compte de l'utilisateur connecté
 *
 * Cette action est irréversible et supprime toutes les données associées à l'utilisateur.
 * Note: Cet endpoint requiert une session active (pas de clé API) pour des raisons de sécurité.
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
		console.error('DELETE /api/users/me error', err);
		return json({ error: err.message }, { status: 500 });
	}
};
