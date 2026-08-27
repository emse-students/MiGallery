import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import type { ImmichAsset, ImmichAlbum } from '$lib/types/api';
import { getOrCreateSystemAlbum } from '$lib/immich/system-albums';
import { fetchAlbumAssets } from '$lib/immich/album-assets';
import { addAlbumAssets, removeAlbumAssets } from '$lib/server/immich-album-assets';
import { searchAllAssets } from '$lib/server/immich-search';
import { OUTBOUND_BUDGET_MS } from '$lib/server/outbound';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

/**
 * Trombinoscope searches only ever want photos, and smaller pages (500) keep the
 * native memory peak per response low. The page cap is generous so heavily
 * photographed people are never truncated.
 */
const CV_SEARCH = { size: 500, maxPages: 20 } as const;
const PHOTOS_ONLY = { type: 'IMAGE' } as const;

/**
 * A person's photos, partitioned by PhotoCV-album membership.
 *
 * Immich AND-combines its filter fields, so passing both personIds and albumIds
 * returns exactly the intersection server-side (verified on prod:
 * personIds+albumIds == person-assets INTERSECT album-assets).
 *
 * - inAlbum=true: a single combined personIds+albumIds search - no full-album
 *   fetch, no in-memory filtering.
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
    return searchAllAssets(
      fetchFn,
      { ...PHOTOS_ONLY, personIds: [personId], albumIds: [photoCVId] },
      CV_SEARCH
    );
  }

  const [allAssets, inAlbumAssets] = await Promise.all([
    searchAllAssets(fetchFn, { ...PHOTOS_ONLY, personIds: [personId] }, CV_SEARCH),
    searchAllAssets(
      fetchFn,
      { ...PHOTOS_ONLY, personIds: [personId], albumIds: [photoCVId] },
      CV_SEARCH
    ),
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
    signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
    headers: { 'x-api-key': IMMICH_API_KEY, Accept: 'application/json' },
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
    assetCount: albumData.assetCount || 0,
  };
}

export async function addAssetsToAlbum(assetIds: string[], fetchFn: typeof fetch) {
  const albumId = await getOrCreateSystemAlbum(fetchFn, 'PhotoCV');
  return addAlbumAssets(fetchFn, albumId, assetIds);
}

export async function removeAssetsFromAlbum(assetIds: string[], fetchFn: typeof fetch) {
  const albumId = await getOrCreateSystemAlbum(fetchFn, 'PhotoCV');
  return removeAlbumAssets(fetchFn, albumId, assetIds);
}
