import { json, error } from '@sveltejs/kit';

import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { requireScope } from '$lib/server/permissions';
import { fetchAllPeople, ImmichPeopleError } from '$lib/immich/people';

import { createLogger } from '$lib/server/logger';

const log = createLogger('people-people');
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

/**
 * GET /api/people/people
 * Lists every person recognized by Immich, all pages, as `{ people, total }`.
 */
export const GET: RequestHandler = async (event) => {
  await requireScope(event, 'read');
  try {
    if (!IMMICH_BASE_URL) {
      throw error(500, 'IMMICH_BASE_URL not configured');
    }

    const people = await fetchAllPeople(event.fetch, IMMICH_BASE_URL, IMMICH_API_KEY);
    return json({ people, total: people.length });
  } catch (e: unknown) {
    const err = ensureError(e);
    log.error('Error in /api/people/people GET:', err);
    if (e instanceof ImmichPeopleError) {
      throw error(e.status, e.message);
    }
    if (e && typeof e === 'object' && 'status' in e) {
      throw e;
    }
    throw error(500, err.message);
  }
};
