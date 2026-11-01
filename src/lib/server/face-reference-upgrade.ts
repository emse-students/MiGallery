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
 * Never a `suggested` face, never one they rejected. The distance is recomputed against the
 * current references, not read from the row (a row's distance is the one of its decision).
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
  FACE_AUTO_MAX_DISTANCE,
  FACE_MAX_REFERENCES,
  FACE_MODEL,
  FACE_PROVEN_AUTO_DISTANCE,
  FACE_REFERENCE_SELECTION_VERSION,
  minDistance,
} from '#lib/face-embedding.ts';
import { selectVariedReferences, type ReferenceItem } from '#lib/face-reference-selection.ts';
import { getFaceStoreState } from '#lib/db/face-database.ts';
import { rematchMember, runExclusive, type FaceEngine } from '#lib/server/face-engine.ts';
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

/** The members holding references not chosen by the current selection version. */
export function membersToUpgrade(db: DatabaseInstance): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT r.user_id FROM face_references r
          LEFT JOIN face_reference_selection s ON s.user_id = r.user_id AND s.model = r.model
          WHERE r.model = ? AND (s.version IS NULL OR s.version < ?)
          ORDER BY r.user_id`
      )
      .all(FACE_MODEL, FACE_REFERENCE_SELECTION_VERSION) as Array<{ user_id: string }>
  ).map((r) => r.user_id);
}

/** The member's confirmed faces and pending `auto` faces: the proven pool before distances. */
function provenCandidates(db: DatabaseInstance, userId: string): ProvenCandidate[] {
  return (
    db
      .prepare(
        `SELECT asset_id, face_index, state FROM face_matches WHERE user_id = ? AND model = ?
          AND (state = 'confirmed' OR (state = 'pending' AND band = 'auto'))
          ORDER BY asset_id, face_index`
      )
      .all(userId, FACE_MODEL) as Array<{ asset_id: string; face_index: number; state: string }>
  ).map((r) => ({
    assetId: r.asset_id,
    faceIndex: r.face_index,
    confirmed: r.state === 'confirmed',
  }));
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
    if (marker && marker.version >= FACE_REFERENCE_SELECTION_VERSION) {
      return { outcome: 'already' as const, references: 0, added: 0, dropped: 0 };
    }
    const held = loadReferenceItems(db, key, userId);
    if (held.length === 0) {
      return { outcome: 'no_references' as const, references: 0, added: 0, dropped: 0 };
    }
    const heldVectors = held.map((h) => h.embedding);
    const heldFaces = new Set(
      held.filter((h) => h.assetId !== null).map((h) => `${h.assetId}\u0000${h.faceIndex}`)
    );
    const candidates = provenCandidates(db, userId).filter(
      (c) => !heldFaces.has(`${c.assetId}\u0000${c.faceIndex}`)
    );
    const confirmed = new Set(
      candidates.filter((c) => c.confirmed).map((c) => `${c.assetId}\u0000${c.faceIndex}`)
    );
    const pool: Array<ReferenceItem & { face?: FaceKey; newSource?: ReferenceSource }> = [...held];
    let proven = 0;
    for (const face of loadFaceEmbeddings(engine.faceDb, key, candidates)) {
      const k = `${face.assetId}\u0000${face.faceIndex}`;
      const d = minDistance(heldVectors, face.embedding);
      const isConfirmed = confirmed.has(k);
      if (!(d <= (isConfirmed ? FACE_AUTO_MAX_DISTANCE : FACE_PROVEN_AUTO_DISTANCE))) {
        continue;
      }
      proven++;
      pool.push({
        key: `face:${face.assetId}:${face.faceIndex}`,
        embedding: face.embedding,
        takenAt: captureTimes.get(face.assetId) ?? null,
        face: { assetId: face.assetId, faceIndex: face.faceIndex },
        newSource: isConfirmed ? 'photo' : 'matched',
      });
    }
    const chosen = new Set(selectVariedReferences(pool, FACE_MAX_REFERENCES).map((c) => c.key));
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
    db.prepare(
      `INSERT INTO face_reference_selection (user_id, model, version, selected_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, model) DO UPDATE SET version = excluded.version,
          selected_at = excluded.selected_at`
    ).run(userId, FACE_MODEL, FACE_REFERENCE_SELECTION_VERSION, now);
    const references = held.length - dropped + added;
    log.info('member references re-selected', {
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
 * One member's upgrade: the capture dates of their proven faces read from Immich OUTSIDE the
 * lock, then the re-selection and the member's re-match inside it. Throws when Immich cannot be
 * read: nothing is written, and the member is tried again on the next pass.
 */
export async function upgradeMemberReferences(
  engine: FaceEngine,
  userId: string,
  fetchFn: typeof fetch
): Promise<UpgradeOutcome> {
  const assets = [...new Set(provenCandidates(engine.db, userId).map((c) => c.assetId))];
  const captureTimes = await assetCaptureTimes(fetchFn, assets);
  const outcome = await runExclusive(async () => {
    const result = reselectReferences(engine, userId, captureTimes);
    if (result.outcome === 'upgraded') {
      await rematchMember(engine, userId);
    }
    return result.outcome;
  });
  if (outcome === 'upgraded') {
    // New references, new matches: a DEFAULT profile photo may now have a better candidate (a
    // choice is never touched). After the lock: it reads Immich.
    await ensureDefaultProfilePhoto(engine, userId, fetchFn);
  }
  return outcome;
}

let running: Promise<void> | null = null;

/**
 * Upgrade every member still below the current selection version, one after the other, each in
 * its own turn of the engine lock (so answers and ingestion run between two members). At most one
 * pass at a time: a call while one runs returns it. A member's failure is logged and the pass goes
 * on; the member stays below the version, so the next pass tries again. Called from the ingestion
 * tick once the store is seeded: the tick decides WHEN, the selection rows decide WHO.
 */
export function runReferenceUpgrades(engine: FaceEngine, fetchFn: typeof fetch): Promise<void> {
  if (running) {
    return running;
  }
  if (!getFaceStoreState(engine.faceDb, 'seeded_at')) {
    return Promise.resolve();
  }
  const members = membersToUpgrade(engine.db);
  if (members.length === 0) {
    return Promise.resolve();
  }
  log.info('reference re-selection pass', { members: members.length });
  running = (async () => {
    const counts: Record<UpgradeOutcome | 'failed', number> = {
      upgraded: 0,
      already: 0,
      no_references: 0,
      failed: 0,
    };
    for (const userId of members) {
      try {
        counts[await upgradeMemberReferences(engine, userId, fetchFn)]++;
      } catch (e) {
        counts.failed++;
        log.error("re-selecting a member's references failed; tried again next pass", {
          userId,
          message: (e as Error).message,
        });
      }
    }
    log.info('reference re-selection pass done', counts);
  })().finally(() => {
    running = null;
  });
  return running;
}
