/**
 * The Immich proxy handler, run as a function against a fake Immich: the one canonical path, the
 * public-asset exception, the admin routes, who may delete which asset, the search body, and the
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

  it('may search only as the profile photo picker does', async () => {
    expect((await send('POST', 'search/metadata', { type: 'IMAGE' })).status).toBe(400);
    expect((await send('POST', 'search/metadata', { personIds: [], type: 'IMAGE' })).status).toBe(
      400
    );
    expect(
      (
        await send('POST', 'search/metadata', {
          personIds: [PERSON],
          originalFileName: 'x',
        })
      ).status
    ).toBe(400);
    expect(forwarded()).toEqual([]);
  });

  it("never gets the people of an asset's detail; an admin and an API key do", async () => {
    answer = () =>
      Response.json({
        id: VICTIM,
        people: [{ id: PERSON, name: 'Someone' }],
        unassignedFaces: [{ boundingBoxX1: 1 }],
        exifInfo: { make: 'x' },
      });
    const res = await send('GET', `assets/${VICTIM}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ id: VICTIM, exifInfo: { make: 'x' } });
    expect(text).not.toContain(PERSON);

    state.auth = member('boss', 'admin');
    expect(
      ((await (await send('GET', `assets/${VICTIM}`)).json()) as { people: unknown[] }).people
    ).toHaveLength(1);
    state.auth = { user: null, grantedScope: 'read', viaApiKey: true };
    expect(
      ((await (await send('GET', `assets/${VICTIM}`)).json()) as { people: unknown[] }).people
    ).toHaveLength(1);
  });
});

describe("a member's stripped asset detail", () => {
  it("carries none of Immich's validators out, and takes no conditional in", async () => {
    let conditional: string | null = 'unset';
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      asked.push(String(url));
      conditional = new Headers(init?.headers).get('if-none-match');
      return Response.json(
        { id: VICTIM, people: [{ id: PERSON }] },
        { headers: { etag: 'W/"full"', 'last-modified': 'Thu, 01 Jan 2026 00:00:00 GMT' } }
      );
    });
    const ask = async () => {
      const url = new URL(`http://x.test/api/immich/assets/${VICTIM}`);
      const request = new Request(url, { headers: { 'if-none-match': 'W/"full"' } });
      return proxy.GET({ request, url, params: { path: `assets/${VICTIM}` }, fetch } as never);
    };
    try {
      const res = await ask();
      expect(res.headers.get('etag')).toBeNull();
      expect(res.headers.get('last-modified')).toBeNull();
      expect(conditional).toBeNull();

      state.auth = member('boss', 'admin');
      const full = await ask();
      expect(full.headers.get('etag')).toBe('W/"full"');
      expect(conditional).toBe('W/"full"');
    } finally {
      vi.stubGlobal('fetch', async (url: string) => {
        asked.push(String(url));
        return answer(String(url));
      });
    }
  });
});

describe('GET /api/users/me/face/selfie/[assetId] (the settings page linking flow)', () => {
  const read = async (assetId: string) => {
    const route = await import('../src/routes/api/users/me/face/selfie/[assetId]/+server');
    try {
      return await route.GET({ params: { assetId }, fetch } as never);
    } catch (e) {
      return new Response(null, { status: (e as { status?: number }).status ?? 500 });
    }
  };

  const fresh = () => new Date(Date.now() - 60_000).toISOString();

  it("names the one person on the member's fresh upload, and nothing else of the asset", async () => {
    answer = () =>
      Response.json({ id: OWN, createdAt: fresh(), people: [{ id: PERSON, name: 'Someone' }] });
    const res = await read(OWN);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 1, personId: PERSON });
  });

  it('only counts the people of a photo showing several, or none', async () => {
    answer = () =>
      Response.json({ id: OWN, createdAt: fresh(), people: [{ id: PERSON }, { id: VICTIM }] });
    const res = await read(OWN);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ count: 2, personId: null });
    expect(text).not.toContain(PERSON);
    answer = () => Response.json({ id: OWN, createdAt: fresh(), people: [] });
    expect(await (await read(OWN)).json()).toEqual({ count: 0, personId: null });
  });

  it('refuses an upload outside the selfie window, or with no upload date', async () => {
    // Imported here, not at the top: face-access.ts opens the database, whose path beforeAll sets.
    const { SELFIE_MAX_AGE_MS } = await import('#lib/server/face-access.ts');
    const stale = new Date(Date.now() - SELFIE_MAX_AGE_MS - 60_000).toISOString();
    answer = () => Response.json({ id: OWN, createdAt: stale, people: [{ id: PERSON }] });
    expect((await read(OWN)).status).toBe(403);
    answer = () => Response.json({ id: OWN, people: [{ id: PERSON }] });
    expect((await read(OWN)).status).toBe(403);
    // More than the minute of allowed clock skew in the future is no upload date either.
    const ahead = new Date(Date.now() + 5 * 60_000).toISOString();
    answer = () => Response.json({ id: OWN, createdAt: ahead, people: [{ id: PERSON }] });
    expect((await read(OWN)).status).toBe(403);
  });

  it("refuses someone else's asset, a re-uploaded copy, and an API key", async () => {
    expect((await read(VICTIM)).status).toBe(403);
    expect((await read(DUP)).status).toBe(403);
    state.auth = { user: null, grantedScope: 'admin', viaApiKey: true };
    expect((await read(OWN)).status).toBe(403);
    expect(asked).toEqual([]);
  });
});
