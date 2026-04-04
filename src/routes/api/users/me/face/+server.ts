import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { verifySigned } from '$lib/auth/cookies';
import { requireScope } from '$lib/server/permissions';

const SESSION_COOKIE_NAME = '__session_user';

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

	const auth = await requireScope(event, 'read');
	console.warn('🔍 [Face Pairing] PATCH /api/users/me/face - Début de la requête', {
		scope: auth.grantedScope
	});

	try {
		const db = getDatabase();
		const body = (await request.json()) as { person_id?: string | null; user_id?: string };

		let userId: string | null = null;

		if (auth.grantedScope === 'admin' && body.user_id) {
			userId = body.user_id;
			console.warn("👨‍💼 [Face Pairing] Admin mode - modification d'un autre utilisateur:", userId);
		} else {
			const cookieSigned = cookies.get('current_user_id') ?? null;
			userId = auth.user?.id_user ?? null;

			if (cookieSigned) {
				const verified = verifySigned(cookieSigned);
				if (verified) {
					userId = verified;
					console.debug('✅ [Face Pairing] Cookie signé vérifié:', userId);
				}
			}

			if (!userId) {
				const sessionUserId = cookies.get(SESSION_COOKIE_NAME) ?? null;
				if (sessionUserId) {
					userId = sessionUserId;
					console.debug('ℹ️  [Face Pairing] Utilisation du cookie session:', userId);
				}
			}

			if (!userId) {
				const localUser = locals.user as { id?: string; id_user?: string } | null | undefined;
				userId = localUser?.id_user || localUser?.id || null;
				console.debug('ℹ️  [Face Pairing] Utilisation du local user:', userId);
			}
		}

		if (!userId) {
			console.warn('⚠️  [Face Pairing] ERREUR: Aucun utilisateur identifié');
			return json({ error: 'Unauthorized - no user identified' }, { status: 401 });
		}

		const personId = body.person_id;
		console.warn("👤 [Face Pairing] Tentative d'assignation du visage:", { userId, personId });

		if (personId !== null && (personId === undefined || typeof personId !== 'string')) {
			console.error('❌ [Face Pairing] Type invalide pour person_id:', typeof personId);
			return json({ error: 'person_id is required and must be a string or null' }, { status: 400 });
		}

		if (personId) {
			console.warn('🔎 [Face Pairing] Vérification si le visage est déjà assigné...', personId);
			const existingUser = db
				.prepare('SELECT id_user FROM users WHERE photos_id = ? AND id_user != ?')
				.get(personId, userId) as { id_user: string } | undefined;

			if (existingUser) {
				console.error('⚠️  [Face Pairing] ERREUR: Visage déjà assigné à:', existingUser.id_user);
				return json(
					{
						error: 'face_already_assigned',
						message:
							"Ce visage a déjà été assigné à un autre compte. Si ce n'est pas le vôtre, merci de contacter bureau@mitv.fr"
					},
					{ status: 409 }
				);
			}
			console.debug("✅ [Face Pairing] Visage disponible, pas d'assignation précédente");
		}

		console.warn('💾 [Face Pairing] Mise à jour de la base de données...', { userId, personId });
		const stmt = db.prepare('UPDATE users SET photos_id = ? WHERE id_user = ?');
		const result = stmt.run(personId, userId);

		if (result.changes === 0) {
			console.error('❌ [Face Pairing] ERREUR: Utilisateur non trouvé:', userId);
			return json({ error: 'User not found' }, { status: 404 });
		}

		console.warn('🎉 [Face Pairing] Visage assigné avec succès!', {
			userId,
			personId,
			changes: result.changes
		});
		return json({ success: true, person_id: personId });
	} catch (e) {
		const err = e as Error;
		console.error('❌ [Face Pairing] PATCH /api/users/me/face - Erreur:', err.message, err.stack);
		return json({ error: err.message }, { status: 500 });
	}
};
