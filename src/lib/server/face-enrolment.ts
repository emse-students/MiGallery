/**
 * Enrolment, a member's answers, and what they teach the store (lot A5,
 * docs/wiki/face-matching-option-c.md).
 *
 * THE SELFIE IS NEVER STORED. The route hands the picture to the model service in memory and only
 * the embedding it returns comes here, sealed into `face_references`; the picture itself is dropped
 * with the request.
 *
 * A CONFIRMED FACE TEACHES, ONLY WHEN IT IS NEAR. A face the member confirms becomes one of their
 * references when it lies within the `auto` distance (FACE_AUTO_MAX_DISTANCE) of a reference they
 * already hold: added below FACE_MAX_REFERENCES (15), and at the cap in place of the least useful
 * one, the older photo of the two most redundant references (faces v2, owner 2026-11-01:
 * face-reference-selection.ts). A confirmation in the `suggested` band stays confirmed (shown to
 * them) but is never learned: a reference learned at 0.6 would pull the member's reach towards a
 * lookalike, who would then be followed from photo to photo.
 *
 * A REJECTION TEACHES TOO: the face becomes one of the member's negative examples
 * (face-negatives.ts), which withhold its lookalikes from them, and from them only.
 *
 * A RE-MATCH IS BACKGROUND WORK, COALESCED PER MEMBER. It scans the whole store, so no request
 * awaits it, and {@link scheduleRematch} queues at most one per member (CoalescingQueue).
 *
 * Withdrawal is NOT here: it is the one erasure path of A1 (`applyFaceLink` to null, then
 * `eraseLocalFaceData`), which deletes references, matches and consent in one transaction.
 */

import type { DatabaseInstance } from '#lib/db/database.ts';
import { inTransaction } from '#lib/db/transaction.ts';
import { FACE_MAX_REFERENCES, FACE_MODEL } from '#lib/face-embedding.ts';
import { decideLearning, learnable, redundantVictim } from '#lib/face-reference-selection.ts';
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
import {
  addFaceReference,
  deleteFaceReference,
  loadReferenceItems,
} from '#lib/server/face-references.ts';
import { addFaceNegative } from '#lib/server/face-negatives.ts';
import { deleteMemberFaceCrop } from '#lib/server/face-crop.ts';
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
 * picture); when the member already holds the maximum without a selfie, the least useful
 * reference makes room (`redundantVictim`: of the two closest, the older photo; never the selfie). Returns the number of references held afterwards. The caller then calls
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
      const held = loadReferenceItems(db, key, userId);
      const victim = redundantVictim([
        ...held,
        { key: 'selfie', embedding: selfie, takenAt: now, anchor: true },
      ]);
      const row = held.find((h) => h.key === victim?.key);
      if (!row || !deleteFaceReference(db, userId, row.id)) {
        throw new Error('no reference could make room for the selfie');
      }
      evicted = 1;
    }
    // The selfie is taken now: its capture date is the enrolment.
    if (!addFaceReference(db, key, userId, 'selfie', selfie, now, { takenAt: now })) {
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

/** Whether a confirmed face may become a reference (face-reference-selection.ts, re-exported). */
export { learnable };

/** What an answer did. `learned`: the face became a reference (added, or renewing one). */
export type AnswerOutcome = 'not_held' | 'confirmed' | 'learned' | 'rejected';

/** What {@link answerFace} may be told, and where it reports what it released. */
export interface AnswerOptions {
  now?: number;
  /**
   * The capture date of the face's photo (ms), read from Immich by the caller OUTSIDE the engine
   * lock; null when it could not be read (renewal then ranks the face oldest, never newest).
   */
  takenAt?: number | null;
  /**
   * Filled on a rejection with the OTHER faces the member was waiting to answer that their new
   * negative now withholds from them: the screen drops them rather than offer a face that is no
   * longer theirs to answer.
   */
  released?: FaceKey[];
}

/**
 * Record `userId`'s answer on a face they hold, then what follows from it, inside the engine's
 * queue so no scan sees half of it:
 * - `confirm`: the face is theirs for good. When it is learnable (within the `auto` distance of a
 *   reference they hold) it becomes a reference: added below the cap, or, at the cap, in place of
 *   the least useful one (`decideLearning`: of the two closest, the older photo), so references
 *   keep their variety and follow the member's face over the years. A re-match is then queued in
 *   the BACKGROUND (the request never waits for a scan of the store).
 * - `reject`: the face is never offered to them again, is kept as one of their NEGATIVE examples,
 *   and is re-decided for everyone else; then the faces still waiting for their answer are
 *   re-decided against that negative (a few dozen: cheap, done before answering), and those it
 *   withholds are reported in `options.released`. Its crop is deleted from their cache.
 * `not_held` when the face is not theirs to answer (never decided for them, or already answered).
 */
export async function answerFace(
  engine: FaceEngine,
  userId: string,
  face: FaceKey,
  verdict: MatchVerdict,
  options: AnswerOptions = {}
): Promise<AnswerOutcome> {
  const now = options.now ?? Date.now();
  const outcome = await runExclusive((): AnswerOutcome => {
    if (!answerMatch(engine.db, userId, face, verdict, now)) {
      return 'not_held';
    }
    const [opened] = loadFaceEmbeddings(engine.faceDb, engine.key, [face]);
    if (verdict === 'reject') {
      deleteMemberFaceCrop(userId, face);
      if (opened) {
        addFaceNegative(engine.db, engine.key, userId, face, opened.embedding, now);
      } else {
        log.warn('a rejected face is no longer in the store; no negative kept');
      }
      redecideFaces(engine, [face]);
      const waiting = waitingFaces(engine.db, userId);
      if (waiting.length > 0 && opened) {
        redecideFaces(engine, waiting);
        const still = new Set(waitingFaces(engine.db, userId).map(keyOf));
        const released = waiting.filter((f) => !still.has(keyOf(f)));
        options.released?.push(...released);
        log.info('a rejection withheld other waiting faces', { released: released.length });
      }
      return 'rejected';
    }
    if (!opened) {
      // The face left the store between the answer and now (its asset went): nothing to learn.
      log.warn('a confirmed face is no longer in the store; no reference learned');
      return 'confirmed';
    }
    const held = loadReferenceItems(engine.db, engine.key, userId);
    const decision = decideLearning(
      held,
      {
        key: `face:${face.assetId}:${face.faceIndex}`,
        embedding: opened.embedding,
        takenAt: options.takenAt ?? null,
      },
      FACE_MAX_REFERENCES
    );
    if (decision.kind === 'skip') {
      log.info('confirmed face not learned', { reason: decision.reason });
      return 'confirmed';
    }
    const origin = { assetId: face.assetId, faceIndex: face.faceIndex, takenAt: options.takenAt };
    inTransaction(engine.db, () => {
      if (decision.kind === 'replace') {
        const victim = held.find((h) => h.key === decision.victim);
        if (!victim || !deleteFaceReference(engine.db, userId, victim.id)) {
          throw new Error('the reference renewal replaces could not be deleted');
        }
      }
      if (
        !addFaceReference(engine.db, engine.key, userId, 'photo', opened.embedding, now, origin)
      ) {
        throw new Error('the learned reference could not be stored');
      }
    });
    log.info('confirmed face learned', { renewal: decision.kind === 'replace' });
    return 'learned';
  });
  if (outcome === 'learned') {
    // Outside the lock, and not awaited: the store scan is background work.
    void scheduleRematch(engine, userId);
  }
  return outcome;
}

const keyOf = (f: FaceKey) => `${f.assetId}\u0000${f.faceIndex}`;

/** The faces `userId` holds that wait for their answer (the `suggested` band, pending). */
function waitingFaces(db: DatabaseInstance, userId: string): FaceKey[] {
  return (
    db
      .prepare(
        `SELECT asset_id, face_index FROM face_matches WHERE user_id = ? AND model = ?
          AND state = 'pending' AND band = 'suggested'`
      )
      .all(userId, FACE_MODEL) as Array<{ asset_id: string; face_index: number }>
  ).map((r) => ({ assetId: r.asset_id, faceIndex: r.face_index }));
}
