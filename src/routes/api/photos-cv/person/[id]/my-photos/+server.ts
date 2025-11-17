import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getPersonAssets } from '$lib/photos-cv/handlers';

export const GET: RequestHandler = async ({ params, fetch }) => {
  const personId = params.id;
  if (!personId) throw error(400, 'personId is required');
  try {
    const assets = await getPersonAssets(personId, false, fetch);
    return json({ assets });
  } catch (e) {
    console.error('GET /api/photos-cv/person/[id]/my-photos error', e);
    throw error(500, e instanceof Error ? e.message : 'Internal');
  }
};
