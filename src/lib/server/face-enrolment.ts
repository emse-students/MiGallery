/**
 * Enrolment, a member's answers, and what they teach the store (lot A5,
 * docs/wiki/face-matching-option-c.md).
 *
 * THE SELFIE IS NEVER STORED. The route hands the picture to the model service in memory and only
 * the embedding it returns comes here, sealed into `face_references`; the picture itself is dropped
 * with the request.
 *
 * A CONFIRMED FACE TEACHES. A face the member confirms becomes one of their references while they
 * hold fewer than FACE_MAX_REFERENCES, so a member who started from a single selfie reaches the
 * three references the `auto` band asks for by answering.
 *
 * Withdrawal is NOT here: it is the one erasure path of A1 (`applyFaceLink` to null, then
 * `eraseLocalFaceData`), which deletes references, matches and consent in one transaction.
 */

import type { DatabaseInstance } from '#lib/db/database.ts';
import { inTransaction } from '#lib/db/transaction.ts';
import { FACE_MAX_REFERENCES, FACE_MODEL } from '#lib/face-embedding.ts';
import { recordFaceConsent } from '#lib/server/face-consent.ts';
import {
  answerMatch,
  rematchMember,
  redecideFaces,
  runExclusive,
  type FaceEngine,
  type MatchVerdict,
} from '#lib/server/face-engine.ts';
import { addFaceReference } from '#lib/server/face-references.ts';
import { deleteMemberFaceCrop } from '#lib/server/face-crop.ts';
import { loadFaceEmbeddings, type FaceKey } from '#lib/server/face-store.ts';
import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('face-enrolment');

/** How many references of the current model `userId` holds. */
export function referenceCount(db: DatabaseInstance, userId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM face_references WHERE user_id = ? AND model = ?')
    .get(userId, FACE_MODEL) as { n: number };
  return row.n;
}

/**
 * Record the member's consent and store their selfie as a reference, in one transaction. A new
 * selfie REPLACES the previous one (a member re-enrols with a better picture); when the member
 * already holds the maximum without a selfie, the oldest reference makes room. Returns the number
 * of references held afterwards. The caller then runs {@link rematchMember} through the engine.
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

/** Run a member's re-match through the engine, logged; never rejects. */
export function scheduleRematch(engine: FaceEngine, userId: string): Promise<void> {
  return runExclusive(() => rematchMember(engine, userId)).then(
    () => undefined,
    (e: unknown) => log.error('re-matching a member failed', e)
  );
}

/** What an answer did. */
export type AnswerOutcome = 'not_held' | 'confirmed' | 'learned' | 'rejected';

/**
 * Record `userId`'s answer on a face they hold, then what follows from it, all inside the engine's
 * queue so no scan sees half of it:
 * - `confirm`: the face is theirs for good. While they hold fewer than the maximum, its embedding
 *   becomes a reference and the store is re-matched for them (`learned`).
 * - `reject`: the face is never offered to them again and is re-decided for everyone else; its
 *   crop, if one was cut for their confirmation screen, is deleted from their cache.
 * `not_held` when the face is not theirs to answer (never decided for them, or already answered).
 */
export function answerFace(
  engine: FaceEngine,
  userId: string,
  face: FaceKey,
  verdict: MatchVerdict,
  now: number = Date.now()
): Promise<AnswerOutcome> {
  return runExclusive(async (): Promise<AnswerOutcome> => {
    if (!answerMatch(engine.db, userId, face, verdict, now)) {
      return 'not_held';
    }
    if (verdict === 'reject') {
      deleteMemberFaceCrop(userId, face);
      redecideFaces(engine, [face]);
      return 'rejected';
    }
    if (referenceCount(engine.db, userId) >= FACE_MAX_REFERENCES) {
      return 'confirmed';
    }
    const [opened] = loadFaceEmbeddings(engine.faceDb, engine.key, [face]);
    if (!opened) {
      // The face left the store between the answer and now (its asset went): nothing to learn.
      log.warn('a confirmed face is no longer in the store; no reference learned');
      return 'confirmed';
    }
    addFaceReference(engine.db, engine.key, userId, 'photo', opened.embedding, now);
    await rematchMember(engine, userId);
    return 'learned';
  });
}
