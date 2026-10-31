/**
 * Lot A7: the one-shot seed of the face store from Immich's vectors, and the carry-over of the
 * members' links to references, matches and profile photos (src/lib/server/face-seed.ts), plus its
 * route. SYNTHETIC vectors and ids only.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './test-helpers';
import { FACE_EMBEDDING_DIM, cosineDistance, normalizeEmbedding } from '#lib/face-embedding.ts';
import { parseSealKey } from '#lib/server/face-seal.ts';

const env: Record<string, string | undefined> = {
  IMMICH_BASE_URL: 'http://immich.test',
  IMMICH_API_KEY: 'k',
  FACE_ML_URL: 'http://ml.test',
  FACE_STORE_KEY: 'ab'.repeat(32),
};
vi.mock('#lib/server/env.ts', () => ({ env }));

const auth = vi.hoisted(() => ({ admin: true, impersonating: false }));
vi.mock('#lib/server/permissions.ts', () => ({
  requireScope: async () => {
    if (!auth.admin) throw Object.assign(new Error('forbidden'), { status: 403 });
    return { user: { id_user: 'admin', role: 'admin' }, grantedScope: 'admin', viaApiKey: true };
  },
}));
vi.mock('#lib/server/auth.ts', () => ({
  isImpersonating: () => auth.impersonating,
  getRequestSession: () => null,
}));

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

const ALICE = synthetic(1000);
const BOB = synthetic(2000);
const CAROL = synthetic(3000);
const STRANGER = synthetic(4000);

let database: typeof import('#lib/db/database.ts');
let faceDatabase: typeof import('#lib/db/face-database.ts');
let engineMod: typeof import('#lib/server/face-engine.ts');
let seedMod: typeof import('#lib/server/face-seed.ts');
let refs: typeof import('#lib/server/face-references.ts');
let route: typeof import('../src/routes/api/admin/faces/seed/+server');
let dbDir: string;
const key = parseSealKey(env.FACE_STORE_KEY);

const db = () => database.getDatabase();
const faceDb = () => faceDatabase.getFaceDatabase();
const engine = () => ({ db: db(), faceDb: faceDb(), key });

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-face-seed-'));
  process.env.DATABASE_PATH = join(dbDir, 'migallery.db');
  database = await import('#lib/db/database.ts');
  faceDatabase = await import('#lib/db/face-database.ts');
  engineMod = await import('#lib/server/face-engine.ts');
  seedMod = await import('#lib/server/face-seed.ts');
  refs = await import('#lib/server/face-references.ts');
  route = await import('../src/routes/api/admin/faces/seed/+server');
});

afterAll(() => {
  faceDatabase.resetFaceDatabase();
  database.resetDatabase();
  removeTempDir(dbDir);
});

beforeEach(() => {
  db().exec(
    'DELETE FROM face_matches; DELETE FROM face_references; DELETE FROM face_consents; DELETE FROM users;'
  );
  faceDb().exec(
    'DELETE FROM face_embeddings; DELETE FROM face_assets; DELETE FROM face_store_state; DROP TABLE IF EXISTS face_seed_links;'
  );
  auth.admin = true;
  auth.impersonating = false;
});

/** A member linked to `person`, consenting unless told otherwise. */
function member(id: string, person: string | null, consent = true, profileAsset?: string) {
  db()
    .prepare('INSERT INTO users (id_user, name, photos_id, photos_asset_id) VALUES (?, ?, ?, ?)')
    .run(id, id, person, profileAsset ?? null);
  if (consent) {
    db()
      .prepare(
        "INSERT INTO face_consents (user_id, created_at, version, source) VALUES (?, 1, 'v1', 'legacy')"
      )
      .run(id);
  }
}

function face(assetId: string, personId: string | null, embedding: Float32Array) {
  return {
    assetId,
    personId,
    imageWidth: 640,
    imageHeight: 480,
    x1: 10,
    y1: 10,
    x2: 60,
    y2: 70,
    embedding: Array.from(embedding),
  };
}

/** Alice's person: five faces near her, and one far outlier the references must not include. */
function aliceFaces() {
  return [
    // First in physical order, so the selection must EVICT it to leave it out.
    face('al-outlier', 'pA', atDistance(ALICE, synthetic(99), 0.45)),
    ...[0.1, 0.12, 0.14, 0.16, 0.18].map((d, i) =>
      face(`al${i}`, 'pA', atDistance(ALICE, synthetic(10 + i), d))
    ),
  ];
}

const matches = () =>
  db()
    .prepare(
      'SELECT asset_id, face_index, user_id, band, state FROM face_matches ORDER BY asset_id'
    )
    .all() as Array<{
    asset_id: string;
    face_index: number;
    user_id: string;
    band: string;
    state: string;
  }>;

async function seed(faces: ReturnType<typeof face>[], assets: string[] = []) {
  await seedMod.beginSeed(engine());
  await seedMod.seedAssets(engine(), assets);
  const written = await seedMod.seedFaces(engine(), faces);
  return { written, report: await seedMod.finishSeed(engine()) };
}

describe('the seed', () => {
  it('writes every face sealed, every recognised asset done, and the references from the links', async () => {
    member('alice', 'pA', true, 'al2');
    member('bob', 'pB');
    const bobFaces = [0.1, 0.12].map((d, i) =>
      face(`bo${i}`, 'pB', atDistance(BOB, synthetic(20 + i), d))
    );
    const { written, report } = await seed(
      [...aliceFaces(), ...bobFaces, face('st0', 'pX', STRANGER)],
      ['empty', 'al0']
    );
    expect(written).toEqual({ written: 9, linked: 8, unusable: 0 });

    expect(
      faceDb()
        .prepare("SELECT state, source, faces FROM face_assets WHERE asset_id = 'empty'")
        .get()
    ).toEqual({ state: 'done', source: 'seed', faces: 0 });
    expect(
      faceDb().prepare("SELECT COUNT(*) AS n FROM face_assets WHERE state = 'done'").get()
    ).toEqual({ n: 10 });
    expect(
      faceDb().prepare('SELECT COUNT(*) AS n FROM face_embeddings WHERE score IS NULL').get()
    ).toEqual({ n: 9 });

    // Alice: the 5 faces nearest her person's centroid, never the outlier.
    const aliceRefs = refs.loadFaceReferences(db(), key, 'alice');
    expect(aliceRefs).toHaveLength(5);
    for (const r of aliceRefs) expect(cosineDistance(r, ALICE)).toBeLessThan(0.3);
    expect(refs.loadFaceReferences(db(), key, 'bob')).toHaveLength(2);
    expect(db().prepare('SELECT DISTINCT source FROM face_references').all()).toEqual([
      { source: 'photo' },
    ]);

    // Every face decided; the stranger matches nobody.
    const held = matches();
    expect(
      held
        .filter((m) => m.user_id === 'alice')
        .map((m) => m.asset_id)
        .sort()
    ).toEqual(['al0', 'al1', 'al2', 'al3', 'al4', 'al-outlier'].sort());
    expect(held.filter((m) => m.user_id === 'bob')).toHaveLength(2);
    expect(held.some((m) => m.asset_id === 'st0')).toBe(false);

    expect(report).toMatchObject({
      faces: 9,
      linkedMembers: 2,
      referencedMembers: 2,
      skipped: { noConsent: 0, noFaces: 0 },
      referencesPerMember: { 5: 1, 2: 1 },
      parity: { personFaces: 8, toOther: 0, unmatched: 0 },
      profilePhotos: { claimed: 1 },
    });
    // Bob holds 2 references, under the minimum: his faces are offered, never shown at once. So
    // is Alice's outlier, beyond the auto band from the references chosen near her centroid.
    expect(report.parity).toMatchObject({ shown: 5, suggested: 3 });

    // Seeded: the working table is gone, ingestion may start.
    expect(faceDatabase.getFaceStoreState(faceDb(), 'seeded_at')).not.toBeNull();
    expect(
      faceDb()
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'face_seed_links'")
        .get()
    ).toEqual({ n: 0 });
  });

  it('reports aggregates only: no member, asset or person id', async () => {
    member('alice', 'pA', true, 'al2');
    const { report } = await seed(aliceFaces());
    const text = JSON.stringify(report);
    for (const id of ['alice', 'pA', 'al0', 'al2']) expect(text).not.toContain(id);
  });

  it('claims the profile photo for its member, confirmed', async () => {
    member('alice', 'pA', true, 'al2');
    await seed(aliceFaces());
    expect(matches().find((m) => m.asset_id === 'al2')).toMatchObject({
      user_id: 'alice',
      state: 'confirmed',
    });
    expect(matches().filter((m) => m.state === 'confirmed')).toHaveLength(1);
  });

  it('gives no reference to a member who withdrew, and says how many', async () => {
    member('alice', 'pA');
    member('carol', 'pC', false);
    const { report } = await seed([
      ...aliceFaces(),
      ...[0.1, 0.12, 0.14].map((d, i) =>
        face(`ca${i}`, 'pC', atDistance(CAROL, synthetic(30 + i), d))
      ),
    ]);
    expect(refs.loadFaceReferences(db(), key, 'carol')).toHaveLength(0);
    expect(report.skipped.noConsent).toBe(1);
    expect(matches().some((m) => m.user_id === 'carol')).toBe(false);
  });

  it('numbers the faces of an asset 0, 1, ... in the order they come', async () => {
    await seed([face('x', null, ALICE), face('y', null, BOB), face('x', null, CAROL)]);
    expect(
      faceDb()
        .prepare('SELECT asset_id, face_index FROM face_embeddings ORDER BY asset_id, face_index')
        .all()
    ).toEqual([
      { asset_id: 'x', face_index: 0 },
      { asset_id: 'x', face_index: 1 },
      { asset_id: 'y', face_index: 0 },
    ]);
    expect(faceDb().prepare("SELECT faces FROM face_assets WHERE asset_id = 'x'").get()).toEqual({
      faces: 2,
    });
  });

  it('stores no face that is not a usable vector, and counts it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await seedMod.beginSeed(engine());
    const zero = face('z', null, new Float32Array(FACE_EMBEDDING_DIM));
    const short = { ...face('s', null, ALICE), embedding: [1, 2, 3] };
    const result = await seedMod.seedFaces(engine(), [zero, short, face('ok', null, ALICE)]);
    errors.mockRestore();
    expect(result).toEqual({ written: 1, linked: 0, unusable: 2 });
    expect(faceDb().prepare('SELECT asset_id FROM face_embeddings').all()).toEqual([
      { asset_id: 'ok' },
    ]);
  });

  it('is refused once seeded, and before it has begun', async () => {
    await expect(seedMod.seedFaces(engine(), [])).rejects.toMatchObject({ reason: 'not_begun' });
    await seed([]);
    await expect(seedMod.beginSeed(engine())).rejects.toMatchObject({ reason: 'already_seeded' });
    await expect(seedMod.seedAssets(engine(), ['a'])).rejects.toMatchObject({
      reason: 'already_seeded',
    });
  });

  it('starts again from nothing after a partial run', async () => {
    await seedMod.beginSeed(engine());
    await seedMod.seedFaces(engine(), [face('half', null, ALICE)]);
    await seedMod.beginSeed(engine());
    await seedMod.seedFaces(engine(), [face('whole', null, BOB)]);
    expect(faceDb().prepare('SELECT asset_id, face_index FROM face_embeddings').all()).toEqual([
      { asset_id: 'whole', face_index: 0 },
    ]);
    expect(faceDb().prepare('SELECT asset_id FROM face_assets').all()).toEqual([
      { asset_id: 'whole' },
    ]);
  });
});

describe('claimFace', () => {
  async function stored() {
    member('alice', 'pA');
    member('bob', 'pB');
    await seed([
      ...aliceFaces(),
      ...[0.1, 0.12, 0.14].map((d, i) =>
        face(`bo${i}`, 'pB', atDistance(BOB, synthetic(20 + i), d))
      ),
    ]);
  }
  const opened = (assetId: string) =>
    engineMod
      .runExclusive(() => undefined)
      .then(() => ({ assetId, faceIndex: 0, embedding: atDistance(ALICE, synthetic(10), 0.1) }));

  it('never overrides an answer: a face another member confirmed, or one the member rejected', async () => {
    await stored();
    db().prepare("UPDATE face_matches SET state = 'confirmed' WHERE asset_id = 'al0'").run();
    const f = await opened('al0');
    expect(await engineMod.runExclusive(() => engineMod.claimFace(engine(), 'bob', f))).toBe(
      'confirmed_by_other'
    );
    db().prepare("UPDATE face_matches SET state = 'rejected' WHERE asset_id = 'al0'").run();
    expect(await engineMod.runExclusive(() => engineMod.claimFace(engine(), 'alice', f))).toBe(
      'rejected_by_member'
    );
  });

  it('replaces a pending holder, and needs references', async () => {
    await stored();
    const f = await opened('al1');
    expect(await engineMod.runExclusive(() => engineMod.claimFace(engine(), 'bob', f))).toBe(
      'claimed'
    );
    expect(matches().filter((m) => m.asset_id === 'al1')).toEqual([
      { asset_id: 'al1', face_index: 0, user_id: 'bob', band: 'suggested', state: 'confirmed' },
    ]);
    member('dave', null);
    const other = await opened('al3');
    expect(await engineMod.runExclusive(() => engineMod.claimFace(engine(), 'dave', other))).toBe(
      'no_references'
    );
    expect(() => engineMod.claimFace(engine(), 'bob', f)).toThrow(/runExclusive/);
  });
});

describe('POST /api/admin/faces/seed', () => {
  const call = async (body: unknown) => {
    try {
      const res = await route.POST({
        request: new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }),
      } as never);
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    } catch (e) {
      return { status: (e as { status?: number }).status ?? 500, body: null };
    }
  };

  it('runs the four phases and answers counts only', async () => {
    member('alice', 'pA');
    expect((await call({ phase: 'begin' })).status).toBe(200);
    expect(await call({ phase: 'assets', ids: ['al0'] })).toEqual({
      status: 200,
      body: { success: true, added: 1 },
    });
    expect(await call({ phase: 'faces', faces: aliceFaces() })).toEqual({
      status: 200,
      body: { success: true, written: 6, linked: 6, unusable: 0 },
    });
    const done = await call({ phase: 'finish' });
    expect(done.status).toBe(200);
    expect(JSON.stringify(done.body)).not.toMatch(/alice|pA|al0/);
    expect((await call({ phase: 'begin' })).status).toBe(409);
  });

  it('refuses a malformed face, a non-admin and an impersonated session', async () => {
    await call({ phase: 'begin' });
    expect((await call({ phase: 'faces', faces: [{ assetId: 'a' }] })).status).toBe(400);
    expect(
      (await call({ phase: 'faces', faces: [{ ...face('a', null, ALICE), x1: 1.5 }] })).status
    ).toBe(400);
    expect((await call({ phase: 'nope' })).status).toBe(400);
    auth.impersonating = true;
    expect((await call({ phase: 'begin' })).status).toBe(403);
    auth.impersonating = false;
    auth.admin = false;
    expect((await call({ phase: 'begin' })).status).toBe(403);
    expect(faceDb().prepare('SELECT COUNT(*) AS n FROM face_embeddings').get()).toEqual({ n: 0 });
  });
});

describe('seed-client line parsing', () => {
  it('reads a COPY face line, \\N as no person', async () => {
    const { parseFaceLine } = await import('../scripts/faces/seed-client.mjs');
    const vector = `[${Array.from({ length: FACE_EMBEDDING_DIM }, (_, i) => (i === 0 ? 1 : 0)).join(',')}]`;
    const parsed = parseFaceLine(['F', 'a1', '\\N', '640', '480', '1', '2', '3', '4', vector]);
    expect(parsed).toMatchObject({ assetId: 'a1', personId: null, imageWidth: 640, x2: 3 });
    expect(parsed.embedding).toHaveLength(FACE_EMBEDDING_DIM);
    expect(() => parseFaceLine(['F', 'a1'])).toThrow(/columns/);
    expect(() => parseFaceLine(['F', 'a', 'p', 'w', '1', '1', '1', '1', '1', vector])).toThrow(
      /integer/
    );
  });
});
