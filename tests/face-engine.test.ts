/**
 * Lots A3 and A4 of the face store (docs/wiki/face-matching-option-c.md): ingestion into faces.db,
 * the match engine, and the erasure of a member's matches. SYNTHETIC vectors only; Immich and the
 * model service are fakes answering from in-memory tables.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
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
let mlGarbage = false;
let missingPreview = new Set<string>();
const searchBodies: Array<Record<string, unknown>> = [];

const fakeFetch = (async (url: string, init?: RequestInit) => {
  const u = new URL(url);
  if (u.pathname === '/api/search/metadata') {
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
  mlGarbage = false;
  missingPreview = new Set();
  searchBodies.length = 0;
});

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

  it('counts a missing preview as an attempt, never as a deletion', async () => {
    seeded();
    missingPreview.add('p1');
    const result = await ingestAll(['p1']);
    expect(result.retry).toBe(1);
    expect(faceDb().prepare('SELECT state, last_error FROM face_assets').get()).toMatchObject({
      state: 'pending',
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

    // n1 deleted from Immich, n3 new: n1's faces and matches go, n3 is pending.
    listed = ['n2', 'n3'];
    const result = await ingest.reconcile(fakeFetch, engine());
    expect(result).toMatchObject({ listed: 2, added: 1, removed: 1, refused: null });
    expect(searchBodies.at(-1)).toMatchObject({ withDeleted: true });
    expect(matches()).toHaveLength(0);
    expect(
      faceDb().prepare("SELECT COUNT(*) AS n FROM face_embeddings WHERE asset_id = 'n1'").get()
    ).toEqual({ n: 0 });
  });

  it('removes nothing on a listing that names under half of what it knows', async () => {
    ingest.addPending(faceDb(), ['a', 'b', 'c', 'd', 'e'], 1);
    listed = ['a', 'b'];
    const result = await ingest.reconcile(fakeFetch, engine());
    expect(result.removed).toBe(0);
    expect(result.refused).toMatch(/2 assets against 5/);
    expect(faceDb().prepare('SELECT COUNT(*) AS n FROM face_assets').get()).toEqual({ n: 5 });
  });

  it('reports an unseeded store and an overdue backlog as errors with their cause', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(ingest.reportIngest(faceDb(), null).seeded).toBe(false);
    expect(errors).toHaveBeenCalledTimes(1);
    seeded();
    ingest.addPending(faceDb(), ['x'], 0);
    ingest.reportIngest(faceDb(), null, ingest.INGEST_OVERDUE_MS - 1);
    expect(errors).toHaveBeenCalledTimes(1); // a day-old backlog is not yet an error
    const report = ingest.reportIngest(faceDb(), 'ml_unavailable', ingest.INGEST_OVERDUE_MS + 1);
    expect(errors).toHaveBeenCalledTimes(2);
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
    expect(engineMod.answerMatch(db(), 'alice', { assetId: 'p1', faceIndex: 0 }, 'confirm')).toBe(
      true
    );
    // A later, nearer member: a human's answer is not re-decided.
    enrol('clone', ALICE, 3, 0.01);
    await engineMod.rematchMember(engine(), 'clone');
    expect(matches()).toEqual([
      { asset_id: 'p1', face_index: 0, user_id: 'alice', band: 'auto', state: 'confirmed' },
    ]);
  });

  it('offers a rejected face to the next member, never again to the one who rejected it', async () => {
    enrol('alice', ALICE, 3, 0.2);
    enrol('twin', ALICE, 3, 0.35);
    await store([['p1', 0, ALICE]]);
    expect(matches()[0].user_id).toBe('alice');
    expect(engineMod.answerMatch(db(), 'alice', { assetId: 'p1', faceIndex: 0 }, 'reject')).toBe(
      true
    );
    engineMod.redecideFaces(engine(), [{ assetId: 'p1', faceIndex: 0 }]);
    expect(matches()).toEqual([
      { asset_id: 'p1', face_index: 0, user_id: 'alice', band: 'auto', state: 'rejected' },
      { asset_id: 'p1', face_index: 0, user_id: 'twin', band: 'auto', state: 'pending' },
    ]);
    // A re-decision later (a new member, a new reference) still leaves alice out.
    await engineMod.rematchMember(engine(), 'alice');
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
    expect(engineMod.answerMatch(db(), 'bob', { assetId: 'p1', faceIndex: 0 }, 'confirm')).toBe(
      false
    );
  });

  it('moves the faces of a new, nearer member to them on their enrolment', async () => {
    enrol('far', ALICE, 3, 0.45);
    await store([
      ['p1', 0, ALICE],
      ['p2', 0, BOB],
    ]);
    expect(matches().map((m) => m.user_id)).toEqual(['far']);
    enrol('near', ALICE, 3, 0.1);
    await engineMod.rematchMember(engine(), 'near');
    expect(matches().map((m) => [m.asset_id, m.user_id, m.band])).toEqual([['p1', 'near', 'auto']]);
  });

  it('drops a held face that a member no longer reaches when their references change', async () => {
    enrol('alice', ALICE, 3, 0.4);
    await store([['p1', 0, ALICE]]);
    expect(matches()).toHaveLength(1);
    refs.eraseFaceReferences(db(), 'alice');
    for (let i = 0; i < 3; i++)
      refs.addFaceReference(db(), key, 'alice', 'photo', synthetic(500 + i));
    await engineMod.rematchMember(engine(), 'alice');
    expect(matches()).toHaveLength(0);
  });

  it('never writes a match for a member whose references went during the decision', async () => {
    enrol('alice', ALICE);
    await store([]);
    const members = (await import('#lib/server/face-store.ts')).loadAllReferences(db(), key);
    refs.eraseFaceReferences(db(), 'alice');
    engineMod.recordDecisions(engine(), members, [
      { assetId: 'p9', faceIndex: 0, embedding: ALICE },
    ]);
    expect(matches()).toHaveLength(0);
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
    const result = await engineMod.rematchAll(engine());
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
    engineMod.answerMatch(db(), 'alice', { assetId: 'p2', faceIndex: 0 }, 'reject');
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
