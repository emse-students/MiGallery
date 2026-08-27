import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { fetchAlbumAssets } from '$lib/immich/album-assets';
import { requireScope } from '$lib/server/permissions';
import { addAlbumAssets, removeAlbumAssets } from '$lib/server/immich-album-assets';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;

function requireAlbumId(albumId: string | undefined): string {
  if (!albumId) {
    throw error(400, 'albumId required');
  }
  return albumId;
}

/** External callers send either `assetIds` or `ids`; both have always worked. */
async function readAssetIds(request: Request): Promise<string[]> {
  const body = (await request.json()) as Record<string, unknown>;
  const assetIds = typeof body.assetIds !== 'undefined' ? body.assetIds : body.ids;
  if (!Array.isArray(assetIds) || assetIds.length === 0) {
    throw error(400, 'assetIds required');
  }
  return assetIds as string[];
}

export const GET: RequestHandler = async (event) => {
  const albumId = requireAlbumId(event.params.albumId);
  await requireScope(event, 'read');

  // fetchAlbumAssets fetches the album itself and throws when it is missing, so
  // the album GET this handler used to run first - and throw the answer away -
  // was a second identical round trip against the same 4s outbound budget.
  const assets = await fetchAlbumAssets(event.fetch, IMMICH_BASE_URL, IMMICH_API_KEY, albumId);
  return json({ assets });
};

export const PUT: RequestHandler = async (event) => {
  const albumId = requireAlbumId(event.params.albumId);
  await requireScope(event, 'write');

  const added = await addAlbumAssets(event.fetch, albumId, await readAssetIds(event.request));
  return json({ success: true, added });
};

export const DELETE: RequestHandler = async (event) => {
  const albumId = requireAlbumId(event.params.albumId);
  await requireScope(event, 'write');

  const removed = await removeAlbumAssets(event.fetch, albumId, await readAssetIds(event.request));
  return json({ success: true, removed });
};
