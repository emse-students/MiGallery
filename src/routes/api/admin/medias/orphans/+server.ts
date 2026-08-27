import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import { getOrphanPage } from '$lib/server/media-anomalies';

/**
 * GET /api/admin/medias/orphans?page=N
 *
 * One page of assets that belong to no album, straight from upstream - no
 * cache, because an orphan stops being one the moment someone files it.
 *
 * One page per request, not the whole list: prod has 4 533 orphans over 5 pages,
 * and doing all five inside a single handler would spend five sequential
 * outbound budgets on one HTTP request. The client loops on `nextPage`, which
 * also lets it show progress.
 */
export const GET: RequestHandler = async (event) => {
  await requireScope(event, 'admin');

  const raw = event.url.searchParams.get('page') ?? '1';
  const page = Number.parseInt(raw, 10);
  if (!Number.isInteger(page) || page < 1) {
    throw error(400, 'page must be a positive integer');
  }

  return json(await getOrphanPage(event.fetch, page));
};
