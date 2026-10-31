import { json, error } from '@sveltejs/kit';

import type { RequestHandler } from './$types';
import { addAssetsToAlbum, removeAssetsFromAlbum } from '#lib/photos-cv/handlers.ts';
import { requirePhotoCvManager } from '#lib/server/face-access.ts';
import { ImmichNotConfiguredError } from '#lib/immich/not-configured.ts';

/**
 * Bulk add/remove on the PhotoCV system album - the album id is resolved
 * server-side, callers only send ids. `POST /api/people` does the same thing
 * for the app itself; this route is what external API-key callers use, so it
 * still exists (it is hit on prod) and it goes through the same handlers.
 */
async function readAssetIds(request: Request): Promise<string[]> {
  const body = (await request.json()) as { assetIds?: string[]; ids?: string[] };
  const assetIds = body.assetIds || body.ids || [];
  if (!Array.isArray(assetIds) || assetIds.length === 0) {
    throw error(400, 'assetIds required');
  }
  return assetIds;
}

/** Immich not configured is a state, answered 503; anything else propagates as before. */
async function orUnavailable<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ImmichNotConfiguredError) {
      throw error(503, e.message);
    }
    throw e;
  }
}

export const PUT: RequestHandler = async (event) => {
  await requirePhotoCvManager(event, 'write');
  const ids = await readAssetIds(event.request);
  const added = await orUnavailable(() => addAssetsToAlbum(ids, event.fetch));
  return json({ success: true, added });
};

export const DELETE: RequestHandler = async (event) => {
  await requirePhotoCvManager(event, 'write');
  const ids = await readAssetIds(event.request);
  const removed = await orUnavailable(() => removeAssetsFromAlbum(ids, event.fetch));
  return json({ success: true, removed });
};
