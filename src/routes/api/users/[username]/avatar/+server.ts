import { error as svelteError, isHttpError } from '@sveltejs/kit';

import { getDatabase } from '$lib/db/database';
import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireScope } from '$lib/server/permissions';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

/**
 * GET /api/users/[username]/avatar
 * Récupère la photo de profil d'un utilisateur par son id_user
 * Requires: authentification (session cookie, auth provider, ou clé API avec scope 'read')
 */
export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'read');
	try {
		const { username } = event.params;
		const { fetch } = event;
		if (!username) {
			return svelteError(400, "Nom d'utilisateur manquant");
		}

		const db = getDatabase();

		const userStmt = db.prepare('SELECT id_photos FROM users WHERE id_user = ?');
		const user = userStmt.get(username) as { id_photos?: string | null } | undefined;

		if (!user) {
			return svelteError(404, 'Utilisateur non trouvé');
		}

		const userId = user.id_photos;
		if (!userId || typeof userId !== 'string') {
			return svelteError(404, 'Utilisateur sans id_photos');
		}

		if (!IMMICH_BASE_URL) {
			return svelteError(500, 'IMMICH_BASE_URL not configured');
		}

		const res = await fetch(`${IMMICH_BASE_URL}/api/people/${userId}/thumbnail`, {
			headers: {
				'x-api-key': IMMICH_API_KEY
			}
		});

		if (!res.ok) {
			return svelteError(res.status, 'Photo non trouvée');
		}

		const blob = await res.blob();

		return new Response(blob, {
			headers: {
				'Content-Type': res.headers.get('content-type') || 'image/jpeg',
				'Cache-Control': 'public, max-age=3600'
			}
		});
	} catch (err: unknown) {
		if (isHttpError(err)) {
			throw err;
		}
		const errorMessage = err instanceof Error ? err.message : 'Erreur serveur';
		console.error('Erreur /api/users/[username]/avatar:', err);
		return svelteError(500, errorMessage);
	}
};
