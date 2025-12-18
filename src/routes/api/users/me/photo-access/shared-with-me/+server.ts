import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireSession } from '$lib/server/permissions';

interface SharedWithMe {
	owner_id: string;
	owner_prenom: string;
	owner_nom: string;
	created_at: string;
}

/**
 * GET /api/users/me/photo-access/shared-with-me
 * Récupère la liste des personnes qui m'ont autorisé à voir leurs photos
 */
export const GET: RequestHandler = async (event) => {
	const user = await requireSession(event);

	try {
		const db = getDatabase();

		const sharedWithMe = db
			.prepare(
				`SELECT
					p.owner_id,
					u.prenom as owner_prenom,
					u.nom as owner_nom,
					p.created_at
				FROM photo_access_permissions p
				JOIN users u ON u.id_user = p.owner_id
				WHERE p.authorized_id = ?
				ORDER BY u.nom, u.prenom`
			)
			.all(user.id_user) as SharedWithMe[];

		return json({ success: true, shared_by: sharedWithMe });
	} catch (e) {
		const err = e as Error;
		console.error('GET /api/users/me/photo-access/shared-with-me error', err);
		return json({ error: err.message }, { status: 500 });
	}
};
