import { error, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '#lib/db/database.ts';
import { requireMemberPhotosAccess } from '#lib/server/face-access.ts';
import { memberPhotoAssets, type MemberPhotoScope } from '#lib/server/face-photos.ts';
import { assetsNdjsonResponse } from '#lib/server/asset-ndjson.ts';
import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('users-userId-photos-stream');

/**
 * GET /api/users/[userId]/photos-stream?in_album=true|false
 * A member's photos (lot A6: their `auto` and confirmed face matches) as NDJSON, one slim line per
 * asset (asset-ndjson.ts). `in_album=false` leaves out the PhotoCV album ("Mes photos"),
 * `in_album=true` keeps only it ("Mes photos CV"), no value gives every photo (the profile photo
 * picker).
 *
 * Readable by the member, a member they authorised, an admin or an API key (face-access.ts). The
 * answer is assets only: no face, no score, no other member.
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
    return assetsNdjsonResponse(assets, event.request);
  } catch (e: unknown) {
    if (isHttpError(e)) {
      log.error('member photos could not be read', { status: e.status });
      throw e;
    }
    log.error('member photos could not be read', (e as Error).message);
    throw error(500, 'Photos could not be read');
  }
};
