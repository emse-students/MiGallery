import { json, error } from '@sveltejs/kit';

import { ensureError } from '#lib/ts-utils.ts';
import type { RequestHandler } from './$types';
import { env } from '#lib/server/env.ts';
import { requireFaceAdmin } from '#lib/server/face-access.ts';
import { fetchAllPeople, ImmichPeopleError } from '#lib/immich/people.ts';
import { ImmichNotConfiguredError, requireImmichBaseUrl } from '#lib/immich/not-configured.ts';

import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('people-people');
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

/**
 * GET /api/people/people
 * Lists every person recognized by Immich, all pages, as `{ people, total }`. Admin session or
 * API key only: it names every person Immich clustered, members or not (see face-access.ts).
 */
export const GET: RequestHandler = async (event) => {
  await requireFaceAdmin(event);
  try {
    const people = await fetchAllPeople(event.fetch, requireImmichBaseUrl(), IMMICH_API_KEY);
    return json({ people, total: people.length });
  } catch (e: unknown) {
    if (e instanceof ImmichNotConfiguredError) {
      throw error(503, e.message);
    }
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
