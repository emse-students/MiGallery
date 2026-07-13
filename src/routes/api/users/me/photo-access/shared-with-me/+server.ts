import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireSession } from '$lib/server/permissions';

import { createLogger } from '$lib/server/logger';

const log = createLogger('users-me-photo-access-shared-with-me');
interface SharedWithMe {
	owner_id: string;
	owner_name: string;
	owner_first_name: string | null;
	owner_last_name: string | null;
	owner_promo: number | null;
	owner_formation: string | null;
	created_at: string;
}

/**
 * GET /api/users/me/photo-access/shared-with-me
 * Fetches the list of people who authorized me to view their photos
 */
export const GET: RequestHandler = async (event) => {
	const user = await requireSession(event);

	try {
		const db = getDatabase();

		const sharedWithMe = db
			.prepare(
				`SELECT
					p.owner_id,
					u.name as owner_name,
					u.first_name as owner_first_name,
					u.last_name as owner_last_name,
					u.promo as owner_promo,
					u.formation as owner_formation,
					p.created_at
				FROM photo_access_permissions p
				JOIN users u ON u.id_user = p.owner_id
				WHERE p.authorized_id = ?
				ORDER BY u.name, u.first_name`
			)
			.all(user.id_user) as SharedWithMe[];

		return json({ success: true, shared_by: sharedWithMe });
	} catch (e) {
		const err = e as Error;
		log.error('GET /api/users/me/photo-access/shared-with-me error', err);
		return json({ error: err.message }, { status: 500 });
	}
};
