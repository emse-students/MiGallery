/**
 * The match engine (lot A4, docs/wiki/face-matching-option-c.md): the ONLY writer of
 * `face_matches`. Every event that can change who a face belongs to - a new photo, an enrolment,
 * a withdrawal, a rejection, the seed - ends in {@link recordDecisions}, which re-decides each
 * face it is given from scratch with `decideFace` against every member. So the state of a face
 * never depends on the order events came in: it is the decision for the current references, the
 * rejections and a confirmation, whatever happened before.
 *
 * WHAT A HUMAN SAID WINS. A face a member CONFIRMED is never re-decided; a face a member REJECTED
 * is never offered to them again (the face goes to the next member, if any is within the bands).
 *
 * ONE AT A TIME. Every mutation here goes through {@link runExclusive}: a scan is asynchronous
 * (it yields between chunks), and two of them interleaving could each decide on a state the other
 * is changing. A decision is also re-checked inside its transaction against the member's CURRENT
 * references, so a withdrawal that lands during a scan is never undone by its result.
 */

import { getDatabase, type DatabaseInstance } from '#lib/db/database.ts';
import { getFaceDatabase } from '#lib/db/face-database.ts';
import { inTransaction } from '#lib/db/transaction.ts';
import { FACE_MODEL, FACE_SUGGEST_MAX_DISTANCE, minDistance } from '#lib/face-embedding.ts';
import { decideFace, type MemberReferences } from '#lib/face-match.ts';
import {
  faceStoreConfigured,
  faceStoreKey,
  loadAllReferences,
  loadFaceEmbeddings,
  scanFaceStore,
  type FaceKey,
} from '#lib/server/face-store.ts';
import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('face-engine');

/** What the engine works on: the main database, the face store's file, and the store key. */
export interface FaceEngine {
  db: DatabaseInstance;
  faceDb: DatabaseInstance;
  key: Buffer;
}

/** The engine over the server's own files, or null when the store is not configured. */
export function defaultFaceEngine(): FaceEngine | null {
  if (!faceStoreConfigured()) {
    return null;
  }
  return { db: getDatabase(), faceDb: getFaceDatabase(), key: faceStoreKey() };
}

/** A face with its opened embedding. Biometric: lives in memory for one decision. */
export type OpenedFace = FaceKey & { embedding: Float32Array };

/** Faces decided per transaction when a long list is recorded. */
const RECORD_BATCH = 2000;

let chain: Promise<unknown> = Promise.resolve();

/** Run `fn` after every engine operation already queued, and before the next one. */
export function runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

const faceKey = (f: FaceKey) => `${f.assetId}\u0000${f.faceIndex}`;

/** Totals of a recording, for the logs. */
export interface RecordResult {
  auto: number;
  suggested: number;
  none: number;
  kept: number;
}

/**
 * Re-decide each face and write the result. Inside one transaction per batch: a confirmed face is
 * kept as it is; otherwise its holder row (not a rejection) is replaced by the decision among the
 * members who did not reject it. A member who no longer holds any reference at write time is
 * dropped from the decision (a withdrawal that landed after `members` was read).
 */
export function recordDecisions(
  engine: FaceEngine,
  members: ReadonlyArray<MemberReferences>,
  faces: ReadonlyArray<OpenedFace>,
  now: number = Date.now()
): RecordResult {
  const { db } = engine;
  const result: RecordResult = { auto: 0, suggested: 0, none: 0, kept: 0 };
  const rowsOf = db.prepare(
    'SELECT user_id, state FROM face_matches WHERE asset_id = ? AND face_index = ? AND model = ?'
  );
  const clear = db.prepare(
    "DELETE FROM face_matches WHERE asset_id = ? AND face_index = ? AND model = ? AND state != 'rejected'"
  );
  const insert = db.prepare(
    `INSERT INTO face_matches (asset_id, face_index, model, user_id, distance, runner_up, band,
       state, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`
  );
  const holds = db.prepare('SELECT 1 FROM face_references WHERE user_id = ? AND model = ? LIMIT 1');

  for (let start = 0; start < faces.length; start += RECORD_BATCH) {
    const batch = faces.slice(start, start + RECORD_BATCH);
    inTransaction(db, () => {
      const current = members.filter((m) => holds.get(m.userId, FACE_MODEL));
      for (const face of batch) {
        const rows = rowsOf.all(face.assetId, face.faceIndex, FACE_MODEL) as Array<{
          user_id: string;
          state: string;
        }>;
        if (rows.some((r) => r.state === 'confirmed')) {
          result.kept++;
          continue;
        }
        const rejected = new Set(rows.filter((r) => r.state === 'rejected').map((r) => r.user_id));
        clear.run(face.assetId, face.faceIndex, FACE_MODEL);
        const decision = decideFace(face.embedding, current, rejected, (userId) =>
          log.error('a member reference is not a usable vector; member skipped', { userId })
        );
        if (!decision) {
          result.none++;
          continue;
        }
        insert.run(
          face.assetId,
          face.faceIndex,
          FACE_MODEL,
          decision.userId,
          decision.distance,
          decision.runnerUp,
          decision.band,
          now
        );
        result[decision.band]++;
      }
    });
  }
  return result;
}

/** Decide freshly stored faces (a new photo) against every member. */
export function matchNewFaces(engine: FaceEngine, faces: ReadonlyArray<OpenedFace>): RecordResult {
  if (faces.length === 0) {
    return { auto: 0, suggested: 0, none: 0, kept: 0 };
  }
  const members = loadAllReferences(engine.db, engine.key);
  const result = recordDecisions(engine, members, faces);
  log.info('new faces decided', { faces: faces.length, ...result });
  return result;
}

/** Re-decide chosen faces (after a withdrawal or a rejection), opened from the store. */
export function redecideFaces(engine: FaceEngine, faces: ReadonlyArray<FaceKey>): RecordResult {
  const opened = loadFaceEmbeddings(engine.faceDb, engine.key, faces);
  const members = loadAllReferences(engine.db, engine.key);
  const result = recordDecisions(engine, members, opened);
  log.info('faces re-decided', { faces: faces.length, opened: opened.length, ...result });
  return result;
}

/**
 * After a member's references changed (an enrolment, a new reference, a withdrawal): scan the
 * store for every face within the suggested band of their references, add the faces they held,
 * and re-decide all of them against every member.
 */
export async function rematchMember(engine: FaceEngine, userId: string): Promise<RecordResult> {
  const members = loadAllReferences(engine.db, engine.key);
  const me = members.find((m) => m.userId === userId);
  const held = (
    engine.db
      .prepare(
        "SELECT asset_id, face_index FROM face_matches WHERE user_id = ? AND model = ? AND state = 'pending'"
      )
      .all(userId, FACE_MODEL) as Array<{ asset_id: string; face_index: number }>
  ).map((r) => ({ assetId: r.asset_id, faceIndex: r.face_index }));

  let candidates: OpenedFace[];
  if (me) {
    const heldKeys = new Set(held.map(faceKey));
    candidates = [];
    const scan = await scanFaceStore(engine.faceDb, engine.key, (face, embedding) => {
      if (
        heldKeys.has(faceKey(face)) ||
        minDistance(me.refs, embedding) <= FACE_SUGGEST_MAX_DISTANCE
      ) {
        candidates.push({ ...face, embedding });
      }
    });
    log.info('store scanned for a member', {
      visited: scan.visited,
      candidates: candidates.length,
    });
  } else {
    candidates = loadFaceEmbeddings(engine.faceDb, engine.key, held);
  }
  const result = recordDecisions(engine, members, candidates);
  log.info('member re-matched', { userId, ...result });
  return result;
}

/** Decide every stored face against every member (the seed, or a change of thresholds). */
export async function rematchAll(engine: FaceEngine): Promise<RecordResult> {
  const members = loadAllReferences(engine.db, engine.key);
  const total: RecordResult = { auto: 0, suggested: 0, none: 0, kept: 0 };
  let pending: OpenedFace[] = [];
  const flush = () => {
    const r = recordDecisions(engine, members, pending);
    total.auto += r.auto;
    total.suggested += r.suggested;
    total.none += r.none;
    total.kept += r.kept;
    pending = [];
  };
  await scanFaceStore(engine.faceDb, engine.key, (face, embedding) => {
    pending.push({ ...face, embedding });
    if (pending.length >= RECORD_BATCH) {
      flush();
    }
  });
  flush();
  log.info('every stored face re-decided', { members: members.length, ...total });
  return total;
}

/** A member's answer on a face they hold. */
export type MatchVerdict = 'confirm' | 'reject';

/**
 * Record `userId`'s answer on a face they hold (pending, either band). Returns false when they do
 * not hold it. A rejection keeps a `rejected` row (never offered to them again); the caller then
 * re-decides the face so it can go to the next member.
 */
export function answerMatch(
  db: DatabaseInstance,
  userId: string,
  face: FaceKey,
  verdict: MatchVerdict,
  now: number = Date.now()
): boolean {
  const changes = db
    .prepare(
      `UPDATE face_matches SET state = ?, decided_at = ?
        WHERE asset_id = ? AND face_index = ? AND model = ? AND user_id = ? AND state = 'pending'`
    )
    .run(
      verdict === 'confirm' ? 'confirmed' : 'rejected',
      now,
      face.assetId,
      face.faceIndex,
      FACE_MODEL,
      userId
    ).changes;
  log.info('match answered', { verdict, recorded: changes > 0 });
  return changes > 0;
}

/**
 * Forget every face of an asset: its embeddings in the store and every match row naming them.
 * For an asset gone from Immich, and before an asset's faces are written again.
 */
export function removeAssetFaces(engine: FaceEngine, assetId: string): number {
  const embeddings = engine.faceDb
    .prepare('DELETE FROM face_embeddings WHERE asset_id = ?')
    .run(assetId).changes;
  const matches = engine.db
    .prepare('DELETE FROM face_matches WHERE asset_id = ?')
    .run(assetId).changes;
  log.debug('asset faces removed', { embeddings, matches });
  return embeddings;
}
