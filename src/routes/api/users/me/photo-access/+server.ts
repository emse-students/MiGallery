import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireSession } from '$lib/server/permissions';

interface PhotoAccessPermission {
	authorized_id: string;
	authorized_name: string;
	authorized_first_name: string | null;
	authorized_last_name: string | null;
	created_at: string;
}

interface UserBasic {
	id_user: string;
	name: string;
	first_name: string | null;
	last_name: string | null;
}

/**
 * GET /api/users/me/photo-access
 * Récupère la liste des personnes autorisées à voir mes photos
 */
export const GET: RequestHandler = async (event) => {
	const user = await requireSession(event);

	try {
		const db = getDatabase();

		const permissions = db
			.prepare(
				`SELECT
					p.authorized_id,
					u.name as authorized_name,
					u.first_name as authorized_first_name,
					u.last_name as authorized_last_name,
					p.created_at
				FROM photo_access_permissions p
				JOIN users u ON u.id_user = p.authorized_id
				WHERE p.owner_id = ?
				ORDER BY u.name, u.first_name`
			)
			.all(user.id_user) as PhotoAccessPermission[];

		return json({ success: true, permissions });
	} catch (e) {
		const err = e as Error;
		console.error('GET /api/users/me/photo-access error', err);
		return json({ error: err.message }, { status: 500 });
	}
};

/**
 * POST /api/users/me/photo-access
 * Ajoute une autorisation pour qu'un utilisateur puisse voir mes photos
 *
 * Body:
 * - user_id: string (l'identifiant utilisateur MiGallery complet, fourni par le système OIDC)
 *
 * NOTE: Les identifiants utilisateurs MiGallery sont des ID complets (UUID-like) fournis par le service d'authentification OIDC.
 * Ils ne sont pas au format "prenom.nom" - utilisez l'ID complet affiché dans le profil de l'utilisateur.
 */
export const POST: RequestHandler = async (event) => {
	const user = await requireSession(event);

	try {
		const db = getDatabase();
		const body = (await event.request.json()) as { user_id?: string };

		if (!body.user_id || typeof body.user_id !== 'string') {
			return json({ error: 'user_id is required' }, { status: 400 });
		}

		const authorizedId = body.user_id.trim();

		if (authorizedId === user.id_user) {
			return json({ error: 'Vous ne pouvez pas vous autoriser vous-même' }, { status: 400 });
		}

		const targetUser = db
			.prepare('SELECT id_user, name, first_name, last_name FROM users WHERE id_user = ?')
			.get(authorizedId) as UserBasic | undefined;

		if (!targetUser) {
			return json(
				{
					error:
						"Utilisateur non trouvé. Veuillez vérifier l'identifiant utilisateur MiGallery (disponible sur le profil de la personne)."
				},
				{ status: 404 }
			);
		}

		db
			.prepare(
				'INSERT OR IGNORE INTO photo_access_permissions (owner_id, authorized_id) VALUES (?, ?)'
			)
			.run(user.id_user, authorizedId);

		return json({
			success: true,
			message: `${targetUser.name} peut maintenant voir vos photos`,
			user: targetUser
		});
	} catch (e) {
		const err = e as Error;
		console.error('POST /api/users/me/photo-access error', err);
		return json({ error: err.message }, { status: 500 });
	}
};

/**
 * DELETE /api/users/me/photo-access
 * Révoque l'autorisation d'un utilisateur à voir mes photos
 *
 * Body:
 * - user_id: string (l'identifiant de l'utilisateur à révoquer)
 */
export const DELETE: RequestHandler = async (event) => {
	const user = await requireSession(event);

	try {
		const db = getDatabase();
		const body = (await event.request.json()) as { user_id?: string };

		if (!body.user_id || typeof body.user_id !== 'string') {
			return json({ error: 'user_id is required' }, { status: 400 });
		}

		const authorizedId = body.user_id.trim();

		const result = db
			.prepare('DELETE FROM photo_access_permissions WHERE owner_id = ? AND authorized_id = ?')
			.run(user.id_user, authorizedId);

		if (result.changes === 0) {
			return json({ error: 'Autorisation non trouvée' }, { status: 404 });
		}

		return json({ success: true, message: 'Autorisation révoquée' });
	} catch (e) {
		const err = e as Error;
		console.error('DELETE /api/users/me/photo-access error', err);
		return json({ error: err.message }, { status: 500 });
	}
};
