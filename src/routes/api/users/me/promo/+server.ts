import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { verifySigned } from '$lib/auth/cookies';
import { requireScope } from '$lib/server/permissions';

const SESSION_COOKIE_NAME = '__session_user';

/**
 * PATCH /api/users/me/promo
 * Met à jour l'année de promotion et le statut first_login de l'utilisateur connecté
 */
export const PATCH: RequestHandler = async (event) => {
	const { request, locals, cookies } = event;

	const auth = await requireScope(event, 'read');

	try {
		const db = getDatabase();

		const cookieSigned = cookies.get('current_user_id') ?? null;
		let userId: string | null = auth.user?.id_user ?? null;

		if (cookieSigned) {
			const verified = verifySigned(cookieSigned);
			if (verified) {
				userId = verified;
			}
		}

		if (!userId) {
			const sessionUserId = cookies.get(SESSION_COOKIE_NAME) ?? null;
			if (sessionUserId) {
				userId = sessionUserId;
			}
		}

		if (!userId) {
			const localUser = locals.user as { id?: string; id_user?: string } | null | undefined;
			userId = localUser?.id_user || localUser?.id || null;
		}

		if (!userId) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const body = (await request.json()) as { promo?: number | null; promo_year?: number | null };
		const promoYear = body.promo ?? body.promo_year ?? null;
		const currentYear = new Date().getFullYear();

		// On accepte null (personnel) ou un nombre (étudiant)
		if (promoYear !== null && typeof promoYear !== 'number') {
			return json({ error: 'promo_year must be a number or null' }, { status: 400 });
		}
		if (
			typeof promoYear === 'number' &&
			promoYear !== 0 &&
			(promoYear < 1816 || promoYear > currentYear)
		) {
			return json(
				{ error: `promo_year must be 0 or between 1816 and ${currentYear}` },
				{ status: 400 }
			);
		}

		const stmt = db.prepare('UPDATE users SET promo = ? WHERE id_user = ?');
		const result = stmt.run(promoYear, userId);

		if (result.changes === 0) {
			return json({ error: 'User not found' }, { status: 404 });
		}

		return json({ success: true, promo: promoYear, promo_year: promoYear });
	} catch (e) {
		const err = e as Error;
		console.error('PATCH /api/users/me/promo error', err);
		return json({ error: err.message }, { status: 500 });
	}
};
