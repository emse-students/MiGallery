import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireSession } from '$lib/server/permissions';

import { createLogger } from '$lib/server/logger';

const log = createLogger('users-me-promo');

/**
 * PATCH /api/users/me/promo
 * Updates the promotion year and first_login status of the logged-in user
 */
export const PATCH: RequestHandler = async (event) => {
	const { request } = event;

	// "me" is whoever the session says it is - there is no other answer to look for.
	const userId = (await requireSession(event)).id_user;

	try {
		const db = getDatabase();

		const body = (await request.json()) as { promo?: number | null };
		const promoYear = body.promo ?? null;
		const currentYear = new Date().getFullYear();

		// We accept null (staff) or a number (student)
		if (promoYear !== null && typeof promoYear !== 'number') {
			return json({ error: 'promo must be a number or null' }, { status: 400 });
		}
		if (
			typeof promoYear === 'number' &&
			promoYear !== 0 &&
			(promoYear < 1816 || promoYear > currentYear)
		) {
			return json({ error: `promo must be 0 or between 1816 and ${currentYear}` }, { status: 400 });
		}

		const stmt = db.prepare('UPDATE users SET promo = ?, first_login = 0 WHERE id_user = ?');
		const result = stmt.run(promoYear, userId);

		if (result.changes === 0) {
			return json({ error: 'User not found' }, { status: 404 });
		}

		return json({ success: true, promo: promoYear });
	} catch (e) {
		const err = e as Error;
		log.error('PATCH /api/users/me/promo error', err);
		return json({ error: err.message }, { status: 500 });
	}
};
