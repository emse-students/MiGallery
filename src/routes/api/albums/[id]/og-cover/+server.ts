import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import path from 'node:path';
import sharp from '$lib/server/sharp-config';
import { getDatabase } from '$lib/db/database';
import { resolveCover } from '$lib/server/album-cover';
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
 * Public for every album, like the square variant: both serve one cropped photo
 * and both are loaded by external <img> / unfurler requests that carry no key.
 *
 * The image is cached to disk for subsequent requests.
 */
export const GET: RequestHandler = async ({ params, fetch }) => {
	const { id } = params;
	if (!id) {
		throw error(400, 'Missing album ID');
	}

	const db = getDatabase();
	const row = db.prepare('SELECT id FROM albums WHERE id = ?').get(id) as
		| { id?: string }
		| undefined;

	if (!row) {
		throw error(404, 'Album not found');
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
		throw error(500, 'Media backend not configured');
	}

	// Same persisted cover as the square variant, so both formats always show
	// the same photo and neither re-asks the backend which asset that is.
	const cover = await resolveCover(id, fetch);
	if (!cover) {
		throw error(404, 'Album has no cover image');
	}
	const assetId = cover.assetId;

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
