/**
 * The Immich proxy's face rule (lot A6), called as a HANDLER with Immich faked: every person and
 * face call is refused BEFORE anything is forwarded, whoever asks - an admin session and an API
 * key included - and an answer that carries the people Immich found reaches the client without
 * them. Synthetic ids only.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: {
    user: { id_user: 'boss', role: 'admin' } as null | { id_user: string; role: string },
    grantedScope: 'admin',
    viaApiKey: false,
  },
}));

vi.mock('#lib/server/env.ts', () => ({
  env: { IMMICH_BASE_URL: 'http://immich.test', IMMICH_API_KEY: 'k' },
}));
vi.mock('#lib/server/permissions.ts', () => ({
  requireScope: async () => state.auth,
}));
vi.mock('#lib/server/logs.ts', () => ({ logEvent: async () => undefined }));

// Synthetic ids, shaped like Immich's: no real person or asset.
const PERSON = '00000000-0000-4000-8000-0000000000a1';
const ASSET = '00000000-0000-4000-8000-0000000000b2';

/** Every URL the fake Immich was asked, and what it answers next. */
let asked: string[] = [];
let answer: () => Response = () => Response.json({});

let proxy: typeof import('../src/routes/api/immich/[...path]/+server');

beforeAll(async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(String(url));
    return answer();
  });
  proxy = await import('../src/routes/api/immich/[...path]/+server');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  asked = [];
  answer = () => Response.json({});
  state.auth = {
    user: { id_user: 'boss', role: 'admin' },
    grantedScope: 'admin',
    viaApiKey: false,
  };
});

async function send(method: string, path: string, query = '', body?: unknown) {
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

describe('the proxy refuses every person and face call, to everyone', () => {
  // Not on the allowlist at all (immich-proxy-allowlist.ts): 404, whoever asks.
  const unlisted: Array<[string, string, string, unknown?]> = [
    ['GET', 'people', ''],
    ['GET', `people/${PERSON}`, ''],
    ['GET', `people/${PERSON}/thumbnail`, ''],
    ['PUT', `people/${PERSON}`, '', { name: 'x' }],
    ['DELETE', `faces/${PERSON}`, ''],
    ['GET', 'faces', `?id=${PERSON}`],
    ['GET', 'search/person', '?name=a'],
    ['POST', 'search/metadata', '', { type: 'IMAGE' }],
    ['POST', 'sync/stream', '', { types: ['PeopleV1', 'AssetFacesV1'] }],
    ['GET', 'server/version', ''],
  ];
  // Listed routes that name people: refused by face-access.ts on top of the list.
  const naming: Array<[string, string, string, unknown?]> = [
    ['GET', 'timeline/buckets', `?personId=${PERSON}`],
    ['GET', 'timeline/bucket', '?withPeople=true'],
    ['DELETE', 'assets', '', { ids: [ASSET], personIds: [PERSON] }],
  ];

  for (const [who, auth] of [
    ['an admin session', { user: { id_user: 'boss', role: 'admin' }, viaApiKey: false }],
    ['an API key', { user: null, viaApiKey: true }],
  ] as const) {
    it(`${who}: an unlisted route is 404, one naming people 403, and Immich is never asked`, async () => {
      state.auth = { ...auth, grantedScope: 'admin' };
      for (const [method, path, query, body] of unlisted) {
        expect((await send(method, path, query, body)).status, `${method} ${path}`).toBe(404);
      }
      for (const [method, path, query, body] of naming) {
        expect((await send(method, path, query, body)).status, `${method} ${path}`).toBe(403);
      }
      expect(asked).toEqual([]);
    });
  }

  it('a listed call naming no person is forwarded', async () => {
    const res = await send('GET', `assets/${ASSET}`);
    expect(res.status).toBe(200);
    expect(asked).toEqual([`http://immich.test/api/assets/${ASSET}`]);
  });
});

describe('an answer reaches the client without the people Immich found', () => {
  it('an asset detail loses people and unassigned faces, and keeps the rest', async () => {
    answer = () =>
      Response.json({
        id: 'a1',
        people: [{ id: PERSON, name: 'Someone', faces: [{ boundingBoxX1: 1 }] }],
        unassignedFaces: [{ boundingBoxX1: 2 }],
        exifInfo: { make: 'x' },
      });
    const res = await send('GET', `assets/${ASSET}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ id: 'a1', exifInfo: { make: 'x' } });
    expect(text).not.toContain(PERSON);
  });

  it('a JSON answer naming people that does not parse is refused, never forwarded', async () => {
    answer = () =>
      new Response(`{"id":"a1","people":[{"id":"${PERSON}"}`, {
        headers: { 'content-type': 'application/json' },
      });
    const res = await send('GET', `assets/${ASSET}`);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain(PERSON);
  });

  it('an answer without people is forwarded as it came', async () => {
    answer = () => Response.json({ id: 'a1', exifInfo: { make: 'x' } });
    const res = await send('GET', `assets/${ASSET}`);
    expect(await res.json()).toEqual({ id: 'a1', exifInfo: { make: 'x' } });
  });
});
