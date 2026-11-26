import { json } from '@sveltejs/kit';

import type { RequestEvent } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logEvent } from '#lib/server/logs.ts';
import { requireStaff } from '#lib/server/permissions.ts';
import {
  addAlbumAssets,
  removeAlbumAssets,
  type ImmichBulkIdResponse,
} from '#lib/server/immich-album-assets.ts';

/** Both callers in the app send `{ ids }`; anything else is an empty add. */
async function readIds(request: Request): Promise<string[]> {
  const body = (await request.json()) as { ids?: unknown } | null;
  const ids = body?.ids;
  return Array.isArray(ids) ? (ids as string[]) : [];
}

/**
 * Record the assets Immich actually added or removed - its per-id answer, not the ids asked for,
 * so an already-present asset is not counted. This is what ties an upload to its album in the
 * admin activity feed: the upload row itself does not know the album.
 */
function logAlbumAssets(
  event: RequestEvent,
  action: 'add_assets' | 'remove_assets',
  results: ImmichBulkIdResponse[]
): void {
  const assetIds = results.filter((r) => r.success).map((r) => r.id);
  if (assetIds.length > 0) {
    logEvent(event, 'update', 'album', event.params.id ?? null, {
      action,
      count: assetIds.length,
      assetIds,
    });
  }
}

/**
 * PUT /api/albums/[id]/assets
 * Adds assets to an album.
 *
 * Body: { ids: string[] }
 */
export const PUT: RequestHandler = async (event) => {
  await requireStaff(event);
  const ids = await readIds(event.request);
  const results = await addAlbumAssets(event.fetch, event.params.id, ids);
  logAlbumAssets(event, 'add_assets', results);
  return json(results);
};

/**
 * DELETE /api/albums/[id]/assets
 * Removes assets from an album.
 *
 * Body: { ids: string[] }
 */
export const DELETE: RequestHandler = async (event) => {
  await requireStaff(event);
  const ids = await readIds(event.request);
  const results = await removeAlbumAssets(event.fetch, event.params.id, ids);
  logAlbumAssets(event, 'remove_assets', results);
  return json(results);
};
