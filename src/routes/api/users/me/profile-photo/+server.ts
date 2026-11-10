import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '#lib/db/database.ts';
import { requireScope } from '#lib/server/permissions.ts';
import { isImpersonating } from '#lib/server/auth.ts';
import { createLogger } from '#lib/server/logger.ts';
import { profileFace, visibleProfileFaces } from '#lib/server/face-photos.ts';
import { profilePhotoOf } from '#lib/server/profile-photo-default.ts';
import { answerMatch, runExclusive } from '#lib/server/face-engine.ts';
import { inTransaction } from '#lib/db/transaction.ts';

const log = createLogger('profile-photo-route');

/**
 * PUT /api/users/me/profile-photo
 * Choose the member's profile photo among THEIR OWN photos (lot A6).
 *
 * Body: { asset_id: string, user_id?: string (admin only: another member's) }
 *
 * The photo must be one of the member's photos now - a face of theirs there, shown without a
 * question (`face_matches`) - or the answer is 404 and nothing changes. The avatar is then cut
 * around that face (`GET /api/users/[username]/avatar`). Stored in `users.photos_asset_id`, which
 * a withdrawal clears, as a CHOICE (`photos_asset_source = chosen`): a default photo never
 * replaces it while it is still theirs (profile-photo-default.ts). Refused to an impersonated session: it is the member's own choice.
 *
 * Choosing CONFIRMS the face the avatar is cut around (owner, 2026-11-10): a pending `auto` face
 * could be claimed by another member, which ended the choice and let a default replace it without
 * the member doing anything. A confirmed face is never claimed nor re-decided, so a chosen photo
 * now changes only by the member's act (a rejection, a withdrawal) or because Immich lost it.
 * Only the MEMBER's own choice confirms: they saw that face in the picker. An admin choosing for
 * them sees no face (the crops are served to their holder alone), so an admin's choice is stored
 * unconfirmed, as before. No reference is learned in this request; like any face the member
 * confirmed, it may become one at a later reference selection (face-reference-upgrade.ts).
 */
export const PUT: RequestHandler = async (event) => {
  const auth = await requireScope(event, 'read');
  if (isImpersonating(event)) {
    log.warn('profile photo change refused while impersonating');
    return json({ error: 'Not allowed while impersonating' }, { status: 403 });
  }
  let body: { asset_id?: unknown; user_id?: unknown };
  try {
    body = (await event.request.json()) as typeof body;
  } catch {
    return json({ error: 'a JSON body is required' }, { status: 400 });
  }
  const isAdmin = auth.user?.role === 'admin';
  if (body.user_id !== undefined && typeof body.user_id !== 'string') {
    return json({ error: 'user_id must be a string' }, { status: 400 });
  }
  if (body.user_id !== undefined && body.user_id !== auth.user?.id_user && !isAdmin) {
    log.warn('profile photo of another member refused: not an admin');
    return json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (body.user_id as string | undefined) ?? auth.user?.id_user;
  if (!userId) {
    return json({ error: 'Unauthorized - no user identified' }, { status: 401 });
  }
  const assetId = body.asset_id;
  if (typeof assetId !== 'string' || !/^[\w-]{1,64}$/.test(assetId)) {
    return json({ error: 'asset_id is required' }, { status: 400 });
  }

  const db = getDatabase();
  // Inside the engine lock: no claim or re-decision runs between the check and the write.
  const outcome = await runExclusive((): 'not_theirs' | 'no_user' | 'chosen' => {
    const face = profileFace(db, userId, assetId);
    if (!face) {
      return 'not_theirs';
    }
    return inTransaction(db, () => {
      const changes = db
        .prepare(
          "UPDATE users SET photos_asset_id = ?, photos_asset_source = 'chosen' WHERE id_user = ?"
        )
        .run(assetId, userId).changes;
      if (changes === 0) {
        return 'no_user';
      }
      if (userId !== auth.user?.id_user) {
        log.debug('profile photo chosen by an admin: the face is left unconfirmed');
        return 'chosen';
      }
      // The member's choice IS their word on that face: confirmed, no other member can claim it
      // away and turn the choice invalid (a pending `auto` face can be). False when it already was.
      const confirmed = answerMatch(db, userId, face, 'confirm');
      log.debug('profile photo face', { newlyConfirmed: confirmed });
      return 'chosen';
    });
  });
  if (outcome === 'not_theirs') {
    log.info('profile photo refused: not one of the member photos', { byAdmin: isAdmin });
    return json({ error: 'not_found' }, { status: 404 });
  }
  if (outcome === 'no_user') {
    log.warn('profile photo refused: no such member');
    return json({ error: 'User not found' }, { status: 404 });
  }
  log.info('profile photo chosen', { byAdmin: userId !== auth.user?.id_user });
  return json({ success: true, photos_asset_id: assetId });
};

/**
 * GET /api/users/me/profile-photo[?user_id=]
 * What the profile photo picker needs: the current photo and whether it was chosen or picked by
 * default, and, for each of the member's photos, the face of theirs a tile shows
 * (`{ current: { asset_id, source } | null, faces: { [asset_id]: face_index } }`). The photos
 * themselves, in their order (newest first), come from the photos stream. `user_id` is an
 * admin's, like the PUT. Refused to an impersonated session.
 */
export const GET: RequestHandler = async (event) => {
  const auth = await requireScope(event, 'read');
  if (isImpersonating(event)) {
    log.warn('profile photo read refused while impersonating');
    return json({ error: 'Not allowed while impersonating' }, { status: 403 });
  }
  const asked = event.url.searchParams.get('user_id');
  const isAdmin = auth.user?.role === 'admin';
  if (asked !== null && asked !== auth.user?.id_user && !isAdmin) {
    log.warn('profile photo of another member refused: not an admin');
    return json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = asked ?? auth.user?.id_user;
  if (!userId) {
    return json({ error: 'Unauthorized - no user identified' }, { status: 401 });
  }
  const db = getDatabase();
  const current = profilePhotoOf(db, userId);
  const faces = Object.fromEntries(
    visibleProfileFaces(db, userId).map((f) => [f.assetId, f.faceIndex] as const)
  );
  log.debug('profile photo read', { faces: Object.keys(faces).length });
  return json({
    success: true,
    current: current.assetId ? { asset_id: current.assetId, source: current.source } : null,
    faces,
  });
};
