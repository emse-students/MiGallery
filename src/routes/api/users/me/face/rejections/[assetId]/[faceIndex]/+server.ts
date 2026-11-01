import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { requireScope } from '#lib/server/permissions.ts';
import { isImpersonating } from '#lib/server/auth.ts';
import { createLogger } from '#lib/server/logger.ts';
import { m } from '#lib/paraglide/messages.js';
import { defaultFaceEngine } from '#lib/server/face-engine.ts';
import { restoreRejectedFace } from '#lib/server/face-enrolment.ts';
import { scheduleDefaultProfilePhoto } from '#lib/server/profile-photo-default.ts';

const log = createLogger('face-rejection-route');

/**
 * DELETE /api/users/me/face/rejections/[assetId]/[faceIndex]
 * "En fait, c'est moi" (owner, 2026-11-01): the member takes back their "not me" on a face. The
 * negative example it kept is deleted and the face is theirs again, confirmed
 * (`restoreRejectedFace`). Same scope and impersonation refusal as the answer route.
 *
 * 404 when the face is not one they rejected; 409 `confirmed_by_other` when another member has
 * confirmed it since (nothing changes, the screen says why).
 */
export const DELETE: RequestHandler = async (event) => {
  const auth = await requireScope(event, 'read');
  if (isImpersonating(event)) {
    log.warn('rejection undo refused while impersonating');
    return json({ error: 'Not allowed while impersonating' }, { status: 403 });
  }
  const userId = auth.user?.id_user;
  if (!userId) {
    return json({ error: 'Unauthorized - no user identified' }, { status: 401 });
  }
  const assetId = event.params.assetId ?? '';
  const faceIndex = Number(event.params.faceIndex);
  if (!/^[\w-]{1,64}$/.test(assetId) || !Number.isInteger(faceIndex) || faceIndex < 0) {
    return json({ error: 'Invalid face' }, { status: 400 });
  }
  const engine = defaultFaceEngine();
  if (!engine) {
    log.error('rejection undo asked while the face store is not configured');
    return json(
      { error: 'face_unavailable', message: m.face_enrol_unavailable() },
      { status: 503 }
    );
  }

  const outcome = await restoreRejectedFace(engine, userId, { assetId, faceIndex });
  if (outcome === 'not_rejected') {
    return json({ error: 'not_found' }, { status: 404 });
  }
  if (outcome === 'confirmed_by_other') {
    return json(
      { error: 'confirmed_by_other', message: m.param_rejected_taken() },
      { status: 409 }
    );
  }
  // The photo is theirs again: a DEFAULT profile photo is looked at again in the background.
  scheduleDefaultProfilePhoto(engine, userId, fetch);
  return json({ success: true, outcome });
};
