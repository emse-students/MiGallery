/**
 * Lot A6's read side, called as HANDLERS against throwaway SQLite files with the session helpers
 * scripted and Immich faked: a member's photos (GET /api/users/[userId]/photos-stream), the faces
 * waiting for their answer (GET /api/users/me/face/matches), the picture of one of those faces
 * (GET /api/users/me/face/crops/...), the profile photo (PUT /api/users/me/profile-photo) and the
 * avatar cut from it (GET /api/users/[username]/avatar), plus the reads behind them
 * (face-photos.ts). Every case asserts the status AND what was (not) stored or cached; no answer
 * may carry a distance, a band or another member's id. SYNTHETIC ids and images only.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import sharp from 'sharp';
import { removeTempDir } from './test-helpers';
import { FACE_MODEL } from '#lib/face-embedding.ts';

type Auth = {
  user: null | { id_user: string; role: string };
  grantedScope: string;
  viaApiKey: boolean;
};

const state = vi.hoisted(() => ({
  auth: null as null | {
    user: null | { id_user: string; role: string };
    grantedScope: string;
    viaApiKey: boolean;
  },
  impersonating: false,
  /** The PhotoCV album's asset ids, as the faked album read answers them. */
  cvAlbum: [] as string[],
}));

const env = vi.hoisted(() => ({
  IMMICH_BASE_URL: 'http://immich.test' as string | undefined,
}));

vi.mock('#lib/server/env.ts', () => ({
  env: {
    get IMMICH_BASE_URL() {
      return env.IMMICH_BASE_URL;
    },
    IMMICH_API_KEY: 'k',
    FACE_ML_URL: 'http://ml.test',
    FACE_STORE_KEY: 'ab'.repeat(32),
  },
}));
vi.mock('#lib/server/permissions.ts', () => ({
  requireScope: async () => {
    if (!state.auth) throw Object.assign(new Error('unauthorized'), { status: 401 });
    return state.auth;
  },
}));
vi.mock('#lib/server/auth.ts', () => ({
  isImpersonating: () => state.impersonating,
  getRequestSession: () => null,
}));
vi.mock('#lib/photos-cv/handlers.ts', () => ({
  getAlbumAssets: async () => state.cvAlbum.map((id) => ({ id, type: 'IMAGE' })),
}));

const member = (id: string, role = 'user'): Auth => ({
  user: { id_user: id, role },
  grantedScope: 'read',
  viaApiKey: false,
});
const API_KEY: Auth = { user: null, grantedScope: 'read', viaApiKey: true };

let database: typeof import('#lib/db/database.ts');
let faceDatabase: typeof import('#lib/db/face-database.ts');
let photos: typeof import('#lib/server/face-photos.ts');
let faceCrop: typeof import('#lib/server/face-crop.ts');
let streamRoute: typeof import('../src/routes/api/users/[userId]/photos-stream/+server');
let matchRoute: typeof import('../src/routes/api/users/me/face/matches/+server');
let cropRoute: typeof import('../src/routes/api/users/me/face/crops/[assetId]/[faceIndex]/+server');
let profileRoute: typeof import('../src/routes/api/users/me/profile-photo/+server');
let avatarRoute: typeof import('../src/routes/api/users/[username]/avatar/+server');
let dbDir: string;
let source: Buffer;

const db = () => database.getDatabase();
const faceDb = () => faceDatabase.getFaceDatabase();

/** One face match row. `band`/`state` as the engine writes them. */
function match(
  user: string,
  asset: string,
  band: 'auto' | 'suggested',
  st: 'pending' | 'confirmed' | 'rejected',
  { face = 0, created = 1, model = FACE_MODEL } = {}
) {
  db()
    .prepare(
      `INSERT INTO face_matches (asset_id, face_index, model, user_id, distance, runner_up, band, state, created_at)
       VALUES (?, ?, ?, ?, 0.42, 0.9, ?, ?, ?)`
    )
    .run(asset, face, model, user, band, st, created);
}

/** The stored box of a face, in the frame of the synthetic preview. */
function box(asset: string, face = 0) {
  faceDb()
    .prepare(
      `INSERT INTO face_embeddings (asset_id, face_index, model, x1, y1, x2, y2, img_w, img_h, score, sealed, created_at)
       VALUES (?, ?, ?, 40, 30, 120, 110, 400, 300, 0.9, x'00', 1)`
    )
    .run(asset, face, FACE_MODEL);
}

/** Every Immich call the fake answered, as "METHOD path". */
let immichCalls: string[] = [];
/** The assets the faked Immich holds, by id. */
let library: Record<string, { id: string; type: string; fileCreatedAt: string }> = {};
/** When set, the faked search ignores its filter and answers this page instead. */
let ignoreFilter: string[] | null = null;
/** When set, the faked search answers (or throws) this instead. */
let searchFails: (() => Response) | null = null;

const immich = (async (url: string, init?: RequestInit) => {
  const u = new URL(String(url));
  immichCalls.push(`${init?.method ?? 'GET'} ${u.pathname}`);
  if (u.pathname === '/api/search/metadata') {
    if (searchFails) {
      return searchFails();
    }
    const body = JSON.parse(String(init?.body)) as {
      filter: { or: Array<{ id: { eq: string } }> };
      size: number;
    };
    const asked = body.filter.or.map((c) => c.id.eq);
    const items = (ignoreFilter ?? asked).map((id) => library[id]).filter(Boolean);
    return Response.json({ assets: { items, nextPage: null } });
  }
  if (u.pathname.endsWith('/thumbnail') && u.searchParams.get('size') === 'preview') {
    return new Response(new Uint8Array(source), { headers: { 'content-type': 'image/png' } });
  }
  return new Response('unexpected', { status: 599 });
}) as unknown as typeof fetch;

function photo(id: string, when: string, type = 'IMAGE') {
  library[id] = { id, type, fileCreatedAt: when };
}

async function call(fn: unknown, event: object) {
  try {
    const res = (await (fn as (e: never) => Promise<Response>)(event as never)) as Response;
    return res;
  } catch (e) {
    return new Response(null, { status: (e as { status?: number }).status ?? 500 });
  }
}

const streamOf = async (ownerId: string, query = '') => {
  const res = await call(streamRoute.GET, {
    params: { userId: ownerId },
    url: new URL(`http://x.test/api/users/${ownerId}/photos-stream${query}`),
    request: new Request('http://x.test/'),
    fetch: immich,
  });
  const ids =
    res.status === 200
      ? (await res.text())
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((l) => (JSON.parse(l) as { asset: { id: string } }).asset.id)
      : null;
  return { status: res.status, ids };
};

const crop = (assetId: string, faceIndex: string | number = 0) =>
  call(cropRoute.GET, { params: { assetId, faceIndex: String(faceIndex) }, fetch: immich });

const choose = (body: unknown) =>
  call(profileRoute.PUT, {
    request: new Request('http://x.test/', { method: 'PUT', body: JSON.stringify(body) }),
  });

const avatar = (username: string) =>
  call(avatarRoute.GET, {
    params: { username },
    url: new URL(`http://x.test/api/users/${username}/avatar`),
    request: new Request('http://x.test/'),
    fetch: immich,
  });

const profileOf = (id: string) =>
  (
    db().prepare('SELECT photos_asset_id FROM users WHERE id_user = ?').get(id) as {
      photos_asset_id: string | null;
    }
  ).photos_asset_id;

const cachedCrops = (id: string) => {
  const dir = faceCrop.memberCropDir(id);
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
};

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-face-read-'));
  process.env.DATABASE_PATH = join(dbDir, 'migallery.db');
  database = await import('#lib/db/database.ts');
  faceDatabase = await import('#lib/db/face-database.ts');
  photos = await import('#lib/server/face-photos.ts');
  faceCrop = await import('#lib/server/face-crop.ts');
  streamRoute = await import('../src/routes/api/users/[userId]/photos-stream/+server');
  matchRoute = await import('../src/routes/api/users/me/face/matches/+server');
  cropRoute = await import('../src/routes/api/users/me/face/crops/[assetId]/[faceIndex]/+server');
  profileRoute = await import('../src/routes/api/users/me/profile-photo/+server');
  avatarRoute = await import('../src/routes/api/users/[username]/avatar/+server');
  source = await sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 30, g: 200, b: 60 } },
  })
    .png()
    .toBuffer();
});

afterAll(() => {
  for (const id of ['m1', 'm2', 'm3', 'boss']) faceCrop.deleteMemberFaceCrops(id);
  faceDatabase.resetFaceDatabase();
  database.resetDatabase();
  removeTempDir(dbDir);
});

beforeEach(() => {
  db().exec(
    'DELETE FROM face_matches; DELETE FROM face_references; DELETE FROM face_consents; DELETE FROM photo_access_permissions; DELETE FROM users;'
  );
  faceDb().exec('DELETE FROM face_embeddings;');
  for (const id of ['m1', 'm2', 'm3', 'boss']) {
    db()
      .prepare('INSERT INTO users (id_user, name, role) VALUES (?, ?, ?)')
      .run(id, id, id === 'boss' ? 'admin' : 'user');
    faceCrop.deleteMemberFaceCrops(id);
  }
  state.auth = member('m1');
  state.impersonating = false;
  state.cvAlbum = [];
  immichCalls = [];
  library = {};
  searchFails = null;
  env.IMMICH_BASE_URL = 'http://immich.test';
  ignoreFilter = null;
});

describe("which faces are a member's photos (face-photos.ts)", () => {
  it('a photo is an auto face or a confirmed one, never a waiting, rejected or other-model one', () => {
    match('m1', 'auto', 'auto', 'pending');
    match('m1', 'yes', 'suggested', 'confirmed', { created: 2 });
    match('m1', 'wait', 'suggested', 'pending');
    match('m1', 'no', 'auto', 'rejected');
    match('m1', 'old', 'auto', 'pending', { model: 'another-model' });
    match('m2', 'theirs', 'auto', 'pending');
    expect(photos.memberPhotoAssetIds(db(), 'm1')).toEqual(['auto', 'yes']);
  });

  it('two faces of the member in one photo are one photo', () => {
    match('m1', 'p', 'auto', 'pending', { face: 0 });
    match('m1', 'p', 'suggested', 'confirmed', { face: 1 });
    expect(photos.memberPhotoAssetIds(db(), 'm1')).toEqual(['p']);
    expect(photos.faceStatus(db(), 'm1')).toEqual({ enrolled: true, photos: 1, toConfirm: 0 });
  });

  it('the faces to confirm are the pending suggested ones only', () => {
    match('m1', 'a', 'suggested', 'pending', { created: 3 });
    match('m1', 'b', 'suggested', 'pending', { face: 2, created: 1 });
    match('m1', 'c', 'suggested', 'confirmed');
    match('m1', 'd', 'auto', 'pending');
    match('m1', 'e', 'suggested', 'rejected');
    match('m2', 'f', 'suggested', 'pending');
    expect(photos.pendingSuggestions(db(), 'm1')).toEqual([
      { assetId: 'b', faceIndex: 2 },
      { assetId: 'a', faceIndex: 0 },
    ]);
  });

  it("holds a shown or waiting face, not a rejected one nor another member's", () => {
    match('m1', 'a', 'auto', 'pending');
    match('m1', 'w', 'suggested', 'pending');
    match('m1', 'r', 'auto', 'rejected');
    match('m2', 'o', 'auto', 'pending');
    expect(photos.holdsFace(db(), 'm1', { assetId: 'a', faceIndex: 0 })).toBe(true);
    expect(photos.holdsFace(db(), 'm1', { assetId: 'w', faceIndex: 0 })).toBe(true);
    expect(photos.holdsFace(db(), 'm1', { assetId: 'r', faceIndex: 0 })).toBe(false);
    expect(photos.holdsFace(db(), 'm1', { assetId: 'o', faceIndex: 0 })).toBe(false);
    expect(photos.holdsFace(db(), 'm1', { assetId: 'a', faceIndex: 1 })).toBe(false);
  });

  it('the profile face is the lowest visible face of the member in that photo, or none', () => {
    match('m1', 'p', 'suggested', 'pending', { face: 0 });
    match('m1', 'p', 'auto', 'pending', { face: 3 });
    match('m1', 'p', 'suggested', 'confirmed', { face: 2 });
    match('m2', 'q', 'auto', 'pending');
    match('m1', 'w', 'suggested', 'pending');
    expect(photos.profileFace(db(), 'm1', 'p')).toEqual({ assetId: 'p', faceIndex: 2 });
    expect(photos.profileFace(db(), 'm1', 'q')).toBeNull();
    expect(photos.profileFace(db(), 'm1', 'w')).toBeNull();
    expect(photos.profileFace(db(), 'm1', 'none')).toBeNull();
  });

  it('a member is enrolled by a reference alone, before any match', () => {
    expect(photos.faceStatus(db(), 'm1')).toEqual({ enrolled: false, photos: 0, toConfirm: 0 });
    db()
      .prepare(
        "INSERT INTO face_references (user_id, model, source, sealed, created_at) VALUES ('m1', ?, 'selfie', x'00', 1)"
      )
      .run(FACE_MODEL);
    expect(photos.faceStatus(db(), 'm1').enrolled).toBe(true);
    match('m2', 'w', 'suggested', 'pending');
    expect(photos.faceStatus(db(), 'm2')).toEqual({ enrolled: true, photos: 0, toConfirm: 1 });
  });
});

describe('GET /api/users/[userId]/photos-stream', () => {
  beforeEach(() => {
    photo('old', '2024-01-01T00:00:00Z');
    photo('new', '2025-06-01T00:00:00Z');
    photo('cv', '2024-06-01T00:00:00Z');
    photo('clip', '2025-01-01T00:00:00Z', 'VIDEO');
    for (const id of ['old', 'new', 'cv', 'clip']) match('m1', id, 'auto', 'pending');
    state.cvAlbum = ['cv'];
  });

  it('serves the owner their photos, newest first, videos left out, fetched BY ID', async () => {
    expect(await streamOf('m1')).toEqual({ status: 200, ids: ['new', 'cv', 'old'] });
    expect(immichCalls).toEqual(['POST /api/search/metadata']);
  });

  it('partitions on the PhotoCV album', async () => {
    expect((await streamOf('m1', '?in_album=false')).ids).toEqual(['new', 'old']);
    expect((await streamOf('m1', '?in_album=true')).ids).toEqual(['cv']);
  });

  it('serves a member the owner authorised, an admin and an API key', async () => {
    db()
      .prepare("INSERT INTO photo_access_permissions (owner_id, authorized_id) VALUES ('m1', 'm2')")
      .run();
    state.auth = member('m2');
    expect((await streamOf('m1')).status).toBe(200);
    state.auth = member('boss', 'admin');
    expect((await streamOf('m1')).status).toBe(200);
    state.auth = API_KEY;
    expect((await streamOf('m1')).status).toBe(200);
  });

  it('refuses a member the owner did not authorise, and asks Immich nothing', async () => {
    db()
      .prepare("INSERT INTO photo_access_permissions (owner_id, authorized_id) VALUES ('m2', 'm1')")
      .run();
    state.auth = member('m2');
    expect(await streamOf('m1')).toEqual({ status: 403, ids: null });
    state.auth = member('m3');
    expect(await streamOf('m1')).toEqual({ status: 403, ids: null });
    expect(immichCalls).toEqual([]);
  });

  it('answers an empty list without a call when the member has no photo', async () => {
    state.auth = member('m3');
    expect(await streamOf('m3')).toEqual({ status: 200, ids: [] });
    expect(immichCalls).toEqual([]);
  });

  it('refuses an Immich answer that ignored the filter rather than show photos not asked for', async () => {
    photo('stranger', '2025-07-01T00:00:00Z');
    ignoreFilter = ['new', 'stranger'];
    expect(await streamOf('m1')).toEqual({ status: 502, ids: null });
  });

  it("answers Immich's refusal of OUR search as 502, without Immich's text", async () => {
    searchFails = () => new Response('secret upstream detail', { status: 400 });
    const res = await call(streamRoute.GET, {
      params: { userId: 'm1' },
      url: new URL('http://x.test/api/users/m1/photos-stream'),
      request: new Request('http://x.test/'),
      fetch: immich,
    });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('secret upstream detail');
  });

  it('classifies the transport: unreachable 502, too slow 504', async () => {
    searchFails = () => {
      throw new TypeError('fetch failed');
    };
    expect((await streamOf('m1')).status).toBe(502);
    searchFails = () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    };
    expect((await streamOf('m1')).status).toBe(504);
    searchFails = () => new Response('<html>', { headers: { 'content-type': 'text/html' } });
    expect((await streamOf('m1')).status).toBe(502);
  });

  it('answers 503 when Immich is not configured, without asking anything', async () => {
    env.IMMICH_BASE_URL = '';
    expect((await streamOf('m1', '?in_album=false')).status).toBe(503);
    expect((await streamOf('m1')).status).toBe(503);
    expect(immichCalls).toEqual([]);
  });

  it('asks in batches of the declared size', async () => {
    const immichSearch = await import('#lib/server/immich-search.ts');
    db().exec('DELETE FROM face_matches;');
    const n = immichSearch.ASSET_ID_BATCH + 3;
    for (let i = 0; i < n; i++) {
      const id = `p${String(i).padStart(4, '0')}`;
      photo(id, '2024-01-01T00:00:00Z');
      match('m1', id, 'auto', 'pending', { created: i });
    }
    const res = await streamOf('m1');
    expect(res.status).toBe(200);
    expect(res.ids).toHaveLength(n);
    expect(immichCalls).toEqual(['POST /api/search/metadata', 'POST /api/search/metadata']);
  });
});

describe('GET /api/users/me/face/matches', () => {
  it("lists the member's waiting faces only, as asset and face, with nothing else", async () => {
    match('m1', 'a', 'suggested', 'pending');
    match('m1', 'b', 'auto', 'pending');
    match('m2', 'c', 'suggested', 'pending');
    const res = await call(matchRoute.GET, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, suggestions: [{ asset_id: 'a', face_index: 0 }] });
    expect(JSON.stringify(body)).not.toMatch(/distance|runner|band|m2|0\.42/);
  });

  it('refuses an impersonated session and a caller with no member', async () => {
    state.impersonating = true;
    expect((await call(matchRoute.GET, {})).status).toBe(403);
    state.impersonating = false;
    state.auth = API_KEY;
    expect((await call(matchRoute.GET, {})).status).toBe(401);
  });

  it('a "not me" deletes the cached picture of that face', async () => {
    match('m1', 'a', 'suggested', 'pending');
    box('a');
    expect((await crop('a')).status).toBe(200);
    expect(cachedCrops('m1')).toEqual(['a_0.webp']);
    const res = await call(matchRoute.POST, {
      request: new Request('http://x.test/', {
        method: 'POST',
        body: JSON.stringify({ asset_id: 'a', face_index: 0, verdict: 'reject' }),
      }),
      fetch: immich,
    });
    expect(res.status).toBe(200);
    expect(cachedCrops('m1')).toEqual([]);
  });
});

describe('GET /api/users/me/face/crops/[assetId]/[faceIndex]', () => {
  it('serves the holder a private, uncached square picture and caches it in their directory', async () => {
    match('m1', 'a', 'suggested', 'pending');
    box('a');
    const res = await crop('a');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([faceCrop.OUTPUT_SIZE, faceCrop.OUTPUT_SIZE]);
    expect(cachedCrops('m1')).toEqual(['a_0.webp']);
  });

  it("answers 404 for another member's face, a rejected one or a face with no box - and cuts nothing", async () => {
    match('m2', 'o', 'suggested', 'pending');
    box('o');
    match('m1', 'r', 'suggested', 'rejected');
    box('r');
    match('m1', 'n', 'suggested', 'pending');
    for (const asset of ['o', 'r', 'n', 'missing']) {
      expect((await crop(asset)).status).toBe(404);
    }
    expect(cachedCrops('m1')).toEqual([]);
    expect(cachedCrops('m2')).toEqual([]);
    expect(immichCalls).toEqual([]);
  });

  it('refuses an impersonated session, an API key and a malformed face', async () => {
    match('m1', 'a', 'suggested', 'pending');
    box('a');
    state.impersonating = true;
    expect((await crop('a')).status).toBe(403);
    state.impersonating = false;
    state.auth = API_KEY;
    expect((await crop('a')).status).toBe(401);
    state.auth = member('m1');
    expect((await crop('../a')).status).toBe(400);
    expect((await crop('a', '-1')).status).toBe(400);
    expect((await crop('a', 'x')).status).toBe(400);
    expect(cachedCrops('m1')).toEqual([]);
  });
});

describe('PUT /api/users/me/profile-photo', () => {
  it("stores a photo that is one of the member's", async () => {
    match('m1', 'a', 'auto', 'pending');
    const res = await choose({ asset_id: 'a' });
    expect(res.status).toBe(200);
    expect(profileOf('m1')).toBe('a');
  });

  it("refuses a photo that is not theirs - waiting, rejected, another member's - and keeps the old one", async () => {
    match('m1', 'a', 'auto', 'pending');
    await choose({ asset_id: 'a' });
    match('m1', 'w', 'suggested', 'pending');
    match('m1', 'r', 'auto', 'rejected');
    match('m2', 'o', 'auto', 'pending');
    for (const asset of ['w', 'r', 'o', 'none']) {
      expect((await choose({ asset_id: asset })).status).toBe(404);
    }
    expect(profileOf('m1')).toBe('a');
  });

  it("a member cannot choose for another member; an admin can, among THAT member's photos", async () => {
    match('m2', 'o', 'auto', 'pending');
    expect((await choose({ asset_id: 'o', user_id: 'm2' })).status).toBe(403);
    expect(profileOf('m2')).toBeNull();
    state.auth = member('boss', 'admin');
    expect((await choose({ asset_id: 'o', user_id: 'm2' })).status).toBe(200);
    expect(profileOf('m2')).toBe('o');
    match('m3', 'x', 'auto', 'pending');
    expect((await choose({ asset_id: 'x', user_id: 'm2' })).status).toBe(404);
    expect(profileOf('m2')).toBe('o');
  });

  it('refuses an impersonated session and a malformed body', async () => {
    match('m1', 'a', 'auto', 'pending');
    state.impersonating = true;
    expect((await choose({ asset_id: 'a' })).status).toBe(403);
    state.impersonating = false;
    expect((await choose({ asset_id: '../a' })).status).toBe(400);
    expect((await choose({ asset_id: 'a', user_id: 7 })).status).toBe(400);
    expect(profileOf('m1')).toBeNull();
  });
});

describe('GET /api/users/[username]/avatar', () => {
  it("cuts the member's own face out of the chosen photo", async () => {
    match('m1', 'a', 'auto', 'pending');
    box('a');
    db().prepare("UPDATE users SET photos_asset_id = 'a' WHERE id_user = 'm1'").run();
    state.auth = member('m2');
    const res = await avatar('m1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('etag')).toBe('"a"');
    expect(cachedCrops('m1')).toEqual(['a_0.webp']);
    expect(immichCalls).toEqual(['GET /api/assets/a/thumbnail']);
  });

  it("answers 404 with no photo chosen, or a photo no longer the member's, and cuts nothing", async () => {
    expect((await avatar('m1')).status).toBe(404);
    match('m1', 'a', 'auto', 'rejected');
    box('a');
    db().prepare("UPDATE users SET photos_asset_id = 'a' WHERE id_user = 'm1'").run();
    expect((await avatar('m1')).status).toBe(404);
    // A retired Immich person link gives no avatar either.
    db().prepare("UPDATE users SET photos_id = 'person-1' WHERE id_user = 'm2'").run();
    expect((await avatar('m2')).status).toBe(404);
    expect((await avatar('nobody')).status).toBe(404);
    expect(cachedCrops('m1')).toEqual([]);
    expect(immichCalls).toEqual([]);
  });
});

describe('the crop directory never escapes a member', () => {
  it('a crop asked by one member lands in their directory only', async () => {
    match('m1', 'a', 'suggested', 'pending');
    box('a');
    await crop('a');
    expect(cachedCrops('m1')).toEqual(['a_0.webp']);
    expect(path.dirname(faceCrop.memberCropDir('m1'))).toBe(
      path.dirname(faceCrop.memberCropDir('m2'))
    );
    expect(cachedCrops('m2')).toEqual([]);
  });
});
