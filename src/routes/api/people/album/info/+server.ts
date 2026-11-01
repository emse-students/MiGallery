import { json, error, isHttpError } from '@sveltejs/kit';
import { ensureError } from '#lib/ts-utils.ts';
import type { RequestHandler } from './$types';
import { getAlbumInfo } from '#lib/photos-cv/handlers.ts';
import { ImmichNotConfiguredError } from '#lib/immich/not-configured.ts';
import { requirePhotoCvManager } from '#lib/server/face-access.ts';

import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('people-album-info');
export const GET: RequestHandler = async (event) => {
  // Outside the try: its catch answers 500 for everything, and a 401/403 must stay one.
  await requirePhotoCvManager(event);
  try {
    return json(await getAlbumInfo(event.fetch));
  } catch (e: unknown) {
    if (e instanceof ImmichNotConfiguredError) {
      throw error(503, e.message);
    }
    // A typed failure (404, 502, 504) keeps its status: squashing it to 500 hides what it is.
    if (isHttpError(e)) {
      throw e;
    }
    const err = ensureError(e);
    log.error('Error in /api/people/album/info GET:', err);
    throw error(500, err.message);
  }
};
