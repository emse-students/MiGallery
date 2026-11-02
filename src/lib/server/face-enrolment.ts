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
 * (face-negatives.ts), which withhold its lookalikes from them, and from them only, and any
 * reference that was learned from it goes (a face the member says is not theirs never stays a
 * reference). The member may say it of ANY photo of theirs, a confirmed one included
 * ({@link removeMemberPhoto}), and take it back ({@link restoreRejectedFace}).
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
  FACE_MIN_REFERENCES,
  FACE_MODEL,
  FACE_SELECTION_UNDONE,
  cosineDistance,
} from '#lib/face-embedding.ts';
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
import { addFaceNegative, deleteFaceNegative } from '#lib/server/face-negatives.ts';
import { deleteMemberFaceCrop } from '#lib/server/face-crop.ts';
import { VISIBLE_MATCH_SQL } from '#lib/server/face-photos.ts';
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
    if (replaced > 0) {
      // The first snapshot holds the selfie that was just replaced: an undo would give it back and
      // delete the new one. A re-enrolment is a new start; the next pass keeps a new snapshot.
      for (const table of ['face_reference_ledger', 'face_match_ledger']) {
        db.prepare(`DELETE FROM ${table} WHERE user_id = ? AND model = ?`).run(userId, FACE_MODEL);
      }
      db.prepare('DELETE FROM face_avatar_ledger WHERE user_id = ?').run(userId);
    }
    // A new selfie ends an admin's undo of the selection pass: the member is owed it again.
    db.prepare(
      'DELETE FROM face_reference_selection WHERE user_id = ? AND model = ? AND version = ?'
    ).run(userId, FACE_MODEL, FACE_SELECTION_UNDONE);
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
  /**
   * Filled on a confirmation that became a reference with the faces the member was waiting to
   * answer that the new reference now makes theirs WITHOUT a question (`auto`): the mirror of
   * `released`, and the screen drops them from the list - they are in "Mes photos" now.
   */
  promoted?: FaceKey[];
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
  let rematch = false;
  const outcome = await runExclusive((): AnswerOutcome => {
    if (!answerMatch(engine.db, userId, face, verdict, now)) {
      return 'not_held';
    }
    if (verdict === 'reject') {
      if (afterRejection(engine, userId, [face], now, options.released) > 0) {
        rematch = true;
      }
      return 'rejected';
    }
    const [opened] = loadFaceEmbeddings(engine.faceDb, engine.key, [face]);
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
    settleWaitingAfterLearning(
      engine,
      userId,
      opened.embedding,
      held.length < FACE_MIN_REFERENCES && held.length + 1 >= FACE_MIN_REFERENCES,
      options.promoted,
      options.released
    );
    return 'learned';
  });
  if (outcome === 'learned' || rematch) {
    // Outside the lock, and not awaited: the store scan is background work.
    void scheduleRematch(engine, userId);
  }
  return outcome;
}

/**
 * What follows a "not me" on `faces`, already marked `rejected` for `userId`, inside the engine
 * lock: each face's crop leaves the member's cache, it is kept as one of their NEGATIVE examples,
 * any reference learned from it is deleted, and it is re-decided for everyone else; then the faces
 * still waiting for the member's answer are re-decided against the new negatives, and those they
 * withhold are pushed to `released`. Returns how many references went: the caller queues the
 * member's re-match when one did (their reach shrank, so what it decided may change).
 */
function afterRejection(
  engine: FaceEngine,
  userId: string,
  faces: FaceKey[],
  now: number,
  released?: FaceKey[]
): number {
  const opened = loadFaceEmbeddings(engine.faceDb, engine.key, faces);
  const byKey = new Map(opened.map((o) => [keyOf(o), o]));
  let dropped = 0;
  for (const face of faces) {
    deleteMemberFaceCrop(userId, face);
    const found = byKey.get(keyOf(face));
    if (found) {
      addFaceNegative(engine.db, engine.key, userId, face, found.embedding, now);
    } else {
      log.warn('a rejected face is no longer in the store; no negative kept');
    }
    dropped += engine.db
      .prepare(
        `DELETE FROM face_references WHERE user_id = ? AND model = ? AND asset_id = ?
          AND face_index = ? AND source != 'selfie'`
      )
      .run(userId, FACE_MODEL, face.assetId, face.faceIndex).changes;
  }
  if (dropped > 0) {
    log.info('references learned from a rejected face deleted', { dropped });
  }
  redecideFaces(engine, faces);
  const waiting = waitingFaces(engine.db, userId);
  if (waiting.length > 0 && opened.length > 0) {
    redecideFaces(engine, waiting);
    const still = new Set(waitingFaces(engine.db, userId).map(keyOf));
    const gone = waiting.filter((f) => !still.has(keyOf(f)));
    released?.push(...gone);
    log.info('a rejection withheld other waiting faces', { released: gone.length });
  }
  return dropped;
}

/**
 * What follows a confirmation that became a reference, inside the engine lock: the mirror of the
 * rejection's re-decision. The faces still waiting for the member's answer are re-decided against
 * their new references, so the lookalikes of the face they just confirmed move at once - to `auto`
 * (`promoted`: shown without a question) or, when another member now holds them, away (`released`)
 * - instead of waiting for the background re-match to land and the screen to be reloaded. The
 * re-match still runs after it; it finds the same decisions (one `decideFace` for every path).
 */
function settleWaitingAfterLearning(
  engine: FaceEngine,
  userId: string,
  learned: ArrayLike<number>,
  crossedMinimum: boolean,
  promoted?: FaceKey[],
  released?: FaceKey[]
): void {
  // Only the faces the NEW reference can move: those within the `auto` distance of it. Any other
  // waiting face is as far from the member's references as before, so re-deciding it is work
  // (and a screen that shifts under the member) for nothing.
  // Except when the confirmation made the member cross FACE_MIN_REFERENCES: every waiting face
  // within 0.5 of ANY reference stops being held back by the minimum, so all of them are decided.
  const reachable = new Set(
    loadFaceEmbeddings(engine.faceDb, engine.key, waitingFaces(engine.db, userId))
      .filter((f) => cosineDistance(learned, f.embedding) <= FACE_AUTO_MAX_DISTANCE)
      .map(keyOf)
  );
  const waiting = waitingFaces(engine.db, userId).filter(
    (f) => crossedMinimum || reachable.has(keyOf(f))
  );
  if (waiting.length === 0) {
    return;
  }
  redecideFaces(engine, waiting);
  const still = new Set(waitingFaces(engine.db, userId).map(keyOf));
  const shown = new Set(
    (
      engine.db
        .prepare(
          `SELECT asset_id, face_index FROM face_matches WHERE user_id = ? AND model = ?
            AND state = 'pending' AND band = 'auto'`
        )
        .all(userId, FACE_MODEL) as Array<{ asset_id: string; face_index: number }>
    ).map((r) => keyOf({ assetId: r.asset_id, faceIndex: r.face_index }))
  );
  const gone = waiting.filter((f) => !still.has(keyOf(f)));
  const nowShown = gone.filter((f) => shown.has(keyOf(f)));
  promoted?.push(...nowShown);
  released?.push(...gone.filter((f) => !shown.has(keyOf(f))));
  log.info('a confirmation moved other waiting faces', {
    promoted: nowShown.length,
    released: gone.length - nowShown.length,
  });
}

/** What {@link removeMemberPhoto} did. */
export interface RemovePhotoResult {
  /** The member's visible faces on the photo, now rejected (0: the photo was not theirs). */
  faces: number;
  /** References that had been learned from those faces, deleted. */
  droppedReferences: number;
}

/**
 * "Ce n'est pas moi" on a photo of the member's "Mes photos" (owner, 2026-11-01): EVERY face of
 * theirs shown on that asset - given without a question (`auto`, pending) or confirmed by them -
 * becomes `rejected`, then follows exactly the path of a "Pas moi" on the confirmation screen
 * ({@link afterRejection}): a negative example, a reference learned from it deleted, the face
 * handed to the next member. A dropped reference queues the member's background re-match, as a
 * learned one does. A face waiting for their answer (`suggested`) is not on their photos and is
 * left to the confirmation screen.
 */
export async function removeMemberPhoto(
  engine: FaceEngine,
  userId: string,
  assetId: string,
  options: AnswerOptions = {}
): Promise<RemovePhotoResult> {
  const now = options.now ?? Date.now();
  const result = await runExclusive((): RemovePhotoResult => {
    const faces = (
      engine.db
        .prepare(
          `SELECT face_index FROM face_matches WHERE user_id = ? AND model = ? AND asset_id = ?
            AND ${VISIBLE_MATCH_SQL} ORDER BY face_index`
        )
        .all(userId, FACE_MODEL, assetId) as Array<{ face_index: number }>
    ).map((r) => ({ assetId, faceIndex: r.face_index }));
    if (faces.length === 0) {
      return { faces: 0, droppedReferences: 0 };
    }
    const update = engine.db.prepare(
      `UPDATE face_matches SET state = 'rejected', decided_at = ?
        WHERE asset_id = ? AND face_index = ? AND model = ? AND user_id = ?`
    );
    inTransaction(engine.db, () => {
      for (const face of faces) {
        update.run(now, face.assetId, face.faceIndex, FACE_MODEL, userId);
      }
    });
    const droppedReferences = afterRejection(engine, userId, faces, now, options.released);
    log.info('photo removed from the member', { faces: faces.length, droppedReferences });
    return { faces: faces.length, droppedReferences };
  });
  if (result.droppedReferences > 0) {
    void scheduleRematch(engine, userId);
  }
  return result;
}

/** What {@link restoreRejectedFace} did. */
export type RestoreOutcome = 'restored' | 'not_rejected' | 'confirmed_by_other';

/**
 * "En fait, c'est moi" on a face the member rejected ("Photos écartées", owner 2026-11-01): the
 * negative example the rejection kept is deleted, and the face is theirs again, CONFIRMED (they
 * have now said it is them), unless another member confirmed it meanwhile - then nothing changes
 * and the answer says so. A member who only held it pending (`auto` or `suggested`) loses it, as
 * a confirmation by its member takes it from them elsewhere (`claimFace`). The face is not learned
 * as a reference: it comes back to the photos, not to the reach. The member's re-match is queued,
 * since the negative that withheld lookalikes from them is gone.
 */
export async function restoreRejectedFace(
  engine: FaceEngine,
  userId: string,
  face: FaceKey,
  now: number = Date.now()
): Promise<RestoreOutcome> {
  const lost: Array<{ userId: string; face: FaceKey }> = [];
  const outcome = await runExclusive((): RestoreOutcome =>
    inTransaction(engine.db, (): RestoreOutcome => {
      const rows = engine.db
        .prepare(
          'SELECT user_id, state FROM face_matches WHERE asset_id = ? AND face_index = ? AND model = ?'
        )
        .all(face.assetId, face.faceIndex, FACE_MODEL) as Array<{
        user_id: string;
        state: string;
      }>;
      if (rows.find((r) => r.user_id === userId)?.state !== 'rejected') {
        return 'not_rejected';
      }
      if (rows.some((r) => r.user_id !== userId && r.state === 'confirmed')) {
        return 'confirmed_by_other';
      }
      for (const r of rows) {
        if (r.user_id !== userId && r.state === 'pending') {
          lost.push({ userId: r.user_id, face });
        }
      }
      engine.db
        .prepare(
          `DELETE FROM face_matches WHERE asset_id = ? AND face_index = ? AND model = ?
              AND user_id != ? AND state = 'pending'`
        )
        .run(face.assetId, face.faceIndex, FACE_MODEL, userId);
      engine.db
        .prepare(
          `UPDATE face_matches SET state = 'confirmed', decided_at = ?
              WHERE asset_id = ? AND face_index = ? AND model = ? AND user_id = ?`
        )
        .run(now, face.assetId, face.faceIndex, FACE_MODEL, userId);
      const negatives = deleteFaceNegative(engine.db, userId, face);
      log.info('a rejected face given back to its member', {
        negatives,
        displaced: lost.length,
      });
      return 'restored';
    })
  );
  for (const l of lost) {
    deleteMemberFaceCrop(l.userId, l.face);
  }
  if (outcome === 'restored') {
    void scheduleRematch(engine, userId);
  } else {
    log.info('a rejected face not given back', { outcome });
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
