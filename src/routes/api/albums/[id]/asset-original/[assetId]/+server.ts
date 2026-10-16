import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { requireAlbumAssetAccess } from '$lib/server/album-asset-access';
import { error } from '@sveltejs/kit';
import { ensureError } from '$lib/ts-utils';

import { createLogger } from '$lib/server/logger';

const log = createLogger('albums-id-asset-original-assetId');
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

export const GET: RequestHandler = async (event) => {
  try {
    const albumId = event.params.id;
    const assetId = event.params.assetId;
    const { fetch } = event;

    if (!IMMICH_BASE_URL) {
      throw error(500, 'IMMICH_BASE_URL not configured');
    }

    await requireAlbumAssetAccess(event, albumId, assetId);

    if (!IMMICH_API_KEY) {
      throw error(500, 'IMMICH_API_KEY not configured on server');
    }

    const proxied = await fetch(`/api/immich/assets/${assetId}/original`, {
      headers: {
        'x-internal-immich-key': IMMICH_API_KEY,
        Accept: 'application/octet-stream',
      },
    });

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
    const contentLength = proxied.headers.get('content-length');
    if (contentLength) {
      headers['content-length'] = contentLength;
    }
    const disposition = proxied.headers.get('content-disposition');
    if (disposition) {
      headers['content-disposition'] = disposition;
    }

    return new Response(proxied.body, { status: proxied.status, headers });
  } catch (e: unknown) {
    const err = ensureError(e);
    log.error('error', err);
    if (e && typeof e === 'object' && 'status' in e) {
      type ErrorLike = { status: number; [key: string]: unknown };
      throw e as unknown as ErrorLike;
    }
    throw error(500, err.message);
  }
};

export const POST = GET;
export const PUT = GET;
export const DELETE = GET;
export const PATCH = GET;
