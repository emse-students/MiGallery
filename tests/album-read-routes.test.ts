/**
 * Reading an album follows the album's own rule (`checkAlbumAccess`, `#lib/albums.ts`), on every
 * route that serves one - its record, its photo list, one of its photos. Pinned against the REAL
 * route tree: every GET under `/api/albums/[id]` is called as a handler against a throwaway SQLite
 * file, with the session helper scripted and Immich faked, so a read route added tomorrow is
 * covered without anyone remembering it. The three routes that are public by design are named, and
 * each must exist; so is the one read that is the staff's alone, and the exact set a shared link
 * opens without a session.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { removeTempDir } from './test-helpers';

type Viewer = { id_user: string; role: string; formation?: string; promo?: number };

const state = vi.hoisted(() => ({
  user: null as null | { id_user: string; role: string; formation?: string; promo?: number },
  /** The asset ids Immich lists in every album; empty is how a failed listing looks. */
  members: [] as string[],
  /** How many times Immich was asked what an album holds. */
  listings: 0,
  /** Immich fails instead of answering. */
  down: false,
}));

vi.mock('#lib/server/env.ts', () => ({
  env: { IMMICH_BASE_URL: 'http://immich.test', IMMICH_API_KEY: 'k' },
}));
vi.mock('#lib/server/auth.ts', async (original) => ({
  ...(await original<typeof import('#lib/server/auth.ts')>()),
  getCurrentUser: () => state.user,
}));
vi.mock('#lib/immich/album-assets.ts', () => ({
  fetchAlbumAssets: () => {
    state.listings++;
    if (state.down) return Promise.reject(new Error('Immich is down'));
    return Promise.resolve(state.members.map((id) => ({ id })));
  },
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PRIVATE = id(1);
const OPEN = id(2);
const LINK = id(3);
const HIDDEN = id(4);
const GRANTED = id(5);
const PROMO = id(6);
const UNKNOWN = id(9);
const PHOTO = id(100);
const OTHER_PHOTO = id(101);

const MEMBER: Viewer = { id_user: 'member', role: 'user', formation: 'ICM', promo: 2026 };
const CLASSMATE: Viewer = { id_user: 'classmate', role: 'user', formation: 'ICM', promo: 2027 };
const STAFF: Viewer = { id_user: 'staff', role: 'mitviste' };

/** The routes under an album id that answer without a session, by design. */
const PUBLIC_BY_DESIGN = ['/cover', '/og-cover', '/og-preview'];
/** The read that is the staff's alone: an album's grant lists, read by the album editor. */
const STAFF_ONLY = ['/info'];
/** The one read a shared link does not open without a session: Immich's own record of the album. */
const RECORD = '';

type Handler = (event: RequestEvent) => Promise<Response> | Response;

const ROUTES = import.meta.glob<Record<string, unknown>>('../src/routes/api/albums/**/+server.ts');

/** The part of a route file's path after the album id: `/assets-stream`, `` for the album itself. */
function tailOf(file: string): string | null {
  const marker = '/api/albums/[id]';
  const at = file.indexOf(marker);
  return at < 0 ? null : file.slice(at + marker.length).replace('/+server.ts', '');
}

/** A GET as the handler receives it; Immich's own answers are an empty album. */
function eventFor(album: string, photo: string = PHOTO): RequestEvent {
  const url = new URL(`http://gallery.test/api/albums/${album}`);
  return {
    request: new Request(url),
    url,
    params: { id: album, assetId: photo },
    locals: {},
    cookies: { get: () => undefined },
    fetch: () => Promise.resolve(Response.json({ id: album, albumName: 'album', assets: [] })),
  } as unknown as RequestEvent;
}

/** The status a handler ends with: the one a SvelteKit `error()` throws, or the one it returns. */
async function statusOf(handler: Handler, event: RequestEvent): Promise<number> {
  try {
    return (await handler(event)).status;
  } catch (thrown) {
    return (thrown as { status?: number }).status ?? 500;
  }
}

let dbDir: string;
let reads: Array<{ tail: string; handler: Handler }> = [];
let publicTails: string[] = [];
let staffReads: Array<{ tail: string; handler: Handler }> = [];
let listAlbums: Handler;
let cache: typeof import('#lib/server/album-asset-access.ts');

/** The statuses every guarded read route answers for this viewer and album. */
async function statuses(album: string, photo: string = PHOTO): Promise<Array<[string, number]>> {
  const out: Array<[string, number]> = [];
  for (const r of reads) out.push([r.tail, await statusOf(r.handler, eventFor(album, photo))]);
  return out;
}

const all = (status: number) => reads.map((r) => [r.tail, status]);
const refusals = [401, 403, 404];

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-album-reads-'));
  process.env.DATABASE_PATH = join(dbDir, 'migallery.db');
  const { getDatabase } = await import('#lib/db/database.ts');
  cache = await import('#lib/server/album-asset-access.ts');
  const db = getDatabase();
  const album = db.prepare(
    'INSERT INTO albums (id, name, visibility, visible) VALUES (?, ?, ?, ?)'
  );
  album.run(PRIVATE, 'private', 'private', 1);
  album.run(OPEN, 'open', 'authenticated', 1);
  album.run(LINK, 'link', 'unlisted', 1);
  album.run(HIDDEN, 'hidden', 'authenticated', 0);
  album.run(GRANTED, 'granted', 'private', 1);
  album.run(PROMO, 'promo', 'private', 1);
  const grant = db.prepare(
    'INSERT INTO album_permissions (album_id, kind, value) VALUES (?, ?, ?)'
  );
  grant.run(GRANTED, 'user', MEMBER.id_user);
  grant.run(PROMO, 'formation', 'ICM');
  grant.run(PROMO, 'promo', '2026');

  for (const [file, load] of Object.entries(ROUTES)) {
    const tail = tailOf(file);
    if (tail === null) continue;
    const mod = await load();
    if (typeof mod.GET !== 'function') continue;
    if (PUBLIC_BY_DESIGN.includes(tail)) publicTails.push(tail);
    else if (STAFF_ONLY.includes(tail)) staffReads.push({ tail, handler: mod.GET as Handler });
    else reads.push({ tail, handler: mod.GET as Handler });
  }
  const list = await import('../src/routes/api/albums/+server');
  listAlbums = list.GET as unknown as Handler;
}, 120_000);

afterAll(() => {
  removeTempDir(dbDir);
});

beforeEach(() => {
  state.user = null;
  state.members = [PHOTO];
  state.listings = 0;
  state.down = false;
  cache.clearAlbumMembershipCache();
});

describe('the read routes of an album', () => {
  it('are found, and the public ones are exactly the three named', () => {
    expect(reads.length).toBeGreaterThanOrEqual(5);
    expect(staffReads.map((r) => r.tail)).toEqual(STAFF_ONLY);
    expect(publicTails.toSorted()).toEqual(PUBLIC_BY_DESIGN.toSorted());
  });

  it('refuse a private album to a member it was not granted to', async () => {
    state.user = MEMBER;
    expect(await statuses(PRIVATE)).toEqual(all(403));
  });

  it('refuse an album granted to another promo', async () => {
    state.user = CLASSMATE;
    expect(await statuses(PROMO)).toEqual(all(403));
  });

  it('ask for a session on anything but a shared link', async () => {
    expect(await statuses(PRIVATE)).toEqual(all(401));
    expect(await statuses(OPEN)).toEqual(all(401));
  });

  it('answer 404 to a member for an album the gallery does not know', async () => {
    state.user = MEMBER;
    expect(await statuses(UNKNOWN)).toEqual(all(404));
  });

  it.each([
    ['an album open to every member', OPEN, MEMBER],
    ['an album granted to them by name', GRANTED, MEMBER],
    ['an album granted to their formation and promo', PROMO, MEMBER],
    ['a hidden album they hold the link of', HIDDEN, MEMBER],
    ['a private album, for the staff', PRIVATE, STAFF],
  ])('let a member through on %s', async (_what, album, viewer) => {
    state.user = viewer;
    for (const [tail, status] of await statuses(album)) {
      expect([tail, refusals.includes(status)]).toEqual([tail, false]);
    }
  });

  it('serve a shared link without a session: its photo lists and its photos, and nothing else', async () => {
    const opened = (await statuses(LINK))
      .filter(([, status]) => !refusals.includes(status))
      .map(([tail]) => tail);
    expect(opened.toSorted()).toEqual(
      [
        '/assets-simple',
        '/assets-stream',
        '/asset-original/[assetId]',
        '/asset-thumbnail/[assetId]',
        '/asset-thumbnail/[assetId]/thumbnail',
      ].toSorted()
    );
    const record = reads.find((r) => r.tail === RECORD);
    expect(await statusOf(record!.handler, eventFor(LINK))).toBe(401);
    for (const r of staffReads) {
      expect([r.tail, await statusOf(r.handler, eventFor(LINK))]).toEqual([r.tail, 401]);
    }
  });

  it('keep the grant lists of an album for the staff', async () => {
    for (const r of staffReads) {
      state.user = MEMBER;
      expect([r.tail, await statusOf(r.handler, eventFor(GRANTED))]).toEqual([r.tail, 403]);
      state.user = STAFF;
      expect([r.tail, await statusOf(r.handler, eventFor(GRANTED))]).toEqual([r.tail, 200]);
    }
  });
});

describe('one photo of an album', () => {
  const photoRoutes = () => reads.filter((r) => r.tail.includes('[assetId]'));

  it('is refused when it is not in the album the member may open', async () => {
    state.user = MEMBER;
    for (const r of photoRoutes()) {
      expect([r.tail, await statusOf(r.handler, eventFor(OPEN, OTHER_PHOTO))]).toEqual([
        r.tail,
        403,
      ]);
    }
  });

  it('is answered 503, not refused, when Immich does not say what the album holds', async () => {
    state.user = MEMBER;
    state.members = [];
    for (const r of photoRoutes()) {
      expect([r.tail, await statusOf(r.handler, eventFor(OPEN))]).toEqual([r.tail, 503]);
    }
  });

  it.each([
    ['fails', true, 1],
    ['answers an empty list', false, 12],
  ])('writes one line for a whole grid while Immich %s', async (_what, down, listings) => {
    state.user = MEMBER;
    state.members = [];
    state.down = down;
    const lines = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const [route] = photoRoutes();
      for (let n = 0; n < 12; n++) {
        expect(await statusOf(route.handler, eventFor(OPEN, id(200 + n)))).toBe(503);
      }
      // A failed request is not repeated within the window; an empty answer is asked again.
      expect(state.listings).toBe(listings);
      const said = lines.mock.calls.filter((call) => call.join(' ').includes('did not say'));
      expect(said.length).toBe(1);
    } finally {
      lines.mockRestore();
    }
  });

  it('is served to the staff whatever the album lists', async () => {
    state.user = STAFF;
    state.members = [];
    for (const r of photoRoutes()) {
      const status = await statusOf(r.handler, eventFor(OPEN, OTHER_PHOTO));
      expect([r.tail, [...refusals, 503].includes(status)]).toEqual([r.tail, false]);
    }
  });
});

describe('the album list', () => {
  const namesFor = async (viewer: Viewer) => {
    state.user = viewer;
    const response = await listAlbums(eventFor(OPEN));
    const albums = (await response.json()) as Array<{ albumName: string }>;
    return albums.map((a) => a.albumName).toSorted();
  };

  it('holds, for a member, the albums the albums page lists for them', async () => {
    expect(await namesFor(MEMBER)).toEqual(['granted', 'link', 'open', 'promo']);
    expect(await namesFor(CLASSMATE)).toEqual(['link', 'open']);
  });

  it('holds every album for the staff', async () => {
    expect(await namesFor(STAFF)).toEqual([
      'granted',
      'hidden',
      'link',
      'open',
      'private',
      'promo',
    ]);
  });
});

describe('an id that is not an Immich id', () => {
  it('is answered 400 before Immich is asked anything', async () => {
    state.user = STAFF;
    const album = reads.find((r) => r.tail === '');
    expect(album).toBeDefined();
    expect(await statusOf(album!.handler, eventFor('..%2Fusers'))).toBe(400);
  });
});
