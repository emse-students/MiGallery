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
 * THE PROTOCOL, four phases over `POST /api/admin/faces/seed` (scripts/faces/seed-client.mjs):
 * - `begin`: refused once the store is seeded (`seeded_at`, durable); otherwise any partial earlier
 *   run is wiped, so a failed seed is simply run again.
 * - `assets`: every asset Immich has run face recognition on, written `done` (source `seed`, no
 *   face yet): an asset with no face is as decided as one with five, and must not be re-embedded.
 * - `faces`: the faces, each given the next index of its asset, sealed, written. A face of a
 *   LINKED person (a member's own link) is noted in `face_seed_links`, a working table of the seed.
 * - `finish`: per linked member who still consents, the 5 of their person's faces nearest the
 *   person's centroid become their references (`photo`); every stored face is decided
 *   (`rematchAll`); the profile photo each member chose is claimed for them when it is a face of
 *   their person; the parity of the result with their links is measured, as aggregates only; the
 *   working table is dropped and `seeded_at` written - after which ingestion starts.
 *
 * Every phase runs inside the engine lock. A member's erasure is synchronous and outside it, so a
 * reference is written only inside a transaction that re-reads the member's link and consent.
 */

import { inTransaction } from '#lib/db/transaction.ts';
import { getFaceStoreState, setFaceStoreState } from '#lib/db/face-database.ts';
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

/** The seed was refused: said to the operator, never retried by itself. */
export class SeedRefusedError extends Error {
  readonly kind = 'seed_refused';
  constructor(
    readonly reason: 'already_seeded' | 'not_begun',
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

const SEED_STARTED = 'seed_started_at';

const LINKS_TABLE = `CREATE TABLE IF NOT EXISTS face_seed_links (
    asset_id TEXT NOT NULL,
    face_index INTEGER NOT NULL,
    person_id TEXT NOT NULL,
    PRIMARY KEY(asset_id, face_index)
)`;

/** The person ids members linked to themselves, mapped to the member. */
function linkedPersons(engine: FaceEngine): Map<string, string> {
  const rows = engine.db
    .prepare('SELECT id_user, photos_id FROM users WHERE photos_id IS NOT NULL')
    .all() as Array<{ id_user: string; photos_id: string }>;
  return new Map(rows.map((r) => [r.photos_id, r.id_user]));
}

function assertBegun(engine: FaceEngine): void {
  if (getFaceStoreState(engine.faceDb, 'seeded_at')) {
    throw new SeedRefusedError('already_seeded', 'the face store is already seeded');
  }
  if (!getFaceStoreState(engine.faceDb, SEED_STARTED)) {
    throw new SeedRefusedError('not_begun', 'the seed has not begun');
  }
}

/** Phase `begin`: refuse a seeded store, wipe a partial run, open the working table. */
export async function beginSeed(engine: FaceEngine, now: number = Date.now()): Promise<void> {
  await runExclusive(() => {
    if (getFaceStoreState(engine.faceDb, 'seeded_at')) {
      throw new SeedRefusedError('already_seeded', 'the face store is already seeded');
    }
    const { faceDb, db } = engine;
    inTransaction(faceDb, () => {
      faceDb.exec(LINKS_TABLE);
      faceDb.exec('DELETE FROM face_seed_links');
      faceDb.prepare('DELETE FROM face_embeddings WHERE model = ?').run(FACE_MODEL);
      faceDb.prepare('DELETE FROM face_assets WHERE model = ?').run(FACE_MODEL);
      setFaceStoreState(faceDb, SEED_STARTED, String(now));
    });
    // Matches name faces of the store just emptied: none may outlive them.
    const dropped = db.prepare('DELETE FROM face_matches WHERE model = ?').run(FACE_MODEL).changes;
    checkpointFaceStore(engine);
    log.info('face seed begun', { matchesDropped: dropped });
  });
}

/** Phase `assets`: the assets face recognition ran on, written `done` with no face yet. */
export async function seedAssets(
  engine: FaceEngine,
  assetIds: ReadonlyArray<string>,
  now: number = Date.now()
): Promise<number> {
  return runExclusive(() => {
    assertBegun(engine);
    const insert = engine.faceDb.prepare(
      `INSERT OR IGNORE INTO face_assets (asset_id, model, state, source, faces, attempts,
         discovered_at, updated_at) VALUES (?, ?, 'done', 'seed', 0, 0, ?, ?)`
    );
    let added = 0;
    inTransaction(engine.faceDb, () => {
      for (const id of assetIds) {
        added += insert.run(id, FACE_MODEL, now, now).changes;
      }
    });
    log.info('seed: assets written', { received: assetIds.length, added });
    return added;
  });
}

/** Phase `faces`: each face sealed under the next index of its asset. */
export async function seedFaces(
  engine: FaceEngine,
  faces: ReadonlyArray<SeedFace>,
  now: number = Date.now()
): Promise<{ written: number; linked: number; unusable: number }> {
  return runExclusive(() => {
    assertBegun(engine);
    const { faceDb } = engine;
    // A face that is not a usable vector (wrong length, non-finite, all zero) could never match
    // anyone: it is not stored, and the count is reported as an error.
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
    });
    return { written: faces.length - unusable, linked, unusable };
  });
}

/** What the seed measured: aggregates only, never an id or a vector. */
export interface SeedReport {
  faces: number;
  assets: number;
  /** Members linked to a person. */
  linkedMembers: number;
  /** Linked members given references (they still consent and their person has faces). */
  referencedMembers: number;
  /** Linked members left without references, by why. */
  skipped: { noConsent: number; noFaces: number };
  /** References written per member, as a histogram (count of members per number of references). */
  referencesPerMember: Record<number, number>;
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

/**
 * Phase `finish`: references from the links, every face decided, the profile photos carried over,
 * the parity measured, then `seeded_at`. Returns the aggregates.
 */
export async function finishSeed(
  engine: FaceEngine,
  now: number = Date.now()
): Promise<SeedReport> {
  return runExclusive(async () => {
    assertBegun(engine);
    const { db, faceDb } = engine;
    const persons = linkedPersons(engine);
    const links = faceDb
      .prepare('SELECT asset_id, face_index, person_id FROM face_seed_links')
      .all() as Array<{ asset_id: string; face_index: number; person_id: string }>;
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
    const nearest = new Map<string, Array<{ d: number; face: FaceKey; embedding: Float32Array }>>();
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

    // The references, each member in a transaction that re-reads their link and consent.
    const stillConsents = db.prepare(
      `SELECT 1 FROM users u WHERE u.id_user = ? AND u.photos_id = ?
         AND EXISTS (SELECT 1 FROM face_consents c WHERE c.user_id = u.id_user AND c.withdrawn_at IS NULL)`
    );
    const report: SeedReport = {
      faces: (
        faceDb
          .prepare('SELECT COUNT(*) AS n FROM face_embeddings WHERE model = ?')
          .get(FACE_MODEL) as { n: number }
      ).n,
      assets: (
        faceDb.prepare('SELECT COUNT(*) AS n FROM face_assets WHERE model = ?').get(FACE_MODEL) as {
          n: number;
        }
      ).n,
      linkedMembers: persons.size,
      referencedMembers: 0,
      skipped: { noConsent: 0, noFaces: 0 },
      referencesPerMember: {},
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
          if (addFaceReference(db, engine.key, userId, 'photo', embedding, now)) {
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
    });
    checkpointFaceStore(engine);
    log.info('face store seeded', report);
    return report;
  });
}
