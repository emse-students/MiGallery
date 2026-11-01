/**
 * "Ce n'est pas moi" on a photo of "Mes photos" and "Photos écartées" (owner, 2026-11-01), called
 * as HANDLERS against throwaway SQLite files with the session helpers scripted and Immich faked:
 * POST /api/users/me/face/rejections (a photo leaves the member, a confirmed one included, and a
 * reference learned from it goes), GET of the same route (the faces they rejected), and DELETE
 * /api/users/me/face/rejections/[assetId]/[faceIndex] ("En fait, c'est moi": the negative goes,
 * the face comes back confirmed, unless another member confirmed it). SYNTHETIC ids and vectors.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './test-helpers';
import { FACE_MODEL } from '#lib/face-embedding.ts';

const state = vi.hoisted(() => ({
  user: null as null | { id_user: string; role: string },
  impersonating: false,
}));

vi.mock('#lib/server/env.ts', () => ({
  env: {
    IMMICH_BASE_URL: 'http://immich.test',
    IMMICH_API_KEY: 'k',
    FACE_ML_URL: 'http://ml.test',
    FACE_STORE_KEY: 'ab'.repeat(32),
  },
}));
vi.mock('#lib/server/permissions.ts', () => ({
  requireScope: async () => {
    if (!state.user) throw Object.assign(new Error('unauthorized'), { status: 401 });
    return { user: state.user, grantedScope: 'read', viaApiKey: false };
  },
}));
vi.mock('#lib/server/auth.ts', () => ({
  isImpersonating: () => state.impersonating,
  getRequestSession: () => null,
}));

/** Immich, faked: its search holds nothing, so a background default-photo look sets nothing. */
const immich = (async (url: string) => {
  if (new URL(String(url)).pathname === '/api/search/metadata') {
    return Response.json({ assets: { items: [], nextPage: null, nextCursor: null } });
  }
  return Response.json({ message: 'Not found' }, { status: 400 });
}) as unknown as typeof fetch;

const key = Buffer.from('ab'.repeat(32), 'hex');

let database: typeof import('#lib/db/database.ts');
let faceDatabase: typeof import('#lib/db/face-database.ts');
let engineMod: typeof import('#lib/server/face-engine.ts');
let refs: typeof import('#lib/server/face-references.ts');
let sealMod: typeof import('#lib/server/face-seal.ts');
let emb: typeof import('#lib/face-embedding.ts');
let defaults: typeof import('#lib/server/profile-photo-default.ts');
let listRoute: typeof import('../src/routes/api/users/me/face/rejections/+server');
let undoRoute: typeof import('../src/routes/api/users/me/face/rejections/[assetId]/[faceIndex]/+server');
let dbDir: string;

const db = () => database.getDatabase();
const faceDb = () => faceDatabase.getFaceDatabase();

/** A unit vector along axis `i` (synthetic, never a face). */
const axis = (i: number) => {
  const v = new Float32Array(512);
  v[i] = 1;
  return v;
};

/** A face in the store with a real sealed vector. */
function storeFace(asset: string, v: Float32Array, face = 0) {
  faceDb()
    .prepare(
      `INSERT INTO face_embeddings (asset_id, face_index, model, x1, y1, x2, y2, img_w, img_h, score, sealed, created_at)
       VALUES (?, ?, ?, 40, 30, 120, 110, 400, 300, 0.9, ?, 1)`
    )
    .run(
      asset,
      face,
      FACE_MODEL,
      sealMod.seal(key, sealMod.embeddingContext(asset, face, FACE_MODEL), emb.encodeEmbedding(v))
    );
}

/** One match row, as the engine writes it. */
function match(
  user: string,
  asset: string,
  band: 'auto' | 'suggested',
  st: 'pending' | 'confirmed' | 'rejected',
  decided: number | null = null
) {
  db()
    .prepare(
      `INSERT INTO face_matches (asset_id, face_index, model, user_id, distance, runner_up, band, state, created_at, decided_at)
       VALUES (?, 0, ?, ?, 0.3, NULL, ?, ?, 1, ?)`
    )
    .run(asset, FACE_MODEL, user, band, st, decided);
}

const rowOf = (user: string, asset: string) =>
  (
    db()
      .prepare('SELECT state FROM face_matches WHERE user_id = ? AND asset_id = ?')
      .get(user, asset) as { state: string } | null
  )?.state ?? null;

const referenceOrigins = (user: string) =>
  (
    db()
      .prepare('SELECT source, asset_id FROM face_references WHERE user_id = ? ORDER BY id')
      .all(user) as Array<{ source: string; asset_id: string | null }>
  ).map((r) => `${r.source}:${r.asset_id ?? '-'}`);

const negatives = (user: string) =>
  (
    db()
      .prepare('SELECT asset_id FROM face_negatives WHERE user_id = ? ORDER BY asset_id')
      .all(user) as Array<{ asset_id: string }>
  ).map((r) => r.asset_id);

async function call(fn: unknown, event: object): Promise<{ status: number; body: unknown }> {
  try {
    const res = (await (fn as (e: never) => Promise<Response>)(event as never)) as Response;
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    return { status: (e as { status?: number }).status ?? 500, body: null };
  }
}

const notMe = (assetId: unknown) =>
  call(listRoute.POST, {
    request: new Request('http://x.test/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ asset_id: assetId }),
    }),
  });
const listRejected = () => call(listRoute.GET, {});
const itsMe = (assetId: string, faceIndex: string | number = 0) =>
  call(undoRoute.DELETE, { params: { assetId, faceIndex: String(faceIndex) } });

/** Wait for the background work the routes queued (the re-match, the default photo). */
const idle = async () => {
  await engineMod.runExclusive(() => undefined);
  await defaults.defaultPhotosSettled();
  await engineMod.runExclusive(() => undefined);
};

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-face-not-me-'));
  process.env.DATABASE_PATH = join(dbDir, 'migallery.db');
  database = await import('#lib/db/database.ts');
  faceDatabase = await import('#lib/db/face-database.ts');
  engineMod = await import('#lib/server/face-engine.ts');
  refs = await import('#lib/server/face-references.ts');
  sealMod = await import('#lib/server/face-seal.ts');
  emb = await import('#lib/face-embedding.ts');
  defaults = await import('#lib/server/profile-photo-default.ts');
  listRoute = await import('../src/routes/api/users/me/face/rejections/+server');
  undoRoute =
    await import('../src/routes/api/users/me/face/rejections/[assetId]/[faceIndex]/+server');
});

afterAll(() => {
  faceDatabase.resetFaceDatabase();
  database.resetDatabase();
  removeTempDir(dbDir);
});

afterEach(async () => {
  await idle();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  db().exec(
    'DELETE FROM face_matches; DELETE FROM face_references; DELETE FROM face_negatives; DELETE FROM users;'
  );
  faceDb().exec('DELETE FROM face_embeddings;');
  for (const id of ['m1', 'm2']) {
    db().prepare('INSERT INTO users (id_user, name) VALUES (?, ?)').run(id, id);
  }
  // m1 holds a selfie, and a reference learned from the photo 'conf' they confirmed.
  refs.addFaceReference(db(), key, 'm1', 'selfie', axis(1), 1);
  refs.addFaceReference(db(), key, 'm1', 'photo', axis(1), 2, { assetId: 'conf', faceIndex: 0 });
  state.user = { id_user: 'm1', role: 'user' };
  state.impersonating = false;
  vi.stubGlobal('fetch', immich);
});

describe('POST /api/users/me/face/rejections ("Ce n\'est pas moi" on a photo)', () => {
  it('a CONFIRMED photo leaves the member: rejected, kept as a negative, and its learned reference deleted', async () => {
    storeFace('conf', axis(1));
    match('m1', 'conf', 'auto', 'confirmed');
    const res = await notMe('conf');
    expect(res).toEqual({ status: 200, body: { success: true, faces: 1, released: [] } });
    await idle();
    expect(rowOf('m1', 'conf')).toBe('rejected');
    expect(negatives('m1')).toEqual(['conf']);
    // The selfie stays; the reference taken from the face they now say is not them goes.
    expect(referenceOrigins('m1')).toEqual(['selfie:-']);
  });

  it('a photo given without a question goes as a "Pas moi" does, and the references stay', async () => {
    storeFace('shown', axis(2));
    match('m1', 'shown', 'auto', 'pending');
    expect((await notMe('shown')).status).toBe(200);
    await idle();
    expect(rowOf('m1', 'shown')).toBe('rejected');
    expect(negatives('m1')).toEqual(['shown']);
    expect(referenceOrigins('m1')).toEqual(['selfie:-', 'photo:conf']);
  });

  it("is 404 on a photo that is not the member's: waiting, already rejected, another member's", async () => {
    match('m1', 'asked', 'suggested', 'pending');
    match('m1', 'gone', 'auto', 'rejected');
    match('m2', 'theirs', 'auto', 'confirmed');
    for (const asset of ['asked', 'gone', 'theirs', 'nowhere']) {
      expect((await notMe(asset)).status).toBe(404);
    }
    expect(rowOf('m1', 'asked')).toBe('pending');
    expect(rowOf('m2', 'theirs')).toBe('confirmed');
    expect(negatives('m1')).toEqual([]);
  });

  it('refuses a malformed body', async () => {
    expect((await notMe('')).status).toBe(400);
    expect((await notMe(3)).status).toBe(400);
  });
});

describe('GET /api/users/me/face/rejections ("Photos écartées")', () => {
  it("lists the member's own rejected faces, the latest first, and nothing else", async () => {
    match('m1', 'older', 'auto', 'rejected', 10);
    match('m1', 'newer', 'suggested', 'rejected', 20);
    match('m1', 'mine', 'auto', 'pending');
    match('m2', 'theirs', 'auto', 'rejected', 30);
    const res = await listRejected();
    expect(res).toEqual({
      status: 200,
      body: {
        success: true,
        rejections: [
          { asset_id: 'newer', face_index: 0 },
          { asset_id: 'older', face_index: 0 },
        ],
      },
    });
  });
});

describe('DELETE /api/users/me/face/rejections/[assetId]/[faceIndex] ("En fait, c\'est moi")', () => {
  it('deletes the negative and gives the face back confirmed, taking it from a pending holder', async () => {
    storeFace('conf', axis(1));
    match('m1', 'conf', 'auto', 'confirmed');
    expect((await notMe('conf')).status).toBe(200);
    await idle();
    expect(negatives('m1')).toEqual(['conf']);
    // The face went to the next member meanwhile, still waiting for their answer.
    db().prepare("DELETE FROM face_matches WHERE user_id = 'm2' AND asset_id = 'conf'").run();
    match('m2', 'conf', 'suggested', 'pending');

    const res = await itsMe('conf');
    expect(res).toEqual({ status: 200, body: { success: true, outcome: 'restored' } });
    await idle();
    expect(negatives('m1')).toEqual([]);
    expect(rowOf('m1', 'conf')).toBe('confirmed');
    expect(rowOf('m2', 'conf')).toBeNull();
    expect((await listRejected()).body).toEqual({ success: true, rejections: [] });
  });

  it('refuses, changing nothing, when another member has confirmed the face since', async () => {
    storeFace('conf', axis(1));
    match('m1', 'conf', 'auto', 'confirmed');
    expect((await notMe('conf')).status).toBe(200);
    await idle();
    db().prepare("DELETE FROM face_matches WHERE user_id = 'm2' AND asset_id = 'conf'").run();
    match('m2', 'conf', 'suggested', 'confirmed');

    const res = await itsMe('conf');
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBe('confirmed_by_other');
    expect(rowOf('m1', 'conf')).toBe('rejected');
    expect(rowOf('m2', 'conf')).toBe('confirmed');
    expect(negatives('m1')).toEqual(['conf']);
  });

  it('is 404 on a face the member did not reject, and 400 on a malformed face', async () => {
    match('m1', 'mine', 'auto', 'confirmed');
    expect((await itsMe('mine')).status).toBe(404);
    expect((await itsMe('nowhere')).status).toBe(404);
    expect((await itsMe('bad/id')).status).toBe(400);
    expect((await itsMe('a', -1)).status).toBe(400);
    expect(rowOf('m1', 'mine')).toBe('confirmed');
  });
});

describe('impersonation', () => {
  it('refuses the list, the removal and the undo to an impersonated session, changing nothing', async () => {
    match('m1', 'shown', 'auto', 'pending');
    match('m1', 'gone', 'auto', 'rejected');
    state.impersonating = true;
    expect((await listRejected()).status).toBe(403);
    expect((await notMe('shown')).status).toBe(403);
    expect((await itsMe('gone')).status).toBe(403);
    expect(rowOf('m1', 'shown')).toBe('pending');
    expect(rowOf('m1', 'gone')).toBe('rejected');
  });
});
