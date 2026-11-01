import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { requireScope } from '#lib/server/permissions.ts';
import { isImpersonating } from '#lib/server/auth.ts';
import { createLogger } from '#lib/server/logger.ts';
import { readJsonBody } from '#lib/server/route-errors.ts';
import { m } from '#lib/paraglide/messages.js';
import { getDatabase } from '#lib/db/database.ts';
import { defaultFaceEngine } from '#lib/server/face-engine.ts';
import { removeMemberPhoto } from '#lib/server/face-enrolment.ts';
import { rejectedFaces } from '#lib/server/face-photos.ts';
import { scheduleDefaultProfilePhoto } from '#lib/server/profile-photo-default.ts';
import type { FaceKey } from '#lib/server/face-store.ts';

const log = createLogger('face-rejections-route');

/**
 * GET /api/users/me/face/rejections
 * The faces the member said were not them ("Photos écartées"), latest first:
 * `{ rejections: [{ asset_id, face_index }] }`. Each one's picture is the crop route's, served
 * while no other member has confirmed the face. Refused to an impersonated session, as every
 * route of the member's own faces.
 */
export const GET: RequestHandler = async (event) => {
  const auth = await requireScope(event, 'read');
  if (isImpersonating(event)) {
    log.warn('rejected faces refused while impersonating');
    return json({ error: 'Not allowed while impersonating' }, { status: 403 });
  }
  const userId = auth.user?.id_user;
  if (!userId) {
    return json({ error: 'Unauthorized - no user identified' }, { status: 401 });
  }
  const rejections = rejectedFaces(getDatabase(), userId).map((face) => ({
    asset_id: face.assetId,
    face_index: face.faceIndex,
  }));
  log.debug('rejected faces read', { count: rejections.length });
  return json({ success: true, rejections });
};

/**
 * POST /api/users/me/face/rejections
 * "Ce n'est pas moi" on a photo of the member's "Mes photos" (owner, 2026-11-01): every face of
 * theirs shown on it, given without a question or confirmed, leaves them as a "Pas moi" does
 * (`removeMemberPhoto`: a negative example kept, a reference learned from it deleted, the face
 * handed to the next member, a re-match queued when a reference went).
 *
 * Body: { asset_id: string }
 *
 * 404 when the photo is not one of theirs. Answers `released` as the answer route does: the faces
 * waiting for them that the new negative withholds. A DEFAULT profile photo is looked at again in
 * the background (a chosen one is never replaced while it is still theirs).
 */
export const POST: RequestHandler = async (event) => {
  const auth = await requireScope(event, 'read');
  if (isImpersonating(event)) {
    log.warn('photo removal refused while impersonating');
    return json({ error: 'Not allowed while impersonating' }, { status: 403 });
  }
  const userId = auth.user?.id_user;
  if (!userId) {
    return json({ error: 'Unauthorized - no user identified' }, { status: 401 });
  }
  const engine = defaultFaceEngine();
  if (!engine) {
    log.error('photo removal asked while the face store is not configured');
    return json(
      { error: 'face_unavailable', message: m.face_enrol_unavailable() },
      { status: 503 }
    );
  }
  const { asset_id: assetId } = await readJsonBody<{ asset_id?: unknown }>(event.request);
  if (typeof assetId !== 'string' || assetId.length === 0) {
    return json({ error: 'asset_id is required' }, { status: 400 });
  }

  const released: FaceKey[] = [];
  const result = await removeMemberPhoto(engine, userId, assetId, { released });
  if (result.faces === 0) {
    log.info('photo removal refused: not one of the member photos');
    return json({ error: 'not_found' }, { status: 404 });
  }
  // The GLOBAL fetch: the work outlives this request (as in the answer route).
  scheduleDefaultProfilePhoto(engine, userId, fetch);
  return json({
    success: true,
    faces: result.faces,
    released: released.map((f) => ({ asset_id: f.assetId, face_index: f.faceIndex })),
  });
};
