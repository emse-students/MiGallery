/**
 * The faces v2 re-selection of existing members' references (the owner's decision of 2026-11-01,
 * docs/wiki/face-matching-option-c.md): up to FACE_MAX_REFERENCES (15) chosen for VARIETY among
 * the faces PROVEN theirs, in the background, one member at a time, never in a request.
 *
 * WHAT COUNTS AS PROVEN, AND WHY. An `auto` face had no human: it could itself be a false match,
 * and a wrong face made a reference would pull the member's reach towards a stranger. So a face is
 * proven only when it is, against the references the member holds NOW:
 * - CONFIRMED by them (an answer, or the A7 seed's claim of their own profile photo) AND within the
 *   `auto` distance (0.5) of one of those references - the rule every learned reference obeys
 *   (`learnable`): a confirmed lookalike at 0.6 is shown to them, never learned; or
 * - a pending `auto` face within FACE_PROVEN_AUTO_DISTANCE (0.4): a margin of 0.1 under the `auto`
 *   bound, so the auto faces most likely to be wrong - those nearest the bound - never teach.
 * Never one they rejected, and a `suggested` face only in the BOOTSTRAP (selection version 3, owner
 * 2026-11-01): a member under FACE_MIN_REFERENCES has every `auto` face held back as `suggested` by
 * that very minimum, so a member with only a selfie had no proven face and never reached it. For
 * them a pending `suggested` face counts, within the same 0.4 of their references and only when no
 * other member was within FACE_AMBIGUITY_MARGIN of it at the decision. It is proof for the
 * SELECTION ONLY: the face stays unseen by the member until the re-match, with the references it
 * then reaches, finds it `auto`. The bootstrap grows the set UNTIL STABLE (`growUntilStable`: each
 * round may reach faces the last one made reachable; it ends when a round adds nothing or at the
 * cap, and no reference stays farther than 0.62 from the member's selfie). The distance is recomputed against the current references, not
 * read from the row (a row's distance is the one of its decision).
 *
 * WHAT IT DOES, per member: read the proven faces and their photos' capture dates from Immich
 * (outside the engine lock: network), then, inside the lock and in ONE synchronous transaction,
 * reload, choose (`selectVariedReferences`: the selfie kept, then farthest-point among the held
 * references and the proven faces), replace the set and write the member's
 * `face_reference_selection` row; then re-match the member (sticky `auto` matches are kept). The
 * row is durable state: a member done is never redone, a crash resumes, and a member whose run
 * failed (Immich down) is tried again on the next tick, with an error line each time.
 *
 * WHO GETS WHAT. A member with no reference (a linked person Immich no longer had at the seed)
 * holds nothing to upgrade and is skipped until they enrol. An asset Immich no longer has gives
 * its face no capture date (it ranks oldest); it is never an error. A selfie is always kept.
 */

import type { DatabaseInstance } from '#lib/db/database.ts';
import { inTransaction } from '#lib/db/transaction.ts';
import {
  FACE_AMBIGUITY_MARGIN,
  FACE_AUTO_MAX_DISTANCE,
  FACE_MAX_REFERENCES,
  FACE_MIN_REFERENCES,
  FACE_MODEL,
  FACE_PROVEN_AUTO_DISTANCE,
  FACE_REFERENCE_SELECTION_VERSION,
  FACE_SELECTION_UNDONE,
  minDistance,
} from '#lib/face-embedding.ts';
import {
  growUntilStable,
  selectVariedReferences,
  type ReferenceItem,
} from '#lib/face-reference-selection.ts';
import { getFaceStoreState } from '#lib/db/face-database.ts';
import { rematchMember, runExclusive, type FaceEngine } from '#lib/server/face-engine.ts';
import { saveSelectionLedger } from '#lib/server/face-reference-ledger.ts';
import { assetCaptureTimes } from '#lib/server/face-photos.ts';
import { ensureDefaultProfilePhoto } from '#lib/server/profile-photo-default.ts';
import {
  addFaceReference,
  deleteFaceReference,
  loadReferenceItems,
  type ReferenceSource,
} from '#lib/server/face-references.ts';
import { loadFaceEmbeddings, type FaceKey } from '#lib/server/face-store.ts';
import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('face-reference-upgrade');

/** A face a member may be proven to hold, before its distance is checked. */
interface ProvenCandidate extends FaceKey {
  confirmed: boolean;
}

/**
 * The members the tick has to select for: those holding references not chosen by the current
 * selection version, AND - the rule is PERMANENT (owner, 2026-11-02) - every member still under
 * FACE_MIN_REFERENCES, whatever their marker, because new faces keep arriving and a lone selfie is
 * exactly who the bootstrap is for. A member whose pass an admin undid is left out until they enrol
 * again. Derived from durable state, never from a clock: a member the bootstrap cannot help yet
 * costs one read per tick and no write.
 */
export function membersToUpgrade(db: DatabaseInstance): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT r.user_id FROM face_references r
          LEFT JOIN face_reference_selection s ON s.user_id = r.user_id AND s.model = r.model
          WHERE r.model = ? AND (s.version IS NULL OR (s.version != ? AND (s.version < ?
            OR (SELECT COUNT(*) FROM face_references r2
                 WHERE r2.user_id = r.user_id AND r2.model = r.model) < ?)))
          ORDER BY r.user_id`
      )
      .all(
        FACE_MODEL,
        FACE_SELECTION_UNDONE,
        FACE_REFERENCE_SELECTION_VERSION,
        FACE_MIN_REFERENCES
      ) as Array<{ user_id: string }>
  ).map((r) => r.user_id);
}

/**
 * The members a selection pass rewrote whose re-match did not finish (a crash, a failure): the
 * durable half of "selected AND re-matched". Written with the references, cleared by the re-match.
 */
export function membersPendingRematch(db: DatabaseInstance): string[] {
  return (
    db
      .prepare('SELECT user_id FROM face_rematch_pending WHERE model = ? ORDER BY user_id')
      .all(FACE_MODEL) as Array<{ user_id: string }>
  ).map((r) => r.user_id);
}

/** How many references of the current model `userId` holds. */
function heldCount(db: DatabaseInstance, userId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM face_references WHERE user_id = ? AND model = ?')
    .get(userId, FACE_MODEL) as { n: number };
  return row.n;
}

/**
 * The member's confirmed faces and pending `auto` faces: the proven pool before distances. In the
 * BOOTSTRAP (a member under FACE_MIN_REFERENCES, whose `auto` faces are all held back as
 * `suggested` by that very minimum) it also takes the pending `suggested` faces the matcher found
 * unambiguous (no other member within FACE_AMBIGUITY_MARGIN of the distance it decided on); the
 * 0.4 bound on their distance to the CURRENT references is applied by the caller, as for `auto`.
 */
function provenCandidates(
  db: DatabaseInstance,
  userId: string,
  bootstrap: boolean
): ProvenCandidate[] {
  return (
    db
      .prepare(
        `SELECT asset_id, face_index, state FROM face_matches WHERE user_id = ? AND model = ?
          AND (state = 'confirmed' OR (state = 'pending' AND (band = 'auto'
            OR (? AND band = 'suggested' AND (runner_up IS NULL OR runner_up - distance >= ?)))))
          ORDER BY asset_id, face_index`
      )
      .all(userId, FACE_MODEL, bootstrap ? 1 : 0, FACE_AMBIGUITY_MARGIN) as Array<{
      asset_id: string;
      face_index: number;
      state: string;
    }>
  ).map((r) => ({
    assetId: r.asset_id,
    faceIndex: r.face_index,
    confirmed: r.state === 'confirmed',
  }));
}

/** Record that the member's references were chosen by the current selection version. */
function markSelected(db: DatabaseInstance, userId: string, now: number): void {
  db.prepare(
    `INSERT INTO face_reference_selection (user_id, model, version, selected_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, model) DO UPDATE SET version = excluded.version,
        selected_at = excluded.selected_at`
  ).run(userId, FACE_MODEL, FACE_REFERENCE_SELECTION_VERSION, now);
}

/** What one member's re-selection did. */
export type UpgradeOutcome = 'upgraded' | 'already' | 'no_references';

/**
 * Choose the member's references from their held references and their proven faces, write them
 * and the selection row in ONE transaction, synchronously (no withdrawal can land in between).
 * Inside the engine lock. Returns how many references they hold afterwards, or null when there was
 * nothing to do (exported for the tests).
 */
export function reselectReferences(
  engine: FaceEngine,
  userId: string,
  captureTimes: ReadonlyMap<string, number>,
  now: number = Date.now()
): { outcome: UpgradeOutcome; references: number; added: number; dropped: number } {
  const { db, key } = engine;
  return inTransaction(db, () => {
    const marker = db
      .prepare('SELECT version FROM face_reference_selection WHERE user_id = ? AND model = ?')
      .get(userId, FACE_MODEL) as { version: number } | null;
    if (marker?.version === FACE_SELECTION_UNDONE) {
      return { outcome: 'already' as const, references: 0, added: 0, dropped: 0 };
    }
    const held = loadReferenceItems(db, key, userId);
    if (held.length === 0) {
      return { outcome: 'no_references' as const, references: 0, added: 0, dropped: 0 };
    }
    // THE PHASE, decided by the count at the start (owner, 2026-11-02): below the cap the set
    // GROWS (most similar first, an unconfirmed suggestion counts as proof); at the cap it
    // PROPAGATES (variety, proven faces only, never an unproven suggestion).
    const growing = held.length < FACE_MAX_REFERENCES;
    const current = marker !== null && marker.version >= FACE_REFERENCE_SELECTION_VERSION;
    if (current && held.length >= FACE_MIN_REFERENCES) {
      return { outcome: 'already' as const, references: held.length, added: 0, dropped: 0 };
    }
    if (marker && !growing) {
      // Chosen by an earlier version and already at the cap: a re-selection of every member's
      // references would only churn them. Marked, not touched.
      markSelected(db, userId, now);
      return { outcome: 'already' as const, references: held.length, added: 0, dropped: 0 };
    }
    const bootstrap = growing;
    const heldVectors = held.map((h) => h.embedding);
    const heldFaces = new Set(
      held.filter((h) => h.assetId !== null).map((h) => `${h.assetId}\u0000${h.faceIndex}`)
    );
    const candidates = provenCandidates(db, userId, bootstrap).filter(
      (c) => !heldFaces.has(`${c.assetId}\u0000${c.faceIndex}`)
    );
    const confirmed = new Set(
      candidates.filter((c) => c.confirmed).map((c) => `${c.assetId}\u0000${c.faceIndex}`)
    );
    type PoolItem = ReferenceItem & {
      face?: FaceKey;
      newSource?: ReferenceSource;
      confirmed?: boolean;
    };
    const opened: PoolItem[] = loadFaceEmbeddings(engine.faceDb, key, candidates).map((face) => ({
      key: `face:${face.assetId}:${face.faceIndex}`,
      embedding: face.embedding,
      takenAt: captureTimes.get(face.assetId) ?? null,
      face: { assetId: face.assetId, faceIndex: face.faceIndex },
      confirmed: confirmed.has(`${face.assetId}\u0000${face.faceIndex}`),
      newSource: confirmed.has(`${face.assetId}\u0000${face.faceIndex}`) ? 'photo' : 'matched',
    }));
    const bound = (c: PoolItem, d: number) =>
      d <= (c.confirmed ? FACE_AUTO_MAX_DISTANCE : FACE_PROVEN_AUTO_DISTANCE);
    const pool: PoolItem[] = [...held];
    let proven = 0;
    if (bootstrap) {
      // Admitted by proximity, grown until stable, held references kept, nothing dropped
      // (face-reference-selection.ts). Nothing to admit: nothing is written, except that a member
      // already at the minimum is marked so the tick stops asking.
      const grown = growUntilStable(held, opened, FACE_MAX_REFERENCES, bound);
      if (grown.length === 0) {
        if (held.length >= FACE_MIN_REFERENCES) {
          markSelected(db, userId, now);
        }
        return { outcome: 'already' as const, references: held.length, added: 0, dropped: 0 };
      }
      proven = grown.length;
      pool.push(...grown);
    } else {
      for (const item of opened) {
        if (bound(item, minDistance(heldVectors, item.embedding))) {
          proven++;
          pool.push(item);
        }
      }
    }
    // Growth already holds exactly what it admitted (held + grown, within the cap); variety is the
    // rule at the cap only.
    const chosen = new Set(
      (growing ? pool : selectVariedReferences(pool, FACE_MAX_REFERENCES)).map((c) => c.key)
    );
    // What is about to be replaced is kept first, in this same transaction: the way back.
    saveSelectionLedger(db, userId, FACE_REFERENCE_SELECTION_VERSION, now);
    let dropped = 0;
    for (const h of held) {
      if (!chosen.has(h.key)) {
        deleteFaceReference(db, userId, h.id);
        dropped++;
      }
    }
    let added = 0;
    for (const item of pool) {
      if (item.face && chosen.has(item.key)) {
        if (
          !addFaceReference(db, key, userId, item.newSource ?? 'photo', item.embedding, now, {
            assetId: item.face.assetId,
            faceIndex: item.face.faceIndex,
            takenAt: item.takenAt,
          })
        ) {
          throw new Error('a re-selected reference could not be stored');
        }
        added++;
      }
    }
    markSelected(db, userId, now);
    // In the SAME transaction: the marker must mean "selected AND re-matched", so the re-match
    // has its own durable mark, cleared when it completes (finishMemberRematch).
    db.prepare(
      'INSERT OR REPLACE INTO face_rematch_pending (user_id, model, since) VALUES (?, ?, ?)'
    ).run(userId, FACE_MODEL, now);
    const references = held.length - dropped + added;
    log.info('member references re-selected', {
      bootstrap,
      held: held.length,
      proven,
      added,
      dropped,
      references,
    });
    return { outcome: 'upgraded' as const, references, added, dropped };
  });
}

/**
 * PHASE 1 of a member's upgrade: the capture dates of their proven faces read from Immich OUTSIDE
 * the lock, then the re-selection inside it (references, ledger, marker and the re-match's pending
 * mark in one transaction). No re-match here: a pass selects EVERY member first and re-matches them
 * after (see {@link runReferenceUpgrades}), so no decision depends on who came first. Throws when
 * Immich cannot be read: nothing is written, and the member is tried again on the next pass.
 */
export async function selectMemberReferences(
  engine: FaceEngine,
  userId: string,
  fetchFn: typeof fetch
): Promise<UpgradeOutcome> {
  const growing = heldCount(engine.db, userId) < FACE_MAX_REFERENCES;
  const assets = [...new Set(provenCandidates(engine.db, userId, growing).map((c) => c.assetId))];
  const captureTimes = await assetCaptureTimes(fetchFn, assets);
  return runExclusive(() => reselectReferences(engine, userId, captureTimes).outcome);
}

/**
 * PHASE 2: the member's re-match, inside the lock, then the pending mark cleared in the same turn
 * (a throw leaves it, and the next tick resumes). After the lock, a DEFAULT profile photo may have
 * a better candidate now (a choice is never touched): best effort and logged, since the member's
 * references and matches are already complete.
 */
export async function finishMemberRematch(
  engine: FaceEngine,
  userId: string,
  fetchFn: typeof fetch
): Promise<void> {
  await runExclusive(async () => {
    await rematchMember(engine, userId);
    engine.db
      .prepare('DELETE FROM face_rematch_pending WHERE user_id = ? AND model = ?')
      .run(userId, FACE_MODEL);
  });
  try {
    await ensureDefaultProfilePhoto(engine, userId, fetchFn);
  } catch (e) {
    log.error('default profile photo after a selection failed; the next answer retries it', {
      userId,
      message: (e as Error).message,
    });
  }
}

/** One member, both phases in a row: for an enrolment, where there is no other member to wait for. */
export async function upgradeMemberReferences(
  engine: FaceEngine,
  userId: string,
  fetchFn: typeof fetch
): Promise<UpgradeOutcome> {
  const outcome = await selectMemberReferences(engine, userId, fetchFn);
  if (outcome === 'upgraded') {
    await finishMemberRematch(engine, userId, fetchFn);
  }
  return outcome;
}

let running: Promise<void> | null = null;

/**
 * Upgrade the members the tick owes ({@link membersToUpgrade}) in TWO PHASES, so the result does
 * not depend on the order of the members: first every member's references are selected (one turn
 * of the engine lock each, so answers and ingestion run between two), THEN every member whose
 * re-match is pending ({@link membersPendingRematch}: those just selected AND any a crash left) is
 * re-matched. Every re-match therefore decides against the FINAL reference sets of everyone, so two
 * lookalikes bootstrapping in one pass get the same faces whichever id sorts first. At most one
 * pass at a time: a call while one runs returns it. A member's failure is logged and the pass goes
 * on; the member stays owed, so the next pass tries again. Called from the ingestion tick once the
 * store is seeded: the tick decides WHEN, the durable rows decide WHO. Silent when it did nothing.
 */
export function runReferenceUpgrades(engine: FaceEngine, fetchFn: typeof fetch): Promise<void> {
  if (running) {
    return running;
  }
  if (!getFaceStoreState(engine.faceDb, 'seeded_at')) {
    return Promise.resolve();
  }
  const members = membersToUpgrade(engine.db);
  if (members.length === 0 && membersPendingRematch(engine.db).length === 0) {
    return Promise.resolve();
  }
  running = (async () => {
    const counts: Record<UpgradeOutcome | 'rematched' | 'failed', number> = {
      upgraded: 0,
      already: 0,
      no_references: 0,
      rematched: 0,
      failed: 0,
    };
    for (const userId of members) {
      try {
        counts[await selectMemberReferences(engine, userId, fetchFn)]++;
      } catch (e) {
        counts.failed++;
        log.error("re-selecting a member's references failed; tried again next pass", {
          userId,
          message: (e as Error).message,
        });
      }
    }
    for (const userId of membersPendingRematch(engine.db)) {
      try {
        await finishMemberRematch(engine, userId, fetchFn);
        counts.rematched++;
      } catch (e) {
        counts.failed++;
        log.error('re-matching a member after their selection failed; tried again next pass', {
          userId,
          message: (e as Error).message,
        });
      }
    }
    if (counts.upgraded > 0 || counts.rematched > 0 || counts.failed > 0) {
      log.info('reference selection pass done', counts);
    }
  })().finally(() => {
    running = null;
  });
  return running;
}
