import { error, isHttpError } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { restoreAssetsFromTrash } from '$lib/server/immich-trash';
import { createLogger } from '$lib/server/logger';
import { OUTBOUND_BUDGET_MS } from '$lib/server/outbound';

const log = createLogger('immich-album-assets');

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

/** Immich answers both mutations with one entry per id it was handed. */
export interface ImmichBulkIdResponse {
	id: string;
	success: boolean;
	error?: string;
}

/**
 * The single outbound call to `PUT|DELETE /api/albums/{id}/assets`.
 *
 * It also owns the LOGGING for both verbs: there is no `handleError` hook in
 * this app, so an exception that leaves a route unlogged is invisible in prod -
 * which is how the outbound timeouts on this path stayed silent apart from the
 * per-route catches this module replaced.
 *
 * The status contract is deliberately unchanged: a 4xx from Immich is the
 * caller's fault and travels as-is, EVERYTHING else answers 500 - a timeout
 * included, tempting as 504 is. The integration tests pin the accepted statuses
 * to [200, 400, 401, 404, 500].
 */
async function mutateAlbumAssets(
	fetchFn: typeof fetch,
	method: 'PUT' | 'DELETE',
	albumId: string,
	ids: string[]
): Promise<ImmichBulkIdResponse[]> {
	if (!IMMICH_BASE_URL) {
		throw error(500, 'IMMICH_BASE_URL not configured');
	}
	if (!Array.isArray(ids) || ids.length === 0) {
		throw error(400, 'ids required');
	}

	const verb = method === 'PUT' ? 'add' : 'remove';

	try {
		const res = await fetchFn(`${IMMICH_BASE_URL}/api/albums/${albumId}/assets`, {
			signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
			method,
			headers: { 'x-api-key': IMMICH_API_KEY, 'Content-Type': 'application/json' },
			body: JSON.stringify({ ids })
		});

		if (!res.ok) {
			const txt = await res.text().catch(() => res.statusText);
			log.error(`failed to ${verb} ${ids.length} asset(s) on album ${albumId}: ${res.status} ${txt}`);
			throw error(
				res.status >= 400 && res.status < 500 ? res.status : 500,
				`Failed to ${verb} assets: ${txt}`
			);
		}

		return (await res.json()) as ImmichBulkIdResponse[];
	} catch (e: unknown) {
		if (isHttpError(e)) {
			throw e;
		}
		log.error(`failed to ${verb} ${ids.length} asset(s) on album ${albumId}:`, e);
		throw error(500, e instanceof Error ? e.message : `Failed to ${verb} assets`);
	}
}

/**
 * THE ONLY WAY TO ATTACH ASSETS TO AN IMMICH ALBUM.
 *
 * The trash restore lives INSIDE this function on purpose, not in the callers.
 * A re-uploaded file Immich recognises is answered with `{ status: 'duplicate',
 * id }` and stays in the trash if that is where it was, and a trashed asset
 * added to an album is invisible everywhere in the gallery - so the add looked
 * like it had silently done nothing. That bug existed because four of the five
 * add paths had to remember to restore first and did not. Now none of them can
 * forget: there is nowhere else to add an asset from.
 */
export async function addAlbumAssets(
	fetchFn: typeof fetch,
	albumId: string,
	ids: string[]
): Promise<ImmichBulkIdResponse[]> {
	await restoreAssetsFromTrash(fetchFn, ids);
	return mutateAlbumAssets(fetchFn, 'PUT', albumId, ids);
}

export async function removeAlbumAssets(
	fetchFn: typeof fetch,
	albumId: string,
	ids: string[]
): Promise<ImmichBulkIdResponse[]> {
	return mutateAlbumAssets(fetchFn, 'DELETE', albumId, ids);
}
