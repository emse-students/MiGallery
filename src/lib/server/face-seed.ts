/**
 * Lot A7: seed the face store from the vectors Immich already computed, and carry the members'
 * existing links (`users.photos_id`, an Immich person they linked to themselves) over to
 * references and matches. Run ONCE, before the cutover (lot A8) deletes Immich's faces.
 *
 * WHY NO RECOMPUTATION. Immich's buffalo_l vectors are the same model the store uses; re-embedding
 * the archive would cost about 22 hours of the model service for the same numbers. The seed reads
 * them from Immich's database in PHYSICAL order (an ORDER BY sorts the whole table) and streams them
 * here in batches; nothing is written to disk unsealed.
 *
 * THE PROTOCOL, over `POST /api/admin/faces/seed` (scripts/faces/seed-client.mjs):
 * - `begin`: refused once the store is seeded (`seeded_at`, durable); otherwise any partial earlier
 *   run is wiped (its faces, assets, matches, the references the seed wrote, its counters), and a
 *   fresh RUN TOKEN is returned. Every later phase carries it: a phase of a replaced run is refused
 *   (`stale_run`), so a partial seed can never be sealed by the wrong client.
 * - `assets`: every asset Immich has run face recognition on, written `done` (source `seed`, no
 *   face yet): an asset with no face is as decided as one with five, and must not be re-embedded.
 *   How many were received is counted durably.
 * - `faces`: the faces, each given the next index of its asset, sealed, written. A face of a
 *   LINKED person (a member's own link) is noted in `face_seed_links`, a working table of the seed.
 *   A face that is not a usable vector is not stored, and counted durably.
 * - `finish`: carries the counts Immich reported BEFORE streaming (assets, faces); refused
 *   (`incomplete`) unless they equal what was durably received, so a truncated export is never
 *   sealed. It answers at once and runs in the background under the engine lock; its outcome is
 *   durable (`seed_finish`) and polled. Per linked member who still consents, the 5 of their
 *   person's faces nearest the person's centroid become their references (source `seed`); every
 *   stored face is decided (`rematchAll`); the profile photo each member chose is claimed for them
 *   when it is a face of their person; the parity of the result with their links is measured, as
 *   aggregates only; the working table is dropped and `seeded_at` written - after which ingestion
 *   starts. A DRY RUN of `finish` computes what the references would be and writes nothing but its
 *   own status.
 *
 * Every phase runs inside the engine lock. A member's erasure is synchronous and outside it, so a
 * reference is written only inside a transaction that re-reads the member's link and consent.
 */

import { randomBytes } from 'node:crypto';
import { inTransaction } from '#lib/db/transaction.ts';
import { getFaceStoreState, setFaceStoreState } from '#lib/db/face-database.ts';
import type { DatabaseInstance } from '#lib/db/database.ts';
import {
  FACE_EMBEDDING_DIM,
  FACE_MAX_REFERENCES,
  FACE_MODEL,
  cosineDistance,
  encodeEmbedding,
  normalizeEmbedding,
} from '#lib/face-embedding.ts';
import { embeddingContext, seal } from '#lib/server/face-seal.ts';
import { scanFaceStore, loadFaceEmbeddings, type FaceKey } from '#lib/server/face-store.ts';
import { addFaceReference } from '#lib/server/face-references.ts';
import {
  checkpointFaceStore,
  claimFace,
  rematchAll,
  runExclusive,
  type ClaimOutcome,
  type FaceEngine,
  type RecordResult,
} from '#lib/server/face-engine.ts';
import { VISIBLE_MATCH_SQL } from '#lib/server/face-photos.ts';
import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('face-seed');

/** Why a seed phase was refused. */
export type SeedRefusal =
  | 'already_seeded'
  | 'not_begun'
  | 'stale_run'
  | 'incomplete'
  | 'finish_running';

/** The seed was refused: said to the operator, never retried by itself. */
export class SeedRefusedError extends Error {
  readonly kind = 'seed_refused';
  constructor(
    readonly reason: SeedRefusal,
    message: string
  ) {
    super(message);
    this.name = 'SeedRefusedError';
  }
}

/** One face as Immich stored it. `personId` is Immich's person (group) id, or null. */
export interface SeedFace {
  assetId: string;
  personId: string | null;
  imageWidth: number;
  imageHeight: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  embedding: ArrayLike<number>;
}

/** What Immich counted before the export streamed: the finish compares it with what arrived. */
export interface SeedExpected {
  assets: number;
  faces: number;
}

/** The token of the current run: written by `begin`, carried by every later phase. */
const SEED_RUN = 'seed_run';
/** Asset ids received by the `assets` phase of the current run. */
const SEED_ASSETS_RECEIVED = 'seed_assets_received';
/** Faces of the current run that were not usable vectors (received, never stored). */
const SEED_UNUSABLE = 'seed_unusable';
/** The outcome of the last `finish` (or dry run), as JSON: see {@link SeedFinishStatus}. */
const SEED_FINISH = 'seed_finish';

/**
 * This process's identity. A `running` finish recorded by another process id was cut by a restart:
 * no code of THIS process can ever end it, so it is reported `interrupted` - decided from durable
 * state, never from how long it has been running.
 */
const PROCESS_ID = randomBytes(16).toString('hex');

const LINKS_TABLE = `CREATE TABLE IF NOT EXISTS face_seed_links (
    asset_id TEXT NOT NULL,
    face_index INTEGER NOT NULL,
    person_id TEXT NOT NULL,
    PRIMARY KEY(asset_id, face_index)
)`;

/** Why a finish failed: a refusal's reason, a restart that cut it, or an unexpected fault. */
export type SeedFailure = SeedRefusal | 'interrupted' | 'error';

/** The durable outcome of a finish, as the poll returns it. Aggregates only. */
export type SeedFinishStatus =
  | { status: 'none' }
  | { status: 'running'; dryRun: boolean }
  | { status: 'done'; dryRun: false; report: SeedReport }
  | { status: 'done'; dryRun: true; report: SeedPlanReport }
  | { status: 'failed'; dryRun: boolean; reason: SeedFailure };

type StoredFinish = Exclude<SeedFinishStatus, { status: 'none' }> & {
  run: string;
  process: string;
};

function readStoredFinish(faceDb: DatabaseInstance): StoredFinish | null {
  const raw = getFaceStoreState(faceDb, SEED_FINISH);
  return raw ? (JSON.parse(raw) as StoredFinish) : null;
}

function writeStoredFinish(
  faceDb: DatabaseInstance,
  run: string,
  status: Exclude<SeedFinishStatus, { status: 'none' }>
): void {
  setFaceStoreState(faceDb, SEED_FINISH, JSON.stringify({ ...status, run, process: PROCESS_ID }));
}

/** Whether a finish of THIS process is running or queued: a begin or another finish must wait. */
function finishRunningHere(faceDb: DatabaseInstance): boolean {
  const stored = readStoredFinish(faceDb);
  return stored?.status === 'running' && stored.process === PROCESS_ID;
}

function readCounter(faceDb: DatabaseInstance, key: string): number {
  return Number(getFaceStoreState(faceDb, key) ?? '0');
}

function addToCounter(faceDb: DatabaseInstance, key: string, n: number): void {
  setFaceStoreState(faceDb, key, String(readCounter(faceDb, key) + n));
}

/** The person ids members linked to themselves, mapped to the member. */
function linkedPersons(engine: FaceEngine): Map<string, string> {
  const rows = engine.db
    .prepare('SELECT id_user, photos_id FROM users WHERE photos_id IS NOT NULL')
    .all() as Array<{ id_user: string; photos_id: string }>;
  return new Map(rows.map((r) => [r.photos_id, r.id_user]));
}

/** Refuse a seeded store, a seed never begun, and a phase of a run that `begin` replaced. */
function assertRun(engine: FaceEngine, run: string): void {
  if (getFaceStoreState(engine.faceDb, 'seeded_at')) {
    throw new SeedRefusedError('already_seeded', 'the face store is already seeded');
  }
  const current = getFaceStoreState(engine.faceDb, SEED_RUN);
  if (!current) {
    throw new SeedRefusedError('not_begun', 'the seed has not begun');
  }
  if (current !== run) {
    throw new SeedRefusedError('stale_run', 'this run was replaced by a later begin');
  }
}

/** What the current run durably received: assets, faces stored, faces refused as unusable. */
function receivedCounts(faceDb: DatabaseInstance): {
  assets: number;
  faces: number;
  unusable: number;
} {
  const stored = (
    faceDb.prepare('SELECT COUNT(*) AS n FROM face_embeddings WHERE model = ?').get(FACE_MODEL) as {
      n: number;
    }
  ).n;
  const unusable = readCounter(faceDb, SEED_UNUSABLE);
  return { assets: readCounter(faceDb, SEED_ASSETS_RECEIVED), faces: stored + unusable, unusable };
}

/**
 * Refuse a finish whose export did not arrive whole: the counts Immich gave before streaming must
 * equal what was durably received. A truncated pipe (psql failing mid-COPY) ends here, unsealed.
 */
function assertComplete(engine: FaceEngine, expected: SeedExpected): void {
  const got = receivedCounts(engine.faceDb);
  if (got.assets !== expected.assets || got.faces !== expected.faces) {
    log.error('seed: the export did not arrive whole; nothing is sealed', { expected, got });
    throw new SeedRefusedError(
      'incomplete',
      `received ${got.assets} assets and ${got.faces} faces, Immich counted ${expected.assets} and ${expected.faces}`
    );
  }
  log.info('seed: the export arrived whole', { expected });
}

/**
 * Phase `begin`: refuse a seeded store, wipe a partial run (its faces, assets, matches, the
 * references the seed wrote and its counters), open the working table. Returns the run token every
 * later phase must carry.
 */
export async function beginSeed(engine: FaceEngine): Promise<string> {
  log.info('seed: begin asked');
  if (finishRunningHere(engine.faceDb)) {
    // Taking the lock would wait for the whole finish: the request would time out instead.
    throw new SeedRefusedError('finish_running', 'a finish of this seed is running');
  }
  return runExclusive(() => {
    if (getFaceStoreState(engine.faceDb, 'seeded_at')) {
      throw new SeedRefusedError('already_seeded', 'the face store is already seeded');
    }
    const { faceDb, db } = engine;
    const run = randomBytes(24).toString('hex');
    inTransaction(faceDb, () => {
      faceDb.exec(LINKS_TABLE);
      faceDb.exec('DELETE FROM face_seed_links');
      faceDb.prepare('DELETE FROM face_embeddings WHERE model = ?').run(FACE_MODEL);
      faceDb.prepare('DELETE FROM face_assets WHERE model = ?').run(FACE_MODEL);
      faceDb.prepare('DELETE FROM face_store_state WHERE key = ?').run(SEED_FINISH);
      setFaceStoreState(faceDb, SEED_ASSETS_RECEIVED, '0');
      setFaceStoreState(faceDb, SEED_UNUSABLE, '0');
      setFaceStoreState(faceDb, SEED_RUN, run);
    });
    // Matches name faces of the store just emptied: none may outlive them. The references an
    // earlier, failed finish wrote go too (only the seed writes source 'seed', and only while the
    // store is unseeded, which this phase has just checked): a member's own go nowhere.
    const { droppedMatches, droppedReferences } = inTransaction(db, () => ({
      droppedMatches: db.prepare('DELETE FROM face_matches WHERE model = ?').run(FACE_MODEL)
        .changes,
      droppedReferences: db
        .prepare("DELETE FROM face_references WHERE model = ? AND source = 'seed'")
        .run(FACE_MODEL).changes,
    }));
    checkpointFaceStore(engine);
    log.info('face seed begun', { droppedMatches, droppedReferences });
    return run;
  });
}

/** Phase `assets`: the assets face recognition ran on, written `done` with no face yet. */
export async function seedAssets(
  engine: FaceEngine,
  run: string,
  assetIds: ReadonlyArray<string>,
  now: number = Date.now()
): Promise<number> {
  log.debug('seed: assets received', { count: assetIds.length });
  return runExclusive(() => {
    assertRun(engine, run);
    const insert = engine.faceDb.prepare(
      `INSERT OR IGNORE INTO face_assets (asset_id, model, state, source, faces, attempts,
         discovered_at, updated_at) VALUES (?, ?, 'done', 'seed', 0, 0, ?, ?)`
    );
    let added = 0;
    inTransaction(engine.faceDb, () => {
      for (const id of assetIds) {
        added += insert.run(id, FACE_MODEL, now, now).changes;
      }
      addToCounter(engine.faceDb, SEED_ASSETS_RECEIVED, assetIds.length);
    });
    log.info('seed: assets written', { received: assetIds.length, added });
    return added;
  });
}

/** Phase `faces`: each face sealed under the next index of its asset. */
export async function seedFaces(
  engine: FaceEngine,
  run: string,
  faces: ReadonlyArray<SeedFace>,
  now: number = Date.now()
): Promise<{ written: number; linked: number; unusable: number }> {
  log.debug('seed: faces received', { count: faces.length });
  return runExclusive(() => {
    assertRun(engine, run);
    const { faceDb } = engine;
    // A face that is not a usable vector (wrong length, non-finite, all zero) could never match
    // anyone: it is not stored, and the count is kept durably and reported as an error.
    const encoded = faces.map((face) => {
      try {
        return encodeEmbedding(face.embedding);
      } catch {
        return null;
      }
    });
    const unusable = encoded.filter((e) => e === null).length;
    if (unusable > 0) {
      log.error('seed: faces that are not usable vectors were not stored', { unusable });
    }
    const persons = linkedPersons(engine);
    const ensureAsset = faceDb.prepare(
      `INSERT OR IGNORE INTO face_assets (asset_id, model, state, source, faces, attempts,
         discovered_at, updated_at) VALUES (?, ?, 'done', 'seed', 0, 0, ?, ?)`
    );
    const nextIndex = faceDb.prepare(
      `UPDATE face_assets SET faces = faces + 1, updated_at = ? WHERE asset_id = ? AND model = ?
       RETURNING faces - 1 AS idx`
    );
    const insert = faceDb.prepare(
      `INSERT INTO face_embeddings (asset_id, face_index, model, x1, y1, x2, y2, img_w, img_h,
         score, sealed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    );
    const link = faceDb.prepare(
      'INSERT INTO face_seed_links (asset_id, face_index, person_id) VALUES (?, ?, ?)'
    );
    let linked = 0;
    inTransaction(faceDb, () => {
      faces.forEach((face, i) => {
        const bytes = encoded[i];
        if (!bytes) {
          return;
        }
        ensureAsset.run(face.assetId, FACE_MODEL, now, now);
        const { idx } = nextIndex.get(now, face.assetId, FACE_MODEL) as { idx: number };
        insert.run(
          face.assetId,
          idx,
          FACE_MODEL,
          face.x1,
          face.y1,
          face.x2,
          face.y2,
          face.imageWidth,
          face.imageHeight,
          seal(engine.key, embeddingContext(face.assetId, idx, FACE_MODEL), bytes),
          now
        );
        if (face.personId && persons.has(face.personId)) {
          link.run(face.assetId, idx, face.personId);
          linked++;
        }
      });
      addToCounter(faceDb, SEED_UNUSABLE, unusable);
    });
    return { written: faces.length - unusable, linked, unusable };
  });
}

/** What a dry run of `finish` measures, and the first part of the real report. Aggregates only. */
export interface SeedPlanReport {
  faces: number;
  assets: number;
  /** Faces received that were not usable vectors, never stored. */
  unusable: number;
  /** Members linked to a person. */
  linkedMembers: number;
  /** Linked members who hold an open consent. */
  consentingMembers: number;
  /** Linked members given references (they still consent and their person has faces). */
  referencedMembers: number;
  /** Linked members left without references, by why. */
  skipped: { noConsent: number; noFaces: number };
  /** References per member, as a histogram (count of members per number of references). */
  referencesPerMember: Record<number, number>;
}

/** What the seed measured: aggregates only, never an id or a vector. */
export interface SeedReport extends SeedPlanReport {
  decisions: RecordResult;
  /** The faces of the members' own persons, by what the store decided for them. */
  parity: {
    personFaces: number;
    /** Shown to the member without a question (auto or confirmed). */
    shown: number;
    /** Offered to the member for confirmation. */
    suggested: number;
    /** Given to ANOTHER member. */
    toOther: number;
    /** Matched to nobody. */
    unmatched: number;
    /** Per member, the share of their person's faces shown to them: p10 / p50 / p90. */
    shownShare: { p10: number; p50: number; p90: number };
  };
  /** Profile photos carried over, by outcome. */
  profilePhotos: Record<ClaimOutcome | 'not_their_face', number>;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

type SeedLink = { asset_id: string; face_index: number; person_id: string };
type Nearest = Array<{ d: number; face: FaceKey; embedding: Float32Array }>;

/**
 * What both the dry run and the real finish read, writing nothing: the links, the linked persons,
 * and per person the FACE_MAX_REFERENCES faces nearest its centroid (two streamed scans).
 */
async function planReferences(engine: FaceEngine): Promise<{
  persons: Map<string, string>;
  links: SeedLink[];
  nearest: Map<string, Nearest>;
}> {
  const { faceDb } = engine;
  const persons = linkedPersons(engine);
  const links = faceDb
    .prepare('SELECT asset_id, face_index, person_id FROM face_seed_links')
    .all() as SeedLink[];
  const personOf = new Map(links.map((l) => [`${l.asset_id}\u0000${l.face_index}`, l.person_id]));

  // Two scans of the store: the centroid of each linked person, then each face's distance to it.
  const sums = new Map<string, { sum: Float64Array; n: number }>();
  await scanFaceStore(faceDb, engine.key, (face, embedding) => {
    const person = personOf.get(`${face.assetId}\u0000${face.faceIndex}`);
    if (!person) {
      return;
    }
    let acc = sums.get(person);
    if (!acc) {
      acc = { sum: new Float64Array(FACE_EMBEDDING_DIM), n: 0 };
      sums.set(person, acc);
    }
    for (let i = 0; i < FACE_EMBEDDING_DIM; i++) {
      acc.sum[i] += embedding[i];
    }
    acc.n++;
  });
  const centroids = new Map<string, Float32Array>();
  for (const [person, { sum, n }] of sums) {
    centroids.set(person, normalizeEmbedding(Float32Array.from(sum, (v) => v / n)));
  }
  // The FACE_MAX_REFERENCES nearest faces per person, kept as a small sorted list.
  const nearest = new Map<string, Nearest>();
  await scanFaceStore(faceDb, engine.key, (face, embedding) => {
    const person = personOf.get(`${face.assetId}\u0000${face.faceIndex}`);
    const centroid = person ? centroids.get(person) : undefined;
    if (!person || !centroid) {
      return;
    }
    const d = cosineDistance(centroid, embedding);
    const list = nearest.get(person) ?? [];
    if (list.length < FACE_MAX_REFERENCES || d < list[list.length - 1].d) {
      list.push({ d, face, embedding });
      list.sort((a, b) => a.d - b.d);
      list.length = Math.min(list.length, FACE_MAX_REFERENCES);
      nearest.set(person, list);
    }
  });
  return { persons, links, nearest };
}

/** The member is still linked to `person` and holds an open consent (read, never written). */
const STILL_CONSENTS = `SELECT 1 FROM users u WHERE u.id_user = ? AND u.photos_id = ?
  AND EXISTS (SELECT 1 FROM face_consents c WHERE c.user_id = u.id_user AND c.withdrawn_at IS NULL)`;

function emptyPlanReport(
  faceDb: DatabaseInstance,
  persons: Map<string, string>,
  db: DatabaseInstance
): SeedPlanReport {
  const got = receivedCounts(faceDb);
  const stillConsents = db.prepare(STILL_CONSENTS);
  let consenting = 0;
  for (const [person, userId] of persons) {
    if (stillConsents.get(userId, person)) {
      consenting++;
    }
  }
  return {
    faces: got.faces - got.unusable,
    assets: (
      faceDb.prepare('SELECT COUNT(*) AS n FROM face_assets WHERE model = ?').get(FACE_MODEL) as {
        n: number;
      }
    ).n,
    unusable: got.unusable,
    linkedMembers: persons.size,
    consentingMembers: consenting,
    referencedMembers: 0,
    skipped: { noConsent: 0, noFaces: 0 },
    referencesPerMember: {},
  };
}

/**
 * The dry run of `finish`: the same checks (run, completeness) and the same reference selection,
 * reporting what the references WOULD be (within each member's remaining room under the cap). It
 * writes nothing but its own status: no reference, no match, no claim, no `seeded_at`, the working
 * table kept, so the real finish can follow.
 */
export async function dryRunSeed(
  engine: FaceEngine,
  run: string,
  expected: SeedExpected
): Promise<SeedPlanReport> {
  log.info('seed: dry run asked');
  return runExclusive(async () => {
    assertRun(engine, run);
    assertComplete(engine, expected);
    const { db, faceDb } = engine;
    const { persons, nearest } = await planReferences(engine);
    const report = emptyPlanReport(faceDb, persons, db);
    const stillConsents = db.prepare(STILL_CONSENTS);
    const held = db.prepare(
      'SELECT COUNT(*) AS n FROM face_references WHERE user_id = ? AND model = ?'
    );
    for (const [person, userId] of persons) {
      const chosen = nearest.get(person) ?? [];
      if (chosen.length === 0) {
        report.skipped.noFaces++;
        continue;
      }
      if (!stillConsents.get(userId, person)) {
        report.skipped.noConsent++;
        continue;
      }
      const room = FACE_MAX_REFERENCES - (held.get(userId, FACE_MODEL) as { n: number }).n;
      const wouldWrite = Math.max(0, Math.min(chosen.length, room));
      report.referencedMembers++;
      report.referencesPerMember[wouldWrite] = (report.referencesPerMember[wouldWrite] ?? 0) + 1;
    }
    writeStoredFinish(faceDb, run, { status: 'done', dryRun: true, report });
    log.info('face seed dry run', report);
    return report;
  });
}

/**
 * Phase `finish`: refused unless the export arrived whole; then references from the links, every
 * face decided, the profile photos carried over, the parity measured, then `seeded_at` and the
 * durable `done` status in one transaction. Returns the aggregates.
 */
export async function finishSeed(
  engine: FaceEngine,
  run: string,
  expected: SeedExpected,
  now: number = Date.now()
): Promise<SeedReport> {
  log.info('seed: finish asked');
  return runExclusive(async () => {
    assertRun(engine, run);
    assertComplete(engine, expected);
    const { db, faceDb } = engine;
    const { persons, links, nearest } = await planReferences(engine);

    // The references, each member in a transaction that re-reads their link and consent.
    const stillConsents = db.prepare(STILL_CONSENTS);
    const report: SeedReport = {
      ...emptyPlanReport(faceDb, persons, db),
      decisions: { auto: 0, suggested: 0, none: 0, kept: 0 },
      parity: {
        personFaces: links.length,
        shown: 0,
        suggested: 0,
        toOther: 0,
        unmatched: 0,
        shownShare: { p10: 0, p50: 0, p90: 0 },
      },
      profilePhotos: {
        claimed: 0,
        already_confirmed: 0,
        confirmed_by_other: 0,
        rejected_by_member: 0,
        no_references: 0,
        not_their_face: 0,
      },
    };
    for (const [person, userId] of persons) {
      const chosen = nearest.get(person) ?? [];
      if (chosen.length === 0) {
        report.skipped.noFaces++;
        continue;
      }
      const written = inTransaction(db, () => {
        if (!stillConsents.get(userId, person)) {
          return -1;
        }
        let n = 0;
        for (const { embedding } of chosen) {
          if (addFaceReference(db, engine.key, userId, 'seed', embedding, now)) {
            n++;
          }
        }
        return n;
      });
      if (written < 0) {
        report.skipped.noConsent++;
        continue;
      }
      report.referencedMembers++;
      report.referencesPerMember[written] = (report.referencesPerMember[written] ?? 0) + 1;
    }

    report.decisions = await rematchAll(engine);

    // The profile photo each member chose, when it is a face of their own person.
    const profiles = db
      .prepare(
        'SELECT id_user, photos_id, photos_asset_id FROM users WHERE photos_id IS NOT NULL AND photos_asset_id IS NOT NULL'
      )
      .all() as Array<{ id_user: string; photos_id: string; photos_asset_id: string }>;
    const linkOf = new Map(links.map((l) => [`${l.asset_id}\u0000${l.person_id}`, l]));
    for (const p of profiles) {
      const face = linkOf.get(`${p.photos_asset_id}\u0000${p.photos_id}`);
      if (!face) {
        report.profilePhotos.not_their_face++;
        continue;
      }
      const [opened] = loadFaceEmbeddings(faceDb, engine.key, [
        { assetId: face.asset_id, faceIndex: face.face_index },
      ]);
      if (!opened) {
        report.profilePhotos.not_their_face++;
        continue;
      }
      report.profilePhotos[claimFace(engine, p.id_user, opened, now)]++;
    }

    // Parity: each linked person's faces against what the store decided.
    const holderOf = db.prepare(
      `SELECT user_id, (${VISIBLE_MATCH_SQL}) AS shown FROM face_matches
        WHERE asset_id = ? AND face_index = ? AND model = ? AND state != 'rejected'`
    );
    const perMember = new Map<string, { total: number; shown: number }>();
    for (const l of links) {
      const owner = persons.get(l.person_id);
      if (!owner) {
        continue;
      }
      const stat = perMember.get(owner) ?? { total: 0, shown: 0 };
      stat.total++;
      const row = holderOf.get(l.asset_id, l.face_index, FACE_MODEL) as {
        user_id: string;
        shown: number;
      } | null;
      if (!row) {
        report.parity.unmatched++;
      } else if (row.user_id !== owner) {
        report.parity.toOther++;
      } else if (row.shown) {
        report.parity.shown++;
        stat.shown++;
      } else {
        report.parity.suggested++;
      }
      perMember.set(owner, stat);
    }
    const shares = [...perMember.values()].map((s) => s.shown / s.total).sort((a, b) => a - b);
    report.parity.shownShare = {
      p10: quantile(shares, 0.1),
      p50: quantile(shares, 0.5),
      p90: quantile(shares, 0.9),
    };

    inTransaction(faceDb, () => {
      faceDb.exec('DROP TABLE IF EXISTS face_seed_links');
      setFaceStoreState(faceDb, 'seeded_at', new Date(now).toISOString());
      writeStoredFinish(faceDb, run, { status: 'done', dryRun: false, report });
    });
    checkpointFaceStore(engine);
    log.info('face store seeded', report);
    return report;
  });
}

/**
 * Start a finish (or its dry run) in the background and return once it is recorded `running`:
 * the work takes minutes, longer than any HTTP connection is kept idle, so the client polls
 * {@link readSeedFinish} instead of waiting on the request. The run and the completeness are
 * checked HERE first, so a refusal is an immediate answer; the work checks them again under the
 * lock. Its end - done, or failed with a classified reason - is written inside the lock, so no
 * later phase can interleave with it. Returns the settled outcome (the route ignores it).
 */
export async function startSeedFinish(
  engine: FaceEngine,
  run: string,
  expected: SeedExpected,
  dryRun: boolean,
  now: number = Date.now()
): Promise<{ settled: Promise<SeedFinishStatus> }> {
  log.info('seed: finish start asked', { dryRun });
  if (finishRunningHere(engine.faceDb)) {
    throw new SeedRefusedError('finish_running', 'a finish of this seed is already running');
  }
  await runExclusive(() => {
    assertRun(engine, run);
    if (finishRunningHere(engine.faceDb)) {
      throw new SeedRefusedError('finish_running', 'a finish of this seed is already running');
    }
    assertComplete(engine, expected);
    writeStoredFinish(engine.faceDb, run, { status: 'running', dryRun });
  });
  const settled = runExclusive(async (): Promise<SeedFinishStatus> => {
    try {
      if (dryRun) {
        return { status: 'done', dryRun, report: await dryRunSeed(engine, run, expected) };
      }
      return { status: 'done', dryRun, report: await finishSeed(engine, run, expected, now) };
    } catch (e) {
      const reason: SeedFailure = e instanceof SeedRefusedError ? e.reason : 'error';
      if (reason === 'error') {
        log.error('seed: the finish failed; nothing is sealed', e);
      } else {
        log.warn('seed: the finish was refused under the lock; nothing is sealed', { reason });
      }
      const failed: SeedFinishStatus = { status: 'failed', dryRun, reason };
      // A later begin replaced this run: its status is no longer this run's to write.
      if (getFaceStoreState(engine.faceDb, SEED_RUN) === run) {
        writeStoredFinish(engine.faceDb, run, failed);
      }
      return failed;
    }
  });
  return { settled };
}

/**
 * The outcome of the current run's finish, for the poll. Refused (`stale_run`, `not_begun`) unless
 * `run` is the current run. A `running` status written by another process was cut by a restart:
 * it is reported, and recorded, as failed `interrupted` - so a poll always ends.
 */
export function readSeedFinish(engine: FaceEngine, run: string): SeedFinishStatus {
  log.debug('seed: finish status read');
  const current = getFaceStoreState(engine.faceDb, SEED_RUN);
  if (!current) {
    throw new SeedRefusedError('not_begun', 'the seed has not begun');
  }
  if (current !== run) {
    throw new SeedRefusedError('stale_run', 'this run was replaced by a later begin');
  }
  const stored = readStoredFinish(engine.faceDb);
  if (!stored || stored.run !== run) {
    return { status: 'none' };
  }
  const { run: _ignored, process: writer, ...status } = stored;
  if (status.status === 'running' && writer !== PROCESS_ID) {
    log.error('seed: a finish was cut by a restart; nothing was sealed', {
      dryRun: status.dryRun,
    });
    const failed: SeedFinishStatus = {
      status: 'failed',
      dryRun: status.dryRun,
      reason: 'interrupted',
    };
    writeStoredFinish(engine.faceDb, run, failed);
    return failed;
  }
  return status;
}
