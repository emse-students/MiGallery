import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import type { ImmichAsset, ImmichAlbum } from '$lib/types/api';
import { getOrCreateSystemAlbum } from '$lib/immich/system-albums';
import { fetchAlbumAssets } from '$lib/immich/album-assets';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

/**
 * Paginate POST /api/search/metadata for an arbitrary filter body and collect
 * every asset. Immich AND-combines its filter fields, so passing both personIds
 * and albumIds returns exactly the intersection server-side (verified on prod:
 * personIds+albumIds == person-assets INTERSECT album-assets). Smaller pages
 * (500) keep the native memory peak per response low; the page cap is generous
 * so heavily-photographed people are never truncated.
 */
async function searchAllAssets(
	fetchFn: typeof fetch,
	filter: Record<string, unknown>
): Promise<ImmichAsset[]> {
	const allAssets: ImmichAsset[] = [];
	let page = 1;
	let hasNext = true;

	while (hasNext) {
		const res = await fetchFn(`${IMMICH_BASE_URL}/api/search/metadata`, {
			method: 'POST',
			headers: {
				'x-api-key': IMMICH_API_KEY,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ ...filter, type: 'IMAGE', page, size: 500 })
		});

		if (!res.ok) {
			const txt = await res.text();
			throw error(res.status, `Search failed: ${txt}`);
		}

		const data = (await res.json()) as {
			assets?: {
				items?: ImmichAsset[];
				nextPage?: number | null;
			};
		};
		const items = data.assets?.items || [];
		if (items.length === 0) {
			break;
		}
		allAssets.push(...items);
		hasNext = data.assets?.nextPage !== null && data.assets?.nextPage !== undefined;
		page++;
		if (page > 20) {
			break;
		}
	}
	return allAssets;
}

/**
 * A person's photos, partitioned by PhotoCV-album membership.
 *
 * - inAlbum=true: a single combined personIds+albumIds search (Immich filters
 *   the intersection server-side) - no full-album fetch, no in-memory filtering.
 * - inAlbum=false: all of the person's photos MINUS the (small) in-album subset.
 *   We still need every person asset to know what is NOT in the album, but we
 *   subtract the combined-query result instead of fetching the entire PhotoCV
 *   album (thousands of assets) just to filter it out.
 */
export async function getPersonAssets(
	personId: string,
	inAlbum: boolean,
	fetchFn: typeof fetch
): Promise<ImmichAsset[]> {
	const photoCVId = await getOrCreateSystemAlbum(fetchFn, 'PhotoCV');

	if (inAlbum) {
		return searchAllAssets(fetchFn, { personIds: [personId], albumIds: [photoCVId] });
	}

	const [allAssets, inAlbumAssets] = await Promise.all([
		searchAllAssets(fetchFn, { personIds: [personId] }),
		searchAllAssets(fetchFn, { personIds: [personId], albumIds: [photoCVId] })
	]);
	const inAlbumIds = new Set(inAlbumAssets.map((a) => a.id));
	return allAssets.filter((asset) => !inAlbumIds.has(asset.id));
}

export async function getAlbumAssets(fetchFn: typeof fetch): Promise<ImmichAsset[]> {
	const albumId = await getOrCreateSystemAlbum(fetchFn, 'PhotoCV');
	return (await fetchAlbumAssets(
		fetchFn,
		IMMICH_BASE_URL,
		IMMICH_API_KEY,
		albumId
	)) as ImmichAsset[];
}

export async function getAlbumInfo(fetchFn: typeof fetch): Promise<{
	id: string;
	name: string;
	assetCount: number;
}> {
	const albumId = await getOrCreateSystemAlbum(fetchFn, 'PhotoCV');
	const albumRes = await fetchFn(`${IMMICH_BASE_URL}/api/albums/${albumId}`, {
		headers: { 'x-api-key': IMMICH_API_KEY, Accept: 'application/json' }
	});
	if (!albumRes.ok) {
		throw error(500, `Failed to fetch album: ${albumRes.statusText}`);
	}
	const albumData = (await albumRes.json()) as ImmichAlbum;
	if (!albumData.id) {
		throw error(500, 'Album ID is missing');
	}
	return {
		id: albumData.id,
		name: albumData.albumName || 'Photos CV',
		assetCount: albumData.assetCount || 0
	};
}

export async function addAssetsToAlbum(
	assetIds: string[],
	fetchFn: typeof fetch
): Promise<{ success: boolean }> {
	const albumId = await getOrCreateSystemAlbum(fetchFn, 'PhotoCV');
	const res = await fetchFn(`${IMMICH_BASE_URL}/api/albums/${albumId}/assets`, {
		method: 'PUT',
		headers: { 'x-api-key': IMMICH_API_KEY, 'Content-Type': 'application/json' },
		body: JSON.stringify({ ids: assetIds })
	});
	if (!res.ok) {
		const errorText = await res.text();
		throw error(500, `Failed to add assets to album: ${errorText}`);
	}

	return res.json() as Promise<{ success: boolean }>;
}

export async function removeAssetsFromAlbum(
	assetIds: string[],
	fetchFn: typeof fetch
): Promise<{ success: boolean }> {
	const albumId = await getOrCreateSystemAlbum(fetchFn, 'PhotoCV');
	const res = await fetchFn(`${IMMICH_BASE_URL}/api/albums/${albumId}/assets`, {
		method: 'DELETE',
		headers: { 'x-api-key': IMMICH_API_KEY, 'Content-Type': 'application/json' },
		body: JSON.stringify({ ids: assetIds })
	});
	if (!res.ok) {
		const errorText = await res.text();
		throw error(500, `Failed to remove assets from album: ${errorText}`);
	}

	return res.json() as Promise<{ success: boolean }>;
}
