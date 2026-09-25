import { error } from '@sveltejs/kit';
import type { ImmichAsset } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';
import { fetchAlbumAssets } from '$lib/immich/album-assets';
import { createLogger } from '$lib/server/logger';
import { OUTBOUND_BUDGET_MS } from '$lib/server/outbound';
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

    const albumHeaders: Record<string, string> = { Accept: 'application/json' };
    if (IMMICH_API_KEY) {
      albumHeaders['x-api-key'] = IMMICH_API_KEY;
    }

    let albumVisibility: string | undefined;
    try {
      const albumMetaRes = await fetch(`${IMMICH_BASE_URL}/api/albums/${id}`, {
        signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
        headers: albumHeaders,
      });
      if (albumMetaRes.ok) {
        const albumMeta = (await albumMetaRes.json()) as { visibility?: string };
        albumVisibility = albumMeta.visibility;
      }
    } catch (metaErr: unknown) {
      const _metaErr = ensureError(metaErr);
      log.warn(
        '[assets-stream] failed to read album visibility metadata',
        _metaErr.message || _metaErr
      );
    }

    let visibilityHint: string | null = null;
    try {
      const parsed = new URL(request.url);
      visibilityHint = parsed.searchParams.get('visibility');
    } catch {
      visibilityHint = null;
    }
    let localVisibility: string | undefined = undefined;
    try {
      const db = getDatabase();
      const row = db.prepare('SELECT visibility FROM albums WHERE id = ?').get(id) as
        | { visibility?: string }
        | undefined;
      localVisibility = row?.visibility;
    } catch (dbErr: unknown) {
      const _dbErr = ensureError(dbErr);
      log.warn('failed to read local DB visibility', _dbErr.message || _dbErr);
    }

    const isUnlisted =
      visibilityHint === 'unlisted' ||
      localVisibility === 'unlisted' ||
      albumVisibility === 'unlisted';
    if (!isUnlisted) {
      await requireScope(event, 'read');
    }

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
