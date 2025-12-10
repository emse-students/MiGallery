import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { verifySigned } from '$lib/auth/cookies';

/**
 * PATCH /api/users/me/face
 * Met à jour l'ID de la personne (id_photos) et le statut first_login de l'utilisateur connecté
 */
export const PATCH: RequestHandler = async ({ request, locals, cookies }) => {
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

		if (!userId) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const body = (await request.json()) as { person_id?: string };
		const personId = body.person_id;

		if (!personId || typeof personId !== 'string') {
			return json({ error: 'person_id is required and must be a string' }, { status: 400 });
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
