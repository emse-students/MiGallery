import { error, isHttpError } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createLogger } from '$lib/server/logger';
import { OUTBOUND_BUDGET_MS } from '$lib/server/outbound';
import type { ImmichAsset } from '$lib/types/api';

const log = createLogger('immich-search');
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
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
 */
export interface AssetSearchPage {
	items: ImmichAsset[];
	/** The next page to ask for, or null when this was the last one. */
	nextPage: number | null;
}

interface SearchMetadataResponse {
	assets?: {
		items?: ImmichAsset[];
		nextPage?: string | number | null;
	};
}

/** Fetch exactly one page of results. */
export async function searchAssetPage(
	fetchFn: typeof fetch,
	filter: Record<string, unknown>,
	page: number,
	size: number
): Promise<AssetSearchPage> {
	if (!IMMICH_BASE_URL) {
		throw error(500, 'IMMICH_BASE_URL not configured');
	}

	try {
		const res = await fetchFn(`${IMMICH_BASE_URL}/api/search/metadata`, {
			signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
			method: 'POST',
			headers: { 'x-api-key': IMMICH_API_KEY, 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...filter, page, size })
		});

		if (!res.ok) {
			const txt = await res.text().catch(() => res.statusText);
			log.error(`search failed (page ${page}, size ${size}): ${res.status} ${txt}`);
			// Same status contract as the album mutations: a 4xx is the caller's
			// problem and travels as-is, anything else is ours and answers 500.
			throw error(res.status >= 400 && res.status < 500 ? res.status : 500, `Search failed: ${txt}`);
		}

		const data = (await res.json()) as SearchMetadataResponse;
		const items = data.assets?.items ?? [];
		const raw = data.assets?.nextPage;
		const next = raw === null || raw === undefined ? null : Number(raw);

		return { items, nextPage: Number.isFinite(next) && next !== null ? next : null };
	} catch (e: unknown) {
		if (isHttpError(e)) {
			throw e;
		}
		log.error(`search failed (page ${page}, size ${size}):`, e);
		throw error(500, e instanceof Error ? e.message : 'Search failed');
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
