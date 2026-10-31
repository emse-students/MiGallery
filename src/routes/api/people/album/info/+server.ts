import { json, error } from '@sveltejs/kit';
import type { ImmichAlbum } from '#lib/types/api.ts';
import { ensureError } from '#lib/ts-utils.ts';
import type { RequestHandler } from './$types';
import { getOrCreateSystemAlbum } from '#lib/immich/system-albums.ts';
import { requirePhotoCvManager } from '#lib/server/face-access.ts';

import { createLogger } from '#lib/server/logger.ts';
import { OUTBOUND_BUDGET_MS } from '#lib/server/outbound.ts';

const log = createLogger('people-album-info');
export const GET: RequestHandler = async (event) => {
  // Outside the try: its catch answers 500 for everything, and a 401/403 must stay one.
  await requirePhotoCvManager(event);
  try {
    const { fetch } = event;
    const albumId = await getOrCreateSystemAlbum(fetch, 'PhotoCV');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (process.env.IMMICH_API_KEY) {
      headers['x-api-key'] = process.env.IMMICH_API_KEY;
    }
    const albumRes = await fetch(`${process.env.IMMICH_BASE_URL}/api/albums/${albumId}`, {
      headers,
      signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
    });
    if (!albumRes.ok) {
      throw error(500, `Failed to fetch album: ${albumRes.statusText}`);
    }
    const albumData = (await albumRes.json()) as ImmichAlbum;
    return json({
      id: albumData.id,
      name: albumData.albumName,
      assetCount: albumData.assetCount || 0,
    });
  } catch (e: unknown) {
    const err = ensureError(e);
    log.error('Error in /api/people/album/info GET:', err);
    throw error(500, err.message);
  }
};
