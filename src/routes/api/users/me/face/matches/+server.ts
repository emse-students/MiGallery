import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { requireScope } from '#lib/server/permissions.ts';
import { isImpersonating } from '#lib/server/auth.ts';
import { createLogger } from '#lib/server/logger.ts';
import { readJsonBody } from '#lib/server/route-errors.ts';
import { m } from '#lib/paraglide/messages.js';
import { defaultFaceEngine } from '#lib/server/face-engine.ts';
import { answerFace } from '#lib/server/face-enrolment.ts';
import { scheduleDefaultProfilePhoto } from '#lib/server/profile-photo-default.ts';
import { getDatabase } from '#lib/db/database.ts';
import { assetCaptureTimes, pendingSuggestions, shownFaces } from '#lib/server/face-photos.ts';
import type { FaceKey } from '#lib/server/face-store.ts';

const log = createLogger('face-matches-route');

/**
 * GET /api/users/me/face/matches
 * The faces given to the member that wait for their answer (the `suggested` band, lot A6), NEAREST
 * first (faces v2): `{ suggestions: [{ asset_id, face_index }] }`. Nothing else: no distance, no
 * band, no other member - the order is the only trace of the distance. Each one's picture is `GET /api/users/me/face/crops/[assetId]/[faceIndex]`.
 * With `?list=shown`: the faces shown as theirs WITHOUT a question that they have not answered,
 * least sure first, in the same shape - what "Pas moi" from Mes photos answers (auto is sticky,
 * so the member's "not me" is the only way a stranger leaves their photos).
 * Refused to an impersonated session, like the answer itself.
 */
export const GET: RequestHandler = async (event) => {
  const auth = await requireScope(event, 'read');
  if (isImpersonating(event)) {
    log.warn('face suggestions refused while impersonating');
    return json({ error: 'Not allowed while impersonating' }, { status: 403 });
  }
  const userId = auth.user?.id_user;
  if (!userId) {
    return json({ error: 'Unauthorized - no user identified' }, { status: 401 });
  }
  const shown = event.url.searchParams.get('list') === 'shown';
  const faces = shown
    ? shownFaces(getDatabase(), userId)
    : pendingSuggestions(getDatabase(), userId);
  const suggestions = faces.map((face) => ({
    asset_id: face.assetId,
    face_index: face.faceIndex,
  }));
  log.debug('face suggestions read', { shown, count: suggestions.length });
  return json({ success: true, suggestions });
};

/**
 * POST /api/users/me/face/matches
 * The member's answer on a photo where a face was given to them.
 *
 * Body: { asset_id: string, face_index: number, verdict: 'confirm' | 'reject' }
 *
 * 404 when the face is not theirs to answer. A confirmation may teach the store a reference
 * (face-enrolment.ts), whose re-match of the store runs in the background, never in this request;
 * its photo's capture date is read from Immich first, outside the engine lock, for renewal (a
 * failed read is logged and the face ranks oldest). A rejection keeps the face as a negative
 * example, hands it to the next member, and answers `released`: the other faces waiting for this
 * member that the negative now withholds from them (the screen drops them).
 */
export const POST: RequestHandler = async (event) => {
  const auth = await requireScope(event, 'read');
  if (isImpersonating(event)) {
    log.warn('face answer refused while impersonating');
    return json({ error: 'Not allowed while impersonating' }, { status: 403 });
  }
  const userId = auth.user?.id_user;
  if (!userId) {
    return json({ error: 'Unauthorized - no user identified' }, { status: 401 });
  }
  const engine = defaultFaceEngine();
  if (!engine) {
    log.error('face answer asked while the face store is not configured');
    return json(
      { error: 'face_unavailable', message: m.face_enrol_unavailable() },
      { status: 503 }
    );
  }

  const body = await readJsonBody<{ asset_id?: unknown; face_index?: unknown; verdict?: unknown }>(
    event.request
  );
  const { asset_id: assetId, face_index: faceIndex, verdict } = body;
  if (
    typeof assetId !== 'string' ||
    assetId.length === 0 ||
    typeof faceIndex !== 'number' ||
    !Number.isInteger(faceIndex) ||
    faceIndex < 0 ||
    (verdict !== 'confirm' && verdict !== 'reject')
  ) {
    return json({ error: 'asset_id, face_index and verdict are required' }, { status: 400 });
  }

  let takenAt: number | null = null;
  if (verdict === 'confirm') {
    try {
      takenAt = (await assetCaptureTimes(event.fetch, [assetId])).get(assetId) ?? null;
    } catch (e) {
      log.warn('capture date unreadable; the face ranks oldest for renewal', {
        message: (e as Error).message,
      });
    }
  }
  const released: FaceKey[] = [];
  const outcome = await answerFace(engine, userId, { assetId, faceIndex }, verdict, {
    takenAt,
    released,
  });
  if (outcome === 'not_held') {
    log.info('face answer refused: not held');
    return json({ error: 'not_found' }, { status: 404 });
  }
  if (outcome === 'learned' || outcome === 'rejected') {
    // The references renewed, or a face left them: a DEFAULT profile photo is looked at again in
    // the background (a choice is never touched).
    // The GLOBAL fetch: the work outlives this request (as in the avatar route).
    scheduleDefaultProfilePhoto(engine, userId, fetch);
  }
  return json({
    success: true,
    outcome,
    released: released.map((f) => ({ asset_id: f.assetId, face_index: f.faceIndex })),
  });
};
