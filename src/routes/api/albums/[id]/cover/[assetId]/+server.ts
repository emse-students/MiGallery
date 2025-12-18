import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { requireScope } from '$lib/server/permissions';
import { getDatabase } from '$lib/db/database';

const CACHE_DIR = path.resolve('data/cache/covers');

try {
	if (!fs.existsSync(CACHE_DIR)) {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
	}
} catch (e) {
	console.error('Failed to create cache directory', e);
}

export const GET: RequestHandler = async (event) => {
	const { params, fetch } = event;
	const albumId = params.id;
	const assetId = params.assetId;

	if (!albumId || !assetId) {
		throw error(400, 'Missing albumId or assetId');
	}

	let localVisibility: string | undefined = undefined;
	try {
		const db = getDatabase();
		const row = db.prepare('SELECT visibility FROM albums WHERE id = ?').get(albumId) as
			| { visibility?: string }
			| undefined;
		localVisibility = row?.visibility;
	} catch (e) {
		console.warn('Failed to check album visibility', e);
	}

	const isUnlisted = localVisibility === 'unlisted';
	if (!isUnlisted) {
		await requireScope(event, 'read');
	}

	const cacheFile = path.join(CACHE_DIR, `${assetId}.webp`);
	if (fs.existsSync(cacheFile)) {
		try {
			const buffer = fs.readFileSync(cacheFile);
			return new Response(buffer, {
				headers: {
					'Content-Type': 'image/webp',
					'Cache-Control': 'public, max-age=604800'
				}
			});
		} catch (e) {
			console.warn('Failed to read cache file, regenerating...', e);
		}
	}

	const apiKey = env.IMMICH_API_KEY;
	const baseUrl = env.IMMICH_BASE_URL;
	if (!apiKey || !baseUrl) {
		throw error(500, 'Immich config missing');
	}

	const immichUrl = `${baseUrl}/api/assets/${assetId}/original?isWebp=true`;

	try {
		const res = await fetch(immichUrl, {
			headers: { 'x-api-key': apiKey, Accept: 'image/webp,image/*' }
		});

		if (!res.ok) {
			const thumbUrl = `${baseUrl}/api/assets/${assetId}/thumbnail?size=preview`;
			const res2 = await fetch(thumbUrl, {
				headers: { 'x-api-key': apiKey, Accept: 'image/webp,image/*' }
			});
			if (!res2.ok) {
				throw error(res.status, 'Failed to fetch image from Immich');
			}
			return processImage(await res2.arrayBuffer(), cacheFile);
		}

		return await processImage(await res.arrayBuffer(), cacheFile);
	} catch (e) {
		console.error('Error processing cover:', e);
		throw error(500, 'Internal Server Error processing cover');
	}
};

async function processImage(buffer: ArrayBuffer, cacheFile: string): Promise<Response> {
	try {
		const resizedBuffer = await sharp(buffer)
			.resize(600, 600, {
				fit: 'cover',
				position: 'center'
			})
			.webp({ quality: 80 })
			.toBuffer();

		try {
			fs.writeFileSync(cacheFile, resizedBuffer);
		} catch (writeErr) {
			console.error('Failed to write to cache', writeErr);
		}

		return new Response(Buffer.from(resizedBuffer), {
			headers: {
				'Content-Type': 'image/webp',
				'Cache-Control': 'public, max-age=604800'
			}
		});
	} catch (e) {
		console.error('Sharp error:', e);
		return new Response(Buffer.from(buffer), {
			headers: { 'Content-Type': 'image/jpeg' }
		});
	}
}
