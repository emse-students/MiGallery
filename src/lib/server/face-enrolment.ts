/**
 * Enrolment, a member's answers, and what they teach the store (lot A5,
 * docs/wiki/face-matching-option-c.md).
 *
 * THE SELFIE IS NEVER STORED. The route hands the picture to the model service in memory and only
 * the embedding it returns comes here, sealed into `face_references`; the picture itself is dropped
 * with the request.
 *
 * A CONFIRMED FACE TEACHES, ONLY WHEN IT IS NEAR. A face the member confirms becomes one of their
 * references while they hold fewer than FACE_MAX_REFERENCES AND it lies within the `auto` distance
 * (FACE_AUTO_MAX_DISTANCE) of a reference they already hold. A confirmation in the `suggested` band
 * stays confirmed (shown to them) but is never learned: a reference learned at 0.6 would pull the
 * member's reach towards a lookalike, who would then be followed from photo to photo.
 *
 * A RE-MATCH IS BACKGROUND WORK, COALESCED PER MEMBER. It scans the whole store, so no request
 * awaits it, and {@link scheduleRematch} queues at most one per member (CoalescingQueue).
 *
 * Withdrawal is NOT here: it is the one erasure path of A1 (`applyFaceLink` to null, then
 * `eraseLocalFaceData`), which deletes references, matches and consent in one transaction.
 */

import type { DatabaseInstance } from '#lib/db/database.ts';
import { inTransaction } from '#lib/db/transaction.ts';
import {
  FACE_AUTO_MAX_DISTANCE,
  FACE_MAX_REFERENCES,
  FACE_MODEL,
  minDistance,
} from '#lib/face-embedding.ts';
import { recordFaceConsent } from '#lib/server/face-consent.ts';
import {
  answerMatch,
  CoalescingQueue,
  rematchMember,
  redecideFaces,
  runExclusive,
  type FaceEngine,
  type MatchVerdict,
} from '#lib/server/face-engine.ts';
import { addFaceReference, loadFaceReferences } from '#lib/server/face-references.ts';
import { loadFaceEmbeddings, type FaceKey } from '#lib/server/face-store.ts';
import { createLogger } from '#lib/server/logger.ts';
import { RateLimiter } from '#lib/server/rate-limit.ts';

const log = createLogger('face-enrolment');

/** How many references of the current model `userId` holds. */
export function referenceCount(db: DatabaseInstance, userId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM face_references WHERE user_id = ? AND model = ?')
    .get(userId, FACE_MODEL) as { n: number };
  return row.n;
}

/**
 * Record the member's consent and store their selfie as a reference, in one transaction. The
 * selfie is the member's explicit agreement, so it supersedes an older open consent (see
 * recordFaceConsent). A new selfie REPLACES the previous one (a member re-enrols with a better
 * picture); when the member already holds the maximum without a selfie, the oldest reference makes
 * room. Returns the number of references held afterwards. The caller then calls
 * {@link scheduleRematch}.
 */
export function enrolMember(
  engine: FaceEngine,
  userId: string,
  selfie: Float32Array,
  now: number = Date.now()
): number {
  const { db, key } = engine;
  return inTransaction(db, () => {
    recordFaceConsent(db, userId, 'selfie', now);
    const replaced = db
      .prepare("DELETE FROM face_references WHERE user_id = ? AND model = ? AND source = 'selfie'")
      .run(userId, FACE_MODEL).changes;
    let evicted = 0;
    if (referenceCount(db, userId) >= FACE_MAX_REFERENCES) {
      evicted = db
        .prepare(
          `DELETE FROM face_references WHERE id = (SELECT id FROM face_references
             WHERE user_id = ? AND model = ? ORDER BY created_at, id LIMIT 1)`
        )
        .run(userId, FACE_MODEL).changes;
    }
    if (!addFaceReference(db, key, userId, 'selfie', selfie, now)) {
      // The cap is held above; reaching this means the table and this code disagree.
      throw new Error('the selfie reference could not be stored');
    }
    const held = referenceCount(db, userId);
    log.info('member enrolled', { replaced, evicted, references: held });
    return held;
  });
}

/**
 * Selfies a member may send per hour. Each costs an inference on the shared model service (and,
 * once stored, a re-match, coalesced below); ten leaves room for a few pictures refused for a
 * second face, never for a loop.
 */
export const ENROL_LIMIT_PER_HOUR = 10;

/** The enrolment limit per member, held in this process (the route takes from it). */
export const enrolLimiter = new RateLimiter(ENROL_LIMIT_PER_HOUR, 60 * 60 * 1000);

/** The members' background re-matches: at most one queued per member. */
const rematches = new CoalescingQueue('member re-match', (e: unknown) =>
  log.error('re-matching a member failed', e)
);

/**
 * Queue a member's re-match in the background, coalesced (see CoalescingQueue): a request while
 * one is queued joins it; a request while one runs leads to exactly one more. Never rejects. The
 * promise resolves once the run that covers this request is over (the tests wait on it).
 */
export function scheduleRematch(engine: FaceEngine, userId: string): Promise<void> {
  log.debug('member re-match requested');
  return rematches.request(userId, () => rematchMember(engine, userId));
}

/**
 * Whether a confirmed face may become a reference: its distance to the member's NEAREST existing
 * reference is within the `auto` band, the matcher's own bound (inclusive, as `classifyDistance`).
 * NaN (a corrupt vector) is never learned.
 */
export function learnable(nearestReferenceDistance: number): boolean {
  return nearestReferenceDistance <= FACE_AUTO_MAX_DISTANCE;
}

/** What an answer did. */
export type AnswerOutcome = 'not_held' | 'confirmed' | 'learned' | 'rejected';

/**
 * Record `userId`'s answer on a face they hold, then what follows from it, inside the engine's
 * queue so no scan sees half of it:
 * - `confirm`: the face is theirs for good. While they hold fewer than the maximum and the face is
 *   {@link learnable}, its embedding becomes a reference (`learned`) and a re-match is queued in
 *   the BACKGROUND (the request never waits for a scan of the store).
 * - `reject`: the face is never offered to them again and is re-decided for everyone else (one
 *   face: cheap, done before answering).
 * `not_held` when the face is not theirs to answer (never decided for them, or already answered).
 */
export async function answerFace(
  engine: FaceEngine,
  userId: string,
  face: FaceKey,
  verdict: MatchVerdict,
  now: number = Date.now()
): Promise<AnswerOutcome> {
  const outcome = await runExclusive((): AnswerOutcome => {
    if (!answerMatch(engine.db, userId, face, verdict, now)) {
      return 'not_held';
    }
    if (verdict === 'reject') {
      redecideFaces(engine, [face]);
      return 'rejected';
    }
    if (referenceCount(engine.db, userId) >= FACE_MAX_REFERENCES) {
      log.debug('confirmed face not learned: the member holds the maximum');
      return 'confirmed';
    }
    const [opened] = loadFaceEmbeddings(engine.faceDb, engine.key, [face]);
    if (!opened) {
      // The face left the store between the answer and now (its asset went): nothing to learn.
      log.warn('a confirmed face is no longer in the store; no reference learned');
      return 'confirmed';
    }
    const held = loadFaceReferences(engine.db, engine.key, userId);
    if (held.length === 0) {
      // A match is only ever decided on references; none left means they went (a withdrawal).
      log.warn('a confirmed face of a member holding no reference; no reference learned');
      return 'confirmed';
    }
    const nearest = minDistance(held, opened.embedding, (index) =>
      log.error('a member reference is not a usable vector', { index })
    );
    if (!learnable(nearest)) {
      log.info('confirmed face not learned: beyond the auto distance of every reference', {
        distance: nearest,
      });
      return 'confirmed';
    }
    addFaceReference(engine.db, engine.key, userId, 'photo', opened.embedding, now);
    return 'learned';
  });
  if (outcome === 'learned') {
    // Outside the lock, and not awaited: the store scan is background work.
    void scheduleRematch(engine, userId);
  }
  return outcome;
}
