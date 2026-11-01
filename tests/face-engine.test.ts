/**
 * Lots A3 and A4 of the face store (docs/wiki/face-matching-option-c.md): ingestion into faces.db,
 * the match engine, and the erasure of a member's matches. SYNTHETIC vectors only; Immich and the
 * model service are fakes answering from in-memory tables.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './test-helpers';
import { FACE_EMBEDDING_DIM, normalizeEmbedding } from '#lib/face-embedding.ts';
import { parseSealKey } from '#lib/server/face-seal.ts';

const env: Record<string, string | undefined> = {
  IMMICH_BASE_URL: 'http://immich.test',
  IMMICH_API_KEY: 'k',
  FACE_ML_URL: 'http://ml.test',
  FACE_STORE_KEY: 'ab'.repeat(32),
};
vi.mock('#lib/server/env.ts', () => ({ env }));

function synthetic(seed: number): Float32Array {
  let a = seed >>> 0;
  const out = new Float32Array(FACE_EMBEDDING_DIM);
  for (let i = 0; i < out.length; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  return out;
}

/** A vector at an exact cosine distance `d` from `base`. */
function atDistance(base: Float32Array, other: Float32Array, d: number): Float32Array {
  const u = normalizeEmbedding(base);
  const o = normalizeEmbedding(other);
  let dot = 0;
  for (let i = 0; i < u.length; i++) dot += u[i] * o[i];
  const w = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) w[i] = o[i] - dot * u[i];
  const v = normalizeEmbedding(w);
  const cos = 1 - d;
  const sin = Math.sqrt(1 - cos * cos);
  const out = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) out[i] = cos * u[i] + sin * v[i];
  return out;
}

/** Two "people": everything is built around these two far-apart identities. */
const ALICE = synthetic(1000);
const BOB = synthetic(2000);

let database: typeof import('#lib/db/database.ts');
let faceDatabase: typeof import('#lib/db/face-database.ts');
let engineMod: typeof import('#lib/server/face-engine.ts');
let ingest: typeof import('#lib/server/face-ingest.ts');
let refs: typeof import('#lib/server/face-references.ts');
let erasure: typeof import('#lib/server/face-erasure.ts');
let dbDir: string;
const key = parseSealKey(env.FACE_STORE_KEY);

function db() {
  return database.getDatabase();
}
function faceDb() {
  return faceDatabase.getFaceDatabase();
}
function engine() {
  return { db: db(), faceDb: faceDb(), key };
}

/** The engine's mutations, each run inside its lock as the server's callers do. */
const L = {
  answerMatch: (...a: Parameters<typeof engineMod.answerMatch>) =>
    engineMod.runExclusive(() => engineMod.answerMatch(...a)),
  redecideFaces: (...a: Parameters<typeof engineMod.redecideFaces>) =>
    engineMod.runExclusive(() => engineMod.redecideFaces(...a)),
  rematchMember: (...a: Parameters<typeof engineMod.rematchMember>) =>
    engineMod.runExclusive(() => engineMod.rematchMember(...a)),
  rematchAll: (...a: Parameters<typeof engineMod.rematchAll>) =>
    engineMod.runExclusive(() => engineMod.rematchAll(...a)),
};

function addUser(id: string) {
  db().prepare('INSERT INTO users (id_user, name) VALUES (?, ?)').run(id, id);
}

/** Enrol `id` with `n` references, all exactly `d` from `who`. */
function enrol(id: string, who: Float32Array, n = 3, d = 0.2) {
  addUser(id);
  for (let i = 0; i < n; i++) {
    refs.addFaceReference(
      db(),
      key,
      id,
      'photo',
      atDistance(who, synthetic(id.length * 97 + i), d)
    );
  }
}

function matches(): Array<{
  asset_id: string;
  face_index: number;
  user_id: string;
  band: string;
  state: string;
}> {
  return db()
    .prepare(
      'SELECT asset_id, face_index, user_id, band, state FROM face_matches ORDER BY asset_id, face_index, user_id'
    )
    .all() as never;
}

/** The faces each fake asset holds, as the model would return them. */
const library = new Map<string, Float32Array[]>();
/** Assets the fake Immich lists, in order. */
let listed: string[] = [];
let mlDown = false;
let immichGarbled = false;
let mlGarbage = false;
/** A status the fake model answers instead of a result (null: it answers). */
let mlStatus: number | null = null;
let missingPreview = new Set<string>();
const searchBodies: Array<Record<string, unknown>> = [];

const fakeFetch = (async (url: string, init?: RequestInit) => {
  const u = new URL(url);
  if (u.pathname === '/api/search/metadata') {
    if (immichGarbled) return new Response('<html>proxy error</html>');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown> & {
      page: number;
      size: number;
    };
    searchBodies.push(body);
    const start = (body.page - 1) * body.size;
    const items = listed.slice(start, start + body.size).map((id) => ({ id }));
    const next = start + body.size < listed.length ? String(body.page + 1) : null;
    return Response.json({ assets: { items, nextPage: next } });
  }
  const thumb = u.pathname.match(/^\/api\/assets\/([^/]+)\/thumbnail$/);
  if (thumb) {
    const id = decodeURIComponent(thumb[1]);
    if (missingPreview.has(id)) return new Response('no', { status: 400 });
    return new Response(id);
  }
  if (u.pathname === '/predict') {
    if (mlDown) throw new TypeError('connect ECONNREFUSED');
    if (mlStatus !== null) return new Response('{}', { status: mlStatus });
    const id = await ((init!.body as FormData).get('image') as Blob).text();
    if (mlGarbage) {
      return Response.json({ imageWidth: 10, imageHeight: 10, 'facial-recognition': [{}] });
    }
    const faces = (library.get(id) ?? []).map((v, i) => ({
      boundingBox: { x1: i, y1: i, x2: i + 10, y2: i + 10 },
      score: 0.9,
      embedding: JSON.stringify(Array.from(v)),
    }));
    return Response.json({ imageWidth: 1440, imageHeight: 1080, 'facial-recognition': faces });
  }
  return new Response('unexpected', { status: 599 });
}) as unknown as typeof fetch;

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-face-engine-'));
  process.env.DATABASE_PATH = join(dbDir, 'migallery.db');
  database = await import('#lib/db/database.ts');
  faceDatabase = await import('#lib/db/face-database.ts');
  engineMod = await import('#lib/server/face-engine.ts');
  ingest = await import('#lib/server/face-ingest.ts');
  refs = await import('#lib/server/face-references.ts');
  erasure = await import('#lib/server/face-erasure.ts');
});

afterAll(() => {
  faceDatabase.resetFaceDatabase();
  database.resetDatabase();
  removeTempDir(dbDir);
});

beforeEach(() => {
  db().exec('DELETE FROM face_matches; DELETE FROM face_references; DELETE FROM users;');
  faceDb().exec(
    'DELETE FROM face_embeddings; DELETE FROM face_assets; DELETE FROM face_store_state;'
  );
  library.clear();
  listed = [];
  mlDown = false;
  immichGarbled = false;
  mlGarbage = false;
  mlStatus = null;
  missingPreview = new Set();
  searchBodies.length = 0;
});

/** A listing time, and the spacing after which a second listing counts (face-ingest.ts). */
const T0 = 1_800_000_000_000;
const SPACING = 20 * 60 * 60 * 1000;

function seeded() {
  faceDatabase.setFaceStoreState(faceDb(), 'seeded_at', '2026-10-31T00:00:00Z');
}

async function ingestAll(ids: string[]) {
  listed = ids;
  ingest.addPending(faceDb(), ids, 1);
  return ingest.runIngestPass(fakeFetch, engine());
}

describe('the face store file', () => {
  it('lives beside migallery.db, and migallery.db holds no embedding table', () => {
    expect(faceDatabase.faceDatabasePath()).toBe(join(dbDir, 'faces.db'));
    const inMain = db()
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'face_embeddings'")
      .get();
    expect(inMain).toBeNull();
    const sd = faceDb().prepare('PRAGMA secure_delete').get() as Record<string, number>;
    expect(Object.values(sd)[0]).toBeGreaterThan(0);
  });

  it('drops the empty A1 embedding table from migallery.db, and keeps a non-empty one', () => {
    const main = db();
    main.exec(
      'CREATE TABLE face_embeddings (asset_id TEXT, face_index INTEGER, model TEXT, sealed BLOB)'
    );
    database.ensureSchema(main);
    expect(
      main.prepare("SELECT 1 FROM sqlite_master WHERE name = 'face_embeddings'").get()
    ).toBeNull();
    main.exec(
      "CREATE TABLE face_embeddings (asset_id TEXT, face_index INTEGER, model TEXT, sealed BLOB); INSERT INTO face_embeddings VALUES ('a', 0, 'm', x'00')"
    );
    database.ensureSchema(main);
    expect(main.prepare('SELECT COUNT(*) AS n FROM face_embeddings').get()).toEqual({ n: 1 });
    main.exec('DROP TABLE face_embeddings');
  });
});

describe('ingestion (A3)', () => {
  it('ingests nothing before the seed', async () => {
    library.set('p1', [ALICE]);
    const result = await ingestAll(['p1']);
    expect(result.stopped).toBe('not_seeded');
    expect(faceDb().prepare('SELECT COUNT(*) AS n FROM face_embeddings').get()).toEqual({ n: 0 });
  });

  it('embeds an asset once, seals its faces with their box, and decides them', async () => {
    seeded();
    enrol('alice', ALICE);
    library.set('p1', [atDistance(ALICE, synthetic(5), 0.1), BOB]);
    const result = await ingestAll(['p1']);
    expect(result).toMatchObject({ done: 1, stopped: null });
    const rows = faceDb()
      .prepare(
        'SELECT face_index, x1, img_w, score, length(sealed) AS bytes FROM face_embeddings ORDER BY face_index'
      )
      .all() as Array<Record<string, number>>;
    expect(rows).toEqual([
      { face_index: 0, x1: 0, img_w: 1440, score: 0.9, bytes: 1024 + 29 },
      { face_index: 1, x1: 1, img_w: 1440, score: 0.9, bytes: 1024 + 29 },
    ]);
    expect(faceDb().prepare('SELECT state, source, faces FROM face_assets').get()).toEqual({
      state: 'done',
      source: 'ml',
      faces: 2,
    });
    expect(matches()).toEqual([
      { asset_id: 'p1', face_index: 0, user_id: 'alice', band: 'auto', state: 'pending' },
    ]);
    // Done is done: a second pass asks the model nothing.
    const again = await ingest.runIngestPass(fakeFetch, engine());
    expect(again.done).toBe(0);
  });

  it('stops the pass and blames no asset when the model service is down', async () => {
    seeded();
    mlDown = true;
    const result = await ingestAll(['p1', 'p2']);
    expect(result.stopped).toBe('ml_unavailable');
    expect(
      faceDb()
        .prepare("SELECT COUNT(*) AS n FROM face_assets WHERE state = 'pending' AND attempts = 0")
        .get()
    ).toEqual({ n: 2 });
  });

  it('counts an attempt of the asset, and goes on, when the model refuses the image itself', async () => {
    seeded();
    mlStatus = 422;
    const result = await ingestAll(['p1', 'p2']);
    expect(result).toMatchObject({ retry: 2, stopped: null });
    expect(
      faceDb()
        .prepare('SELECT asset_id, attempts, last_error FROM face_assets ORDER BY asset_id')
        .all()
    ).toEqual([
      { asset_id: 'p1', attempts: 1, last_error: 'image_refused: 422' },
      { asset_id: 'p2', attempts: 1, last_error: 'image_refused: 422' },
    ]);
  });

  it('stops the pass and blames no asset on a status that says the service did not serve it', async () => {
    seeded();
    mlStatus = 404; // a wrong FACE_ML_URL path: not the image's fault
    const result = await ingestAll(['p1']);
    expect(result.stopped).toBe('ml_unavailable');
    expect(faceDb().prepare('SELECT attempts FROM face_assets').get()).toEqual({ attempts: 0 });
  });

  it('fails an asset after the attempts on an answer it cannot trust, and reports the cause', async () => {
    seeded();
    mlGarbage = true;
    await ingestAll(['p1']);
    for (let i = 1; i < ingest.INGEST_MAX_ATTEMPTS; i++) {
      await ingest.runIngestPass(fakeFetch, engine());
    }
    expect(faceDb().prepare('SELECT state, attempts FROM face_assets').get()).toEqual({
      state: 'failed',
      attempts: ingest.INGEST_MAX_ATTEMPTS,
    });
    const report = ingest.reportIngest(faceDb(), null);
    expect(report).toMatchObject({ failed: 1, failedCauses: { bad_response: 1 } });
  });

  it('leaves an asset with no preview yet pending, counting no attempt, never deleting it', async () => {
    seeded();
    missingPreview.add('p1');
    for (let i = 0; i < ingest.INGEST_MAX_ATTEMPTS + 1; i++) {
      expect((await ingestAll(['p1'])).retry).toBe(1);
    }
    expect(faceDb().prepare('SELECT state, attempts, last_error FROM face_assets').get()).toEqual({
      state: 'pending',
      attempts: 0,
      last_error: 'no_preview: Immich has no preview for it yet',
    });
    // The hourly report names the cause, not only the age.
    expect(ingest.reportIngest(faceDb(), null).pendingCauses).toEqual({ no_preview: 1 });
    // Once Immich has made the preview, the next pass embeds it.
    missingPreview.delete('p1');
    library.set('p1', [ALICE]);
    expect((await ingest.runIngestPass(fakeFetch, engine())).done).toBe(1);
  });

  it('takes the least recently tried pending asset first', async () => {
    seeded();
    missingPreview.add('old');
    ingest.addPending(faceDb(), ['old'], 1);
    ingest.addPending(faceDb(), ['new'], 2);
    library.set('new', []);
    await ingest.runIngestPass(fakeFetch, engine(), 1); // tries `old`: no preview, moved behind
    expect((await ingest.runIngestPass(fakeFetch, engine(), 1)).done).toBe(1);
    expect(faceDb().prepare("SELECT state FROM face_assets WHERE asset_id = 'new'").get()).toEqual({
      state: 'done',
    });
  });

  it('writes an asset again from scratch, dropping its old decisions', async () => {
    seeded();
    enrol('alice', ALICE);
    library.set('p1', [atDistance(ALICE, synthetic(5), 0.1)]);
    await ingestAll(['p1']);
    db().prepare("UPDATE face_matches SET state = 'confirmed'").run();
    library.set('p1', [BOB, atDistance(ALICE, synthetic(6), 0.1)]);
    faceDb().prepare("UPDATE face_assets SET state = 'pending'").run();
    await ingest.runIngestPass(fakeFetch, engine());
    expect(matches()).toEqual([
      { asset_id: 'p1', face_index: 1, user_id: 'alice', band: 'auto', state: 'pending' },
    ]);
  });

  it('discovers by creation date and reconciles the whole library', async () => {
    seeded();
    listed = ['n1', 'n2'];
    expect(await ingest.discoverNew(fakeFetch, faceDb(), '2026-10-30T00:00:00.000Z')).toBe(2);
    expect(searchBodies[0]).toMatchObject({ createdAfter: '2026-10-30T00:00:00.000Z' });
    library.set('n1', [ALICE]);
    enrol('alice', ALICE);
    await ingest.runIngestPass(fakeFetch, engine());
    expect(matches()).toHaveLength(1);

    // n1 deleted from Immich, n3 new: n3 is pending; n1 is only marked by ONE listing...
    listed = ['n2', 'n3'];
    const first = await ingest.reconcile(fakeFetch, engine(), T0);
    expect(first).toMatchObject({
      listed: 2,
      added: 1,
      marked: 1,
      removed: 0,
      refused: null,
      counted: true,
    });
    expect(searchBodies.at(-1)).toMatchObject({ withDeleted: true });
    expect(matches()).toHaveLength(1);
    // ...and its faces and matches go when the next counting listing misses it too.
    const second = await ingest.reconcile(fakeFetch, engine(), T0 + SPACING);
    expect(second).toMatchObject({ added: 0, marked: 0, removed: 1 });
    expect(matches()).toHaveLength(0);
    expect(
      faceDb().prepare("SELECT COUNT(*) AS n FROM face_embeddings WHERE asset_id = 'n1'").get()
    ).toEqual({ n: 0 });
  });

  it('forgets a mark when the asset is listed again', async () => {
    seeded();
    ingest.addPending(faceDb(), ['a', 'b', 'c'], 1);
    listed = ['a', 'b'];
    expect((await ingest.reconcile(fakeFetch, engine(), T0)).marked).toBe(1);
    listed = ['a', 'b', 'c'];
    await ingest.reconcile(fakeFetch, engine(), T0 + SPACING);
    listed = ['a', 'b'];
    // Missing again, but not from two CONSECUTIVE listings: still only marked.
    expect(await ingest.reconcile(fakeFetch, engine(), T0 + 2 * SPACING)).toMatchObject({
      marked: 1,
      removed: 0,
    });
  });

  it('never counts a second witness before the spacing: restarts list, they do not delete', async () => {
    seeded();
    ingest.addPending(faceDb(), ['a', 'b', 'c'], 1);
    listed = ['a', 'b'];
    expect(await ingest.reconcile(fakeFetch, engine(), T0)).toMatchObject({
      marked: 1,
      counted: true,
    });
    // Two deploys and a crash loop within the hour: each lists, none counts.
    for (const at of [T0 + 1, T0 + 60_000, T0 + SPACING - 1]) {
      expect(await ingest.reconcile(fakeFetch, engine(), at)).toMatchObject({
        marked: 0,
        removed: 0,
        counted: false,
      });
    }
    expect(
      faceDb().prepare("SELECT absent_listings FROM face_assets WHERE asset_id = 'c'").get()
    ).toEqual({ absent_listings: 1 });
    // A listing that does not count still adds the new and clears what it names again.
    listed = ['a', 'b', 'c', 'd'];
    expect(await ingest.reconcile(fakeFetch, engine(), T0 + 2)).toMatchObject({
      added: 1,
      counted: false,
    });
    expect(
      faceDb().prepare("SELECT absent_listings FROM face_assets WHERE asset_id = 'c'").get()
    ).toEqual({ absent_listings: 0 });
    // The spacing is measured from the last listing that COUNTED, stored in the face store.
    listed = ['a', 'b', 'd'];
    expect(await ingest.reconcile(fakeFetch, engine(), T0 + SPACING)).toMatchObject({
      marked: 1,
      counted: true,
    });
    expect(faceDatabase.getFaceStoreState(faceDb(), ingest.LAST_COUNTED_LISTING)).toBe(
      String(T0 + SPACING)
    );
    expect(await ingest.reconcile(fakeFetch, engine(), T0 + 2 * SPACING)).toMatchObject({
      removed: 1,
    });
    expect(ingest.RECONCILE_COUNT_SPACING_MS).toBe(SPACING);
  });

  it('removes nothing from a listing that hit its page cap', async () => {
    seeded();
    ingest.addPending(faceDb(), ['a', 'b', 'c'], 1);
    listed = Array.from({ length: 1001 }, (_, i) => `x${i}`); // two pages of 1000
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await ingest.reconcile(fakeFetch, engine(), Date.now(), 1);
    errors.mockRestore();
    expect(result).toMatchObject({
      marked: 0,
      removed: 0,
      refused: 'the listing hit its page cap',
    });
    expect(faceDb().prepare('SELECT SUM(absent_listings) AS n FROM face_assets').get()).toEqual({
      n: 0,
    });
  });

  it('removes nothing on a listing that names under half of what it knows', async () => {
    ingest.addPending(faceDb(), ['a', 'b', 'c', 'd', 'e'], 1);
    listed = ['a', 'b'];
    const result = await ingest.reconcile(fakeFetch, engine());
    expect(result.removed).toBe(0);
    expect(result.refused).toMatch(/2 assets against 5/);
    expect(faceDb().prepare('SELECT COUNT(*) AS n FROM face_assets').get()).toEqual({ n: 5 });
  });

  it('stops on a listing that is not JSON, as Immich unavailable, blaming no asset', async () => {
    seeded();
    immichGarbled = true;
    await expect(
      ingest.discoverNew(fakeFetch, faceDb(), '2026-10-30T00:00:00Z')
    ).rejects.toBeInstanceOf(ingest.ImmichUnavailableError);
  });

  it('counts an unexpected failure against its asset, leaves it pending, and goes on', async () => {
    seeded();
    enrol('alice', ALICE);
    library.set('a1', [ALICE]);
    library.set('a2', [BOB]);
    ingest.addPending(faceDb(), ['a1', 'a2'], 1);
    // The decision cannot be written: the faces are, the asset must NOT be done.
    db().exec('ALTER TABLE face_matches RENAME TO face_matches_hidden');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let result;
    try {
      result = await ingest.runIngestPass(fakeFetch, engine());
    } finally {
      db().exec('ALTER TABLE face_matches_hidden RENAME TO face_matches');
      errors.mockRestore();
    }
    expect(result).toMatchObject({ done: 0, retry: 2, stopped: null });
    const rows = faceDb()
      .prepare('SELECT asset_id, state, attempts, last_error FROM face_assets ORDER BY asset_id')
      .all() as Array<{ state: string; attempts: number; last_error: string }>;
    expect(rows.map((r) => [r.state, r.attempts])).toEqual([
      ['pending', 1],
      ['pending', 1],
    ]);
    expect(rows[0].last_error).toMatch(/^error: /);
    // The next pass writes and decides it again.
    expect((await ingest.runIngestPass(fakeFetch, engine())).done).toBe(2);
    expect(matches().map((m) => m.asset_id)).toEqual(['a1']);
  });

  it('decides at ingestion on the stored float16 vector, so a rescan changes nothing', async () => {
    seeded();
    enrol('alice', ALICE);
    library.set('p1', [atDistance(ALICE, synthetic(3), 0.3)]);
    await ingestAll(['p1']);
    const before = db().prepare('SELECT distance, created_at FROM face_matches').get();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await L.rematchAll(engine());
    expect(db().prepare('SELECT distance, created_at FROM face_matches').get()).toEqual(before);
  });

  it('empties the WAL after removing faces', async () => {
    seeded();
    library.set('g1', [ALICE]);
    await ingestAll(['g1', 'k1', 'k2']);
    listed = ['k1', 'k2'];
    await ingest.reconcile(fakeFetch, engine(), T0);
    expect((await ingest.reconcile(fakeFetch, engine(), T0 + SPACING)).removed).toBe(1);
    expect(statSync(`${faceDatabase.faceDatabasePath()}-wal`).size).toBe(0);
  });

  it('turns the feature off on a malformed key, with one error, never a throw', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const good = env.FACE_STORE_KEY;
    env.FACE_STORE_KEY = 'not-a-key';
    let off: number;
    try {
      expect(engineMod.defaultFaceEngine()).toBeNull();
      expect(engineMod.defaultFaceEngine()).toBeNull();
      off = errors.mock.calls.filter((c) => String(c[0]).includes('face feature is OFF')).length;
      // ONE error line in all: the key parser does not log a fault its caller already reports.
      expect(errors).toHaveBeenCalledTimes(1);
    } finally {
      env.FACE_STORE_KEY = good;
      errors.mockRestore();
    }
    expect(off).toBe(1);
    expect(engineMod.defaultFaceEngine()).not.toBeNull();
  });

  it('says an unseeded store without accusing it, and reports an overdue backlog with its cause', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(ingest.reportIngest(faceDb(), null).seeded).toBe(false);
    expect(errors).toHaveBeenCalledTimes(0); // planned until the seed (A7)
    seeded();
    ingest.addPending(faceDb(), ['x'], 0);
    ingest.reportIngest(faceDb(), null, ingest.INGEST_OVERDUE_MS - 1);
    expect(errors).toHaveBeenCalledTimes(0); // a day-old backlog is not yet an error
    const report = ingest.reportIngest(faceDb(), 'ml_unavailable', ingest.INGEST_OVERDUE_MS + 1);
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockRestore();
    expect(report).toMatchObject({ pending: 1, lastStop: 'ml_unavailable' });
    expect(report.oldestPendingMs).toBeGreaterThan(ingest.INGEST_OVERDUE_MS);
  });
});

describe('the match engine (A4)', () => {
  /** Store faces directly (as the seed will) and return them opened. */
  async function store(faces: Array<[string, number, Float32Array]>) {
    seeded();
    for (const [assetId] of faces) library.set(assetId, []);
    for (const [assetId, , v] of faces) library.get(assetId)?.push(v);
    await ingestAll([...new Set(faces.map((f) => f[0]))]);
  }

  it('gives a face to the nearest member only', async () => {
    enrol('alice', ALICE);
    enrol('bob', BOB);
    await store([['p1', 0, atDistance(ALICE, synthetic(7), 0.15)]]);
    expect(matches().map((m) => m.user_id)).toEqual(['alice']);
  });

  it('keeps a confirmed face, whoever comes later', async () => {
    enrol('alice', ALICE);
    await store([['p1', 0, atDistance(ALICE, synthetic(7), 0.3)]]);
    expect(await L.answerMatch(db(), 'alice', { assetId: 'p1', faceIndex: 0 }, 'confirm')).toBe(
      true
    );
    // A later, nearer member: a human's answer is not re-decided.
    enrol('clone', ALICE, 3, 0.01);
    await L.rematchMember(engine(), 'clone');
    expect(matches()).toEqual([
      { asset_id: 'p1', face_index: 0, user_id: 'alice', band: 'auto', state: 'confirmed' },
    ]);
  });

  it('offers a rejected face to the next member, never again to the one who rejected it', async () => {
    enrol('alice', ALICE, 3, 0.2);
    enrol('twin', ALICE, 3, 0.35);
    await store([['p1', 0, ALICE]]);
    expect(matches()[0].user_id).toBe('alice');
    expect(await L.answerMatch(db(), 'alice', { assetId: 'p1', faceIndex: 0 }, 'reject')).toBe(
      true
    );
    await L.redecideFaces(engine(), [{ assetId: 'p1', faceIndex: 0 }]);
    expect(matches()).toEqual([
      { asset_id: 'p1', face_index: 0, user_id: 'alice', band: 'auto', state: 'rejected' },
      // The one who rejected it is still the runner-up, closer than the margin: past a human.
      { asset_id: 'p1', face_index: 0, user_id: 'twin', band: 'suggested', state: 'pending' },
    ]);
    // A re-decision later (a new member, a new reference) still leaves alice out.
    await L.rematchMember(engine(), 'alice');
    expect(
      matches()
        .filter((m) => m.state === 'pending')
        .map((m) => m.user_id)
    ).toEqual(['twin']);
  });

  it('refuses an answer on a face the member does not hold', async () => {
    enrol('alice', ALICE);
    enrol('bob', BOB);
    await store([['p1', 0, ALICE]]);
    expect(await L.answerMatch(db(), 'bob', { assetId: 'p1', faceIndex: 0 }, 'confirm')).toBe(
      false
    );
  });

  it('moves a suggested face of a new, nearer member to them on their enrolment', async () => {
    // 0.55: the suggested band, which a re-match may still re-decide.
    enrol('far', ALICE, 3, 0.55);
    await store([
      ['p1', 0, ALICE],
      ['p2', 0, BOB],
    ]);
    expect(matches().map((m) => m.user_id)).toEqual(['far']);
    enrol('near', ALICE, 3, 0.1);
    await L.rematchMember(engine(), 'near');
    expect(matches().map((m) => [m.asset_id, m.user_id, m.band])).toEqual([['p1', 'near', 'auto']]);
  });

  it('keeps an auto face with its member when a nearer member enrols (sticky auto, owner 2026-11-01)', async () => {
    // 0.45: the auto band. "Une fois qu'un visage est attaché, il n'est pas détaché par un nouveau scan."
    enrol('far', ALICE, 3, 0.45);
    await store([['p1', 0, ALICE]]);
    expect(matches().map((m) => [m.user_id, m.band, m.state])).toEqual([
      ['far', 'auto', 'pending'],
    ]);
    enrol('near', ALICE, 3, 0.1);
    await L.rematchMember(engine(), 'near');
    await L.rematchAll(engine());
    expect(matches().map((m) => [m.user_id, m.band, m.state])).toEqual([
      ['far', 'auto', 'pending'],
    ]);
  });

  it('lets a sticky auto face go on "not me", and the nearer member then gets it', async () => {
    enrol('far', ALICE, 3, 0.45);
    await store([['p1', 0, ALICE]]);
    enrol('near', ALICE, 3, 0.1);
    await L.rematchMember(engine(), 'near');
    expect(await L.answerMatch(db(), 'far', { assetId: 'p1', faceIndex: 0 }, 'reject')).toBe(true);
    await L.redecideFaces(engine(), [{ assetId: 'p1', faceIndex: 0 }]);
    expect(matches().map((m) => [m.user_id, m.state])).toEqual([
      ['far', 'rejected'],
      ['near', 'pending'],
    ]);
  });

  it("deletes the former holder's crop of a face that moved, and keeps the crop of a face still held", async () => {
    const { memberCropDir } = await import('#lib/server/face-crop.ts');
    // The suggested band: an auto face would be sticky and never move.
    enrol('far', ALICE, 3, 0.55);
    enrol('bob', BOB);
    await store([
      ['p1', 0, ALICE],
      ['p2', 0, BOB],
    ]);
    // Crops as the confirmation screen caches them, one per held face.
    const crop = (member: string, file: string) => join(memberCropDir(member), file);
    for (const [member, file] of [
      ['far', 'p1_0.webp'],
      ['bob', 'p2_0.webp'],
    ]) {
      mkdirSync(memberCropDir(member), { recursive: true });
      writeFileSync(crop(member, file), 'crop');
    }
    try {
      enrol('near', ALICE, 3, 0.1);
      await L.rematchMember(engine(), 'near');
      expect(matches().map((m) => [m.asset_id, m.user_id])).toEqual([
        ['p1', 'near'],
        ['p2', 'bob'],
      ]);
      // The face left `far`: its picture of someone else's face goes with it.
      expect(existsSync(crop('far', 'p1_0.webp'))).toBe(false);
      expect(existsSync(crop('bob', 'p2_0.webp'))).toBe(true);
    } finally {
      for (const member of ['far', 'bob'])
        rmSync(memberCropDir(member), { recursive: true, force: true });
    }
  });

  it('keeps an auto face its member no longer reaches when their references change (sticky)', async () => {
    enrol('alice', ALICE, 3, 0.4);
    await store([['p1', 0, ALICE]]);
    expect(matches().map((m) => m.band)).toEqual(['auto']);
    refs.eraseFaceReferences(db(), 'alice');
    for (let i = 0; i < 3; i++)
      refs.addFaceReference(db(), key, 'alice', 'photo', synthetic(500 + i));
    await L.rematchMember(engine(), 'alice');
    expect(matches().map((m) => [m.user_id, m.band, m.state])).toEqual([
      ['alice', 'auto', 'pending'],
    ]);
  });

  it('drops a suggested face that a member no longer reaches when their references change', async () => {
    enrol('alice', ALICE, 3, 0.55);
    await store([['p1', 0, ALICE]]);
    expect(matches()).toHaveLength(1);
    const { memberCropDir } = await import('#lib/server/face-crop.ts');
    const crop = join(memberCropDir('alice'), 'p1_0.webp');
    mkdirSync(memberCropDir('alice'), { recursive: true });
    writeFileSync(crop, 'crop');
    try {
      refs.eraseFaceReferences(db(), 'alice');
      for (let i = 0; i < 3; i++)
        refs.addFaceReference(db(), key, 'alice', 'photo', synthetic(500 + i));
      await L.rematchMember(engine(), 'alice');
      expect(matches()).toHaveLength(0);
      // Matched to nobody now: the crop of it goes too.
      expect(existsSync(crop)).toBe(false);
    } finally {
      rmSync(memberCropDir('alice'), { recursive: true, force: true });
    }
  });

  it('never writes a match for a member whose references went during the decision', async () => {
    enrol('alice', ALICE);
    await store([]);
    const snapshot = engineMod.snapshotMembers(engine());
    refs.eraseFaceReferences(db(), 'alice');
    await engineMod.runExclusive(() =>
      engineMod.recordDecisions(engine(), snapshot, [
        { assetId: 'p9', faceIndex: 0, embedding: ALICE },
      ])
    );
    expect(matches()).toHaveLength(0);
  });

  it('never writes a match decided on withdrawn references that a re-enrolment replaced under the same ids', async () => {
    enrol('alice', ALICE);
    await store([]);
    const before = (
      db()
        .prepare("SELECT group_concat(id) AS ids FROM face_references WHERE user_id = 'alice'")
        .get() as {
        ids: string;
      }
    ).ids;
    const snapshot = engineMod.snapshotMembers(engine());
    // Withdraw, then enrol again with a different face: INTEGER PRIMARY KEY without
    // AUTOINCREMENT hands the same ids back, so only the seal tells the two sets apart.
    refs.eraseFaceReferences(db(), 'alice');
    for (let i = 0; i < 3; i++)
      refs.addFaceReference(db(), key, 'alice', 'photo', atDistance(BOB, synthetic(600 + i), 0.2));
    const after = (
      db()
        .prepare("SELECT group_concat(id) AS ids FROM face_references WHERE user_id = 'alice'")
        .get() as {
        ids: string;
      }
    ).ids;
    expect(after).toBe(before);
    await engineMod.runExclusive(() =>
      engineMod.recordDecisions(engine(), snapshot, [
        { assetId: 'p9', faceIndex: 0, embedding: ALICE },
      ])
    );
    // Decided against the CURRENT references (Bob's face), Alice's old face matches nobody.
    expect(matches()).toHaveLength(0);
  });

  it('refuses every mutation outside the lock', async () => {
    enrol('alice', ALICE);
    expect(() => engineMod.redecideFaces(engine(), [])).toThrow(/runExclusive/);
    expect(() => engineMod.removeAssetFaces(engine(), 'p1')).toThrow(/runExclusive/);
    expect(() =>
      engineMod.answerMatch(db(), 'alice', { assetId: 'p1', faceIndex: 0 }, 'confirm')
    ).toThrow(/runExclusive/);
    await expect(engineMod.rematchAll(engine())).rejects.toThrow(/runExclusive/);
    // Nested inside the lock, an engine call runs at once instead of waiting for itself.
    await engineMod.runExclusive(() =>
      engineMod.runExclusive(() => engineMod.rematchAll(engine()))
    );
  });

  it('suggests, never auto-accepts, on fewer than three references', async () => {
    enrol('thin', ALICE, 1, 0.1);
    await store([['p1', 0, ALICE]]);
    expect(matches()[0]).toMatchObject({ user_id: 'thin', band: 'suggested' });
  });

  it('decides every stored face at once (the seed)', async () => {
    await store([
      ['p1', 0, ALICE],
      ['p2', 0, BOB],
      ['p3', 0, atDistance(BOB, synthetic(9), 0.3)],
    ]);
    enrol('alice', ALICE, 3, 0.05);
    enrol('bob', BOB, 3, 0.05);
    const result = await L.rematchAll(engine());
    expect(result).toMatchObject({ auto: 3, none: 0 });
    expect(matches().map((m) => [m.asset_id, m.user_id])).toEqual([
      ['p1', 'alice'],
      ['p2', 'bob'],
      ['p3', 'bob'],
    ]);
  });

  it('runs one operation at a time, in order', async () => {
    const order: string[] = [];
    const slow = engineMod.runExclusive(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('slow');
    });
    const fast = engineMod.runExclusive(() => {
      order.push('fast');
    });
    const failing = engineMod.runExclusive(() => {
      throw new Error('x');
    });
    const after = engineMod.runExclusive(() => order.push('after'));
    await Promise.all([slow, fast, failing.catch(() => undefined), after]);
    expect(order).toEqual(['slow', 'fast', 'after']);
  });
});

describe('erasure of matches (A4 into the A1 path)', () => {
  it('deletes every match of a withdrawing member in the same transaction, and re-decides what they held', async () => {
    seeded();
    enrol('alice', ALICE, 3, 0.2);
    enrol('twin', ALICE, 3, 0.35);
    library.set('p1', [ALICE]);
    library.set('p2', [atDistance(ALICE, synthetic(3), 0.1)]);
    await ingestAll(['p1', 'p2']);
    await L.answerMatch(db(), 'alice', { assetId: 'p2', faceIndex: 0 }, 'reject');
    const local = erasure.inTransaction(db(), () =>
      erasure.eraseLocalFaceData(db(), 'alice', 'withdrawal')
    );
    expect(local.heldFaces).toEqual([
      { assetId: 'p1', faceIndex: 0 },
      { assetId: 'p2', faceIndex: 0 },
    ]);
    expect(matches().filter((m) => m.user_id === 'alice')).toEqual([]);
    expect(refs.loadFaceReferences(db(), key, 'alice')).toHaveLength(0);
    erasure.finishLocalErasure(local);
    await engineMod.runExclusive(() => undefined);
    expect(
      matches()
        .filter((m) => m.state === 'pending')
        .map((m) => [m.asset_id, m.user_id])
    ).toEqual([
      ['p1', 'twin'],
      ['p2', 'twin'],
    ]);
  });

  it('takes the matches with an account deletion', async () => {
    seeded();
    enrol('alice', ALICE);
    library.set('p1', [ALICE]);
    await ingestAll(['p1']);
    expect(erasure.deleteUserAccount(db(), 'alice')).toBe(true);
    expect(matches()).toHaveLength(0);
  });

  it('erases matches on a withdrawal even when the member is already unlinked', async () => {
    seeded();
    enrol('alice', ALICE);
    library.set('p1', [ALICE]);
    await ingestAll(['p1']);
    const link = await import('#lib/server/face-link.ts');
    const result = erasure.inTransaction(db(), () =>
      link.applyFaceLink(db(), 'alice', null, { source: 'selfie', unlinkReason: 'withdrawal' })
    );
    expect(result.local?.heldFaces).toEqual([{ assetId: 'p1', faceIndex: 0 }]);
    expect(matches()).toHaveLength(0);
  });
});

describe('enrolment and answers (A5)', () => {
  let enrolment: typeof import('#lib/server/face-enrolment.ts');

  beforeAll(async () => {
    enrolment = await import('#lib/server/face-enrolment.ts');
  });
  beforeEach(() => {
    db().exec('DELETE FROM face_consents;');
  });

  function refRows(id: string) {
    return db()
      .prepare('SELECT source FROM face_references WHERE user_id = ? ORDER BY id')
      .all(id) as Array<{ source: string }>;
  }
  function openConsents(id: string) {
    return (
      db()
        .prepare(
          'SELECT COUNT(*) AS n FROM face_consents WHERE user_id = ? AND withdrawn_at IS NULL'
        )
        .get(id) as { n: number }
    ).n;
  }
  async function storeOne(assetId: string, v: Float32Array) {
    seeded();
    library.set(assetId, [v]);
    await ingestAll([assetId]);
  }

  it('records the consent and the selfie, and a new selfie replaces the old one', () => {
    addUser('alice');
    expect(enrolment.enrolMember(engine(), 'alice', ALICE)).toBe(1);
    expect(openConsents('alice')).toBe(1);
    expect(enrolment.enrolMember(engine(), 'alice', atDistance(ALICE, synthetic(5), 0.1))).toBe(1);
    expect(refRows('alice')).toEqual([{ source: 'selfie' }]);
    expect(openConsents('alice')).toBe(1);
  });

  it("closes an open legacy consent and opens the member's own, with the reference", async () => {
    const { TERMS_VERSION } = await import('#lib/legal.ts');
    addUser('alice');
    db()
      .prepare(
        "INSERT INTO face_consents (user_id, created_at, version, source) VALUES ('alice', 1, 'legacy', 'legacy')"
      )
      .run();
    // One transaction: a reference that cannot be written leaves the consent as it was.
    expect(() => enrolment.enrolMember(engine(), 'alice', new Float32Array(3), 4000)).toThrow();
    expect(
      db().prepare("SELECT source, withdrawn_at FROM face_consents WHERE user_id = 'alice'").all()
    ).toEqual([{ source: 'legacy', withdrawn_at: null }]);
    enrolment.enrolMember(engine(), 'alice', ALICE, 5000);
    expect(
      db()
        .prepare(
          "SELECT source, version, created_at, withdrawn_at FROM face_consents WHERE user_id = 'alice' ORDER BY id"
        )
        .all()
    ).toEqual([
      { source: 'legacy', version: 'legacy', created_at: 1, withdrawn_at: 5000 },
      { source: 'selfie', version: TERMS_VERSION, created_at: 5000, withdrawn_at: null },
    ]);
    expect(refRows('alice')).toEqual([{ source: 'selfie' }]);
  });

  it('makes room for a selfie at the cap by the older of the two most redundant references', async () => {
    const { FACE_MAX_REFERENCES } = await import('#lib/face-embedding.ts');
    addUser('alice');
    const varied = (i: number) => atDistance(ALICE, synthetic(300 + i), 0.2);
    // A cap of varied references, one of which (row 4) a newer near-copy duplicates.
    for (let i = 0; i < FACE_MAX_REFERENCES - 1; i++)
      refs.addFaceReference(db(), key, 'alice', 'photo', varied(i), 1000 + i, {
        takenAt: 1000 + i,
      });
    refs.addFaceReference(db(), key, 'alice', 'photo', atDistance(varied(4), ALICE, 0.01), 5000, {
      takenAt: 5000,
    });
    const ids = () =>
      (
        db()
          .prepare('SELECT id, taken_at FROM face_references WHERE user_id = ? ORDER BY id')
          .all('alice') as Array<{ id: number; taken_at: number }>
      ).map((r) => r.taken_at);
    expect(enrolment.enrolMember(engine(), 'alice', ALICE)).toBe(FACE_MAX_REFERENCES);
    // The older of the closest pair went (1004); its newer copy (5000) stayed; nothing else moved.
    expect(ids()).not.toContain(1004);
    expect(ids()).toContain(5000);
    expect(ids()).toHaveLength(FACE_MAX_REFERENCES);
    expect(refRows('alice').at(-1)?.source).toBe('selfie');
  });

  it('learns a confirmed face as a reference and re-matches the member', async () => {
    addUser('alice');
    enrolment.enrolMember(engine(), 'alice', ALICE);
    await storeOne('p1', atDistance(ALICE, synthetic(7), 0.3));
    expect(matches()).toEqual([
      { asset_id: 'p1', face_index: 0, user_id: 'alice', band: 'suggested', state: 'pending' },
    ]);
    const outcome = await enrolment.answerFace(
      engine(),
      'alice',
      { assetId: 'p1', faceIndex: 0 },
      'confirm'
    );
    expect(outcome).toBe('learned');
    expect(refRows('alice').map((r) => r.source)).toEqual(['selfie', 'photo']);
    expect(matches()[0].state).toBe('confirmed');
  });

  it('re-matches the store with what it learned, in the background', async () => {
    addUser('alice');
    enrolment.enrolMember(engine(), 'alice', ALICE);
    // Within the auto distance of the selfie, but `suggested`: one reference is a thin enrolment.
    const p1 = atDistance(ALICE, synthetic(7), 0.45);
    // p2 sits beside p1 and AWAY from the selfie: only the learned reference reaches it.
    const p2 = atDistance(
      p1,
      Float32Array.from(ALICE, (v) => -v),
      0.1
    );
    seeded();
    library.set('p1', [p1]);
    library.set('p2', [p2]);
    await ingestAll(['p1', 'p2']);
    expect(matches().map((m) => m.asset_id)).toEqual(['p1']);
    // The answer is queued first, then a job that holds the engine until released: the re-match
    // the answer queues lands BEHIND it. The answer must resolve without it (no scan awaited in
    // the request), and the store is re-matched once the engine is free.
    const answered = enrolment.answerFace(
      engine(),
      'alice',
      { assetId: 'p1', faceIndex: 0 },
      'confirm'
    );
    let release: (() => void) | null = null;
    const held = engineMod.runExclusive(
      () =>
        new Promise<void>((r) => {
          release = r;
        })
    );
    expect(await answered).toBe('learned');
    while (!release) await new Promise((r) => setImmediate(r));
    expect(matches().map((m) => [m.asset_id, m.state])).toEqual([['p1', 'confirmed']]);
    (release as unknown as () => void)();
    await held;
    await engineMod.runExclusive(() => undefined);
    expect(matches().map((m) => [m.asset_id, m.state])).toEqual([
      ['p1', 'confirmed'],
      ['p2', 'pending'],
    ]);
  });

  it('confirms a face in the suggested band, shows it, and never learns it', async () => {
    addUser('alice');
    enrolment.enrolMember(engine(), 'alice', ALICE);
    await storeOne('p1', atDistance(ALICE, synthetic(7), 0.55));
    expect(matches()).toEqual([
      { asset_id: 'p1', face_index: 0, user_id: 'alice', band: 'suggested', state: 'pending' },
    ]);
    const outcome = await enrolment.answerFace(
      engine(),
      'alice',
      { assetId: 'p1', faceIndex: 0 },
      'confirm'
    );
    expect(outcome).toBe('confirmed');
    expect(refRows('alice').map((r) => r.source)).toEqual(['selfie']);
    expect(matches()[0].state).toBe('confirmed');
  });

  it("learns only within the auto distance, the matcher's own bound, inclusive", async () => {
    const { FACE_AUTO_MAX_DISTANCE } = await import('#lib/face-embedding.ts');
    expect(enrolment.learnable(FACE_AUTO_MAX_DISTANCE)).toBe(true);
    // The next double above the bound.
    const above = FACE_AUTO_MAX_DISTANCE + Number.EPSILON * FACE_AUTO_MAX_DISTANCE;
    expect(above).toBeGreaterThan(FACE_AUTO_MAX_DISTANCE);
    expect(enrolment.learnable(above)).toBe(false);
    expect(enrolment.learnable(Number.NaN)).toBe(false);
    // Through the store (float16 round-trips), either side of the bound.
    addUser('alice');
    enrolment.enrolMember(engine(), 'alice', ALICE);
    seeded();
    library.set('near', [atDistance(ALICE, synthetic(7), FACE_AUTO_MAX_DISTANCE - 0.01)]);
    library.set('far', [atDistance(ALICE, synthetic(8), FACE_AUTO_MAX_DISTANCE + 0.01)]);
    await ingestAll(['near', 'far']);
    expect(matches().map((m) => m.asset_id)).toEqual(['far', 'near']);
    const answer = (assetId: string) =>
      enrolment.answerFace(engine(), 'alice', { assetId, faceIndex: 0 }, 'confirm');
    expect(await answer('far')).toBe('confirmed');
    expect(await answer('near')).toBe('learned');
    await engineMod.runExclusive(() => undefined);
    expect(refRows('alice').map((r) => r.source)).toEqual(['selfie', 'photo']);
  });

  it('at the cap, renews toward a recent photo and does not learn an old duplicate', async () => {
    const { FACE_MAX_REFERENCES } = await import('#lib/face-embedding.ts');
    addUser('alice');
    const varied = (i: number) => atDistance(ALICE, synthetic(300 + i), 0.2);
    for (let i = 0; i < FACE_MAX_REFERENCES; i++)
      refs.addFaceReference(db(), key, 'alice', 'photo', varied(i), 1000 + i, {
        takenAt: 1000 + i,
      });
    const takenAts = () =>
      (
        db()
          .prepare('SELECT taken_at FROM face_references WHERE user_id = ? ORDER BY taken_at')
          .all('alice') as Array<{ taken_at: number }>
      ).map((r) => r.taken_at);
    // Near-copies of reference 3: the new face and reference 3 are the closest pair.
    seeded();
    library.set('old', [atDistance(varied(3), ALICE, 0.01)]);
    library.set('new', [atDistance(varied(3), ALICE, 0.012)]);
    await ingestAll(['old', 'new']);
    const answer = (assetId: string, takenAt: number) =>
      enrolment.answerFace(engine(), 'alice', { assetId, faceIndex: 0 }, 'confirm', { takenAt });
    // An OLD photo duplicating a reference: it would be the one dropped, so nothing changes.
    expect(await answer('old', 10)).toBe('confirmed');
    expect(takenAts()).toHaveLength(FACE_MAX_REFERENCES);
    expect(takenAts()).not.toContain(10);
    // A RECENT one replaces the older of the pair: the set moves toward the newer photo.
    expect(await answer('new', 9000)).toBe('learned');
    await engineMod.runExclusive(() => undefined);
    expect(takenAts()).toHaveLength(FACE_MAX_REFERENCES);
    expect(takenAts()).toContain(9000);
    expect(takenAts()).not.toContain(1003);
  });

  it('hands a rejected face to the next member at once', async () => {
    enrol('alice', ALICE, 3, 0.2);
    enrol('twin', ALICE, 3, 0.35);
    await storeOne('p1', ALICE);
    const outcome = await enrolment.answerFace(
      engine(),
      'alice',
      { assetId: 'p1', faceIndex: 0 },
      'reject'
    );
    expect(outcome).toBe('rejected');
    expect(matches().map((m) => [m.user_id, m.state])).toEqual([
      ['alice', 'rejected'],
      ['twin', 'pending'],
    ]);
  });

  it('refuses an answer on a face the member does not hold, and on one already answered', async () => {
    enrol('alice', ALICE);
    enrol('bob', BOB);
    await storeOne('p1', ALICE);
    const face = { assetId: 'p1', faceIndex: 0 };
    expect(await enrolment.answerFace(engine(), 'bob', face, 'confirm')).toBe('not_held');
    expect(await enrolment.answerFace(engine(), 'alice', face, 'reject')).toBe('rejected');
    expect(await enrolment.answerFace(engine(), 'alice', face, 'confirm')).toBe('not_held');
  });

  it('withdraws a member enrolled by selfie alone: consent, references and matches, at once', async () => {
    addUser('alice');
    enrolment.enrolMember(engine(), 'alice', ALICE);
    await storeOne('p1', ALICE);
    expect(matches()).toHaveLength(1);
    const link = await import('#lib/server/face-link.ts');
    const result = erasure.inTransaction(db(), () =>
      link.applyFaceLink(db(), 'alice', null, { source: 'selfie', unlinkReason: 'withdrawal' })
    );
    expect(openConsents('alice')).toBe(0);
    expect(refRows('alice')).toHaveLength(0);
    expect(matches()).toHaveLength(0);
    expect(result.local?.erasure).toBeNull();
  });
});

describe('background re-matches, coalesced per member (A5)', () => {
  /** A queue whose runs are counted per key and held until released. */
  function harness() {
    const errors: unknown[] = [];
    const queue = new engineMod.CoalescingQueue('test', (e) => errors.push(e));
    const runs: string[] = [];
    let release: (() => void) | null = null;
    const run = (key: string) => () =>
      new Promise<void>((resolve) => {
        runs.push(key);
        release = resolve;
      });
    const finish = () => {
      const r = release;
      release = null;
      r?.();
    };
    return { queue, runs, run, finish, errors };
  }
  const settle = () => engineMod.runExclusive(() => undefined);

  it('runs N requests queued together once', async () => {
    const h = harness();
    const promises = Array.from({ length: 5 }, () => h.queue.request('alice', h.run('alice')));
    expect(new Set(promises).size).toBe(1);
    expect(h.queue.isQueued('alice')).toBe(true);
    await Promise.resolve();
    await new Promise((r) => setImmediate(r));
    h.finish();
    await promises[0];
    expect(h.runs).toEqual(['alice']);
    expect(h.queue.isQueued('alice')).toBe(false);
  });

  it('runs exactly once more for requests arriving while a run is in progress', async () => {
    const h = harness();
    const first = h.queue.request('alice', h.run('alice'));
    // Wait until the run has started (it is holding the engine).
    while (h.runs.length === 0) await new Promise((r) => setImmediate(r));
    expect(h.queue.isQueued('alice')).toBe(false);
    const during = Array.from({ length: 4 }, () => h.queue.request('alice', h.run('alice')));
    expect(new Set(during).size).toBe(1);
    h.finish();
    await first;
    while (h.runs.length === 1) await new Promise((r) => setImmediate(r));
    h.finish();
    await during[0];
    await settle();
    expect(h.runs).toEqual(['alice', 'alice']);
    expect(h.errors).toEqual([]);
  });

  it('keeps members apart, and reports a failed run without rejecting', async () => {
    const h = harness();
    const a = h.queue.request('alice', async () => {
      h.runs.push('alice');
      throw new Error('boom');
    });
    const b = h.queue.request('bob', async () => {
      h.runs.push('bob');
    });
    await expect(a).resolves.toBeUndefined();
    await b;
    expect(h.runs).toEqual(['alice', 'bob']);
    expect(h.errors).toHaveLength(1);
  });

  it('joins every re-match of one member requested while the engine is busy into one', async () => {
    const enrolment = await import('#lib/server/face-enrolment.ts');
    enrol('alice', ALICE);
    let release: (() => void) | null = null;
    const held = engineMod.runExclusive(
      () =>
        new Promise<void>((r) => {
          release = r;
        })
    );
    while (!release) await new Promise((r) => setImmediate(r));
    const requests = Array.from({ length: 20 }, () => enrolment.scheduleRematch(engine(), 'alice'));
    expect(new Set(requests).size).toBe(1);
    (release as unknown as () => void)();
    await held;
    await Promise.all(requests);
  });
});

describe('faces v2: negatives, sticky auto and the re-selection (owner, 2026-11-01)', () => {
  let enrolment: typeof import('#lib/server/face-enrolment.ts');
  let negatives: typeof import('#lib/server/face-negatives.ts');
  let upgrade: typeof import('#lib/server/face-reference-upgrade.ts');
  let embedding: typeof import('#lib/face-embedding.ts');

  beforeAll(async () => {
    enrolment = await import('#lib/server/face-enrolment.ts');
    negatives = await import('#lib/server/face-negatives.ts');
    upgrade = await import('#lib/server/face-reference-upgrade.ts');
    embedding = await import('#lib/face-embedding.ts');
  });
  beforeEach(() => {
    db().exec(
      'DELETE FROM face_negatives; DELETE FROM face_reference_selection; DELETE FROM face_consents;'
    );
  });

  async function storeFaces(faces: Record<string, Float32Array>) {
    seeded();
    for (const [assetId, v] of Object.entries(faces)) library.set(assetId, [v]);
    await ingestAll(Object.keys(faces));
  }

  it('keeps "not me" as a sealed negative and withholds its waiting lookalike, reported as released', async () => {
    addUser('alice');
    enrolment.enrolMember(engine(), 'alice', ALICE);
    const p1 = atDistance(ALICE, synthetic(7), 0.55);
    await storeFaces({
      p1,
      // Beside p1, as far from the selfie: the same stranger, in another photo.
      p2: atDistance(p1, synthetic(8), 0.02),
      // Another face in the band, nowhere near p1: still asked.
      p3: atDistance(ALICE, synthetic(9), 0.56),
    });
    expect(matches().map((m) => [m.asset_id, m.band])).toEqual([
      ['p1', 'suggested'],
      ['p2', 'suggested'],
      ['p3', 'suggested'],
    ]);
    const released: Array<{ assetId: string; faceIndex: number }> = [];
    expect(
      await enrolment.answerFace(engine(), 'alice', { assetId: 'p1', faceIndex: 0 }, 'reject', {
        released,
      })
    ).toBe('rejected');
    expect(released).toEqual([{ assetId: 'p2', faceIndex: 0 }]);
    expect(matches().map((m) => [m.asset_id, m.state])).toEqual([
      ['p1', 'rejected'],
      ['p3', 'pending'],
    ]);
    expect(negatives.negativeCount(db(), 'alice')).toBe(1);
    // Sealed under its own context: it never opens as one of her references.
    const { sealed } = db().prepare('SELECT sealed FROM face_negatives').get() as {
      sealed: Uint8Array;
    };
    const seal = await import('#lib/server/face-seal.ts');
    expect(() =>
      seal.unseal(key, seal.referenceContext('alice', embedding.FACE_MODEL), sealed)
    ).toThrow();
  });

  it('"C\'est moi" on a face that is learned promotes its waiting lookalike, reported as promoted', async () => {
    addUser('alice');
    enrolment.enrolMember(engine(), 'alice', ALICE);
    refs.addFaceReference(db(), key, 'alice', 'photo', atDistance(ALICE, synthetic(6), 0.2));
    const c1 = atDistance(ALICE, synthetic(7), 0.3);
    await storeFaces({
      c1,
      // Beside c1: the same person in another photo.
      c2: atDistance(c1, synthetic(8), 0.02),
      // Another face in the band, nowhere near c1: still asked.
      c3: atDistance(ALICE, synthetic(9), 0.56),
    });
    // Two references only: every face is held back as suggested.
    expect(new Set(matches().map((m) => m.band))).toEqual(new Set(['suggested']));
    const promoted: Array<{ assetId: string; faceIndex: number }> = [];
    const released: Array<{ assetId: string; faceIndex: number }> = [];
    expect(
      await enrolment.answerFace(engine(), 'alice', { assetId: 'c1', faceIndex: 0 }, 'confirm', {
        promoted,
        released,
      })
    ).toBe('learned');
    // Three references now: c2 is theirs without a question, at once, before any re-match.
    expect(promoted).toEqual([{ assetId: 'c2', faceIndex: 0 }]);
    expect(released).toEqual([]);
    expect(matches().map((m) => [m.asset_id, m.band, m.state])).toEqual([
      ['c1', 'suggested', 'confirmed'],
      ['c2', 'auto', 'pending'],
      ['c3', 'suggested', 'pending'],
    ]);
  });

  it('"Pas moi" on a face shown WITHOUT a question: it leaves her photos, kept as a negative, the other auto faces stay', async () => {
    // Three references near her: the auto band needs more than a lone selfie.
    enrol('alice', ALICE, 3, 0.1);
    await storeFaces({
      p1: atDistance(ALICE, synthetic(7), 0.1),
      p2: atDistance(ALICE, synthetic(11), 0.1),
    });
    expect(matches().map((m) => [m.asset_id, m.band, m.state])).toEqual([
      ['p1', 'auto', 'pending'],
      ['p2', 'auto', 'pending'],
    ]);
    expect(
      await enrolment.answerFace(engine(), 'alice', { assetId: 'p1', faceIndex: 0 }, 'reject')
    ).toBe('rejected');
    expect(matches().map((m) => [m.asset_id, m.band, m.state])).toEqual([
      ['p1', 'auto', 'rejected'],
      ['p2', 'auto', 'pending'],
    ]);
    expect(negatives.negativeCount(db(), 'alice')).toBe(1);
    // Never offered again: a full re-match keeps her answer.
    await L.rematchMember(engine(), 'alice');
    expect(matches().map((m) => [m.asset_id, m.state])).toEqual([
      ['p1', 'rejected'],
      ['p2', 'pending'],
    ]);
  });

  it('never withholds a face from another member on the negative of someone else', async () => {
    addUser('alice');
    enrolment.enrolMember(engine(), 'alice', ALICE);
    const p1 = atDistance(ALICE, synthetic(7), 0.55);
    await storeFaces({ p1 });
    await enrolment.answerFace(engine(), 'alice', { assetId: 'p1', faceIndex: 0 }, 'reject');
    // Carol enrols near the stranger; her face p2 sits beside the negative of alice.
    enrol('carol', p1, 3, 0.2);
    await storeFaces({ p2: atDistance(p1, synthetic(8), 0.02) });
    await L.rematchMember(engine(), 'carol');
    expect(
      matches()
        .filter((m) => m.asset_id === 'p2')
        .map((m) => m.user_id)
    ).toEqual(['carol']);
  });

  it('deletes the negatives and the selection marker on withdrawal', async () => {
    addUser('alice');
    enrolment.enrolMember(engine(), 'alice', ALICE);
    await storeFaces({ p1: atDistance(ALICE, synthetic(7), 0.55) });
    await enrolment.answerFace(engine(), 'alice', { assetId: 'p1', faceIndex: 0 }, 'reject');
    db()
      .prepare(
        'INSERT INTO face_reference_selection (user_id, model, version, selected_at) VALUES (?, ?, 2, 0)'
      )
      .run('alice', embedding.FACE_MODEL);
    expect(negatives.negativeCount(db(), 'alice')).toBe(1);
    erasure.eraseLocalFaceData(db(), 'alice', 'withdrawal');
    expect(negatives.negativeCount(db(), 'alice')).toBe(0);
    expect(db().prepare('SELECT COUNT(*) AS n FROM face_reference_selection').get()).toEqual({
      n: 0,
    });
  });

  it('holds thirty negatives, dropping the older of the two closest', () => {
    addUser('alice');
    const cap = embedding.FACE_MAX_NEGATIVES;
    expect(cap).toBe(30);
    const face = (i: number) => ({ assetId: `n${i}`, faceIndex: 0 });
    for (let i = 0; i < cap; i++)
      expect(negatives.addFaceNegative(db(), key, 'alice', face(i), synthetic(600 + i), i)).toBe(
        true
      );
    // A newer near-copy of negative 5: negative 5 goes.
    expect(
      negatives.addFaceNegative(
        db(),
        key,
        'alice',
        face(100),
        atDistance(synthetic(605), ALICE, 0.01),
        1000
      )
    ).toBe(true);
    const kept = () =>
      (
        db().prepare('SELECT asset_id FROM face_negatives ORDER BY id').all() as Array<{
          asset_id: string;
        }>
      ).map((r) => r.asset_id);
    expect(kept()).toHaveLength(cap);
    expect(kept()).not.toContain('n5');
    expect(kept()).toContain('n100');
    // An OLDER near-copy of negative 7 would itself be the one dropped: not kept.
    expect(
      negatives.addFaceNegative(
        db(),
        key,
        'alice',
        face(101),
        atDistance(synthetic(607), ALICE, 0.01),
        -1
      )
    ).toBe(false);
    expect(kept()).toHaveLength(cap);
  });

  it('lets a sticky auto face go when another member confirms it (claimFace)', async () => {
    enrol('far', ALICE, 3, 0.45);
    await storeFaces({ p1: ALICE });
    enrol('near', ALICE, 3, 0.1);
    await L.rematchMember(engine(), 'near');
    expect(matches().map((m) => m.user_id)).toEqual(['far']);
    const outcome = await engineMod.runExclusive(() =>
      engineMod.claimFace(engine(), 'near', { assetId: 'p1', faceIndex: 0, embedding: ALICE })
    );
    expect(outcome).toBe('claimed');
    expect(matches().map((m) => [m.user_id, m.state])).toEqual([['near', 'confirmed']]);
  });

  describe('the re-selection of existing members', () => {
    const refsOf = () =>
      db()
        .prepare(
          "SELECT source, asset_id, taken_at FROM face_references WHERE user_id = 'alice' ORDER BY id"
        )
        .all() as Array<{ source: string; asset_id: string | null; taken_at: number | null }>;

    /** Alice as the A7 seed left her: five near-identical references. */
    function seededAlice(): Float32Array[] {
      addUser('alice');
      const held = Array.from({ length: 5 }, (_, i) => atDistance(ALICE, synthetic(800 + i), 0.2));
      for (const v of held) refs.addFaceReference(db(), key, 'alice', 'seed', v);
      return held;
    }

    function setRow(assetId: string, band: string, state: string) {
      db().prepare('DELETE FROM face_matches WHERE asset_id = ? AND face_index = 0').run(assetId);
      db()
        .prepare(
          `INSERT INTO face_matches (asset_id, face_index, model, user_id, distance, runner_up, band,
             state, created_at, decided_at) VALUES (?, 0, ?, 'alice', 0.3, NULL, ?, ?, 1, NULL)`
        )
        .run(assetId, embedding.FACE_MODEL, band, state);
    }

    it('learns only proven faces, with their source and capture date, once', async () => {
      const held = seededAlice();
      await storeFaces({
        conf45: atDistance(held[0], synthetic(901), 0.45),
        auto45: atDistance(held[1], synthetic(902), 0.45),
        auto35: atDistance(held[2], synthetic(903), 0.35),
        sugg30: atDistance(held[3], synthetic(904), 0.3),
        conf60: atDistance(held[4], synthetic(905), 0.6),
      });
      setRow('conf45', 'suggested', 'confirmed');
      setRow('auto45', 'auto', 'pending');
      setRow('auto35', 'auto', 'pending');
      setRow('sugg30', 'suggested', 'pending');
      setRow('conf60', 'suggested', 'confirmed');
      expect(upgrade.membersToUpgrade(db())).toEqual(['alice']);
      const result = upgrade.reselectReferences(engine(), 'alice', new Map([['conf45', 5000]]), 9);
      expect(result).toMatchObject({ outcome: 'upgraded', added: 2, dropped: 0, references: 7 });
      // A confirmed face within 0.5 and an auto face within 0.4; not the auto at 0.45, not the
      // pending suggestion, not the confirmed lookalike at 0.6. The photo of auto35 has no date.
      expect(
        refsOf()
          .filter((r) => r.asset_id !== null)
          .sort((a, b) => String(a.asset_id).localeCompare(String(b.asset_id)))
      ).toEqual([
        { source: 'matched', asset_id: 'auto35', taken_at: null },
        { source: 'photo', asset_id: 'conf45', taken_at: 5000 },
      ]);
      expect(upgrade.reselectReferences(engine(), 'alice', new Map()).outcome).toBe('already');
      expect(upgrade.membersToUpgrade(db())).toEqual([]);
    });

    it('skips a member with no reference, and keeps the selfie whatever the cap', async () => {
      addUser('bob');
      expect(upgrade.reselectReferences(engine(), 'bob', new Map()).outcome).toBe('no_references');
      expect(upgrade.membersToUpgrade(db())).toEqual([]);
      addUser('alice');
      enrolment.enrolMember(engine(), 'alice', ALICE);
      const faces: Record<string, Float32Array> = {};
      for (let i = 0; i < 20; i++) faces[`a${i}`] = atDistance(ALICE, synthetic(700 + i), 0.3);
      await storeFaces(faces);
      for (const id of Object.keys(faces)) setRow(id, 'auto', 'pending');
      const result = upgrade.reselectReferences(engine(), 'alice', new Map());
      expect(result.references).toBe(embedding.FACE_MAX_REFERENCES);
      expect(refsOf().filter((r) => r.source === 'selfie')).toHaveLength(1);
    });

    it('turns a suggestion beside a proven face into an auto match', async () => {
      const held = seededAlice();
      const proven = atDistance(held[0], synthetic(901), 0.38);
      // Moved straight AWAY from the reference it is proven by: 0.55 from it, 0.02 from proven.
      const beside = atDistance(
        proven,
        Float32Array.from(held[0], (v) => -v),
        0.02
      );
      await storeFaces({ proven, beside });
      setRow('proven', 'auto', 'pending');
      expect(matches().find((m) => m.asset_id === 'beside')?.band).toBe('suggested');
      upgrade.reselectReferences(engine(), 'alice', new Map());
      await L.rematchMember(engine(), 'alice');
      expect(matches().find((m) => m.asset_id === 'beside')?.band).toBe('auto');
    });

    it('bootstraps a member with a lone selfie from the unambiguous suggestions nearest it', async () => {
      addUser('alice');
      enrolment.enrolMember(engine(), 'alice', ALICE);
      await storeFaces({
        near30: atDistance(ALICE, synthetic(911), 0.3),
        near35: atDistance(ALICE, synthetic(912), 0.35),
        near38: atDistance(ALICE, synthetic(913), 0.38),
        far45: atDistance(ALICE, synthetic(914), 0.45),
        twin: atDistance(ALICE, synthetic(915), 0.3),
      });
      // The lone selfie holds EVERY face back as suggested (fewer than FACE_MIN_REFERENCES).
      expect(new Set(matches().map((m) => m.band))).toEqual(new Set(['suggested']));
      // A lookalike member was 0.02 behind at the decision: ambiguous, never proof.
      db()
        .prepare("UPDATE face_matches SET runner_up = distance + 0.02 WHERE asset_id = 'twin'")
        .run();
      expect(upgrade.membersToUpgrade(db())).toEqual(['alice']);
      const result = upgrade.reselectReferences(engine(), 'alice', new Map());
      // Within 0.4 and unambiguous: three. Not the one at 0.45, not the twin.
      expect(result).toMatchObject({ outcome: 'upgraded', added: 3, dropped: 0, references: 4 });
      expect(
        refsOf()
          .filter((r) => r.asset_id !== null)
          .map((r) => [r.source, r.asset_id])
          .sort()
      ).toEqual([
        ['matched', 'near30'],
        ['matched', 'near35'],
        ['matched', 'near38'],
      ]);
      // Proof for the selection only: nothing was shown by it. The re-match, with four references,
      // then finds the faces within the auto distance auto, the twin included (no other member).
      expect(new Set(matches().map((m) => m.band))).toEqual(new Set(['suggested']));
      await L.rematchMember(engine(), 'alice');
      expect(Object.fromEntries(matches().map((m) => [m.asset_id, m.band]))).toMatchObject({
        near30: 'auto',
        far45: 'auto',
        twin: 'auto',
      });
    });

    it('only marks a member already at the minimum that an earlier version selected', async () => {
      seededAlice();
      db()
        .prepare(
          'INSERT INTO face_reference_selection (user_id, model, version, selected_at) VALUES (?, ?, 2, 1)'
        )
        .run('alice', embedding.FACE_MODEL);
      expect(upgrade.membersToUpgrade(db())).toEqual(['alice']);
      const result = upgrade.reselectReferences(engine(), 'alice', new Map());
      expect(result).toMatchObject({ outcome: 'already', added: 0, dropped: 0 });
      expect(refsOf()).toHaveLength(5);
      expect(upgrade.membersToUpgrade(db())).toEqual([]);
    });
  });
});
