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
 * ONE AT A TIME, ENFORCED. Every mutation here must run inside {@link runExclusive}: a scan is
 * asynchronous (it yields between chunks), and two of them interleaving could each decide on a
 * state the other is changing. Each mutating function CHECKS that it runs inside the lock and
 * throws otherwise, so a caller cannot forget it. The one write outside the lock is a member's
 * erasure (face-erasure.ts), which must be synchronous; so a decision is re-checked inside its
 * transaction against the references as they are THEN, and a withdrawal that lands during a scan
 * is never undone by its result.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
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

let keyRefused = false;

/**
 * The engine over the server's own files, or null when the store is not configured or its key is
 * malformed. A malformed key turns the face feature OFF with one error line; it never stops the
 * gallery (a throw here would reach the boot and every withdrawal).
 */
export function defaultFaceEngine(): FaceEngine | null {
  if (!faceStoreConfigured()) {
    return null;
  }
  let key: Buffer;
  try {
    key = faceStoreKey();
  } catch (e) {
    if (!keyRefused) {
      keyRefused = true;
      log.error('FACE_STORE_KEY is malformed: the face feature is OFF until it is fixed', {
        message: (e as Error).message,
      });
    }
    return null;
  }
  return { db: getDatabase(), faceDb: getFaceDatabase(), key };
}

/** A face with its opened embedding. Biometric: lives in memory for one decision. */
export type OpenedFace = FaceKey & { embedding: Float32Array };

/** Faces decided per transaction, and held per flush while a scan runs. */
const RECORD_BATCH = 2000;

let chain: Promise<unknown> = Promise.resolve();
const lock = new AsyncLocalStorage<true>();

/** Run `fn` after every engine operation already queued, and before the next one. */
export function runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
  if (lock.getStore()) {
    // Already inside the lock (a nested engine call): queueing would wait for itself forever.
    return Promise.resolve().then(fn);
  }
  const run = () => lock.run(true, fn);
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}

/** Throw unless the caller holds the engine lock. */
function assertExclusive(what: string): void {
  if (!lock.getStore()) {
    throw new Error(`${what} must run inside runExclusive`);
  }
}

const faceKey = (f: FaceKey) => `${f.assetId}\u0000${f.faceIndex}`;

/**
 * Which references each member holds now: per reference, its member, its id AND its seal nonce.
 * The id alone is not an identity: `face_references.id` is an INTEGER PRIMARY KEY without
 * AUTOINCREMENT, so a withdrawal followed by a new enrolment can reuse the same ids, and a
 * snapshot taken before would pass for current while holding the withdrawn templates. The nonce
 * (bytes 1-12 of the sealed blob, fresh random for every seal) differs on any new reference.
 */
function referenceFingerprint(db: DatabaseInstance): string {
  const row = db
    .prepare(
      `SELECT group_concat(user_id || ':' || id || ':' || hex(substr(sealed, 2, 12)), ',') AS f FROM
         (SELECT user_id, id, sealed FROM face_references WHERE model = ? ORDER BY user_id, id)`
    )
    .get(FACE_MODEL) as { f: string | null };
  return row.f ?? '';
}

/** Totals of a recording, for the logs. */
export interface RecordResult {
  auto: number;
  suggested: number;
  none: number;
  kept: number;
}

const emptyResult = (): RecordResult => ({ auto: 0, suggested: 0, none: 0, kept: 0 });

function addResult(total: RecordResult, r: RecordResult): void {
  total.auto += r.auto;
  total.suggested += r.suggested;
  total.none += r.none;
  total.kept += r.kept;
}

/** The members, and the fingerprint of the references they were read from (exported for tests). */
export interface MemberSnapshot {
  members: MemberReferences[];
  fingerprint: string;
}

export function snapshotMembers(engine: FaceEngine): MemberSnapshot {
  return {
    fingerprint: referenceFingerprint(engine.db),
    members: loadAllReferences(engine.db, engine.key),
  };
}

/**
 * Re-decide each face and write the result. Inside one transaction per batch: a confirmed face is
 * kept as it is; otherwise its holder row (not a rejection) is replaced by the decision among the
 * members who did not reject it. The decision is taken on the references as they are IN that
 * transaction: when they changed since `snapshot` was read (a withdrawal, an enrolment landing
 * during a scan), they are read again first. A holder who keeps the face keeps its `created_at`.
 */
export function recordDecisions(
  engine: FaceEngine,
  snapshot: MemberSnapshot,
  faces: ReadonlyArray<OpenedFace>,
  now: number = Date.now()
): RecordResult {
  assertExclusive('recordDecisions');
  const { db } = engine;
  const result = emptyResult();
  const rowsOf = db.prepare(
    'SELECT user_id, state, created_at FROM face_matches WHERE asset_id = ? AND face_index = ? AND model = ?'
  );
  const clear = db.prepare(
    "DELETE FROM face_matches WHERE asset_id = ? AND face_index = ? AND model = ? AND state != 'rejected'"
  );
  const insert = db.prepare(
    `INSERT INTO face_matches (asset_id, face_index, model, user_id, distance, runner_up, band,
       state, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`
  );

  for (let start = 0; start < faces.length; start += RECORD_BATCH) {
    const batch = faces.slice(start, start + RECORD_BATCH);
    inTransaction(db, () => {
      const fingerprint = referenceFingerprint(db);
      if (fingerprint !== snapshot.fingerprint) {
        log.info('references changed during the decision; read again');
        snapshot.members = loadAllReferences(db, engine.key);
        snapshot.fingerprint = fingerprint;
      }
      for (const face of batch) {
        const rows = rowsOf.all(face.assetId, face.faceIndex, FACE_MODEL) as Array<{
          user_id: string;
          state: string;
          created_at: number;
        }>;
        if (rows.some((r) => r.state === 'confirmed')) {
          result.kept++;
          continue;
        }
        const rejected = new Set(rows.filter((r) => r.state === 'rejected').map((r) => r.user_id));
        const holder = rows.find((r) => r.state === 'pending');
        clear.run(face.assetId, face.faceIndex, FACE_MODEL);
        const decision = decideFace(face.embedding, snapshot.members, rejected, {
          invalidReference: (userId) =>
            log.error('a member reference is not a usable vector; member skipped', { userId }),
          invalidCandidate: () =>
            log.error('a stored face is not a usable vector; matched to nobody', {
              assetId: face.assetId,
              faceIndex: face.faceIndex,
            }),
        });
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
          holder?.user_id === decision.userId ? holder.created_at : now
        );
        result[decision.band]++;
      }
    });
  }
  return result;
}

/** Decide freshly stored faces (a new photo) against every member. */
export function matchNewFaces(engine: FaceEngine, faces: ReadonlyArray<OpenedFace>): RecordResult {
  assertExclusive('matchNewFaces');
  if (faces.length === 0) {
    return emptyResult();
  }
  const result = recordDecisions(engine, snapshotMembers(engine), faces);
  log.info('new faces decided', { faces: faces.length, ...result });
  return result;
}

/** Re-decide chosen faces (after a withdrawal or a rejection), opened from the store. */
export function redecideFaces(engine: FaceEngine, faces: ReadonlyArray<FaceKey>): RecordResult {
  assertExclusive('redecideFaces');
  const snapshot = snapshotMembers(engine);
  const opened = loadFaceEmbeddings(engine.faceDb, engine.key, faces);
  const result = recordDecisions(engine, snapshot, opened);
  log.info('faces re-decided', { faces: faces.length, opened: opened.length, ...result });
  return result;
}

/**
 * After a member's references changed (an enrolment, a new reference, a withdrawal): scan the
 * store for every face within the suggested band of their references, add the faces they held,
 * and re-decide all of them against every member, {@link RECORD_BATCH} at a time as the scan goes.
 */
export async function rematchMember(engine: FaceEngine, userId: string): Promise<RecordResult> {
  assertExclusive('rematchMember');
  const snapshot = snapshotMembers(engine);
  const me = snapshot.members.find((m) => m.userId === userId);
  const held = (
    engine.db
      .prepare(
        "SELECT asset_id, face_index FROM face_matches WHERE user_id = ? AND model = ? AND state = 'pending'"
      )
      .all(userId, FACE_MODEL) as Array<{ asset_id: string; face_index: number }>
  ).map((r) => ({ assetId: r.asset_id, faceIndex: r.face_index }));

  const total = emptyResult();
  if (me) {
    const heldKeys = new Set(held.map(faceKey));
    let pending: OpenedFace[] = [];
    let candidates = 0;
    const flush = () => {
      addResult(total, recordDecisions(engine, snapshot, pending));
      pending = [];
    };
    const scan = await scanFaceStore(engine.faceDb, engine.key, (face, embedding) => {
      if (
        heldKeys.has(faceKey(face)) ||
        minDistance(me.refs, embedding) <= FACE_SUGGEST_MAX_DISTANCE
      ) {
        pending.push({ ...face, embedding });
        candidates++;
        if (pending.length >= RECORD_BATCH) {
          flush();
        }
      }
    });
    flush();
    log.info('store scanned for a member', { visited: scan.visited, candidates });
  } else {
    addResult(
      total,
      recordDecisions(engine, snapshot, loadFaceEmbeddings(engine.faceDb, engine.key, held))
    );
  }
  log.info('member re-matched', { userId, ...total });
  return total;
}

/** Decide every stored face against every member (the seed, or a change of thresholds). */
export async function rematchAll(engine: FaceEngine): Promise<RecordResult> {
  assertExclusive('rematchAll');
  const snapshot = snapshotMembers(engine);
  const total = emptyResult();
  let pending: OpenedFace[] = [];
  const flush = () => {
    addResult(total, recordDecisions(engine, snapshot, pending));
    pending = [];
  };
  await scanFaceStore(engine.faceDb, engine.key, (face, embedding) => {
    pending.push({ ...face, embedding });
    if (pending.length >= RECORD_BATCH) {
      flush();
    }
  });
  flush();
  log.info('every stored face re-decided', { members: snapshot.members.length, ...total });
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
  assertExclusive('answerMatch');
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
  assertExclusive('removeAssetFaces');
  const embeddings = engine.faceDb
    .prepare('DELETE FROM face_embeddings WHERE asset_id = ?')
    .run(assetId).changes;
  const matches = engine.db
    .prepare('DELETE FROM face_matches WHERE asset_id = ?')
    .run(assetId).changes;
  log.debug('asset faces removed', { embeddings, matches });
  return embeddings;
}

/**
 * Fold the face store's write-ahead log back into the file and empty it. After faces are deleted:
 * `secure_delete` overwrites the pages of the database file, but the WAL keeps the old copies
 * until a checkpoint.
 */
export function checkpointFaceStore(engine: FaceEngine): void {
  try {
    engine.faceDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (e) {
    log.error('faces.db WAL checkpoint failed; deleted faces may linger in the WAL', {
      message: (e as Error).message,
    });
  }
}
