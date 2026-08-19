import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';
import { getCoverImage, resolveCover, storeCover } from '$lib/server/album-cover';
import { createLogger } from '$lib/server/logger';
import { OUTBOUND_BUDGET_MS } from '$lib/server/outbound';

const log = createLogger('albums-id-cover');

function albumVisibility(albumId: string): string | null {
	const db = getDatabase();
	const row = db.prepare('SELECT visibility FROM albums WHERE id = ?').get(albumId) as
		| { visibility?: string }
		| undefined;
	return row ? row.visibility || 'private' : null;
}

/**
 * GET /api/albums/[id]/cover
 *
 * Serves the album's square cover (400x400 WebP), persisted on disk.
 *
 * The URL is stable per album, so the gallery can render it on first paint
 * without asking which asset the cover is. Callers append `?v=<assetId>` to
 * bust the cache when the cover changes; that versioned form is `immutable`,
 * the bare form revalidates via ETag (an unversioned URL must never go stale).
 *
 * Public for every album, whatever its visibility: a cover is a 400x400 crop of
 * a single photo, and external sites (Canari) must be able to render it from an
 * <img> tag, which carries no key. The album's contents stay gated everywhere
 * else - this endpoint exposes the cover only.
 */
export const GET: RequestHandler = async (event) => {
	const { params, url, request, fetch } = event;
	const albumId = params.id;
	if (!albumId) {
		throw error(400, 'Missing album ID');
	}

	if (!albumVisibility(albumId)) {
		throw error(404, 'Album not found');
	}

	const cover = await resolveCover(albumId, fetch);
	if (!cover) {
		throw error(404, 'Album has no cover');
	}

	const versioned = url.searchParams.get('v') === cover.assetId;
	const etag = `"${cover.assetId}"`;
	if (!versioned && request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-cache' } });
	}

	const image = await getCoverImage(cover.assetId, fetch);
	if (!image) {
		// Queue saturated or source unavailable: fall back to the proxied
		// thumbnail rather than hold a native buffer under burst.
		if (!env.IMMICH_BASE_URL) {
			throw error(500, 'Media backend not configured');
		}
		return new Response(null, {
			status: 307,
			headers: {
				Location: `/api/immich/assets/${cover.assetId}/thumbnail?size=preview`,
				'Cache-Control': 'no-store'
			}
		});
	}

	return new Response(new Uint8Array(image), {
		headers: {
			'Content-Type': 'image/webp',
			ETag: etag,
			'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'public, no-cache'
		}
	});
};

/**
 * PUT /api/albums/[id]/cover
 *
 * Body: { assetId: string }
 *
 * Pins an asset as the album cover: updates the media backend, persists the
 * choice locally, and prunes the image of the cover it replaces.
 */
export const PUT: RequestHandler = async (event) => {
	const { params, request, fetch } = event;
	const albumId = params.id;

	await requireScope(event, 'write');

	if (!albumId) {
		throw error(400, 'Missing album ID');
	}
	if (!albumVisibility(albumId)) {
		throw error(404, 'Album not found');
	}

	const body = (await request.json().catch(() => null)) as { assetId?: string } | null;
	const assetId = body?.assetId;
	if (!assetId) {
		throw error(400, 'assetId is required');
	}

	const baseUrl = (env.IMMICH_BASE_URL || '').replace(/\/$/, '');
	const apiKey = env.IMMICH_API_KEY || '';
	if (!baseUrl) {
		throw error(500, 'Media backend not configured');
	}

	const res = await fetch(`${baseUrl}/api/albums/${albumId}`, {
		signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
		method: 'PATCH',
		headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
		body: JSON.stringify({ albumThumbnailAssetId: assetId })
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => res.statusText);
		log.warn(`Failed to set cover for album ${albumId}: ${detail}`);
		throw error(res.status, 'Failed to update the album cover');
	}

	const type =
		(
			(await res.json().catch(() => null)) as { assets?: Array<{ id: string; type?: string }> } | null
		)?.assets?.find((a) => a.id === assetId)?.type || 'IMAGE';

	storeCover(albumId, { assetId, type });

	return json({ success: true, assetId });
};
