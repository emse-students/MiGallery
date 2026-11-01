/**
 * The Immich proxy handler, run as a function against a fake Immich: the one canonical path, the
 * public-asset exception, the admin routes, who may delete which asset, no search, and the
 * people an asset's detail carries. Ids are synthetic.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { error } from '@sveltejs/kit';
import { removeTempDir } from './test-helpers';

type Auth = {
  user: null | { id_user: string; role: string };
  grantedScope: string;
  viaApiKey: boolean;
};

const state = vi.hoisted(() => ({ auth: null as Auth | null }));

vi.mock('#lib/server/env.ts', () => ({
  env: { IMMICH_BASE_URL: 'http://immich.test', IMMICH_API_KEY: 'k' },
}));
vi.mock('#lib/server/permissions.ts', () => ({
  requireScope: async (_event: unknown, scope: string) => {
    const auth = state.auth;
    if (!auth) {
      throw error(401, 'Authentication required');
    }
    if (scope === 'admin') {
      const admin = auth.viaApiKey ? auth.grantedScope === 'admin' : auth.user?.role === 'admin';
      if (!admin) {
        throw error(403, 'Admin role required');
      }
    }
    return auth;
  },
}));
vi.mock('#lib/server/logs.ts', () => ({ logEvent: async () => undefined }));

const PUBLIC = '00000000-0000-4000-8000-0000000000a1';
const VICTIM = '00000000-0000-4000-8000-0000000000b2';
const OWN = '00000000-0000-4000-8000-0000000000c3';
const DUP = '00000000-0000-4000-8000-0000000000d4';
const PERSON = '00000000-0000-4000-8000-0000000000e5';

const member = (id: string, role = 'user'): Auth => ({
  user: { id_user: id, role },
  grantedScope: 'write',
  viaApiKey: false,
});

/** Every URL the fake Immich was asked, and what it answers next. */
let asked: string[] = [];
let answer: (url: string) => Response = () => Response.json({});

let dbDir: string;
let proxy: typeof import('../src/routes/api/immich/[...path]/+server');

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-proxy-handler-'));
  process.env.DATABASE_PATH = join(dbDir, 'proxy.db');
  const database = await import('#lib/db/database.ts');
  const db = database.getDatabase();
  db.prepare("INSERT INTO users (id_user, name, role) VALUES ('m1', 'm1', 'user')").run();
  db.prepare("INSERT INTO users (id_user, name, role) VALUES ('m2', 'm2', 'user')").run();
  db.prepare("INSERT INTO albums (id, name, visibility) VALUES ('alb', 'alb', 'unlisted')").run();
  const imported = db.prepare(
    "INSERT INTO logs (actor, event_type, target_type, target_id, details) VALUES (?, 'import', 'asset', ?, ?)"
  );
  imported.run('m1', OWN, JSON.stringify({ duplicate: false }));
  // m1 "uploaded" a copy of someone else's photo: Immich answered with the existing id.
  imported.run('m1', DUP, JSON.stringify({ duplicate: true }));
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(String(url));
    return answer(String(url));
  });
  proxy = await import('../src/routes/api/immich/[...path]/+server');
});

afterAll(() => {
  vi.unstubAllGlobals();
  removeTempDir(dbDir);
});

beforeEach(() => {
  asked = [];
  answer = (url) =>
    // The public check reads the asset's albums: only PUBLIC is in the unlisted album.
    url.endsWith(`/api/assets/${PUBLIC}`)
      ? Response.json({ id: PUBLIC, albums: [{ id: 'alb' }] })
      : Response.json({});
  state.auth = member('m1');
});

/** Call the handler; `path` is the param as the router hands it over, already decoded ONCE. */
async function send(method: string, path: string, body?: unknown, query = '') {
  const url = new URL(`http://x.test/api/immich/${path}${query}`);
  const request = new Request(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const handler = proxy[method as 'GET' | 'POST' | 'PUT' | 'DELETE'];
  try {
    return await handler({ request, url, params: { path }, fetch } as never);
  } catch (e) {
    return new Response(null, { status: (e as { status?: number }).status ?? 500 });
  }
}

/**
 * The Immich URLs asked, other than the public check's own read of an asset's detail (which the
 * proxy makes to decide, and never hands over).
 */
const forwarded = () => asked.filter((u) => !/\/api\/assets\/[0-9a-f-]{36}$/.test(u));

describe('an anonymous request', () => {
  beforeEach(() => {
    state.auth = null;
  });

  it('gets the picture of a public asset', async () => {
    expect((await send('GET', `assets/${PUBLIC}/thumbnail`)).status).toBe(200);
    expect(forwarded()).toEqual([`http://immich.test/api/assets/${PUBLIC}/thumbnail`]);
  });

  it('cannot walk out of a public asset with encoded dot segments, single or double encoded', async () => {
    // `%2e%2e` sent once arrives decoded as `..`; `%252e%252e` arrives as `%2e%2e`.
    for (const path of [
      `assets/${PUBLIC}/thumbnail/../../${VICTIM}/original`,
      `assets/${PUBLIC}/thumbnail/%2e%2e/%2e%2e/${VICTIM}/original`,
      `assets/${PUBLIC}/thumbnail/%2E%2e/%2e%2E/%2e%2e/people/${PERSON}`,
    ]) {
      const res = await send('GET', path);
      expect(res.status, path).not.toBe(200);
    }
    expect(forwarded()).toEqual([]);
  });

  it('gets nothing but the exact public paths', async () => {
    expect((await send('GET', `assets/${VICTIM}/thumbnail`)).status).toBe(403);
    expect((await send('GET', `assets/${PUBLIC}/preview`)).status).toBe(401);
    expect((await send('GET', `assets/${PUBLIC}`)).status).toBe(401);
    expect(forwarded()).toEqual([]);
  });
});

describe('a member session', () => {
  it('is refused the admin trash routes', async () => {
    expect((await send('GET', 'timeline/buckets', undefined, '?isTrashed=true')).status).toBe(403);
    expect((await send('POST', 'trash/restore/assets', { ids: [VICTIM] })).status).toBe(403);
    expect(forwarded()).toEqual([]);
  });

  it('may not delete an asset it did not upload, nor one it only re-uploaded a copy of', async () => {
    expect((await send('DELETE', 'assets', { ids: [VICTIM], force: true })).status).toBe(403);
    expect((await send('DELETE', 'assets', { ids: [OWN, VICTIM] })).status).toBe(403);
    expect((await send('DELETE', 'assets', { ids: [DUP] })).status).toBe(403);
    expect((await send('DELETE', 'ASSETS', { ids: [VICTIM] })).status).toBe(403);
    expect((await send('DELETE', 'assets', {})).status).toBe(400);
    expect(forwarded()).toEqual([]);
  });

  it('deletes its own upload, and an admin or a mitviste deletes any', async () => {
    expect((await send('DELETE', 'assets', { ids: [OWN] })).status).toBe(200);
    state.auth = member('boss', 'admin');
    expect((await send('DELETE', 'assets', { ids: [VICTIM] })).status).toBe(200);
    state.auth = member('mv', 'mitviste');
    expect((await send('DELETE', 'assets', { ids: [VICTIM] })).status).toBe(200);
    expect(forwarded()).toEqual([
      'http://immich.test/api/assets',
      'http://immich.test/api/assets',
      'http://immich.test/api/assets',
    ]);
  });

  it('is refused a route the list does not hold', async () => {
    expect((await send('DELETE', `albums/${VICTIM}/assets`, { ids: [VICTIM] })).status).toBe(404);
    expect((await send('POST', 'sync/stream', { types: ['PeopleV1'] })).status).toBe(404);
    expect(forwarded()).toEqual([]);
  });

  it('may not search: no search route is listed (lot A6)', async () => {
    expect(
      (await send('POST', 'search/metadata', { personIds: [PERSON], type: 'IMAGE' })).status
    ).toBe(404);
    expect(forwarded()).toEqual([]);
  });

  it("never gets the people of an asset's detail, nor does an admin or an API key (lot A6)", async () => {
    answer = () =>
      Response.json({
        id: VICTIM,
        people: [{ id: PERSON, name: 'Someone' }],
        unassignedFaces: [{ boundingBoxX1: 1 }],
        exifInfo: { make: 'x' },
      });
    for (const auth of [
      member('m1'),
      member('boss', 'admin'),
      { user: null, grantedScope: 'admin', viaApiKey: true },
    ]) {
      state.auth = auth;
      const res = await send('GET', `assets/${VICTIM}`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ id: VICTIM, exifInfo: { make: 'x' } });
      expect(text).not.toContain(PERSON);
    }
  });
});

describe('cache validators', () => {
  it("an answer stripped of its people carries none of Immich's validators, and no JSON route takes a conditional", async () => {
    let conditional: string | null = 'unset';
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      asked.push(String(url));
      conditional = new Headers(init?.headers).get('if-none-match');
      if (String(url).endsWith('/thumbnail')) {
        return new Response('img', { headers: { 'content-type': 'image/webp', etag: 'W/"img"' } });
      }
      return Response.json(
        { id: VICTIM, people: [{ id: PERSON }] },
        { headers: { etag: 'W/"full"', 'last-modified': 'Thu, 01 Jan 2026 00:00:00 GMT' } }
      );
    });
    const ask = (path: string) => {
      const url = new URL(`http://x.test/api/immich/${path}`);
      const request = new Request(url, { headers: { 'if-none-match': 'W/"full"' } });
      return proxy.GET({ request, url, params: { path }, fetch } as never);
    };
    try {
      for (const auth of [member('m1'), member('boss', 'admin')]) {
        state.auth = auth;
        const res = await ask(`assets/${VICTIM}`);
        expect(res.headers.get('etag')).toBeNull();
        expect(res.headers.get('last-modified')).toBeNull();
        expect(conditional).toBeNull();
      }
      // The media bytes keep their validators both ways.
      const img = await ask(`assets/${VICTIM}/thumbnail`);
      expect(img.headers.get('etag')).toBe('W/"img"');
      expect(conditional).toBe('W/"full"');
    } finally {
      vi.stubGlobal('fetch', async (url: string) => {
        asked.push(String(url));
        return answer(String(url));
      });
    }
  });
});
