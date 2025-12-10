import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { verifySigned } from '$lib/auth/cookies';
import { requireScope } from '$lib/server/permissions';

/**
 * PATCH /api/users/me/promo
 * Met à jour l'année de promotion et le statut first_login de l'utilisateur connecté
 */
export const PATCH: RequestHandler = async (event) => {
	const { request, locals, cookies } = event;

	// Vérifier l'authentification via API key ou session
	await requireScope(event, 'read');

	try {
		const db = getDatabase();

		// Récupérer l'utilisateur connecté via cookie
		const cookieSigned = cookies.get('current_user_id') ?? null;
		let userId: string | null = null;

		if (cookieSigned) {
			const verified = verifySigned(cookieSigned);
			if (verified) {
				userId = verified;
			}
		}

		// Fallback sur la session provider
		if (!userId && locals && typeof locals.auth === 'function') {
			const session = await locals.auth();
			if (session?.user) {
				const user = session.user as { id?: string; preferred_username?: string; sub?: string };
				userId = user.id || user.preferred_username || user.sub || null;
			}
		}

		// Fallback sur l'userId défini par requireScope (API key avec user associé)
		if (!userId && locals.userId) {
			userId = locals.userId as string;
		}

		if (!userId) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const body = (await request.json()) as { promo_year?: number };
		const promoYear = body.promo_year;

		if (!promoYear || typeof promoYear !== 'number') {
			return json({ error: 'promo_year is required and must be a number' }, { status: 400 });
		}

		// Mettre à jour l'année de promo et marquer first_login à 0
		const stmt = db.prepare('UPDATE users SET promo_year = ?, first_login = 0 WHERE id_user = ?');
		const result = stmt.run(promoYear, userId);

		if (result.changes === 0) {
			return json({ error: 'User not found' }, { status: 404 });
		}

		return json({ success: true, promo_year: promoYear });
	} catch (e) {
		const err = e as Error;
		console.error('PATCH /api/users/me/promo error', err);
		return json({ error: err.message }, { status: 500 });
	}
};
