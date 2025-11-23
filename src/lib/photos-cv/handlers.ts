import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import type { ImmichAsset, ImmichAlbum } from '$lib/types/api';
import {
	SYSTEM_ALBUMS as _SYSTEM_ALBUMS,
	getOrCreateSystemAlbum,
	getAllAssetIdsInSystemAlbums
} from '$lib/immich/system-albums';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

async function fetchAllPersonAssets(
	personId: string,
	fetchFn: typeof fetch
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
			body: JSON.stringify({ personIds: [personId], type: 'IMAGE', page, size: 1000 })
		});

		if (!res.ok) {
			throw new Error(`Search failed: ${res.statusText}`);
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
		if (page > 10) {
			break;
		}
	}
	return allAssets;
}

export async function getPersonAssets(
	personId: string,
	inAlbum: boolean,
	fetchFn: typeof fetch
): Promise<ImmichAsset[]> {
	const allAssets = await fetchAllPersonAssets(personId, fetchFn);
	const systemAssetIds = new Set(await getAllAssetIdsInSystemAlbums(fetchFn));
	const filtered = allAssets.filter((asset) => {
		const isInAnySystem = systemAssetIds.has(asset.id);
		return inAlbum ? isInAnySystem : !isInAnySystem;
	});
	return filtered;
}

export async function getAlbumAssets(fetchFn: typeof fetch): Promise<ImmichAsset[]> {
	const albumId = await getOrCreateSystemAlbum(fetchFn, 'PhotoCV');
	const albumRes = await fetchFn(`${IMMICH_BASE_URL}/api/albums/${albumId}`, {
		headers: { 'x-api-key': IMMICH_API_KEY, Accept: 'application/json' }
	});
	if (!albumRes.ok) {
		throw error(500, `Failed to fetch album: ${albumRes.statusText}`);
	}
	const albumData = (await albumRes.json()) as ImmichAlbum;
	return albumData.assets || [];
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
		assetCount: albumData.assetCount || albumData.assets?.length || 0
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
