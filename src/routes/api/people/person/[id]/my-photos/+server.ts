import type { RequestHandler } from './$types';

import { json, error } from '@sveltejs/kit';
import { getPersonAssets } from '$lib/photos-cv/handlers';
import { requirePersonAccess } from '$lib/server/face-access';

import { createLogger } from '$lib/server/logger';

const log = createLogger('people-person-id-my-photos');
export const GET: RequestHandler = async (event) => {
  const personId = event.params.id;
  if (!personId) {
    throw error(400, 'personId is required');
  }

  await requirePersonAccess(event, personId);

  try {
    const assets = await getPersonAssets(personId, false, event.fetch);
    return json({ assets });
  } catch (e: unknown) {
    log.error('GET /api/people/person/[id]/my-photos error', e);
    throw error(500, e instanceof Error ? e.message : 'Internal');
  }
};
