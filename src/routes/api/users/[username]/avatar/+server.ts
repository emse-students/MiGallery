// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { json, error as svelteError } from '@sveltejs/kit';

import { getDatabase } from '$lib/db/database';
import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { verifySigned } from '$lib/auth/cookies';
import { verifyRawKeyWithScope } from '$lib/db/api-keys';
import type { User } from '$lib/types/api';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

async function getUserFromLocals(
	locals: App.Locals,
	cookies: { get: (name: string) => string | undefined }
): Promise<User | null> {
	const db = getDatabase();

	// Try cookie first (fast path)
	const cookieSigned = cookies.get('current_user_id');
	if (cookieSigned) {
		const verified = verifySigned(cookieSigned);
		if (verified) {
			const userInfo = db
				.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1')
				.get(verified) as User | null;
			if (userInfo) {
				return userInfo;
			}
		}
	}

	// Fallback to auth provider
	if (locals && typeof locals.auth === 'function') {
		const session = await locals.auth();
		if (session?.user) {
			const providerId: string | undefined = (session.user.id ||
				session.user.preferred_username ||
				session.user.sub) as string | undefined;
			if (providerId) {
				const userInfo = db
					.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1')
					.get(providerId) as User | null;
				if (userInfo) {
					return userInfo;
				}
			}
		}
	}

	return null;
}

/**
 * GET /api/users/[username]/avatar
 * Récupère la photo de profil d'un utilisateur par son id_user
 * Requires: authentification (session cookie, auth provider, ou clé API avec scope 'read')
 */
export const GET: RequestHandler = async ({ params, fetch, locals, cookies, request }) => {
	try {
		// Vérifier l'authentification via clé API ou session
		const apiKeyHeader = request.headers.get('x-api-key') || request.headers.get('X-API-KEY');
		let authenticated = false;

		if (apiKeyHeader) {
			// Vérifier la clé API avec scope 'read'
			authenticated = verifyRawKeyWithScope(apiKeyHeader, 'read') as boolean;
		} else {
			// Vérifier la session
			const caller = await getUserFromLocals(locals, cookies);
			authenticated = !!caller;
		}

		if (!authenticated) {
			return svelteError(401, 'Unauthorized');
		}

		const { username } = params;
		if (!username) {
			return svelteError(400, "Nom d'utilisateur manquant");
		}

		const db = getDatabase();

		// Chercher l'utilisateur par son id_user
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

		// Récupérer la photo de profil depuis Immich
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
		const errorMessage = err instanceof Error ? err.message : 'Erreur serveur';
		console.error('Erreur /api/users/[username]/avatar:', err);
		return svelteError(500, errorMessage);
	}
};
