import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireSession } from '$lib/server/permissions';

import { createLogger } from '$lib/server/logger';

const log = createLogger('users-me-photo-access-options');
interface UserOption {
	id_user: string;
	name: string;
	first_name: string | null;
	last_name: string | null;
	formation: string | null;
	promo: number | null;
}

/**
 * GET /api/users/me/photo-access/options
 * Fetches the list of users available for photo sharing
 * (all users except the current user)
 */
export const GET: RequestHandler = async (event) => {
	const user = await requireSession(event);

	try {
		const db = getDatabase();

		const users = db
			.prepare(
				`SELECT id_user, name, first_name, last_name, formation, promo
				 FROM users
				 WHERE id_user != ?
				 ORDER BY name ASC, first_name ASC`
			)
			.all(user.id_user) as UserOption[];

		const formattedUsers = users.map((u) => ({
			id_user: u.id_user,
			name: u.name || [u.first_name, u.last_name].filter(Boolean).join(' '),
			first_name: u.first_name,
			last_name: u.last_name,
			formation: u.formation,
			promo: u.promo
		}));

		return json({ success: true, users: formattedUsers });
	} catch (e) {
		const err = e as Error;
		log.error('GET /api/users/me/photo-access/options error', err);
		return json({ error: err.message }, { status: 500 });
	}
};
