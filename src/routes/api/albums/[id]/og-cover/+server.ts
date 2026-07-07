import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import fs from 'node:fs';
import path from 'node:path';
import sharp from '$lib/server/sharp-config';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';
import type { ImmichAlbum } from '$lib/types/api';

const CACHE_DIR = path.resolve('data/cache/og-covers');

try {
	if (!fs.existsSync(CACHE_DIR)) {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
	}
} catch (e) {
	console.error('[og-cover] Failed to create cache dir', e);
}

/**
 * GET /api/albums/[id]/og-cover
 *
 * Sert la couverture d'un album redimensionnée au format Open Graph (1200×630 WebP).
 * Utilisé pour les previews de liens dans Canari.
 *
 * - Albums unlisted / authenticated : accès libre (pas d'auth requise).
 * - Albums privés : requiert une clé API avec scope 'read' (ex. Canari via x-api-key).
 *
 * L'image est mise en cache sur disque pour les requêtes suivantes.
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

	// Les albums privés nécessitent une clé API ; les autres sont publics.
	if (row.visibility === 'private') {
		await requireScope(event, 'read');
	}

	const cacheFile = path.join(CACHE_DIR, `${id}.webp`);
	if (fs.existsSync(cacheFile)) {
		const buffer = fs.readFileSync(cacheFile);
		return new Response(new Uint8Array(buffer), {
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

	// Récupère le thumbnail asset ID depuis Immich
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
			fs.writeFileSync(cacheFile, processed);
		} catch (e) {
			console.error('[og-cover] Cache write failed', e);
		}

		return new Response(new Uint8Array(processed), {
			headers: {
				'Content-Type': 'image/webp',
				'Cache-Control': 'public, max-age=86400'
			}
		});
	} catch (e) {
		console.error('[og-cover] Sharp processing failed, returning raw', e);
		return new Response(new Uint8Array(buf), {
			headers: { 'Content-Type': 'image/jpeg' }
		});
	}
};
