import { env } from '#lib/server/env.ts';
import { error } from '@sveltejs/kit';
import type { ImmichAsset, ImmichAlbum } from '#lib/types/api.ts';
import { withSystemAlbum } from '#lib/immich/system-albums.ts';
import { fetchAlbumAssets } from '#lib/immich/album-assets.ts';
import { addAlbumAssets, removeAlbumAssets } from '#lib/server/immich-album-assets.ts';
import { OUTBOUND_BUDGET_MS } from '#lib/server/outbound.ts';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

/** Every asset of the PhotoCV system album (its members, read through the album). */
export async function getAlbumAssets(fetchFn: typeof fetch): Promise<ImmichAsset[]> {
  // The name is checked against the album under the stored id: a renamed or replaced one is forgotten.
  return withSystemAlbum(
    fetchFn,
    'PhotoCV',
    async (albumId) =>
      (await fetchAlbumAssets(
        fetchFn,
        IMMICH_BASE_URL,
        IMMICH_API_KEY,
        albumId,
        'PhotoCV'
      )) as ImmichAsset[]
  );
}

export async function getAlbumInfo(fetchFn: typeof fetch): Promise<{
  id: string;
  name: string;
  assetCount: number;
}> {
  return withSystemAlbum(fetchFn, 'PhotoCV', async (albumId) => {
    const albumRes = await fetchFn(`${IMMICH_BASE_URL}/api/albums/${albumId}`, {
      signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
      headers: { 'x-api-key': IMMICH_API_KEY, Accept: 'application/json' },
    });
    if (albumRes.status === 404) {
      throw error(404, 'Album not found');
    }
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
  });
}

export async function addAssetsToAlbum(assetIds: string[], fetchFn: typeof fetch) {
  return withSystemAlbum(fetchFn, 'PhotoCV', (albumId) =>
    addAlbumAssets(fetchFn, albumId, assetIds)
  );
}

export async function removeAssetsFromAlbum(assetIds: string[], fetchFn: typeof fetch) {
  return withSystemAlbum(fetchFn, 'PhotoCV', (albumId) =>
    removeAlbumAssets(fetchFn, albumId, assetIds)
  );
}
