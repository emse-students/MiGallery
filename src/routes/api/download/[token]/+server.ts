import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consumeDownloadToken } from '#lib/server/download-tokens.ts';
import { requireScope } from '#lib/server/permissions.ts';
import { createLogger } from '#lib/server/logger.ts';
import { env } from '#lib/server/env.ts';
import { ensureError } from '#lib/ts-utils.ts';
import { fetchWithAnswerDeadline } from '#lib/server/outbound.ts';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';
const log = createLogger('download-token');

export const GET: RequestHandler = async (event) => {
  const { token } = event.params;
  // A token is redeemed by the caller who minted it: the same member, or a key for a key's.
  const auth = await requireScope(event, 'read');
  const data = consumeDownloadToken(token, auth.user?.id_user ?? null);

  if (data === 'other') {
    log.warn('download token refused: it was minted by another caller', {
      viewer: auth.user?.id_user ?? null,
    });
    throw error(403, 'This download belongs to another session');
  }
  if (!data) {
    throw error(404, 'Invalid or expired download token');
  }

  if (!IMMICH_BASE_URL) {
    throw error(500, 'IMMICH_BASE_URL not configured');
  }

  try {
    // The answer is bounded, the archive that follows is not: this body is the whole download,
    // and a reader on a phone connection is allowed to take as long as they take.
    const res = await fetchWithAnswerDeadline(`${IMMICH_BASE_URL}/api/download/archive`, {
      method: 'POST',
      headers: {
        'x-api-key': IMMICH_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/zip, application/octet-stream',
      },
      body: JSON.stringify({ assetIds: data.assetIds }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw error(res.status, `Failed to fetch archive: ${text.slice(0, 200)}`);
    }

    const filename = encodeURIComponent(`${data.filename}.zip`);
    const headers = new Headers({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    });
    const contentLength = res.headers.get('content-length');
    if (contentLength) {
      headers.set('Content-Length', contentLength);
    }

    // Stream directly from Immich to the browser - no JS buffering, no service worker
    return new Response(res.body, { headers });
  } catch (e: unknown) {
    const err = ensureError(e);
    if (e && typeof e === 'object' && 'status' in e) {
      throw e;
    }
    throw error(500, err.message);
  }
};
