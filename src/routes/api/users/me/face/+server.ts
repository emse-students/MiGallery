import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { verifySigned } from '$lib/auth/cookies';
import { requireScope } from '$lib/server/permissions';

/**
 * PATCH /api/users/me/face
 * Met à jour l'ID de la personne (id_photos) et le statut first_login de l'utilisateur connecté
 *
 * Body:
 * - person_id: string | null (requis) - L'ID de la personne à associer
 * - user_id: string (optionnel, admin seulement) - Permet de modifier un autre utilisateur
 */
export const PATCH: RequestHandler = async (event) => {
	const { request, locals, cookies } = event;

	// Vérifier l'authentification via API key ou session
	const auth = await requireScope(event, 'read');

	try {
		const db = getDatabase();
		const body = (await request.json()) as { person_id?: string | null; user_id?: string };

		// Récupérer l'utilisateur cible
		let userId: string | null = null;

		// Si admin et user_id fourni, utiliser celui-ci
		if (auth.grantedScope === 'admin' && body.user_id) {
			userId = body.user_id;
		} else {
			// Sinon, identifier l'utilisateur connecté via cookie
			const cookieSigned = cookies.get('current_user_id') ?? null;

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
		}

		if (!userId) {
			return json({ error: 'Unauthorized - no user identified' }, { status: 401 });
		}

		const personId = body.person_id;

		// Accepter null ou une chaîne non vide
		if (personId !== null && (personId === undefined || typeof personId !== 'string')) {
			return json({ error: 'person_id is required and must be a string or null' }, { status: 400 });
		}

		// Mettre à jour l'ID de la personne et marquer first_login à 0
		const stmt = db.prepare('UPDATE users SET id_photos = ?, first_login = 0 WHERE id_user = ?');
		const result = stmt.run(personId, userId);

		if (result.changes === 0) {
			return json({ error: 'User not found' }, { status: 404 });
		}

		return json({ success: true, person_id: personId });
	} catch (e) {
		const err = e as Error;
		console.error('PATCH /api/users/me/face error', err);
		return json({ error: err.message }, { status: 500 });
	}
};
