import { error as svelteError, isHttpError } from '@sveltejs/kit';

import { getDatabase } from '$lib/db/database';
import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireScope } from '$lib/server/permissions';

import { createLogger } from '$lib/server/logger';

const log = createLogger('users-username-avatar');
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

/**
 * GET /api/users/[username]/avatar
 * Gets a user's profile photo by their id_user
 * Requires: authentication (session cookie, auth provider, or API key with 'read' scope)
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

		const userStmt = db.prepare('SELECT photos_id FROM users WHERE id_user = ?');
		const user = userStmt.get(username) as { photos_id?: string | null } | undefined;

		if (!user) {
			return svelteError(404, 'Utilisateur non trouvé');
		}

		const userId = user.photos_id;
		if (!userId || typeof userId !== 'string') {
			return svelteError(404, 'Utilisateur sans photos_id');
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
		log.error('Error /api/users/[username]/avatar:', err);
		return svelteError(500, errorMessage);
	}
};
