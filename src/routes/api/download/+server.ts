import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireScope } from '#lib/server/permissions.ts';
import { createDownloadToken } from '#lib/server/download-tokens.ts';
import { DOWNLOAD_BATCH_SIZE } from '#lib/immich/download.ts';
import { isImmichId } from '#lib/server/immich-id.ts';
import { requireAssetsRead } from '#lib/server/asset-access.ts';
import { requireAlbumAssetAccess } from '#lib/server/album-asset-access.ts';
import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('download');

/**
 * POST /api/download - mints a one-time token for an archive of the photos named.
 *
 * Every id is judged HERE, as the caller, and the token records exactly the ids that passed: the
 * redemption (`GET /api/download/[token]`) takes nothing but the token, from the same caller. With `albumId` the photos
 * are read as that album's (one membership read for the whole batch); without it each follows the
 * rule of a photo asked for by its id (asset-access.ts).
 */
export const POST: RequestHandler = async (event) => {
  const auth = await requireScope(event, 'read');

  const body = (await event.request.json().catch(() => null)) as {
    assetIds?: unknown;
    filename?: unknown;
    albumId?: unknown;
  } | null;
  const assetIds = body?.assetIds;

  if (!Array.isArray(assetIds) || assetIds.length === 0) {
    throw error(400, 'assetIds must be a non-empty array');
  }
  if (assetIds.length > DOWNLOAD_BATCH_SIZE) {
    log.warn('download refused: more photos than one archive holds', { count: assetIds.length });
    throw error(400, `At most ${DOWNLOAD_BATCH_SIZE} photos per archive`);
  }
  if (!assetIds.every(isImmichId)) {
    throw error(400, 'Invalid asset id');
  }
  const ids = [...new Set(assetIds.map((id) => id.toLowerCase()))];

  const albumId = body?.albumId;
  if (albumId === undefined || albumId === null) {
    await requireAssetsRead(event, auth, ids);
  } else {
    if (!isImmichId(albumId)) {
      throw error(400, 'Invalid album id');
    }
    for (const id of ids) {
      await requireAlbumAssetAccess(event, albumId, id);
    }
  }

  const filename = typeof body?.filename === 'string' && body.filename ? body.filename : 'album';
  const token = createDownloadToken(ids, filename, auth.user?.id_user ?? null);
  log.info('download token minted', { count: ids.length, album: albumId !== undefined });
  return json({ token });
};
