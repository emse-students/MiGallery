import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { requireScope } from '$lib/server/permissions';
import { getDatabase } from '$lib/db/database';

const CACHE_DIR = path.resolve('data/cache/covers');

// Initialisation du cache
try {
	if (!fs.existsSync(CACHE_DIR)) {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
	}
} catch (e) {
	console.error('Failed to create cache directory', e);
}

/**
 * GET: Récupère l'image de couverture (avec redimensionnement et cache)
 */
export const GET: RequestHandler = async (event) => {
	const { params, fetch } = event;
	const { id: albumId, assetId } = params;

	if (!albumId || !assetId) {
		throw error(400, 'Missing albumId or assetId');
	}

	// Vérification visibilité
	let isUnlisted = false;
	try {
		const db = getDatabase();
		const row = db.prepare('SELECT visibility FROM albums WHERE id = ?').get(albumId) as
			| { visibility?: string }
			| undefined;
		isUnlisted = row?.visibility === 'unlisted';
	} catch (e) {
		console.warn('Visibility check failed', e);
	}

	if (!isUnlisted) {
		await requireScope(event, 'read');
	}

	// Vérification Cache
	const cacheFile = path.join(CACHE_DIR, `${assetId}.webp`);
	if (fs.existsSync(cacheFile)) {
		const buffer = fs.readFileSync(cacheFile);
		return new Response(new Uint8Array(buffer), {
			headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=604800' }
		});
	}

	const apiKey = env.IMMICH_API_KEY;
	const baseUrl = env.IMMICH_BASE_URL;
	if (!apiKey || !baseUrl) {
		throw error(500, 'Immich config missing');
	}

	try {
		const immichUrl = `${baseUrl}/api/assets/${assetId}/original`;
		const res = await fetch(immichUrl, { headers: { 'x-api-key': apiKey } });

		if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) {
			// Fallback sur miniature si l'original n'est pas une image ou est introuvable
			const thumbUrl = `${baseUrl}/api/assets/${assetId}/thumbnail?size=preview`;
			const thumbRes = await fetch(thumbUrl, { headers: { 'x-api-key': apiKey } });

			if (!thumbRes.ok) {
				throw error(thumbRes.status, 'Image source not found');
			}

			const thumbBuf = Buffer.from(await thumbRes.arrayBuffer());
			return await processAndCacheImage(thumbBuf, cacheFile);
		}

		const buf = Buffer.from(await res.arrayBuffer());
		return await processAndCacheImage(buf, cacheFile);
	} catch (e) {
		console.error('Error processing cover:', e);
		throw error(500, 'Internal Server Error');
	}
};

/**
 * PUT: Définit cet asset comme couverture de l'album
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
		console.error('Failed to set album cover:', e);
		throw error(500, 'Database error');
	}
};

/**
 * Utilitaire de traitement d'image avec Sharp
 */
async function processAndCacheImage(buffer: Buffer, cachePath: string): Promise<Response> {
	try {
		const processed = await sharp(buffer)
			.resize(600, 600, { fit: 'cover', position: 'center' })
			.webp({ quality: 80 })
			.toBuffer();

		try {
			fs.writeFileSync(cachePath, processed);
		} catch (e) {
			console.error('Cache write failed', e);
		}

		return new Response(new Uint8Array(processed), {
			headers: {
				'Content-Type': 'image/webp',
				'Cache-Control': 'public, max-age=604800'
			}
		});
	} catch (e) {
		console.error('Sharp processing failed', e);
		// Retourne l'image brute en cas d'échec de Sharp
		return new Response(new Uint8Array(buffer), { headers: { 'Content-Type': 'image/jpeg' } });
	}
}
