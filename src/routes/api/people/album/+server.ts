import { json, error } from '@sveltejs/kit';
import type { ImmichAlbum } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { requireScope } from '$lib/server/permissions';
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';
import { getOrCreateSystemAlbum } from '$lib/immich/system-albums';

export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'read');
	try {
		const { fetch, url } = event;
		const page = parseInt(url.searchParams.get('page') ?? '1', 10);
		const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);

		if (page < 1) {
			throw error(400, 'page must be >= 1');
		}
		if (limit < 1 || limit > 500) {
			throw error(400, 'limit must be between 1 and 500');
		}

		const { fetch: _fetch } = event;
		const albumId = await getOrCreateSystemAlbum(_fetch, 'PhotoCV');
		const albumRes = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}`, {
			headers: { 'x-api-key': IMMICH_API_KEY, Accept: 'application/json' }
		});
		if (!albumRes.ok) {
			throw error(500, `Failed to fetch album: ${albumRes.statusText}`);
		}
		const albumData = (await albumRes.json()) as ImmichAlbum;
		const allAssets = albumData.assets || [];
		const totalCount = allAssets.length;

		// Pagination
		const startIndex = (page - 1) * limit;
		const endIndex = startIndex + limit;
		const assets = allAssets.slice(startIndex, endIndex);
		const hasMore = endIndex < totalCount;

		return json({ assets, totalCount, currentPage: page, hasMore });
	} catch (e: unknown) {
		const err = ensureError(e);
		console.error('Error in /api/people/album GET:', err);
		throw error(500, err.message);
	}
};
