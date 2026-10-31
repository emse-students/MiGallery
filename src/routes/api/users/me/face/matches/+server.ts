import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { requireScope } from '#lib/server/permissions.ts';
import { isImpersonating } from '#lib/server/auth.ts';
import { createLogger } from '#lib/server/logger.ts';
import { m } from '#lib/paraglide/messages.js';
import { defaultFaceEngine } from '#lib/server/face-engine.ts';
import { answerFace } from '#lib/server/face-enrolment.ts';

const log = createLogger('face-matches-route');

/**
 * POST /api/users/me/face/matches
 * The member's answer on a photo where a face was given to them.
 *
 * Body: { asset_id: string, face_index: number, verdict: 'confirm' | 'reject' }
 *
 * 404 when the face is not theirs to answer. A confirmation may teach the store a reference
 * (face-enrolment.ts); a rejection hands the face to the next member.
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

  let body: { asset_id?: unknown; face_index?: unknown; verdict?: unknown };
  try {
    body = (await event.request.json()) as typeof body;
  } catch {
    return json({ error: 'a JSON body is required' }, { status: 400 });
  }
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

  const outcome = await answerFace(engine, userId, { assetId, faceIndex }, verdict);
  if (outcome === 'not_held') {
    log.info('face answer refused: not held');
    return json({ error: 'not_found' }, { status: 404 });
  }
  return json({ success: true, outcome });
};
