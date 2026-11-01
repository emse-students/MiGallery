import { error, isHttpError } from '@sveltejs/kit';
import { env } from '#lib/server/env.ts';
import { createLogger } from '#lib/server/logger.ts';
import { OUTBOUND_BUDGET_MS } from '#lib/server/outbound.ts';
import { requireImmichBaseUrl } from '#lib/immich/not-configured.ts';
import type { ImmichAsset } from '#lib/types/api.ts';

const log = createLogger('immich-search');
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

/**
 * The one way this server asks Immich "which assets match?".
 *
 * `POST /api/search/metadata` is the only listing endpoint left since Immich v3
 * stopped inlining `assets` in album details, so three call sites had each grown
 * their own copy of the same paginated fetch loop. They agreed on nothing: page
 * size 500 vs 1 vs 1000, a page cap of 20 vs none, and one of them silently
 * pinned `type: 'IMAGE'`.
 *
 * BEWARE `total`: it reports the size of the PAGE, not the size of the result
 * set (verified on prod - `size:1` answers `total:1`, `size:1000` answers
 * `total:1000`). There is no cheap count. Anything that needs one has to
 * paginate to the end, which is why `searchAllAssets` exists at all.
 *
 * `nextPage` comes back as a STRING ("2"), so it is coerced, never compared to
 * a number.
 *
 * A search by `filter` (Immich v3) pages differently: Immich refuses it with a
 * `page` (400 "Deprecated field page cannot be combined with filter", read on
 * the live server 2026-11-01), answers `nextPage: null` always, and announces
 * more results with an opaque `nextCursor` instead.
 */
export interface AssetSearchPage {
  items: ImmichAsset[];
  /** The next page to ask for, or null when this was the last one. */
  nextPage: number | null;
  /** A filtered search's next-results cursor, or null when nothing more is announced. */
  nextCursor: string | null;
}

interface SearchMetadataResponse {
  assets?: {
    items?: ImmichAsset[];
    nextPage?: string | number | null;
    nextCursor?: string | null;
  };
}

/**
 * Fetch exactly one page of results. `page` is null for a search by `filter`, which Immich
 * refuses with one.
 *
 * Every failure is classified HERE, and none of them is the member's: the search is built by this
 * server. Immich not configured throws `ImmichNotConfiguredError` (the route answers 503). Immich
 * answering an error status - a 4xx included, since it refuses OUR request - or an answer that is
 * not JSON is a 502; Immich not answering in time a 504, and not reachable at all a 502. Immich's
 * own text is logged, never sent to the client.
 */
export async function searchAssetPage(
  fetchFn: typeof fetch,
  filter: Record<string, unknown>,
  page: number | null,
  size: number
): Promise<AssetSearchPage> {
  const base = requireImmichBaseUrl();

  try {
    const res = await fetchFn(`${base}/api/search/metadata`, {
      signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
      method: 'POST',
      headers: { 'x-api-key': IMMICH_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(page === null ? { ...filter, size } : { ...filter, page, size }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      log.error('Immich refused the search', {
        status: res.status,
        page,
        size,
        upstream: txt.slice(0, 300),
      });
      throw error(502, 'Immich refused the search');
    }

    let data: SearchMetadataResponse;
    try {
      data = (await res.json()) as SearchMetadataResponse;
    } catch (e) {
      log.error('Immich answered the search with something that is not JSON', {
        page,
        message: (e as Error).message,
      });
      throw error(502, 'Immich answered the search with something unreadable');
    }
    const items = data.assets?.items ?? [];
    const raw = data.assets?.nextPage;
    const next = raw === null || raw === undefined ? null : Number(raw);

    return {
      items,
      nextPage: Number.isFinite(next) && next !== null ? next : null,
      nextCursor: data.assets?.nextCursor ?? null,
    };
  } catch (e: unknown) {
    if (isHttpError(e)) {
      throw e;
    }
    // What is left is the transport: fetch rejected. The deadline is told apart by the error's
    // NAME, the type the abort signal throws, never by its message.
    const timedOut = e instanceof Error && e.name === 'TimeoutError';
    log.error(
      timedOut ? 'Immich did not answer the search in time' : 'Immich could not be reached',
      {
        page,
        size,
        name: e instanceof Error ? e.name : typeof e,
        message: e instanceof Error ? e.message : String(e),
      }
    );
    throw timedOut
      ? error(504, 'Immich did not answer in time')
      : error(502, 'Immich could not be reached');
  }
}

export interface SearchAllOptions {
  /** Results per request. */
  size?: number;
  /** Hard stop, so a pagination bug upstream cannot loop forever. */
  maxPages?: number;
}

/**
 * Walk every page of a search and collect the assets.
 *
 * The page cap is a backstop against an upstream that keeps handing back a
 * `nextPage`, not a business limit - pick it from what the caller can actually
 * hold in memory. A caller that only needs one page at a time (a long scan that
 * tallies as it goes) should loop on `searchAssetPage` instead of collecting a
 * result set it means to discard.
 */
export async function searchAllAssets(
  fetchFn: typeof fetch,
  filter: Record<string, unknown>,
  { size = 1000, maxPages = 100 }: SearchAllOptions = {}
): Promise<ImmichAsset[]> {
  const all: ImmichAsset[] = [];
  let page: number | null = 1;
  let fetched = 0;

  while (page !== null && fetched < maxPages) {
    const result: AssetSearchPage = await searchAssetPage(fetchFn, filter, page, size);
    fetched++;
    if (result.items.length === 0) {
      break;
    }
    all.push(...result.items);
    page = result.nextPage;
  }

  if (page !== null && fetched >= maxPages) {
    log.warn(`search hit the ${maxPages}-page cap with more results pending`, { filter });
  }

  return all;
}

/** Ids asked per request of {@link searchAssetsByIds}: one page each. */
export const ASSET_ID_BATCH = 250;

/**
 * The assets of the given ids, fetched BY ID in batches of {@link ASSET_ID_BATCH}: one
 * `POST /api/search/metadata` per batch with `filter: { or: [{ id: { eq } }, ...] }` (Immich v3).
 * Assets Immich no longer has (deleted, trashed) are simply absent from the answer.
 *
 * THE ANSWER IS CHECKED, NOT TRUSTED. An Immich that ignored the filter would answer an arbitrary
 * page of the library, and the caller would show a member photos that are not theirs. So every
 * asset returned must be one that was asked for; one that was not throws (502), classified here,
 * and nothing of that batch is used. A batch that announces more results (a `nextCursor`, or a
 * `nextPage`) throws for the same reason: the filter was not applied as written. No `page` is
 * sent: Immich refuses one alongside a `filter`.
 */
export async function searchAssetsByIds(
  fetchFn: typeof fetch,
  ids: readonly string[]
): Promise<ImmichAsset[]> {
  const out: ImmichAsset[] = [];
  for (let start = 0; start < ids.length; start += ASSET_ID_BATCH) {
    const batch = ids.slice(start, start + ASSET_ID_BATCH);
    const asked = new Set(batch);
    const page = await searchAssetPage(
      fetchFn,
      { filter: { or: batch.map((id) => ({ id: { eq: id } })) } },
      null,
      // One more than asked: an honoured answer can never fill the page, so a next page is
      // never legitimately announced.
      ASSET_ID_BATCH + 1
    );
    const stranger = page.items.find((asset) => !asked.has(asset.id));
    if (stranger || page.nextPage !== null || page.nextCursor !== null) {
      log.error('search by id answered assets that were not asked for: the filter was ignored', {
        asked: batch.length,
        answered: page.items.length,
        nextPage: page.nextPage,
        nextCursor: page.nextCursor !== null,
      });
      throw error(502, 'Search by id was not honoured');
    }
    out.push(...page.items);
  }
  log.debug('assets fetched by id', { asked: ids.length, found: out.length });
  return out;
}
