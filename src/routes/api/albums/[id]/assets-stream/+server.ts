import { error } from '@sveltejs/kit';
import type { ImmichAsset } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { requireAlbumAccess } from '$lib/server/album-asset-access';
import { fetchAlbumAssets } from '$lib/immich/album-assets';
import { createLogger } from '$lib/server/logger';
import { assetsNdjsonResponse } from '$lib/server/asset-ndjson';

const log = createLogger('albums-id-assets-stream');
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

/**
 * GET /api/albums/[id]/assets-stream
 * The album's assets as NDJSON, one slim line per asset (see asset-ndjson.ts).
 */
export const GET: RequestHandler = async (event) => {
  try {
    const { id } = event.params;
    const { fetch, request } = event;

    if (!IMMICH_BASE_URL) {
      throw error(500, 'IMMICH_BASE_URL not configured');
    }

    await requireAlbumAccess(event, id);

    const assets = await fetchAlbumAssets(fetch, IMMICH_BASE_URL, IMMICH_API_KEY, id);

    return assetsNdjsonResponse(assets as ImmichAsset[], request);
  } catch (e: unknown) {
    const _err = ensureError(e);
    log.error(`Error in /api/albums/${event.params.id}/assets-stream GET:`, _err.message || _err);
    if (e && typeof e === 'object' && 'status' in e) {
      throw e;
    }
    throw error(500, _err.message);
  }
};
