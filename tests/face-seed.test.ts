/**
 * Lot A7: the one-shot seed of the face store from Immich's vectors, and the carry-over of the
 * members' links to references, matches and profile photos (src/lib/server/face-seed.ts), plus its
 * route. SYNTHETIC vectors and ids only.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

/** Begin, send the assets and the faces; returns the run token and what the faces phase said. */
async function stream(faces: ReturnType<typeof face>[], assets: string[] = []) {
  const run = await seedMod.beginSeed(engine());
  await seedMod.seedAssets(engine(), run, assets);
  const written = await seedMod.seedFaces(engine(), run, faces);
  return { run, written, expected: { assets: assets.length, faces: faces.length } };
}

async function seed(faces: ReturnType<typeof face>[], assets: string[] = []) {
  const { run, written, expected } = await stream(faces, assets);
  return { run, written, report: await seedMod.finishSeed(engine(), run, expected) };
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
      { source: 'seed' },
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
    const run = await seedMod.beginSeed(engine());
    const zero = face('z', null, new Float32Array(FACE_EMBEDDING_DIM));
    const short = { ...face('s', null, ALICE), embedding: [1, 2, 3] };
    const result = await seedMod.seedFaces(engine(), run, [zero, short, face('ok', null, ALICE)]);
    errors.mockRestore();
    expect(result).toEqual({ written: 1, linked: 0, unusable: 2 });
    expect(faceDb().prepare('SELECT asset_id FROM face_embeddings').all()).toEqual([
      { asset_id: 'ok' },
    ]);
  });

  it('is refused once seeded, and before it has begun', async () => {
    await expect(seedMod.seedFaces(engine(), 'r', [])).rejects.toMatchObject({
      reason: 'not_begun',
    });
    const { run } = await seed([]);
    await expect(seedMod.beginSeed(engine())).rejects.toMatchObject({ reason: 'already_seeded' });
    await expect(seedMod.seedAssets(engine(), run, ['a'])).rejects.toMatchObject({
      reason: 'already_seeded',
    });
  });

  it('starts again from nothing after a partial run', async () => {
    const first = await seedMod.beginSeed(engine());
    await seedMod.seedFaces(engine(), first, [face('half', null, ALICE)]);
    const second = await seedMod.beginSeed(engine());
    await seedMod.seedFaces(engine(), second, [face('whole', null, BOB)]);
    expect(faceDb().prepare('SELECT asset_id, face_index FROM face_embeddings').all()).toEqual([
      { asset_id: 'whole', face_index: 0 },
    ]);
    expect(faceDb().prepare('SELECT asset_id FROM face_assets').all()).toEqual([
      { asset_id: 'whole' },
    ]);
  });
});

describe('the seed guards', () => {
  /** Every row of the tables a finish may write, to compare before and after. */
  const snapshot = () => ({
    embeddings: faceDb()
      .prepare('SELECT * FROM face_embeddings ORDER BY asset_id, face_index')
      .all(),
    assets: faceDb().prepare('SELECT * FROM face_assets ORDER BY asset_id').all(),
    links: faceDb().prepare('SELECT * FROM face_seed_links ORDER BY asset_id, face_index').all(),
    state: faceDb()
      .prepare("SELECT * FROM face_store_state WHERE key != 'seed_finish' ORDER BY key")
      .all(),
    references: db().prepare('SELECT * FROM face_references ORDER BY id').all(),
    matches: db().prepare('SELECT * FROM face_matches ORDER BY asset_id, face_index').all(),
    consents: db().prepare('SELECT * FROM face_consents ORDER BY user_id').all(),
  });

  it('refuses to seal an export that did not arrive whole, and a rerun from begin works', async () => {
    member('alice', 'pA', true, 'al2');
    const { run, expected } = await stream(aliceFaces(), ['al0', 'empty']);
    const before = snapshot();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // The second COPY failed half-way: Immich counted more faces than arrived.
    await expect(
      seedMod.finishSeed(engine(), run, { ...expected, faces: expected.faces + 1 })
    ).rejects.toMatchObject({ reason: 'incomplete' });
    await expect(
      seedMod.finishSeed(engine(), run, { ...expected, assets: expected.assets + 1 })
    ).rejects.toMatchObject({ reason: 'incomplete' });
    await expect(
      seedMod.dryRunSeed(engine(), run, { ...expected, faces: expected.faces - 1 })
    ).rejects.toMatchObject({ reason: 'incomplete' });
    errors.mockRestore();
    expect(snapshot()).toEqual(before);
    expect(faceDatabase.getFaceStoreState(faceDb(), 'seeded_at')).toBeNull();

    const again = await seed(aliceFaces(), ['al0', 'empty']);
    expect(again.report).toMatchObject({ faces: 6, referencedMembers: 1, unusable: 0 });
    expect(faceDatabase.getFaceStoreState(faceDb(), 'seeded_at')).not.toBeNull();
  });

  it('counts an unusable face durably as received, so the export still balances', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const zero = face('z', null, new Float32Array(FACE_EMBEDDING_DIM));
    const { report } = await seed([zero, face('ok', null, ALICE)]);
    errors.mockRestore();
    expect(report).toMatchObject({ faces: 1, unusable: 1 });
  });

  it('refuses every phase of a run a later begin replaced', async () => {
    const first = await seedMod.beginSeed(engine());
    await seedMod.seedFaces(engine(), first, [face('a', null, ALICE)]);
    const second = await seedMod.beginSeed(engine());
    await expect(seedMod.seedAssets(engine(), first, ['x'])).rejects.toMatchObject({
      reason: 'stale_run',
    });
    await expect(seedMod.seedFaces(engine(), first, [face('b', null, BOB)])).rejects.toMatchObject({
      reason: 'stale_run',
    });
    await expect(
      seedMod.finishSeed(engine(), first, { assets: 0, faces: 0 })
    ).rejects.toMatchObject({ reason: 'stale_run' });
    await expect(
      seedMod.dryRunSeed(engine(), first, { assets: 0, faces: 0 })
    ).rejects.toMatchObject({ reason: 'stale_run' });
    expect(() => seedMod.readSeedFinish(engine(), first)).toThrow(seedMod.SeedRefusedError);
    expect(faceDb().prepare('SELECT COUNT(*) AS n FROM face_embeddings').get()).toEqual({ n: 0 });
    // The current run seals; the replaced one never could.
    await seedMod.finishSeed(engine(), second, { assets: 0, faces: 0 });
    expect(faceDatabase.getFaceStoreState(faceDb(), 'seeded_at')).not.toBeNull();
  });

  it('dry-runs the finish without writing anything, and the real finish follows', async () => {
    member('alice', 'pA', true, 'al2');
    member('bob', 'pB');
    member('carol', 'pC', false);
    const { run, expected } = await stream(
      [
        ...aliceFaces(),
        ...[0.1, 0.12].map((d, i) => face(`bo${i}`, 'pB', atDistance(BOB, synthetic(20 + i), d))),
        face('ca0', 'pC', CAROL),
      ],
      ['empty']
    );
    // Bob already holds four references of his own: the dry run counts only the room left.
    for (let i = 0; i < 4; i++) refs.addFaceReference(db(), key, 'bob', 'photo', BOB);
    const before = snapshot();
    const plan = await seedMod.dryRunSeed(engine(), run, expected);
    expect(snapshot()).toEqual(before);
    expect(faceDatabase.getFaceStoreState(faceDb(), 'seeded_at')).toBeNull();
    expect(plan).toEqual({
      faces: 9,
      assets: 10,
      unusable: 0,
      linkedMembers: 3,
      consentingMembers: 2,
      referencedMembers: 2,
      skipped: { noConsent: 1, noFaces: 0 },
      referencesPerMember: { 5: 1, 1: 1 },
    });
    expect(seedMod.readSeedFinish(engine(), run)).toEqual({
      status: 'done',
      dryRun: true,
      report: plan,
    });

    const report = await seedMod.finishSeed(engine(), run, expected);
    expect(report).toMatchObject({
      consentingMembers: 2,
      referencedMembers: 2,
      referencesPerMember: { 5: 1, 1: 1 },
    });
    expect(seedMod.readSeedFinish(engine(), run)).toMatchObject({ status: 'done', dryRun: false });
  });

  it('starts a dry run in the background: done, and still nothing written', async () => {
    member('alice', 'pA');
    const { run, expected } = await stream(aliceFaces());
    const before = snapshot();
    const { settled } = await seedMod.startSeedFinish(engine(), run, expected, true);
    expect(await settled).toMatchObject({ status: 'done', dryRun: true });
    expect(snapshot()).toEqual(before);
  });

  it('begin wipes the references a failed finish wrote, and only those', async () => {
    member('alice', 'pA');
    await stream(aliceFaces());
    // What a finish that failed after its references leaves: the seed's, beside the member's own.
    refs.addFaceReference(db(), key, 'alice', 'seed', ALICE);
    refs.addFaceReference(db(), key, 'alice', 'seed', ALICE);
    refs.addFaceReference(db(), key, 'alice', 'photo', ALICE);
    refs.addFaceReference(db(), key, 'alice', 'selfie', ALICE);
    await seedMod.beginSeed(engine());
    expect(db().prepare('SELECT source FROM face_references ORDER BY source').all()).toEqual([
      { source: 'photo' },
      { source: 'selfie' },
    ]);

    // So a rerun's histogram counts the seed's own references afresh, the member's kept.
    const { report } = await seed(aliceFaces());
    expect(report.referencesPerMember).toEqual({ 3: 1 });
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

  it("deletes the displaced holder's crop of a face it claims", async () => {
    await stored();
    const { memberCropDir } = await import('#lib/server/face-crop.ts');
    const crop = join(memberCropDir('alice'), 'al1_0.webp');
    mkdirSync(memberCropDir('alice'), { recursive: true });
    writeFileSync(crop, 'crop');
    try {
      const f = await opened('al1');
      expect(await engineMod.runExclusive(() => engineMod.claimFace(engine(), 'bob', f))).toBe(
        'claimed'
      );
      expect(existsSync(crop)).toBe(false);
    } finally {
      rmSync(memberCropDir('alice'), { recursive: true, force: true });
    }
  });

  it('deletes the crops of the faces of an asset it forgets', async () => {
    await stored();
    const { memberCropDir } = await import('#lib/server/face-crop.ts');
    const crop = join(memberCropDir('alice'), 'al2_0.webp');
    mkdirSync(memberCropDir('alice'), { recursive: true });
    writeFileSync(crop, 'crop');
    try {
      await engineMod.runExclusive(() => engineMod.removeAssetFaces(engine(), 'al2'));
      expect(matches().filter((m) => m.asset_id === 'al2')).toEqual([]);
      expect(existsSync(crop)).toBe(false);
    } finally {
      rmSync(memberCropDir('alice'), { recursive: true, force: true });
    }
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

  const poll = async (run: string | null) => {
    try {
      const url = new URL('http://x/api/admin/faces/seed');
      if (run !== null) url.searchParams.set('run', run);
      const res = await route.GET({ url } as never);
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    } catch (e) {
      return { status: (e as { status?: number }).status ?? 500, body: null };
    }
  };
  /** Every queued engine operation, the background finish included, has run. */
  const drained = () => engineMod.runExclusive(() => undefined);
  /** Hold the engine lock until released: queued work waits behind it, deterministically. */
  const hold = () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    void engineMod.runExclusive(() => gate);
    return release;
  };
  /**
   * Start a finish whose background work is still waiting when this returns: the finish queues
   * its check synchronously, a hold is queued right behind it, so the work lands behind the hold.
   * Returns the release of the hold.
   */
  const finishHeld = async (
    run: string,
    expected: { assets: number; faces: number },
    dryRun: boolean
  ) => {
    const started = seedMod.startSeedFinish(engine(), run, expected, dryRun);
    const release = hold();
    await started;
    return release;
  };

  it('runs the phases, answers the finish at once, and the poll returns counts only', async () => {
    member('alice', 'pA');
    const begun = await call({ phase: 'begin' });
    expect(begun.status).toBe(200);
    const run = begun.body?.run as string;
    expect(run).toMatch(/^[0-9a-f]{48}$/);
    expect(await call({ phase: 'assets', run, ids: ['al0'] })).toEqual({
      status: 200,
      body: { success: true, added: 1 },
    });
    expect(await call({ phase: 'faces', run, faces: aliceFaces() })).toEqual({
      status: 200,
      body: { success: true, written: 6, linked: 6, unusable: 0 },
    });
    expect(await poll(run)).toEqual({ status: 200, body: { success: true, status: 'none' } });
    const expected = { assets: 1, faces: 6 };
    expect(await call({ phase: 'finish', run, expected })).toEqual({
      status: 202,
      body: { success: true, status: 'running', dryRun: false },
    });
    await drained();
    const done = await poll(run);
    expect(done.body).toMatchObject({
      success: true,
      status: 'done',
      dryRun: false,
      report: { faces: 6, assets: 6, linkedMembers: 1, referencedMembers: 1 },
    });
    expect(JSON.stringify(done.body)).not.toMatch(/alice|pA|al0/);
    expect(faceDatabase.getFaceStoreState(faceDb(), 'seeded_at')).not.toBeNull();
    expect((await call({ phase: 'begin' })).status).toBe(409);
  });

  it('refuses a phase without its run token, or with a replaced one', async () => {
    const first = (await call({ phase: 'begin' })).body?.run as string;
    expect((await call({ phase: 'assets', ids: ['a'] })).status).toBe(400);
    expect((await call({ phase: 'finish', expected: { assets: 0, faces: 0 } })).status).toBe(400);
    expect((await poll(null)).status).toBe(400);
    const second = (await call({ phase: 'begin' })).body?.run as string;
    expect(second).not.toBe(first);
    expect((await call({ phase: 'assets', run: first, ids: ['a'] })).status).toBe(409);
    expect((await call({ phase: 'faces', run: first, faces: [] })).status).toBe(409);
    expect(
      (await call({ phase: 'finish', run: first, expected: { assets: 0, faces: 0 } })).status
    ).toBe(409);
    expect((await poll(first)).status).toBe(409);
    expect((await call({ phase: 'assets', run: second, ids: ['a'] })).status).toBe(200);
    expect(faceDatabase.getFaceStoreState(faceDb(), 'seed_finish')).toBeNull();
  });

  it('refuses a finish without the expected counts, and one whose counts differ', async () => {
    const run = (await call({ phase: 'begin' })).body?.run as string;
    await call({ phase: 'faces', run, faces: [face('a', null, ALICE)] });
    expect((await call({ phase: 'finish', run })).status).toBe(400);
    expect((await call({ phase: 'finish', run, expected: { assets: 0, faces: -1 } })).status).toBe(
      400
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const short = await call({ phase: 'finish', run, expected: { assets: 0, faces: 2 } });
    errors.mockRestore();
    expect(short.status).toBe(409);
    expect(await poll(run)).toEqual({ status: 200, body: { success: true, status: 'none' } });
    expect(faceDatabase.getFaceStoreState(faceDb(), 'seeded_at')).toBeNull();
  });

  it('says running while a finish runs, and refuses a begin or a second finish meanwhile', async () => {
    const run = (await call({ phase: 'begin' })).body?.run as string;
    await call({ phase: 'faces', run, faces: [face('a', null, ALICE)] });
    const expected = { assets: 0, faces: 1 };
    const release = await finishHeld(run, expected, true);
    expect((await poll(run)).body).toEqual({ success: true, status: 'running', dryRun: true });
    expect((await call({ phase: 'begin' })).status).toBe(409);
    expect((await call({ phase: 'finish', run, expected })).status).toBe(409);
    release();
    await drained();
    expect((await poll(run)).body).toMatchObject({ status: 'done', dryRun: true });
  });

  it('reports a finish a restart cut as interrupted, and records it', async () => {
    const run = (await call({ phase: 'begin' })).body?.run as string;
    faceDatabase.setFaceStoreState(
      faceDb(),
      'seed_finish',
      JSON.stringify({ status: 'running', dryRun: false, run, process: 'a-process-gone' })
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await poll(run)).body).toEqual({
      success: true,
      status: 'failed',
      dryRun: false,
      reason: 'interrupted',
    });
    errors.mockRestore();
    expect(
      JSON.parse(faceDatabase.getFaceStoreState(faceDb(), 'seed_finish') as string)
    ).toMatchObject({ status: 'failed', reason: 'interrupted' });
    // Not a finish of this process: a new begin is not blocked by it.
    expect((await call({ phase: 'begin' })).status).toBe(200);
  });

  it('records a finish that failed under the lock as failed, and seals nothing', async () => {
    member('alice', 'pA');
    const run = (await call({ phase: 'begin' })).body?.run as string;
    await call({ phase: 'faces', run, faces: aliceFaces() });
    // A broken store: the working table is gone, so the finish throws once it reads it.
    faceDb().exec('DROP TABLE face_seed_links');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await call({ phase: 'finish', run, expected: { assets: 0, faces: 6 } })).status).toBe(
      202
    );
    await drained();
    errors.mockRestore();
    expect((await poll(run)).body).toEqual({
      success: true,
      status: 'failed',
      dryRun: false,
      reason: 'error',
    });
    expect(faceDatabase.getFaceStoreState(faceDb(), 'seeded_at')).toBeNull();
    expect((await call({ phase: 'begin' })).status).toBe(200);
  });

  it('refuses a malformed face, a non-admin and an impersonated session', async () => {
    const run = (await call({ phase: 'begin' })).body?.run as string;
    expect((await call({ phase: 'faces', run, faces: [{ assetId: 'a' }] })).status).toBe(400);
    expect(
      (await call({ phase: 'faces', run, faces: [{ ...face('a', null, ALICE), x1: 1.5 }] })).status
    ).toBe(400);
    expect((await call({ phase: 'nope' })).status).toBe(400);
    const notJson = await Promise.resolve()
      .then(() =>
        route.POST({ request: new Request('http://x/', { method: 'POST', body: '{' }) } as never)
      )
      .catch((e: { status?: number }) => ({ status: e.status ?? 500 }));
    expect(notJson.status).toBe(400);
    auth.impersonating = true;
    expect((await call({ phase: 'begin' })).status).toBe(403);
    expect((await poll(run)).status).toBe(403);
    auth.impersonating = false;
    auth.admin = false;
    expect((await call({ phase: 'begin' })).status).toBe(403);
    expect((await poll(run)).status).toBe(403);
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

  it('reads the count line, and refuses anything else as the first line', async () => {
    const { parseCountLine } = await import('../scripts/faces/seed-client.mjs');
    expect(parseCountLine(['C', '172612', '600003'])).toEqual({ assets: 172612, faces: 600003 });
    expect(() => parseCountLine(['A', 'a1'])).toThrow(/count line/);
    expect(() => parseCountLine(['C', '1'])).toThrow(/count line/);
    expect(() => parseCountLine(['C', '1', '-2'])).toThrow(/whole number/);
    expect(() => parseCountLine(['C', '1.5', '2'])).toThrow(/whole number/);
  });
});
