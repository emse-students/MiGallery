import { error } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import { getPersonAssets } from '$lib/photos-cv/handlers';
import { assetsNdjsonResponse } from '$lib/server/asset-ndjson';

import { createLogger } from '$lib/server/logger';

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

  await requireScope(event, 'read');
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
