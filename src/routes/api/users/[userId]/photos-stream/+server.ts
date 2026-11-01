import { error, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '#lib/db/database.ts';
import { requireMemberPhotosAccess } from '#lib/server/face-access.ts';
import { memberPhotoAssets, type MemberPhotoScope } from '#lib/server/face-photos.ts';
import { assetsNdjsonResponse } from '#lib/server/asset-ndjson.ts';
import { createLogger } from '#lib/server/logger.ts';
import { logRouteFailure } from '#lib/server/route-errors.ts';
import { ImmichNotConfiguredError } from '#lib/immich/not-configured.ts';

const log = createLogger('users-userId-photos-stream');

/**
 * GET /api/users/[userId]/photos-stream?in_album=true|false
 * A member's photos (lot A6: their `auto` and confirmed face matches) as NDJSON, one slim line per
 * asset (asset-ndjson.ts). `in_album=false` leaves out the PhotoCV album ("Mes photos"),
 * `in_album=true` keeps only it ("Mes photos CV"), no value gives every photo (the profile photo
 * picker).
 *
 * Readable by the member, a member they authorised, an admin or an API key (face-access.ts). The
 * answer is assets only: no face, no score, no other member, and `private, no-store`.
 */
export const GET: RequestHandler = async (event) => {
  const ownerId = event.params.userId;
  if (!ownerId) {
    throw error(400, 'userId required');
  }
  const inAlbum = event.url.searchParams.get('in_album');
  const scope: MemberPhotoScope =
    inAlbum === 'true' ? 'in_cv' : inAlbum === 'false' ? 'outside_cv' : 'all';

  await requireMemberPhotosAccess(event, ownerId);
  try {
    const assets = await memberPhotoAssets(event.fetch, getDatabase(), ownerId, scope);
    // Face-derived (who appears where): never stored by a browser or a shared cache.
    return assetsNdjsonResponse(assets, event.request, 'private, no-store');
  } catch (e: unknown) {
    if (e instanceof ImmichNotConfiguredError) {
      // Said once at info by requireImmichBaseUrl; nothing failed.
      throw error(503, e.message);
    }
    logRouteFailure(log, 'member photos could not be read', e);
    if (isHttpError(e)) {
      throw e;
    }
    throw error(500, 'Photos could not be read');
  }
};
