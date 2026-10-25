import { error } from '@sveltejs/kit';
import { ensureError } from '#lib/ts-utils.ts';
import type { RequestHandler } from './$types';
import { requirePersonAccess } from '#lib/server/face-access.ts';
import { getPersonAssets } from '#lib/photos-cv/handlers.ts';
import { assetsNdjsonResponse } from '#lib/server/asset-ndjson.ts';

import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('people-people-personId-photos-stream');
/**
 * GET /api/people/people/[personId]/photos-stream
 * A person's photos as NDJSON, one slim line per asset (see asset-ndjson.ts).
 */
export const GET: RequestHandler = async (event) => {
  const personId = event.params.personId;
  if (!personId) {
    throw error(400, 'personId required');
  }
  const inAlbum = event.url.searchParams.get('in_album') === 'true';

  await requirePersonAccess(event, personId);
  try {
    // Combined personIds+albumIds search (or person-minus-album) is done in
    // the shared handler.
    const assets = await getPersonAssets(personId, inAlbum, event.fetch);
    return assetsNdjsonResponse(assets, event.request);
  } catch (e: unknown) {
    const err = ensureError(e);
    log.error('Error in /api/people/people/[personId]/photos-stream GET:', err);
    throw error(500, err.message);
  }
};
