import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import path from 'node:path';
import sharp from '$lib/server/sharp-config';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';
import type { ImmichAlbum } from '$lib/types/api';
import { ensureCacheDir, readCacheFile, writeCacheFileAtomic } from '$lib/server/disk-cache';

import { createLogger } from '$lib/server/logger';

const log = createLogger('albums-id-og-cover');
const CACHE_DIR = path.resolve('data/cache/og-covers');

try {
	ensureCacheDir(CACHE_DIR);
} catch (e) {
	log.error('Failed to create cache dir', e);
}

/**
 * GET /api/albums/[id]/og-cover
 *
 * Serves the album cover resized to Open Graph format (1200×630 WebP).
 * Used for link previews in Canari.
 *
 * - Unlisted / authenticated albums: free access (no auth required).
 * - Private albums: requires an API key with 'read' scope (e.g., Canari via x-api-key).
 *
 * The image is cached to disk for subsequent requests.
 */
export const GET: RequestHandler = async (event) => {
	const { params, fetch } = event;
	const { id } = params;
	if (!id) {
		throw error(400, 'Missing album ID');
	}

	const db = getDatabase();
	const row = db.prepare('SELECT visibility FROM albums WHERE id = ?').get(id) as
		| { visibility?: string }
		| undefined;

	if (!row) {
		throw error(404, 'Album not found');
	}

	// Private albums require an API key; others are public.
	if (row.visibility === 'private') {
		await requireScope(event, 'read');
	}

	const cacheFile = path.join(CACHE_DIR, `${id}.webp`);
	const cached = readCacheFile(cacheFile);
	if (cached) {
		return new Response(new Uint8Array(cached), {
			headers: {
				'Content-Type': 'image/webp',
				'Cache-Control': 'public, max-age=86400'
			}
		});
	}

	const apiKey = env.IMMICH_API_KEY;
	const baseUrl = env.IMMICH_BASE_URL;
	if (!apiKey || !baseUrl) {
		throw error(500, 'Immich config missing');
	}

	// Fetches the thumbnail asset ID from Immich
	const albumRes = await fetch(`${baseUrl}/api/albums/${id}`, {
		headers: { 'x-api-key': apiKey }
	});
	if (!albumRes.ok) {
		throw error(albumRes.status, 'Album not found in Immich');
	}

	const album = (await albumRes.json()) as ImmichAlbum;
	const assetId = album.albumThumbnailAssetId;
	if (!assetId) {
		throw error(404, 'Album has no cover image');
	}

	const thumbRes = await fetch(`${baseUrl}/api/assets/${assetId}/thumbnail?size=preview`, {
		headers: { 'x-api-key': apiKey }
	});
	if (!thumbRes.ok) {
		throw error(500, 'Failed to fetch thumbnail from Immich');
	}

	const buf = Buffer.from(await thumbRes.arrayBuffer());

	try {
		const processed = await sharp(buf)
			.resize(1200, 630, { fit: 'cover', position: 'center' })
			.webp({ quality: 70 })
			.toBuffer();

		try {
			writeCacheFileAtomic(cacheFile, processed);
		} catch (e) {
			log.error('Cache write failed', e);
		}

		return new Response(new Uint8Array(processed), {
			headers: {
				'Content-Type': 'image/webp',
				'Cache-Control': 'public, max-age=86400'
			}
		});
	} catch (e) {
		log.error('Sharp processing failed, returning raw', e);
		return new Response(new Uint8Array(buf), {
			headers: { 'Content-Type': 'image/jpeg' }
		});
	}
};
