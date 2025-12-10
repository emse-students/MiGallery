import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';
import { error } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

export const GET: RequestHandler = async (event) => {
	try {
		const albumId = event.params.id;
		const assetId = event.params.assetId;
		const { fetch, request } = event;

		if (!IMMICH_BASE_URL) {
			throw error(500, 'IMMICH_BASE_URL not configured');
		}

		// Check local DB album visibility (our source of truth)
		let localVisibility: string | undefined = undefined;
		try {
			const db = getDatabase();
			const row = db.prepare('SELECT visibility FROM albums WHERE id = ?').get(albumId) as
				| { visibility?: string }
				| undefined;
			localVisibility = row?.visibility;
		} catch (dbErr: unknown) {
			console.warn('[asset-thumbnail] failed to read local DB visibility', dbErr);
		}

		const visibilityHint = (() => {
			try {
				return new URL(request.url).searchParams.get('visibility') || null;
			} catch {
				return null;
			}
		})();

		const isUnlisted = visibilityHint === 'unlisted' || localVisibility === 'unlisted';

		if (!isUnlisted) {
			// require auth or x-api-key with read scope
			await requireScope(event, 'read');
		}

		if (!IMMICH_API_KEY) {
			throw error(500, 'IMMICH_API_KEY not configured on server');
		}

		// Fetch the thumbnail via the internal immich proxy and stream back to client
		const size = new URL(request.url).searchParams.get('size') || 'thumbnail';
		const proxied = await fetch(
			`/api/immich/assets/${assetId}/thumbnail?size=${encodeURIComponent(size)}`,
			{
				headers: {
					'x-internal-immich-key': IMMICH_API_KEY,
					Accept: 'application/octet-stream'
				}
			}
		);

		if (!proxied.ok) {
			// try to read a small body for diagnostics
			let bodySnippet = '';
			try {
				bodySnippet = await proxied.clone().text();
			} catch {
				/* ignore */
			}
			console.error('[asset-thumbnail] upstream returned non-ok', {
				assetId,
				status: proxied.status,
				snippet: bodySnippet.slice(0, 400)
			});
			return new Response(bodySnippet || proxied.statusText, { status: proxied.status });
		}

		// Copy relevant headers
		const headers: Record<string, string> = {};
		const contentType = proxied.headers.get('content-type');
		if (contentType) {
			headers['content-type'] = contentType;
		}
		const cacheControl = proxied.headers.get('cache-control');
		if (cacheControl) {
			headers['cache-control'] = cacheControl;
		}

		return new Response(proxied.body, { status: proxied.status, headers });
	} catch (e: unknown) {
		const err = ensureError(e);
		console.error('[asset-thumbnail] error', err);
		if (e && typeof e === 'object' && 'status' in e) {
			throw e;
		}
		throw error(500, err.message);
	}
};
