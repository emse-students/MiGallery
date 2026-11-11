/**
 * Changing an album is the gallery staff's work (`requireStaff`, `#lib/server/permissions.ts`).
 * Pinned against the REAL route tree, as the step-up test is: every state-changing handler under
 * `/api/albums` and `/api/people` answers 403 to a signed-in member who is neither `admin` nor `mitviste`, so a
 * route added tomorrow is covered without anyone remembering it. The handlers are called with the
 * session helper scripted; a refusal comes before any database or Immich call.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

const state = vi.hoisted(() => ({
  user: null as null | { id_user: string; role: string },
}));

vi.mock('#lib/server/auth.ts', async (original) => ({
  ...(await original<typeof import('#lib/server/auth.ts')>()),
  getCurrentUser: () => state.user,
}));
// The member below uploaded nothing: the deletion rule has no ownership to grant them.
vi.mock('#lib/server/asset-uploads.ts', async (original) => ({
  ...(await original<typeof import('#lib/server/asset-uploads.ts')>()),
  uploadedAllOf: () => false,
}));

const STATE_CHANGING = ['POST', 'PUT', 'PATCH', 'DELETE'];

type Handler = (event: RequestEvent) => Promise<Response>;

/** An id of the shape the routes expect; no handler is meant to look it up. */
const SAMPLE_ID = '00000000-0000-4000-8000-000000000000';

/**
 * Every route module that writes an album, loaded as the application loads them: the albums
 * themselves, and the PhotoCV album behind `/api/people`.
 */
const ALBUM_ROUTES = import.meta.glob<Record<string, unknown>>([
  '../src/routes/api/albums/**/+server.ts',
  '../src/routes/api/people/**/+server.ts',
]);

/** The URL path a route file answers, with each parameter given a sample value. */
function pathOf(file: string): string {
  return file
    .replace('../src/routes', '')
    .replace('/+server.ts', '')
    .replace(/\[[^\]]+\]/g, 'sample');
}

/** A request as the handler receives it, with a JSON body no handler is meant to reach. */
function eventFor(method: string, path: string): RequestEvent {
  const url = new URL(`http://gallery.test${path}`);
  return {
    request: new Request(url, {
      method,
      ...(method === 'GET' ? {} : { body: '{}', headers: { 'content-type': 'application/json' } }),
    }),
    url,
    params: { id: SAMPLE_ID, albumId: SAMPLE_ID },
    locals: {},
    cookies: { get: () => undefined },
    fetch: () => Promise.reject(new Error('the handler went past its guard')),
  } as unknown as RequestEvent;
}

/** The status a handler ends with: the one a SvelteKit `error()` throws, or the one it returns. */
async function statusOf(handler: Handler, method: string, path: string): Promise<number> {
  try {
    return (await handler(eventFor(method, path))).status;
  } catch (thrown) {
    return (thrown as { status?: number }).status ?? 500;
  }
}

const handlers: Array<{ name: string; method: string; path: string; handler: Handler }> = [];

beforeAll(async () => {
  for (const [file, load] of Object.entries(ALBUM_ROUTES)) {
    const mod = await load();
    for (const method of STATE_CHANGING) {
      // A read route that answers every method with its GET handler changes nothing.
      if (typeof mod[method] === 'function' && mod[method] !== mod.GET) {
        const path = pathOf(file);
        handlers.push({ name: `${method} ${path}`, method, path, handler: mod[method] as Handler });
      }
    }
  }
  // Two handlers outside the enumeration that belong to the same work: the permission editor's
  // options (a GET that lists every member) and the deletion of one photo by its id.
  const options = await import('../src/routes/api/albums/permissions/options/+server');
  handlers.push({
    name: 'GET /api/albums/permissions/options',
    method: 'GET',
    path: '/api/albums/permissions/options',
    handler: options.GET as unknown as Handler,
  });
  const media = await import('../src/routes/api/external/media/[id]/+server');
  handlers.push({
    name: 'DELETE /api/external/media/sample',
    method: 'DELETE',
    path: '/api/external/media/sample',
    handler: media.DELETE as unknown as Handler,
  });
}, 120_000);

describe('album changes are staff work', () => {
  it('finds the album routes that change state (the enumeration is not empty)', () => {
    expect(handlers.length).toBeGreaterThanOrEqual(15);
    // The paths are real ones: a parameter is spelled `sample`, never left in brackets.
    expect(handlers.filter((h) => h.path.includes('['))).toEqual([]);
  });

  it('answers 403 to a signed-in member who is not staff, on every one of them', async () => {
    state.user = { id_user: 'member', role: 'user' };
    const answers: Array<[string, number]> = [];
    for (const h of handlers) answers.push([h.name, await statusOf(h.handler, h.method, h.path)]);
    expect(answers).toEqual(handlers.map((h) => [h.name, 403]));
  });

  it('answers 401 with no session, on every one of them', async () => {
    state.user = null;
    const answers: Array<[string, number]> = [];
    for (const h of handlers) answers.push([h.name, await statusOf(h.handler, h.method, h.path)]);
    expect(answers).toEqual(handlers.map((h) => [h.name, 401]));
  });
});

describe('requireStaff', () => {
  it.each(['admin', 'mitviste'])('lets a %s session through', async (role) => {
    const { requireStaff } = await import('#lib/server/permissions.ts');
    state.user = { id_user: 'staff', role };
    const auth = await requireStaff(eventFor('POST', '/api/albums'));
    expect(auth.user).toEqual(state.user);
  });
});
