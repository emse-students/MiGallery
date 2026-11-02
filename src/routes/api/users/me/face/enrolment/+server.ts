import { json } from '@sveltejs/kit';
import type { RequestEvent, RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '#lib/db/database.ts';
import { requireScope } from '#lib/server/permissions.ts';
import { isImpersonating } from '#lib/server/auth.ts';
import { createLogger } from '#lib/server/logger.ts';
import { readFormBody } from '#lib/server/route-errors.ts';
import { m } from '#lib/paraglide/messages.js';
import { defaultFaceEngine } from '#lib/server/face-engine.ts';
import { upgradeMemberReferences } from '#lib/server/face-reference-upgrade.ts';
import {
  ENROL_LIMIT_PER_HOUR,
  enrolLimiter,
  enrolMember,
  referenceCount,
  scheduleRematch,
} from '#lib/server/face-enrolment.ts';
import {
  FaceMlImageRefusedError,
  FaceMlUnavailableError,
  SelfieRefusedError,
  selfieEmbedding,
} from '#lib/server/face-ml.ts';

const log = createLogger('face-enrolment-route');

/** The largest selfie accepted, in bytes: a phone camera's full-size JPEG fits well under it. */
const SELFIE_MAX_BYTES = 15 * 1024 * 1024;

/** The member acting for themselves, or the response that refuses the request. */
async function ownMember(event: RequestEvent): Promise<string | Response> {
  const auth = await requireScope(event, 'read');
  if (isImpersonating(event)) {
    log.warn('face enrolment refused while impersonating');
    return json({ error: 'Not allowed while impersonating' }, { status: 403 });
  }
  const userId = auth.user?.id_user;
  if (!userId) {
    return json({ error: 'Unauthorized - no user identified' }, { status: 401 });
  }
  return userId;
}

/**
 * GET /api/users/me/face/enrolment
 * Whether the member is enrolled, and how many references they hold. Never a reference itself.
 */
export const GET: RequestHandler = async (event) => {
  const userId = await ownMember(event);
  if (userId instanceof Response) {
    return userId;
  }
  const references = referenceCount(getDatabase(), userId);
  log.debug('enrolment status read', { references });
  return json({ success: true, enrolled: references > 0, references });
};

/**
 * POST /api/users/me/face/enrolment (multipart)
 * - selfie: the picture, read in memory and handed to the model service; NEVER stored.
 * - consent: "true", the member's agreement to the terms in force (recorded with their version).
 *
 * Exactly one face must be found. Its embedding is sealed as the member's selfie reference (a new
 * selfie replaces the previous one), the consent recorded, and the store re-matched for them in
 * the background. Withdrawal is `PATCH /api/users/me/face` with a null person: the one erasure path.
 */
export const POST: RequestHandler = async (event) => {
  const userId = await ownMember(event);
  if (userId instanceof Response) {
    return userId;
  }
  const engine = defaultFaceEngine();
  if (!engine) {
    log.error('face enrolment asked while the face store is not configured');
    return json(
      { error: 'face_unavailable', message: m.face_enrol_unavailable() },
      { status: 503 }
    );
  }

  const form = await readFormBody(event.request);
  if (form.get('consent') !== 'true') {
    log.info('face enrolment refused: no consent');
    return json(
      { error: 'consent_required', message: m.face_enrol_consent_required() },
      { status: 400 }
    );
  }
  const selfie = form.get('selfie');
  if (!(selfie instanceof Blob) || selfie.size === 0) {
    return json({ error: 'selfie is required' }, { status: 400 });
  }
  if (selfie.size > SELFIE_MAX_BYTES) {
    log.info('face enrolment refused: selfie too large', { bytes: selfie.size });
    return json({ error: 'selfie_too_large', message: m.face_enrol_too_large() }, { status: 413 });
  }
  // Counted before the model is called: every selfie that reaches it costs an inference.
  const rate = enrolLimiter.take(userId);
  if (!rate.allowed) {
    log.warn('face enrolment refused: too many selfies', {
      limit: ENROL_LIMIT_PER_HOUR,
      retryAfterSeconds: rate.retryAfterSeconds,
    });
    return json(
      { error: 'too_many_requests', message: m.face_enrol_too_many() },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } }
    );
  }

  let embedding: Float32Array;
  try {
    embedding = await selfieEmbedding(event.fetch, selfie);
  } catch (e) {
    if (e instanceof SelfieRefusedError) {
      return json(
        {
          error: e.reason,
          message: e.reason === 'no_face' ? m.face_enrol_no_face() : m.face_enrol_several_faces(),
        },
        { status: 422 }
      );
    }
    if (e instanceof FaceMlImageRefusedError) {
      // The service answered and refused the picture itself: the client's, not the service's.
      log.warn('face enrolment: the model refused the picture', { status: e.status });
      return json(
        { error: 'selfie_unreadable', message: m.face_enrol_unreadable() },
        { status: 422 }
      );
    }
    if (e instanceof FaceMlUnavailableError) {
      log.error('face enrolment: the model service did not answer', { message: e.message });
      return json(
        { error: 'face_unavailable', message: m.face_enrol_unavailable() },
        { status: 503 }
      );
    }
    log.error('face enrolment: the model service answer was unusable', {
      message: (e as Error).message,
    });
    return json(
      { error: 'face_unavailable', message: m.face_enrol_unavailable() },
      { status: 502 }
    );
  }

  const references = enrolMember(engine, userId, embedding);
  // The bootstrap is owed to every member under the minimum, at every enrolment (owner,
  // 2026-11-02): it runs after the re-match, in the background, and the tick retries on a failure.
  void scheduleRematch(engine, userId)
    .then(() => upgradeMemberReferences(engine, userId, fetch))
    .catch((e) =>
      log.error('the selection after an enrolment failed; the tick retries it', {
        message: (e as Error).message,
      })
    );
  return json({ success: true, enrolled: true, references });
};
