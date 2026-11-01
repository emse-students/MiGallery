import { json, error, isHttpError } from '@sveltejs/kit';
import { ensureError } from '#lib/ts-utils.ts';
import type { RequestHandler } from './$types';
import { requirePhotoCvManager } from '#lib/server/face-access.ts';
import { getAlbumAssets } from '#lib/photos-cv/handlers.ts';
import { ImmichNotConfiguredError } from '#lib/immich/not-configured.ts';

import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('people-album');
export const GET: RequestHandler = async (event) => {
  await requirePhotoCvManager(event);
  try {
    const { url } = event;
    const page = parseInt(url.searchParams.get('page') ?? '1', 10);
    const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);

    if (page < 1) {
      throw error(400, 'page must be >= 1');
    }
    if (limit < 1 || limit > 500) {
      throw error(400, 'limit must be between 1 and 500');
    }

    const allAssets = await getAlbumAssets(event.fetch);
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
    // A typed failure (404, 502, 504) keeps its status: squashing it to 500 hides what it is.
    if (isHttpError(e)) {
      throw e;
    }
    const err = ensureError(e);
    log.error('Error in /api/people/album GET:', err);
    throw error(500, err.message);
  }
};
