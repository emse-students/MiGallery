import { error as svelteError, isHttpError } from '@sveltejs/kit';

import { getDatabase } from '#lib/db/database.ts';
import type { RequestHandler } from '@sveltejs/kit';
import { env } from '#lib/server/env.ts';
import { requireScope } from '#lib/server/permissions.ts';
import { generateMemberFaceCrop } from '#lib/server/face-crop.ts';
import { getFaceDatabase } from '#lib/db/face-database.ts';
import { profileFace } from '#lib/server/face-photos.ts';
import { loadFaceBox } from '#lib/server/face-store.ts';
import { isAvatarSignatureValid } from '#lib/server/avatar-signature.ts';
import { avatarSaltOf } from '#lib/server/avatar-revocation.ts';

import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('users-username-avatar');

/**
 * GET /api/users/[username]/avatar
 * A member's profile photo by their id_user: their own face, cut from the photo they chose among
 * their photos (lot A6). 404 when they chose none, or the photo is no longer one of theirs.
 * Requires: authentication (session cookie, auth provider, or API key with 'read' scope), OR a
 * `?sig=` that signs THIS id_user - the keyless URL MiConnect hands to MinoWiki and Archives
 * ($lib/server/avatar-signature).
 */
export const GET: RequestHandler = async (event) => {
  const sig = event.url.searchParams.get('sig');
  if (sig === null) {
    await requireScope(event, 'read');
  } else {
    const key = env.AVATAR_SIGNING_KEY ?? '';
    if (!key) {
      log.error('Signed avatar request but AVATAR_SIGNING_KEY is not configured');
      return svelteError(500, 'Signed avatars are not configured');
    }
    const idUser = event.params.username ?? '';
    // The user's revocation salt, if any (avatar-signature.ts): a revoked link no longer verifies.
    const salt = avatarSaltOf(getDatabase(), idUser);
    if (!isAvatarSignatureValid(key, idUser, sig, salt)) {
      log.warn('Signed avatar request refused: signature does not match', {
        username: event.params.username,
      });
      return svelteError(403, 'Invalid signature');
    }
  }
  try {
    const { username } = event.params;
    if (!username) {
      return svelteError(400, 'Missing username');
    }

    const db = getDatabase();
    const user = db
      .prepare('SELECT photos_asset_id FROM users WHERE id_user = ?')
      .get(username) as {
      photos_asset_id: string | null;
    } | null;
    if (!user) {
      return svelteError(404, 'User not found');
    }
    const assetId = user.photos_asset_id;
    if (!assetId) {
      return svelteError(404, 'User has no profile photo');
    }

    // The profile photo is cut around the member's OWN face in the photo they chose (lot A6): a
    // photo that is no longer one of theirs - rejected, given to someone else, withdrawn - has no
    // avatar any more, rather than a crop of whoever is in it.
    const face = profileFace(db, username, assetId);
    if (!face) {
      log.info('avatar asked for a photo that is no longer one of the member photos');
      return svelteError(404, 'User has no profile photo');
    }
    const box = loadFaceBox(getFaceDatabase(), face);
    if (!box) {
      log.warn('avatar: the member face has no box in the store');
      return svelteError(404, 'User has no profile photo');
    }

    // The crop is fully determined by the face, so the asset id is a natural ETag. NOTHING is
    // immutable: the avatar is a crop of the member's face, and a withdrawal (or the face going to
    // someone else) must reach the viewers' browsers too. A busted URL (?v=assetId) is fresh for
    // an hour, an unbusted one (e.g. the shared Avatar component) revalidates every time; both
    // revalidate against the ETag, answered only after the face was re-checked above.
    // PRIVATE, never public: the route is session-gated, and a shared cache (the Cloudflare edge)
    // would hand a face to anyone holding the URL.
    const busted = event.url.searchParams.has('v');
    const cacheControl = busted ? 'private, max-age=3600' : 'private, no-cache';
    const etag = `"${assetId}"`;
    if (event.request.headers.get('if-none-match') === etag) {
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, 'Cache-Control': cacheControl },
      });
    }
    const crop = await generateMemberFaceCrop(
      username,
      face,
      box,
      event.fetch,
      () => profileFace(db, username, assetId) !== null
    );
    if (crop.ok) {
      return new Response(new Uint8Array(crop.buffer), {
        headers: {
          'Content-Type': 'image/webp',
          ETag: etag,
          'Cache-Control': cacheControl,
        },
      });
    }
    log.warn('avatar crop failed', { reason: crop.reason });
    if (crop.reason === 'busy') {
      return new Response(null, { status: 503, headers: { 'Retry-After': '2' } });
    }
    return svelteError(crop.reason === 'notfound' ? 404 : 500, 'Photo not available');
  } catch (err: unknown) {
    if (isHttpError(err)) {
      throw err;
    }
    const errorMessage = err instanceof Error ? err.message : 'Server error';
    log.error('Error /api/users/[username]/avatar:', err);
    return svelteError(500, errorMessage);
  }
};
