/**
 * Lot A6's read side, called as HANDLERS against throwaway SQLite files with the session helpers
 * scripted and Immich faked: a member's photos (GET /api/users/[userId]/photos-stream), the faces
 * waiting for their answer (GET /api/users/me/face/matches), the picture of one of those faces
 * (GET /api/users/me/face/crops/...), the profile photo (PUT /api/users/me/profile-photo) and the
 * avatar cut from it (GET /api/users/[username]/avatar), plus the reads behind them
 * (face-photos.ts). Every case asserts the status AND what was (not) stored or cached; no answer
 * may carry a distance, a band or another member's id. SYNTHETIC ids and images only.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
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
  { face = 0, created = 1, model = FACE_MODEL, distance = 0.42 } = {}
) {
  db()
    .prepare(
      `INSERT INTO face_matches (asset_id, face_index, model, user_id, distance, runner_up, band, state, created_at)
       VALUES (?, ?, ?, ?, ?, 0.9, ?, ?, ?)`
    )
    .run(asset, face, model, user, distance, band, st, created);
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
/** Assets the faked Immich holds but its search leaves out by default (archived, locked). */
let archived = new Set<string>();
/** Assets in the faked Immich's trash: left out of search, `isTrashed` on a direct read. */
let trashed = new Set<string>();
/** When set, the faked search ignores its filter and answers this page instead. */
let ignoreFilter: string[] | null = null;
/** When set, the faked search answers (or throws) this instead. */
let searchFails: (() => Response) | null = null;
/** When set, the faked search announces more results by this cursor, as Immich v3 pages a filter. */
let announcedCursor: string | null = null;

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
      page?: number;
    };
    // What the live Immich v3 answers to a `page` alongside a `filter` (read 2026-11-01).
    if (body.page !== undefined) {
      return Response.json(
        {
          message: 'Validation failed',
          errors: [
            { path: ['page'], message: 'Deprecated field page cannot be combined with filter' },
          ],
        },
        { status: 400 }
      );
    }
    const asked = body.filter.or.map((c) => c.id.eq);
    const items = (ignoreFilter ?? asked)
      .filter((id) => !archived.has(id) && !trashed.has(id))
      .map((id) => library[id])
      .filter(Boolean);
    return Response.json({ assets: { items, nextPage: null, nextCursor: announcedCursor } });
  }
  const one = u.pathname.match(/^\/api\/assets\/([^/]+)$/);
  if (one && (init?.method ?? 'GET') === 'GET') {
    const asset = library[decodeURIComponent(one[1])];
    return asset
      ? Response.json({ ...asset, isTrashed: trashed.has(asset.id) })
      : Response.json({ message: 'Not found' }, { status: 404 });
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

afterEach(async () => {
  // A background run a test started ends inside that test: one left in flight would make the
  // next test's schedule for the same member a no-op, and would read the next test's data.
  await (await import('#lib/server/profile-photo-default.ts')).defaultPhotosSettled();
  vi.unstubAllGlobals();
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
  archived = new Set();
  trashed = new Set();
  searchFails = null;
  // The avatar route's background default-photo look runs on the GLOBAL fetch: here, the faked
  // Immich, so no test ever reaches the network (a real lookup of immich.test hung on CI).
  vi.stubGlobal('fetch', immich);
  env.IMMICH_BASE_URL = 'http://immich.test';
  ignoreFilter = null;
  announcedCursor = null;
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

  it('the faces to confirm are the pending suggested ones only, NEAREST first (faces v2)', () => {
    // The nearer face is the NEWER match: an order by age would put it last.
    match('m1', 'a', 'suggested', 'pending', { created: 1, distance: 0.6 });
    match('m1', 'z', 'suggested', 'pending', { created: 2, distance: 0.55 });
    match('m1', 'b', 'suggested', 'pending', { face: 2, created: 3, distance: 0.51 });
    match('m1', 'c', 'suggested', 'confirmed');
    match('m1', 'd', 'auto', 'pending');
    match('m1', 'e', 'suggested', 'rejected');
    match('m2', 'f', 'suggested', 'pending');
    expect(photos.pendingSuggestions(db(), 'm1')).toEqual([
      { assetId: 'b', faceIndex: 2 },
      { assetId: 'z', faceIndex: 0 },
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

  it('is never cached: the list is derived from face matches', async () => {
    const res = await call(streamRoute.GET, {
      params: { userId: 'm1' },
      url: new URL('http://x.test/api/users/m1/photos-stream'),
      request: new Request('http://x.test/'),
      fetch: immich,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
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

  it('refuses a filtered answer that announces more results by a cursor', async () => {
    announcedCursor = 'opaque-cursor';
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
    const res = await call(matchRoute.GET, {
      url: new URL('http://x.test/api/users/me/face/matches'),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, suggestions: [{ asset_id: 'a', face_index: 0 }] });
    expect(JSON.stringify(body)).not.toMatch(/distance|runner|band|m2|0\.42/);
  });

  it('with ?list=shown, lists the faces shown without a question that "Pas moi" may still refuse, least sure first', async () => {
    match('m1', 'sure', 'auto', 'pending', { distance: 0.2 });
    match('m1', 'doubt', 'auto', 'pending', { distance: 0.38 });
    match('m1', 'said-yes', 'auto', 'confirmed', { distance: 0.4 });
    match('m1', 'asked', 'suggested', 'pending', { distance: 0.5 });
    match('m1', 'said-no', 'auto', 'rejected', { distance: 0.3 });
    match('m2', 'theirs', 'auto', 'pending', { distance: 0.39 });
    const res = await call(matchRoute.GET, {
      url: new URL('http://x.test/api/users/me/face/matches?list=shown'),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      suggestions: [
        { asset_id: 'doubt', face_index: 0 },
        { asset_id: 'sure', face_index: 0 },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(/distance|band|m2|0\.38/);
  });

  it('refuses an impersonated session and a caller with no member', async () => {
    state.impersonating = true;
    expect(
      (await call(matchRoute.GET, { url: new URL('http://x.test/api/users/me/face/matches') }))
        .status
    ).toBe(403);
    state.impersonating = false;
    state.auth = API_KEY;
    expect(
      (await call(matchRoute.GET, { url: new URL('http://x.test/api/users/me/face/matches') }))
        .status
    ).toBe(401);
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

  it('is never immutable, and a revalidation is answered only while the face is still theirs', async () => {
    match('m1', 'a', 'auto', 'pending');
    box('a');
    db().prepare("UPDATE users SET photos_asset_id = 'a' WHERE id_user = 'm1'").run();
    state.auth = member('m2');
    const get = (query: string, etag?: string) =>
      call(avatarRoute.GET, {
        params: { username: 'm1' },
        url: new URL(`http://x.test/api/users/m1/avatar${query}`),
        request: new Request('http://x.test/', {
          headers: etag ? { 'if-none-match': etag } : {},
        }),
        fetch: immich,
      });
    expect((await get('?v=a')).headers.get('cache-control')).toBe('private, max-age=3600');
    expect((await get('')).headers.get('cache-control')).toBe('private, no-cache');
    const revalidated = await get('?v=a', '"a"');
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get('cache-control')).toBe('private, max-age=3600');
    // The face went (a withdrawal clears the pointer): the same validator gets no 304.
    db().prepare("UPDATE users SET photos_asset_id = NULL WHERE id_user = 'm1'").run();
    expect((await get('?v=a', '"a"')).status).toBe(404);
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

describe('the default profile photo (owner, 2026-11-01)', () => {
  let defaults: typeof import('#lib/server/profile-photo-default.ts');
  let refs: typeof import('#lib/server/face-references.ts');
  let seal: typeof import('#lib/server/face-seal.ts');
  let emb: typeof import('#lib/face-embedding.ts');
  const key = Buffer.from('ab'.repeat(32), 'hex');
  const engine = () => ({ db: db(), faceDb: faceDb(), key });

  /** A unit vector along axis `i` (synthetic, never a face). */
  const axis = (i: number) => {
    const v = new Float32Array(512);
    v[i] = 1;
    return v;
  };

  beforeAll(async () => {
    defaults = await import('#lib/server/profile-photo-default.ts');
    refs = await import('#lib/server/face-references.ts');
    seal = await import('#lib/server/face-seal.ts');
    emb = await import('#lib/face-embedding.ts');
  });

  /** A face in the store with a real sealed vector and a box `side` px wide in a 400x300 frame. */
  function storeFace(asset: string, face: number, v: Float32Array, side = 80) {
    faceDb()
      .prepare(
        `INSERT INTO face_embeddings (asset_id, face_index, model, x1, y1, x2, y2, img_w, img_h, score, sealed, created_at)
         VALUES (?, ?, ?, 40, 30, ?, ?, 400, 300, 0.9, ?, 1)`
      )
      .run(
        asset,
        face,
        FACE_MODEL,
        40 + side,
        30 + side,
        seal.seal(key, seal.embeddingContext(asset, face, FACE_MODEL), emb.encodeEmbedding(v))
      );
  }

  /** One match row of `user` on `asset`, visible by default (auto, pending). */
  function held(
    user: string,
    asset: string,
    opts: {
      band?: 'auto' | 'suggested';
      state?: 'pending' | 'confirmed';
      distance?: number;
      face?: number;
    } = {}
  ) {
    db()
      .prepare(
        `INSERT INTO face_matches (asset_id, face_index, model, user_id, distance, runner_up, band, state, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 1)`
      )
      .run(
        asset,
        opts.face ?? 0,
        FACE_MODEL,
        user,
        opts.distance ?? 0.3,
        opts.band ?? 'auto',
        opts.state ?? 'pending'
      );
  }

  const pointer = (id: string) =>
    db()
      .prepare('SELECT photos_asset_id AS a, photos_asset_source AS s FROM users WHERE id_user = ?')
      .get(id) as { a: string | null; s: string | null };

  const run = (
    user: string,
    featured?: import('#lib/server/profile-photo-default.ts').FeaturedFace,
    dryRun = false
  ) => defaults.ensureDefaultProfilePhoto(engine(), user, immich, { featured, dryRun });

  it('gives a member with none the best of their own photos: confirmed, then nearer, then larger', async () => {
    for (const [a, side] of [
      ['near-small', 40],
      ['near-big', 120],
      ['far', 200],
      ['conf', 30],
    ] as const) {
      storeFace(a, 0, axis(1), side);
      photo(a, '2026-01-01T00:00:00Z');
    }
    held('m1', 'near-small', { distance: 0.21 });
    held('m1', 'near-big', { distance: 0.22 });
    held('m1', 'far', { distance: 0.45 });
    expect(await run('m1')).toBe('set_scored');
    // Same closeness step: the larger face wins over the nearer-by-a-hair small one.
    expect(pointer('m1')).toEqual({ a: 'near-big', s: 'default' });
    // A confirmed face outranks every auto one, whatever its size.
    held('m1', 'conf', { state: 'confirmed', band: 'suggested', distance: 0.55 });
    expect(await run('m1')).toBe('set_scored');
    expect(pointer('m1')).toEqual({ a: 'conf', s: 'default' });
  });

  it('skips a photo Immich no longer serves (trashed or deleted)', async () => {
    storeFace('gone', 0, axis(1), 200);
    storeFace('kept', 0, axis(1), 40);
    photo('kept', '2026-01-01T00:00:00Z');
    held('m1', 'gone', { distance: 0.1 });
    held('m1', 'kept', { distance: 0.4 });
    expect(await run('m1')).toBe('set_scored');
    expect(pointer('m1')).toEqual({ a: 'kept', s: 'default' });
  });

  it("never overwrites a member's valid choice; replaces a choice whose photo is gone", async () => {
    storeFace('mine', 0, axis(1), 30);
    storeFace('better', 0, axis(1), 200);
    photo('mine', '2026-01-01T00:00:00Z');
    photo('better', '2026-01-01T00:00:00Z');
    held('m1', 'mine', { distance: 0.45 });
    held('m1', 'better', { distance: 0.1 });
    expect((await choose({ asset_id: 'mine' })).status).toBe(200);
    expect(pointer('m1')).toEqual({ a: 'mine', s: 'chosen' });
    expect(await run('m1')).toBe('kept_choice');
    expect(pointer('m1')).toEqual({ a: 'mine', s: 'chosen' });
    // Archived (or locked): the search leaves it out, but Immich still has it - kept.
    archived.add('mine');
    expect(await run('m1')).toBe('kept_choice');
    expect(pointer('m1')).toEqual({ a: 'mine', s: 'chosen' });
    // In the trash: gone, replaced.
    trashed.add('mine');
    expect(await run('m1')).toBe('set_scored');
    expect(pointer('m1')).toEqual({ a: 'better', s: 'default' });
  });

  it('replaces a chosen photo Immich deleted, and never one it cannot read', async () => {
    storeFace('mine', 0, axis(1), 30);
    storeFace('better', 0, axis(1), 200);
    photo('mine', '2026-01-01T00:00:00Z');
    photo('better', '2026-01-01T00:00:00Z');
    held('m1', 'mine', { distance: 0.45 });
    held('m1', 'better', { distance: 0.1 });
    expect((await choose({ asset_id: 'mine' })).status).toBe(200);
    archived.add('mine');
    // Immich does not answer the direct read: an unknown state is never "gone".
    const down = immich;
    const failing = (async (url: string, init?: RequestInit) =>
      new URL(String(url)).pathname.endsWith('/api/assets/mine')
        ? new Response('boom', { status: 500 })
        : down(url, init)) as unknown as typeof fetch;
    await expect(
      defaults.ensureDefaultProfilePhoto(engine(), 'm1', failing, {})
    ).rejects.toBeTruthy();
    expect(pointer('m1')).toEqual({ a: 'mine', s: 'chosen' });
    delete library.mine;
    expect(await run('m1')).toBe('set_scored');
    expect(pointer('m1')).toEqual({ a: 'better', s: 'default' });
  });

  it('replaces a default by a better default, and keeps it when nothing better came', async () => {
    storeFace('first', 0, axis(1), 40);
    photo('first', '2026-01-01T00:00:00Z');
    held('m1', 'first', { distance: 0.3 });
    await run('m1');
    expect(pointer('m1')).toEqual({ a: 'first', s: 'default' });
    expect(await run('m1')).toBe('kept_default');
    storeFace('second', 0, axis(1), 40);
    photo('second', '2026-01-01T00:00:00Z');
    held('m1', 'second', { state: 'confirmed', distance: 0.3 });
    expect(await run('m1')).toBe('set_scored');
    expect(pointer('m1')).toEqual({ a: 'second', s: 'default' });
  });

  it('prefers the face Immich featured for their old person, the photo they had before A6', async () => {
    storeFace('best', 0, axis(1), 200);
    storeFace('feat', 0, axis(2), 40);
    storeFace('feat', 1, axis(1), 40);
    // Face 1 of 'feat' sits elsewhere in the frame: the featured box names face 1, not face 0.
    faceDb()
      .prepare(
        "UPDATE face_embeddings SET x1 = 200, y1 = 150, x2 = 280, y2 = 230 WHERE asset_id = 'feat' AND face_index = 1"
      )
      .run();
    photo('best', '2026-01-01T00:00:00Z');
    photo('feat', '2026-01-01T00:00:00Z');
    held('m1', 'best', { distance: 0.1 });
    held('m1', 'feat', { distance: 0.4, face: 1 });
    // The featured box, in a frame twice as large: found by overlap, not by equality.
    const featured = { assetId: 'feat', x1: 400, y1: 300, x2: 560, y2: 460, imgW: 800, imgH: 600 };
    expect(await run('m1', featured)).toBe('set_featured');
    expect(pointer('m1')).toEqual({ a: 'feat', s: 'default' });
  });

  it('never claims the featured face: held by another member, it stays theirs and the member gets their best match', async () => {
    refs.addFaceReference(db(), key, 'm1', 'seed', axis(1));
    refs.addFaceReference(db(), key, 'm2', 'seed', axis(1));
    storeFace('feat', 0, axis(1), 40);
    storeFace('own', 0, axis(1), 40);
    photo('feat', '2026-01-01T00:00:00Z');
    photo('own', '2026-01-01T00:00:00Z');
    // The face Immich featured for m1's old person is m2's auto match today.
    held('m2', 'feat', { distance: 0.2 });
    held('m1', 'own', { distance: 0.3 });
    const featured = { assetId: 'feat', x1: 40, y1: 30, x2: 80, y2: 70, imgW: 400, imgH: 300 };
    const seen: { featuredNotTheirs?: boolean } = {};
    expect(
      await defaults.ensureDefaultProfilePhoto(engine(), 'm1', immich, { featured, report: seen })
    ).toBe('set_scored');
    expect(pointer('m1')).toEqual({ a: 'own', s: 'default' });
    expect(seen.featuredNotTheirs).toBe(true);
    // m2 keeps the photo, untouched: no claim, no confirmation written without a human.
    expect(
      db().prepare("SELECT user_id, band, state FROM face_matches WHERE asset_id = 'feat'").all()
    ).toEqual([{ user_id: 'm2', band: 'auto', state: 'pending' }]);
    // Waiting for m1's own answer (suggested): not taken either, and never confirmed for them.
    db().prepare("DELETE FROM face_matches WHERE asset_id = 'feat'").run();
    held('m1', 'feat', { band: 'suggested', distance: 0.55 });
    expect(await run('m1', featured)).toBe('kept_default');
    expect(
      db().prepare("SELECT user_id, band, state FROM face_matches WHERE asset_id = 'feat'").all()
    ).toEqual([{ user_id: 'm1', band: 'suggested', state: 'pending' }]);
  });

  it('a run over every member: counts by outcome, idempotent, a gone group ranked from matches, a dry run writes nothing', async () => {
    storeFace('a1', 0, axis(1), 40);
    photo('a1', '2026-01-01T00:00:00Z');
    held('m1', 'a1');
    storeFace('b1', 0, axis(1), 40);
    photo('b1', '2026-01-01T00:00:00Z');
    held('m2', 'b1');
    // m2's old person has no featured face (the group is gone): ranked from their matches.
    db()
      .prepare(
        "UPDATE users SET photos_id = '11111111-1111-4111-8111-111111111111' WHERE id_user = 'm2'"
      )
      .run();
    // m3 is enrolled and holds no photo at all.
    refs.addFaceReference(db(), key, 'm3', 'seed', axis(1));
    const dry = await defaults.runDefaultProfilePhotos(engine(), immich, new Map(), true);
    expect(dry).toMatchObject({ members: 3, set_scored: 2, none: 1, failed: 0 });
    expect(pointer('m1')).toEqual({ a: null, s: null });
    const first = await defaults.runDefaultProfilePhotos(engine(), immich, new Map(), false);
    expect(first).toMatchObject({ members: 3, set_scored: 2, none: 1, featuredGiven: 0 });
    const second = await defaults.runDefaultProfilePhotos(engine(), immich, new Map(), false);
    expect(second).toMatchObject({ members: 3, kept_default: 2, none: 1, set_scored: 0 });
  });

  it('the avatar of a member with no photo finds one in the background; the next request is served', async () => {
    storeFace('a1', 0, axis(1), 40);
    photo('a1', '2026-01-01T00:00:00Z');
    held('m1', 'a1');
    state.auth = member('m2');
    // The background work runs on the GLOBAL fetch (it outlives the request), never event.fetch.
    vi.stubGlobal('fetch', immich);
    // The request's own fetch refuses everything: only the global one can find the default.
    const requestFetch = (async () => {
      throw new Error('event.fetch used after the response');
    }) as unknown as typeof fetch;
    try {
      const first = await call(avatarRoute.GET, {
        params: { username: 'm1' },
        url: new URL('http://x.test/api/users/m1/avatar'),
        request: new Request('http://x.test/'),
        fetch: requestFetch,
      });
      expect(first.status).toBe(404);
      // Awaited, never polled against a clock (a slow runner failed a 500 ms poll).
      await defaults.defaultPhotosSettled();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(pointer('m1')).toEqual({ a: 'a1', s: 'default' });
    expect((await avatar('m1')).status).toBe(200);
  });

  it('the admin run: two POSTs at once start ONE run, the other is told 409', async () => {
    const route = await import('../src/routes/api/admin/faces/default-photos/+server');
    state.auth = member('boss', 'admin');
    storeFace('a1', 0, axis(1), 40);
    photo('a1', '2026-01-01T00:00:00Z');
    held('m1', 'a1');
    vi.stubGlobal('fetch', immich);
    try {
      const post = () =>
        call(route.POST, {
          request: new Request('http://x.test/', {
            method: 'POST',
            body: JSON.stringify({ dryRun: true }),
          }),
        });
      const statuses = (await Promise.all([post(), post()])).map((r) => r.status).sort();
      expect(statuses).toEqual([202, 409]);
      let state_: { status?: string; report?: Record<string, number> } = {};
      // Until the run ends, however long it takes: the test's own timeout is the only bound.
      do {
        await new Promise((r) => setImmediate(r));
        state_ = await (await call(route.GET, {})).json();
      } while (state_.status === 'running');
      expect(state_).toMatchObject({ status: 'done', report: { members: 1, set_scored: 1 } });
      // A dry run writes nothing.
      expect(pointer('m1')).toEqual({ a: null, s: null });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('end to end: a choice is stored, served as the avatar, and read back by the picker', async () => {
    storeFace('p', 0, axis(1), 40);
    storeFace('q', 2, axis(1), 40);
    photo('p', '2026-01-01T00:00:00Z');
    held('m1', 'p');
    held('m1', 'q', { face: 2 });
    expect((await choose({ asset_id: 'q' })).status).toBe(200);
    const read = await call(profileRoute.GET, {
      url: new URL('http://x.test/api/users/me/profile-photo'),
    });
    expect(await read.json()).toEqual({
      success: true,
      current: { asset_id: 'q', source: 'chosen' },
      faces: { p: 0, q: 2 },
    });
    state.auth = member('m2');
    expect((await avatar('m1')).status).toBe(200);
    expect(cachedCrops('m1')).toEqual(['q_2.webp']);
    // The admin path: a member cannot read another's, an admin reads and sets it.
    const other = () =>
      call(profileRoute.GET, {
        url: new URL('http://x.test/api/users/me/profile-photo?user_id=m1'),
      });
    expect((await other()).status).toBe(403);
    state.auth = member('boss', 'admin');
    expect((await other()).status).toBe(200);
    expect((await choose({ asset_id: 'p', user_id: 'm1' })).status).toBe(200);
    expect(pointer('m1')).toEqual({ a: 'p', s: 'chosen' });
  });
});
