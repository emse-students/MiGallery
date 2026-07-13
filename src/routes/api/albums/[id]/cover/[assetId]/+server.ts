import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import fs from 'node:fs';
import path from 'node:path';
import sharp from '$lib/server/sharp-config';
import { requireScope } from '$lib/server/permissions';
import { getDatabase } from '$lib/db/database';

import { createLogger } from '$lib/server/logger';

const log = createLogger('albums-id-cover-assetId');
const CACHE_DIR = path.resolve('data/cache/covers');

// Cache initialization
try {
	if (!fs.existsSync(CACHE_DIR)) {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
	}
} catch (e) {
	log.error('Failed to create cache directory', e);
}

// Semaphore to limit concurrent Sharp processing and prevent memory crashes
// when many albums are loaded at the same time.
const MAX_CONCURRENT_SHARP = 4;
const MAX_QUEUE_SIZE = 12;
let runningSharp = 0;
const sharpQueue: Array<() => void> = [];

function acquireSharp(): Promise<(() => void) | null> {
	if (sharpQueue.length >= MAX_QUEUE_SIZE) {
		return Promise.resolve(null);
	}
	return new Promise((resolve) => {
		const tryAcquire = () => {
			if (runningSharp < MAX_CONCURRENT_SHARP) {
				runningSharp++;
				resolve(() => {
					runningSharp--;
					const next = sharpQueue.shift();
					if (next) {
						next();
					}
				});
			} else {
				sharpQueue.push(tryAcquire);
			}
		};
		tryAcquire();
	});
}

/**
 * GET: Fetches the cover image (with resizing and caching)
 */
export const GET: RequestHandler = async (event) => {
	const { params, fetch } = event;
	const { id: albumId, assetId } = params;

	if (!albumId || !assetId) {
		throw error(400, 'Missing albumId or assetId');
	}

	// Visibility check
	let isUnlisted = false;
	try {
		const db = getDatabase();
		const row = db.prepare('SELECT visibility FROM albums WHERE id = ?').get(albumId) as
			| { visibility?: string }
			| undefined;
		isUnlisted = row?.visibility === 'unlisted';
	} catch (e) {
		log.warn('Visibility check failed', e);
	}

	if (!isUnlisted) {
		await requireScope(event, 'read');
	}

	// Cache check
	const cacheFile = path.join(CACHE_DIR, `${assetId}.webp`);
	if (fs.existsSync(cacheFile)) {
		const buffer = fs.readFileSync(cacheFile);
		// Cache-Control: 180 days ~ 6 months
		return new Response(new Uint8Array(buffer), {
			headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=15552000' }
		});
	}

	const apiKey = env.IMMICH_API_KEY;
	const baseUrl = env.IMMICH_BASE_URL;
	if (!apiKey || !baseUrl) {
		throw error(500, 'Immich config missing');
	}

	// Acquire the lock BEFORE any download: otherwise N concurrent requests
	// materialize N buffers in native RAM, beyond control
	// (the semaphore would only bound Sharp processing). By also bounding
	// fetch, at most MAX_CONCURRENT_SHARP images are resident at a time.
	const release = await acquireSharp();
	if (!release) {
		// Queue full: redirect to the proxied Immich thumbnail
		// rather than load an image in RAM and risk OOM under burst.
		log.warn('Sharp queue full, redirecting to proxied thumbnail');
		return new Response(null, {
			status: 307,
			headers: {
				Location: `/api/immich/assets/${assetId}/thumbnail?size=preview`,
				'Cache-Control': 'no-store'
			}
		});
	}

	try {
		// Source = "preview" thumbnail (≈ a few hundred KB) not
		// full resolution original (JPEG 5-30 MB, RAW 50 MB+): never
		// materialize a large native buffer to produce a 400×400 thumbnail.
		const thumbUrl = `${baseUrl}/api/assets/${assetId}/thumbnail?size=preview`;
		const thumbRes = await fetch(thumbUrl, { headers: { 'x-api-key': apiKey } });
		if (!thumbRes.ok) {
			throw error(thumbRes.status, 'Image source not found');
		}

		const buf = Buffer.from(await thumbRes.arrayBuffer());
		return await processAndCacheImage(buf, cacheFile);
	} catch (e) {
		// Preserves typed HTTP errors (404, etc.) instead of masking them as 500.
		if (e && typeof e === 'object' && 'status' in e) {
			throw e;
		}
		log.error('Error processing cover:', e);
		throw error(500, 'Internal Server Error');
	} finally {
		release();
	}
};

/**
 * PUT: Sets this asset as the album cover
 */
export const PUT: RequestHandler = async (event) => {
	const { params } = event;
	const { id: albumId, assetId } = params;

	await requireScope(event, 'write');

	if (!albumId || !assetId) {
		throw error(400, 'Missing params');
	}

	try {
		const db = getDatabase();
		const result = db
			.prepare('UPDATE albums SET coverAssetId = ? WHERE id = ?')
			.run(assetId, albumId);

		if (result.changes === 0) {
			throw error(404, 'Album non trouvé');
		}

		return json({ success: true });
	} catch (e) {
		log.error('Failed to set album cover:', e);
		throw error(500, 'Database error');
	}
};

/**
 * Image processing utility with Sharp.
 * The Sharp semaphore is acquired/released by the caller (see GET), which obtains it
 * BEFORE download to also bound the memory of ongoing fetches.
 */
async function processAndCacheImage(buffer: Buffer, cachePath: string): Promise<Response> {
	try {
		const processed = await sharp(buffer)
			.resize(400, 400, { fit: 'cover', position: 'center' })
			.webp({ quality: 50 })
			.toBuffer();

		try {
			fs.writeFileSync(cachePath, processed);
		} catch (e) {
			log.error('Cache write failed', e);
		}

		return new Response(new Uint8Array(processed), {
			headers: {
				'Content-Type': 'image/webp',
				// Cache-Control: 180 days ~ 6 months
				'Cache-Control': 'public, max-age=15552000'
			}
		});
	} catch (e) {
		log.error('Sharp processing failed', e);
		// Returns the raw image if Sharp processing fails
		return new Response(new Uint8Array(buffer), { headers: { 'Content-Type': 'image/jpeg' } });
	}
}
