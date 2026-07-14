import { error as svelteError, isHttpError } from '@sveltejs/kit';

import { getDatabase } from '$lib/db/database';
import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireScope } from '$lib/server/permissions';
import { generateFaceCrop } from '$lib/server/face-crop';

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
			return svelteError(400, 'Missing username');
		}

		const db = getDatabase();

		const userStmt = db.prepare('SELECT photos_id, photos_asset_id FROM users WHERE id_user = ?');
		const user = userStmt.get(username) as
			| { photos_id?: string | null; photos_asset_id?: string | null }
			| undefined;

		if (!user) {
			return svelteError(404, 'User not found');
		}

		const userId = user.photos_id;
		if (!userId || typeof userId !== 'string') {
			return svelteError(404, 'User has no photos_id');
		}

		// Prefer MiGallery's own square crop over Immich's tightly hard-coded person
		// thumbnail. When the URL carries a ?v cache-buster (keyed on the asset id)
		// the crop is immutable, so it can be cached for a long time; otherwise the
		// URL is stable per user, so keep a moderate cache. On any crop failure
		// (busy/notfound/config) fall through to the Immich proxy below.
		const assetId = user.photos_asset_id;
		if (assetId && typeof assetId === 'string') {
			const busted = event.url.searchParams.has('v');
			// The crop is fully determined by (assetId, userId), so the asset id is a
			// natural ETag. Busted URLs (?v=assetId) are immutable; unbusted URLs (e.g.
			// the shared Avatar component) are stable, so they must revalidate to avoid
			// serving a stale crop after a photo change.
			const etag = `"${assetId}"`;
			if (!busted && event.request.headers.get('if-none-match') === etag) {
				return new Response(null, {
					status: 304,
					headers: { ETag: etag, 'Cache-Control': 'no-cache' }
				});
			}
			const crop = await generateFaceCrop(assetId, userId, fetch);
			if (crop.ok) {
				return new Response(new Uint8Array(crop.buffer), {
					headers: {
						'Content-Type': 'image/webp',
						ETag: etag,
						'Cache-Control': busted ? 'public, max-age=15552000, immutable' : 'no-cache'
					}
				});
			}
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
			return svelteError(res.status, 'Photo not found');
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
		const errorMessage = err instanceof Error ? err.message : 'Server error';
		log.error('Error /api/users/[username]/avatar:', err);
		return svelteError(500, errorMessage);
	}
};
