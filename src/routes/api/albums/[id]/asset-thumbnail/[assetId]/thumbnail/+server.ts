import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { requireAlbumAssetAccess } from '$lib/server/album-asset-access';
import { error } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';

import { createLogger } from '$lib/server/logger';

const log = createLogger('albums-id-asset-thumbnail-assetId-thumbnail');
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

export const GET: RequestHandler = async (event) => {
  try {
    const albumId = event.params.id;
    const assetId = event.params.assetId;
    const { fetch, request } = event;

    if (!IMMICH_BASE_URL) {
      throw error(500, 'IMMICH_BASE_URL not configured');
    }

    await requireAlbumAssetAccess(event, albumId, assetId);

    if (!IMMICH_API_KEY) {
      throw error(500, 'IMMICH_API_KEY not configured on server');
    }

    const size = new URL(request.url).searchParams.get('size') || 'thumbnail';
    const proxied = await fetch(
      `/api/immich/assets/${assetId}/thumbnail?size=${encodeURIComponent(size)}`,
      {
        headers: {
          'x-internal-immich-key': IMMICH_API_KEY,
          Accept: 'application/octet-stream',
        },
      }
    );

    if (!proxied.ok) {
      let bodySnippet = '';
      try {
        bodySnippet = await proxied.clone().text();
      } catch {
        /* ignore */
      }
      log.error('upstream returned non-ok', {
        assetId,
        status: proxied.status,
        snippet: bodySnippet.slice(0, 400),
      });
      return new Response(bodySnippet || proxied.statusText, { status: proxied.status });
    }

    const headers: Record<string, string> = {};
    const contentType = proxied.headers.get('content-type');
    if (contentType) {
      headers['content-type'] = contentType;
    }
    const cacheControl = proxied.headers.get('cache-control');
    if (cacheControl) {
      headers['cache-control'] = cacheControl;
    }

    return new Response(proxied.body, { status: proxied.status, headers });
  } catch (e: unknown) {
    const err = ensureError(e);
    log.error('error', err);
    if (e && typeof e === 'object' && 'status' in e) {
      throw e;
    }
    throw error(500, err.message);
  }
};
