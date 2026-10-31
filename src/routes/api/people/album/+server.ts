import { json, error } from '@sveltejs/kit';
import { ensureError } from '#lib/ts-utils.ts';
import type { RequestHandler } from './$types';
import { env } from '#lib/server/env.ts';
import { requirePhotoCvManager } from '#lib/server/face-access.ts';
import { fetchAlbumAssets } from '#lib/immich/album-assets.ts';
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';
import { getOrCreateSystemAlbum } from '#lib/immich/system-albums.ts';
import { ImmichNotConfiguredError } from '#lib/immich/not-configured.ts';

import { createLogger } from '#lib/server/logger.ts';
import { OUTBOUND_BUDGET_MS } from '#lib/server/outbound.ts';

const log = createLogger('people-album');
export const GET: RequestHandler = async (event) => {
  await requirePhotoCvManager(event);
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
      signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
      headers: { 'x-api-key': IMMICH_API_KEY, Accept: 'application/json' },
    });
    if (!albumRes.ok) {
      throw error(500, `Failed to fetch album: ${albumRes.statusText}`);
    }
    const allAssets = await fetchAlbumAssets(fetch, IMMICH_BASE_URL, IMMICH_API_KEY, albumId);
    const totalCount = allAssets.length;

    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const assets = allAssets.slice(startIndex, endIndex);
    const hasMore = endIndex < totalCount;

    return json({ assets, totalCount, currentPage: page, hasMore });
  } catch (e: unknown) {
    if (e instanceof ImmichNotConfiguredError) {
      throw error(503, e.message);
    }
    const err = ensureError(e);
    log.error('Error in /api/people/album GET:', err);
    throw error(500, err.message);
  }
};
