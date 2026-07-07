import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import fs from 'node:fs';
import path from 'node:path';
import sharp from '$lib/server/sharp-config';
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

// Sémaphore pour limiter les traitements Sharp simultanés et éviter les crashs mémoire
// quand de nombreux albums sont chargés en même temps.
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
		// Cache-Control: 180 jours ~ 6 mois
		return new Response(new Uint8Array(buffer), {
			headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=15552000' }
		});
	}

	const apiKey = env.IMMICH_API_KEY;
	const baseUrl = env.IMMICH_BASE_URL;
	if (!apiKey || !baseUrl) {
		throw error(500, 'Immich config missing');
	}

	// On acquiert le verrou AVANT tout téléchargement : sinon N requêtes
	// simultanées matérialisent N buffers en RAM native, hors de tout contrôle
	// (le sémaphore ne bornerait que le traitement Sharp). En bornant aussi le
	// fetch, au plus MAX_CONCURRENT_SHARP images sont résidentes à la fois.
	const release = await acquireSharp();
	if (!release) {
		// File d'attente pleine : on redirige vers la miniature Immich proxifiée
		// plutôt que de charger une image en RAM et risquer un OOM sous rafale.
		console.warn('[Cover] Sharp queue full, redirecting to proxied thumbnail');
		return new Response(null, {
			status: 307,
			headers: {
				Location: `/api/immich/assets/${assetId}/thumbnail?size=preview`,
				'Cache-Control': 'no-store'
			}
		});
	}

	try {
		// Source = miniature "preview" (≈ quelques centaines de Ko) et non
		// l'original pleine résolution (JPEG 5-30 Mo, RAW 50 Mo+) : on ne
		// matérialise jamais un gros buffer natif pour produire une vignette 400×400.
		const thumbUrl = `${baseUrl}/api/assets/${assetId}/thumbnail?size=preview`;
		const thumbRes = await fetch(thumbUrl, { headers: { 'x-api-key': apiKey } });
		if (!thumbRes.ok) {
			throw error(thumbRes.status, 'Image source not found');
		}

		const buf = Buffer.from(await thumbRes.arrayBuffer());
		return await processAndCacheImage(buf, cacheFile);
	} catch (e) {
		// Préserve les erreurs HTTP typées (404, etc.) au lieu de les masquer en 500.
		if (e && typeof e === 'object' && 'status' in e) {
			throw e;
		}
		console.error('Error processing cover:', e);
		throw error(500, 'Internal Server Error');
	} finally {
		release();
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
 * Utilitaire de traitement d'image avec Sharp.
 * Le sémaphore Sharp est acquis/relâché par l'appelant (voir GET), qui l'obtient
 * AVANT le téléchargement afin de borner aussi la mémoire des fetch en cours.
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
			console.error('Cache write failed', e);
		}

		return new Response(new Uint8Array(processed), {
			headers: {
				'Content-Type': 'image/webp',
				// Cache-Control: 180 jours ~ 6 mois
				'Cache-Control': 'public, max-age=15552000'
			}
		});
	} catch (e) {
		console.error('Sharp processing failed', e);
		// Retourne l'image brute en cas d'échec de Sharp
		return new Response(new Uint8Array(buffer), { headers: { 'Content-Type': 'image/jpeg' } });
	}
}
