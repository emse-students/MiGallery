/**
 * The face-link routes, called as HANDLERS against a throwaway SQLite file with the session
 * helpers scripted: PATCH /api/users/me/face, PUT and POST /api/users, DELETE /api/users/me,
 * the photo-access grants, and the two throw paths of the erasure worker.
 *
 * Every case asserts the status AND the side effects (the link, the grants, the consent row, the
 * journal), not a set of acceptable codes.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { removeTempDir } from './test-helpers';

const state = vi.hoisted(() => ({
  user: null as null | { id_user: string; role: string },
  admin: false,
  impersonating: false,
  proof: { ok: true } as { ok: true } | { ok: false; reason: string },
}));

vi.mock('#lib/server/env.ts', () => ({
  env: { IMMICH_BASE_URL: 'http://immich.test', IMMICH_API_KEY: 'k' },
}));
vi.mock('#lib/server/permissions.ts', () => ({
  requireScope: async () => {
    if (!state.user) throw Object.assign(new Error('unauthorized'), { status: 401 });
    return {
      user: state.user,
      grantedScope: state.admin ? 'admin' : 'read',
      viaApiKey: false,
    };
  },
  requireSession: async () => {
    if (!state.user) throw Object.assign(new Error('unauthorized'), { status: 401 });
    return state.user;
  },
}));
vi.mock('#lib/server/auth.ts', () => ({
  isImpersonating: () => state.impersonating,
  getRequestSession: () => null,
}));
vi.mock('#lib/session.ts', () => ({ clearSessionCookie: vi.fn() }));
vi.mock('#lib/server/logs.ts', () => ({ logEvent: vi.fn() }));
vi.mock('#lib/server/face-access.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/face-access.ts')>()),
  selfieProves: async () => state.proof,
}));

let database: typeof import('#lib/db/database.ts');
let erasure: typeof import('#lib/server/face-erasure.ts');
let faceRoute: typeof import('../src/routes/api/users/me/face/+server');
let putUser: typeof import('../src/routes/api/users/[id]/+server');
let usersRoute: typeof import('../src/routes/api/users/+server');
let meRoute: typeof import('../src/routes/api/users/me/+server');
let grantRoute: typeof import('../src/routes/api/users/me/photo-access/+server');
let faceCrop: typeof import('#lib/server/face-crop.ts');
let legal: typeof import('#lib/legal.ts');
let dbDir: string;

const A = 'cccccccc-0000-4000-8000-00000000000a';
const B = 'cccccccc-0000-4000-8000-00000000000b';
const FACE_DIR = path.resolve('data/cache/faces');

const req = (method: string, body: unknown) =>
  new Request('http://x.test/', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

async function call(fn: unknown, event: object): Promise<{ status: number; body: unknown }> {
  try {
    const res = (await (fn as (e: never) => Promise<Response>)(event as never)) as Response;
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    return { status: (e as { status?: number }).status ?? 500, body: null };
  }
}

const patch = (body: unknown) =>
  call(faceRoute.PATCH, { request: req('PATCH', body), fetch: globalThis.fetch });
const put = (id: string, body: unknown) =>
  call(putUser.PUT, { request: req('PUT', body), params: { id }, fetch: globalThis.fetch });

const db = () => database.getDatabase();
const addUser = (id: string, photos: string | null) =>
  db()
    .prepare('INSERT INTO users (id_user, name, photos_id, photos_asset_id) VALUES (?, ?, ?, ?)')
    .run(id, id, photos, photos ? 'asset-of-' + id : null);
const consents = (id: string) =>
  db()
    .prepare(
      'SELECT source, version, withdrawn_at FROM face_consents WHERE user_id = ? ORDER BY id'
    )
    .all(id) as Array<{ source: string; version: string; withdrawn_at: number | null }>;
const journal = () =>
  db().prepare('SELECT person_id, reason FROM face_erasures ORDER BY id').all() as Array<{
    person_id: string | null;
    reason: string;
  }>;
const linkOf = (id: string) =>
  db().prepare('SELECT photos_id, photos_asset_id FROM users WHERE id_user = ?').get(id);
const grants = () =>
  db()
    .prepare('SELECT owner_id, authorized_id FROM photo_access_permissions ORDER BY owner_id')
    .all();

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-face-routes-'));
  process.env.DATABASE_PATH = join(dbDir, 'face-routes.db');
  database = await import('#lib/db/database.ts');
  erasure = await import('#lib/server/face-erasure.ts');
  faceRoute = await import('../src/routes/api/users/me/face/+server');
  putUser = await import('../src/routes/api/users/[id]/+server');
  usersRoute = await import('../src/routes/api/users/+server');
  meRoute = await import('../src/routes/api/users/me/+server');
  grantRoute = await import('../src/routes/api/users/me/photo-access/+server');
  faceCrop = await import('#lib/server/face-crop.ts');
  legal = await import('#lib/legal.ts');
  // An Immich that is down: a kicked erasure run records one refused attempt and reaches no network.
  vi.stubGlobal('fetch', async () => new Response('down', { status: 503 }));
});

afterAll(() => {
  vi.unstubAllGlobals();
  database.resetDatabase();
  removeTempDir(dbDir);
});

beforeEach(() => {
  db().exec(
    'DELETE FROM face_erasures; DELETE FROM face_consents; DELETE FROM photo_access_permissions; DELETE FROM users;'
  );
  state.user = { id_user: 'member', role: 'user' };
  state.admin = false;
  state.impersonating = false;
  state.proof = { ok: true };
});

describe('PATCH /api/users/me/face - linking', () => {
  it('a member with a passing selfie links, and the consent says selfie and which terms', async () => {
    addUser('member', null);
    expect((await patch({ person_id: A })).status).toBe(200);
    expect(linkOf('member')).toEqual({ photos_id: A, photos_asset_id: null });
    expect(consents('member')).toEqual([
      { source: 'selfie', version: legal.TERMS_VERSION, withdrawn_at: null },
    ]);
  });

  it('without the selfie proof: 403, and nothing changed', async () => {
    addUser('member', null);
    state.proof = { ok: false, reason: 'no selfie asset' };
    const res = await patch({ person_id: A });
    expect(res.status).toBe(403);
    expect(linkOf('member')).toEqual({ photos_id: null, photos_asset_id: null });
    expect(consents('member')).toEqual([]);
  });

  it('an admin acting on their OWN account skips the proof, so the consent says admin', async () => {
    addUser('member', null);
    state.admin = true;
    state.user = { id_user: 'member', role: 'admin' };
    state.proof = { ok: false, reason: 'would have failed' };
    expect((await patch({ person_id: A })).status).toBe(200);
    expect(consents('member')[0].source).toBe('admin');
  });

  it('a person another member holds: 409, nothing changed', async () => {
    addUser('member', null);
    addUser('other', A);
    const res = await patch({ person_id: A });
    expect(res.status).toBe(409);
    expect(linkOf('member')).toEqual({ photos_id: null, photos_asset_id: null });
    expect(consents('member')).toEqual([]);
  });
});

describe('PATCH /api/users/me/face - the same person again', () => {
  it('keeps the grants, the consent and the journal untouched', async () => {
    addUser('member', A);
    addUser('friend', null);
    db()
      .prepare(
        'INSERT INTO face_consents (user_id, created_at, version, source) VALUES (?, 1, ?, ?)'
      )
      .run('member', 'v', 'selfie');
    db()
      .prepare('INSERT INTO photo_access_permissions (owner_id, authorized_id) VALUES (?, ?)')
      .run('member', 'friend');
    expect((await patch({ person_id: A })).status).toBe(200);
    expect(grants()).toHaveLength(1);
    expect(journal()).toEqual([]);
    expect(consents('member')).toHaveLength(1);
    expect(consents('member')[0].withdrawn_at).toBeNull();
  });
});

describe('PATCH /api/users/me/face - a changed person never carries the old one over', () => {
  async function linkedWithGrantAndCrop() {
    addUser('member', A);
    addUser('friend', null);
    db()
      .prepare(
        "INSERT INTO face_consents (user_id, created_at, version, source) VALUES ('member', 1, 'legacy', 'legacy')"
      )
      .run();
    db()
      .prepare('INSERT INTO photo_access_permissions (owner_id, authorized_id) VALUES (?, ?)')
      .run('member', 'friend');
    db()
      .prepare('INSERT INTO photo_access_permissions (owner_id, authorized_id) VALUES (?, ?)')
      .run('friend', 'member');
    fs.mkdirSync(FACE_DIR, { recursive: true });
    const crop = path.join(FACE_DIR, `asset-x_${A}.webp`);
    fs.writeFileSync(crop, 'x');
    return crop;
  }

  it('a RELINK drops the grants given, closes the old consent, opens a new one, journals the OLD person, clears the profile pointer, removes the old crops', async () => {
    const crop = await linkedWithGrantAndCrop();

    expect((await patch({ person_id: B })).status).toBe(200);

    expect(linkOf('member')).toEqual({ photos_id: B, photos_asset_id: null });
    // Only what the member GAVE goes; what the friend gave them is about the friend's face.
    expect(grants()).toEqual([{ owner_id: 'friend', authorized_id: 'member' }]);
    expect(consents('member').map((c) => [c.source, c.withdrawn_at === null])).toEqual([
      ['legacy', false],
      ['selfie', true],
    ]);
    expect(journal()).toEqual([{ person_id: A, reason: 'relink' }]);
    expect(fs.existsSync(crop)).toBe(false);
  });

  it('an ADMIN unlink with user_id does the same, as admin_unlink', async () => {
    const crop = await linkedWithGrantAndCrop();
    state.admin = true;
    state.user = { id_user: 'boss', role: 'admin' };

    expect((await patch({ person_id: null, user_id: 'member' })).status).toBe(200);

    expect(linkOf('member')).toEqual({ photos_id: null, photos_asset_id: null });
    expect(grants()).toEqual([{ owner_id: 'friend', authorized_id: 'member' }]);
    expect(consents('member')[0].withdrawn_at).not.toBeNull();
    expect(journal()).toEqual([{ person_id: A, reason: 'admin_unlink' }]);
    expect(fs.existsSync(crop)).toBe(false);
  });

  it('a self-service unlink is a withdrawal', async () => {
    await linkedWithGrantAndCrop();
    expect((await patch({ person_id: null })).status).toBe(200);
    expect(journal()).toEqual([{ person_id: A, reason: 'withdrawal' }]);
  });

  it('the journal job of the OLD person clears the old person, never the new one', async () => {
    await linkedWithGrantAndCrop();
    await patch({ person_id: B });
    const touched: string[] = [];
    // After the PUT the re-read must see no name: script it.
    let put = false;
    const scripted = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') put = true;
      touched.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return new Response(JSON.stringify({ id: A, name: put ? '' : 'Alice', birthDate: null }), {
        status: 200,
      });
    }) as typeof fetch;

    // Let the run the PATCH kicked (against the down Immich) finish first: a second call made while
    // one is in progress joins it instead of using its own fetch.
    await erasure.runFaceErasures();
    await erasure.runFaceErasures(scripted);

    expect(touched.every((t) => t.includes(A) && !t.includes(B))).toBe(true);
    expect(touched).toContain(`PUT http://immich.test/api/people/${A}`);
    expect(db().prepare('SELECT outcome FROM face_erasures').all()).toEqual([
      { outcome: 'erased' },
    ]);
  });
});

describe('impersonation', () => {
  it('refuses a link, a withdrawal and a profile photo, and changes nothing', async () => {
    addUser('member', A);
    state.impersonating = true;
    expect((await patch({ person_id: B })).status).toBe(403);
    expect((await patch({ person_id: null })).status).toBe(403);
    expect((await patch({ person_id: A, photos_asset_id: 'other-asset' })).status).toBe(403);
    expect(linkOf('member')).toEqual({ photos_id: A, photos_asset_id: 'asset-of-member' });
    expect(journal()).toEqual([]);
  });

  it('refuses giving and revoking a photo-access grant', async () => {
    addUser('member', A);
    addUser('friend', null);
    state.impersonating = true;
    const give = await call(grantRoute.POST, {
      request: req('POST', { user_id: 'friend' }),
    });
    expect(give.status).toBe(403);
    expect(grants()).toEqual([]);

    db()
      .prepare('INSERT INTO photo_access_permissions (owner_id, authorized_id) VALUES (?, ?)')
      .run('member', 'friend');
    const take = await call(grantRoute.DELETE, {
      request: req('DELETE', { user_id: 'friend' }),
    });
    expect(take.status).toBe(403);
    expect(grants()).toHaveLength(1);
  });

  it('refuses deleting the account', async () => {
    addUser('member', A);
    state.impersonating = true;
    const res = await call(meRoute.DELETE, { request: req('DELETE', {}), cookies: {} });
    expect(res.status).toBe(403);
    expect(db().prepare("SELECT 1 FROM users WHERE id_user = 'member'").get()).not.toBeNull();
  });
});

describe('an impersonated admin session cannot touch the face data of a member', () => {
  beforeEach(() => {
    state.admin = true;
    state.user = { id_user: 'boss', role: 'admin' };
    state.impersonating = true;
  });

  it('PUT with photos_id, DELETE and POST are 403 and change nothing; PUT without photos_id still edits', async () => {
    addUser('member', A);
    expect((await put('member', { name: 'M', photos_id: B, role: 'user' })).status).toBe(403);
    expect((await put('member', { name: 'M', photos_id: '', role: 'user' })).status).toBe(403);
    const del = await call(putUser.DELETE, {
      request: req('DELETE', {}),
      params: { id: 'member' },
    });
    expect(del.status).toBe(403);
    const create = await call(usersRoute.POST, {
      request: req('POST', { id_user: 'fresh', name: 'F', photos_id: B }),
    });
    expect(create.status).toBe(403);
    expect(linkOf('member')).toEqual({ photos_id: A, photos_asset_id: 'asset-of-member' });
    expect(db().prepare("SELECT 1 FROM users WHERE id_user = 'fresh'").get()).toBeNull();
    expect(journal()).toEqual([]);

    expect((await put('member', { name: 'Renamed', role: 'user' })).status).toBe(200);
    expect(linkOf('member')).toMatchObject({ photos_id: A });
  });
});

describe('admin writes of photos_id', () => {
  beforeEach(() => {
    state.admin = true;
    state.user = { id_user: 'boss', role: 'admin' };
  });

  it('PUT: a changed person drops the old grants, journals it, records an admin consent', async () => {
    addUser('member', A);
    addUser('friend', null);
    db()
      .prepare('INSERT INTO photo_access_permissions (owner_id, authorized_id) VALUES (?, ?)')
      .run('member', 'friend');

    expect((await put('member', { name: 'M', photos_id: B, role: 'user' })).status).toBe(200);

    expect(linkOf('member')).toEqual({ photos_id: B, photos_asset_id: null });
    expect(grants()).toEqual([]);
    expect(journal()).toEqual([{ person_id: A, reason: 'relink' }]);
    expect(consents('member').at(-1)?.source).toBe('admin');
  });

  it('PUT with an empty photos_id is an unlink; omitting photos_id leaves the link alone', async () => {
    addUser('member', A);
    expect((await put('member', { name: 'M', role: 'user' })).status).toBe(200);
    expect(linkOf('member')).toMatchObject({ photos_id: A });
    expect((await put('member', { name: 'M', role: 'user', photos_id: '' })).status).toBe(200);
    expect(linkOf('member')).toEqual({ photos_id: null, photos_asset_id: null });
    expect(journal()).toEqual([{ person_id: A, reason: 'admin_unlink' }]);
  });

  it('PUT: a person another member holds is 409 and nothing moved; a non-string is 400', async () => {
    addUser('member', null);
    addUser('other', B);
    expect((await put('member', { name: 'M', photos_id: B, role: 'user' })).status).toBe(409);
    expect(linkOf('member')).toEqual({ photos_id: null, photos_asset_id: null });
    expect((await put('member', { name: 'M', photos_id: 42, role: 'user' })).status).toBe(400);
  });

  it('PUT on an unknown user: 404, and no stray consent row', async () => {
    expect((await put('ghost', { name: 'G', photos_id: A, role: 'user' })).status).toBe(404);
    expect(consents('ghost')).toEqual([]);
  });

  it('POST: a consent row left open by an earlier account of the same id does not skip the admin consent', async () => {
    // The foreign key normally prevents this orphan; a database restored from a dump may hold one.
    db().exec('PRAGMA foreign_keys = OFF');
    db()
      .prepare(
        "INSERT INTO face_consents (user_id, created_at, version, source) VALUES ('back', 1, 'old', 'selfie')"
      )
      .run();
    db().exec('PRAGMA foreign_keys = ON');
    const res = await call(usersRoute.POST, {
      request: req('POST', { id_user: 'back', name: 'B', photos_id: A }),
    });
    expect(res.status).toBe(200);
    expect(consents('back').map((c) => [c.source, c.withdrawn_at === null])).toEqual([
      ['selfie', false],
      ['admin', true],
    ]);
  });

  it('POST: creates with an admin consent; a held person is 409 and no user is created', async () => {
    const create = (id: string, photos_id: string) =>
      call(usersRoute.POST, { request: req('POST', { id_user: id, name: id, photos_id }) });
    expect((await create('new-one', A)).status).toBe(200);
    expect(consents('new-one')).toEqual([
      { source: 'admin', version: legal.TERMS_VERSION, withdrawn_at: null },
    ]);
    expect((await create('new-two', A)).status).toBe(409);
    expect(db().prepare("SELECT 1 FROM users WHERE id_user = 'new-two'").get()).toBeNull();
  });
});

describe('the throw paths of the file and the worker', () => {
  it('a crop that cannot be deleted is logged and never throws, so a withdrawal commits', () => {
    fs.mkdirSync(FACE_DIR, { recursive: true });
    fs.writeFileSync(path.join(FACE_DIR, `asset-y_${B}.webp`), 'x');
    const spy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    });
    try {
      expect(() => faceCrop.deletePersonFaceCrops(B)).not.toThrow();
      expect(faceCrop.deletePersonFaceCrops(B)).toBe(0);
    } finally {
      spy.mockRestore();
      fs.rmSync(path.join(FACE_DIR, `asset-y_${B}.webp`), { force: true });
    }
  });

  it('a withdrawal over a crop that will not go still commits', async () => {
    addUser('member', A);
    fs.mkdirSync(FACE_DIR, { recursive: true });
    fs.writeFileSync(path.join(FACE_DIR, `asset-z_${A}.webp`), 'x');
    const spy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      throw Object.assign(new Error('perm'), { code: 'EPERM' });
    });
    try {
      expect((await patch({ person_id: null })).status).toBe(200);
    } finally {
      spy.mockRestore();
      fs.rmSync(path.join(FACE_DIR, `asset-z_${A}.webp`), { force: true });
    }
    expect(linkOf('member')).toEqual({ photos_id: null, photos_asset_id: null });
    expect(journal()).toEqual([{ person_id: A, reason: 'withdrawal' }]);
  });

  it('runFaceErasures resolves, and logs, when a pass itself fails', async () => {
    db().exec('ALTER TABLE face_erasures RENAME TO face_erasures_away');
    try {
      await expect(erasure.runFaceErasures(vi.fn() as never)).resolves.toBeUndefined();
    } finally {
      db().exec('ALTER TABLE face_erasures_away RENAME TO face_erasures');
    }
  });

  it('a link that is not a person id journals nothing', () => {
    addUser('member', 'test-person-id');
    const local = erasure.inTransaction(db(), () =>
      erasure.eraseLocalFaceData(db(), 'member', 'admin_unlink')
    );
    expect(local).toEqual({ erasure: null, personId: null });
    expect(journal()).toEqual([]);
  });
});
