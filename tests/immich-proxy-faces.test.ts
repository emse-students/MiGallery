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

const PERSON = '6f1c0a52-0d5e-4c8e-9a43-3d2b1f0e9a77';

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
  const calls: Array<[string, string, string, unknown?]> = [
    ['GET', 'people', ''],
    ['GET', `people/${PERSON}`, ''],
    ['GET', `people/${PERSON}/thumbnail`, ''],
    ['PUT', `people/${PERSON}`, '', { name: 'x' }],
    ['DELETE', `faces/${PERSON}`, ''],
    ['GET', 'faces', `?id=${PERSON}`],
    ['GET', 'search/person', '?name=a'],
    ['GET', 'timeline/buckets', `?personId=${PERSON}`],
    ['POST', 'search/metadata', '', { personIds: [PERSON] }],
    ['POST', 'search/metadata', '', { withPeople: true }],
  ];

  it('an admin session gets 403 and Immich is never asked', async () => {
    for (const [method, path, query, body] of calls) {
      expect((await send(method, path, query, body)).status).toBe(403);
    }
    expect(asked).toEqual([]);
  });

  it('an API key gets 403 and Immich is never asked', async () => {
    state.auth = { user: null, grantedScope: 'admin', viaApiKey: true };
    for (const [method, path, query, body] of calls) {
      expect((await send(method, path, query, body)).status).toBe(403);
    }
    expect(asked).toEqual([]);
  });

  it('a call naming no person is forwarded', async () => {
    const res = await send('POST', 'search/metadata', '', { type: 'IMAGE' });
    expect(res.status).toBe(200);
    expect(asked).toEqual(['http://immich.test/api/search/metadata']);
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
    const res = await send('GET', 'assets/a1');
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
    const res = await send('GET', 'assets/a1');
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain(PERSON);
  });

  it('an answer without people is forwarded as it came', async () => {
    answer = () => Response.json({ id: 'a1', exifInfo: { make: 'x' } });
    const res = await send('GET', 'assets/a1');
    expect(await res.json()).toEqual({ id: 'a1', exifInfo: { make: 'x' } });
  });
});
