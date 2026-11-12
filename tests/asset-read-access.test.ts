/**
 * Reading ONE photo by its id follows the photo's own rule (`requireAssetRead`,
 * `#lib/server/asset-access.ts`) on every route that serves one without naming an album: the Immich
 * proxy (record, picture, file, video), the external media route and a download. The handlers are
 * called as functions against a throwaway SQLite file and a fake Immich; each branch of the rule
 * has the case that lets a member in and the case that does not.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { removeTempDir } from './test-helpers';

type Viewer = { id_user: string; role: string; formation?: string; promo?: number };

// The refusal line is a warn, which the logger drops under test unless told otherwise; the level
// is read when the logger loads, so it is set before anything imports it.
vi.hoisted(() => {
  process.env.LOG_LEVEL = 'warn';
});

const state = vi.hoisted(() => ({
  user: null as null | { id_user: string; role: string; formation?: string; promo?: number },
}));

vi.mock('#lib/server/env.ts', () => ({
  env: { IMMICH_BASE_URL: 'http://immich.test', IMMICH_API_KEY: 'k' },
}));
vi.mock('#lib/server/auth.ts', async (original) => ({
  ...(await original<typeof import('#lib/server/auth.ts')>()),
  getCurrentUser: () => state.user,
}));
vi.mock('#lib/server/logs.ts', () => ({ logEvent: async () => undefined }));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OPEN_ALBUM = id(1);
const PRIVATE_ALBUM = id(2);
/** An album Immich has and the gallery's own table does not (a system album). */
const FOREIGN_ALBUM = id(3);

const MINE = id(10);
const ASKED_OF_ME = id(11);
const NOT_ME = id(12);
const ASKED_OF_OTHER = id(13);
const OWNERS = id(14);
const OWNERS_UNANSWERED = id(15);
const IN_OPEN = id(20);
const IN_PRIVATE = id(21);
const IN_FOREIGN = id(22);
const NOWHERE = id(23);

const MEMBER: Viewer = { id_user: 'member', role: 'user', formation: 'ICM', promo: 2026 };
const STAFF: Viewer = { id_user: 'staff', role: 'mitviste' };

/** What the fake Immich knows: the albums holding each photo. */
const albumsOf: Record<string, string[]> = {
  [IN_OPEN]: [OPEN_ALBUM],
  [IN_PRIVATE]: [PRIVATE_ALBUM],
  [IN_FOREIGN]: [FOREIGN_ALBUM],
};
let immichDown = false;
/** Every request the fake Immich received. */
let asked: Array<{ url: string; body: string | null }> = [];

function immich(url: string, init?: RequestInit): Response {
  asked.push({ url, body: typeof init?.body === 'string' ? init.body : null });
  const holding = /\/api\/albums\?assetId=([0-9a-f-]+)$/.exec(url);
  if (holding) {
    return immichDown
      ? new Response('down', { status: 500 })
      : Response.json((albumsOf[holding[1]] ?? []).map((album) => ({ id: album })));
  }
  if (url.endsWith('/api/download/archive')) {
    return new Response('zip', { headers: { 'content-type': 'application/zip' } });
  }
  if (/\/(thumbnail|original|playback)(\?|$)/.test(url)) {
    return new Response('picture', { headers: { 'content-type': 'image/jpeg' } });
  }
  return Response.json({ id: 'record', assets: [] });
}

type Handler = (event: RequestEvent) => Promise<Response> | Response;

let db: ReturnType<typeof import('#lib/db/database.ts').getDatabase>;
let proxy: typeof import('../src/routes/api/immich/[...path]/+server');
let media: typeof import('../src/routes/api/external/media/[id]/+server');
let mint: typeof import('../src/routes/api/download/+server');
let redeem: typeof import('../src/routes/api/download/[token]/+server');
let access: typeof import('#lib/server/asset-access.ts');
let albumAccess: typeof import('#lib/server/album-asset-access.ts');

/** A request as a handler receives it. */
function eventFor(
  path: string,
  params: Record<string, string>,
  init?: { method: string; body: unknown }
): RequestEvent {
  const url = new URL(`http://gallery.test${path}`);
  return {
    request: new Request(url, {
      method: init?.method ?? 'GET',
      ...(init
        ? { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } }
        : {}),
    }),
    url,
    params,
    locals: {},
    cookies: { get: () => undefined },
    fetch,
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

/** Every way one photo is read by its id alone, each answering for `photo`. */
function reads(photo: string): Array<[string, () => Promise<number>]> {
  const viaProxy = (tail: string) => (): Promise<number> => {
    const path = `assets/${photo}${tail}`;
    return statusOf(proxy.GET as unknown as Handler, eventFor(`/api/immich/${path}`, { path }));
  };
  return [
    ['record', viaProxy('')],
    ['thumbnail', viaProxy('/thumbnail')],
    ['original', viaProxy('/original')],
    ['video', viaProxy('/video/playback')],
    [
      'external media',
      () =>
        statusOf(
          media.GET as unknown as Handler,
          eventFor(`/api/external/media/${photo}`, { id: photo })
        ),
    ],
  ];
}

/** The status of every read of `photo`, by name. */
async function statuses(photo: string): Promise<Array<[string, number]>> {
  const out: Array<[string, number]> = [];
  for (const [name, read] of reads(photo)) out.push([name, await read()]);
  return out;
}

const all = (status: number) => reads(MINE).map(([name]) => [name, status]);

const mintFor = (body: unknown) =>
  mint.POST(eventFor('/api/download', {}, { method: 'POST', body }) as never) as Promise<Response>;

beforeAll(async () => {
  const dbDir = mkdtempSync(join(tmpdir(), 'migallery-asset-reads-'));
  process.env.DATABASE_PATH = join(dbDir, 'migallery.db');
  cleanup = () => removeTempDir(dbDir);
  const { getDatabase } = await import('#lib/db/database.ts');
  const { FACE_MODEL } = await import('#lib/face-embedding.ts');
  db = getDatabase();
  const user = db.prepare("INSERT INTO users (id_user, name, role) VALUES (?, ?, 'user')");
  for (const name of ['member', 'owner', 'other']) user.run(name, name);
  const album = db.prepare(
    'INSERT INTO albums (id, name, visibility, visible) VALUES (?, ?, ?, 1)'
  );
  album.run(OPEN_ALBUM, 'open', 'authenticated');
  album.run(PRIVATE_ALBUM, 'private', 'private');
  const face = db.prepare(
    `INSERT INTO face_matches (asset_id, face_index, model, user_id, distance, band, state, created_at)
      VALUES (?, 0, ?, ?, 0.1, ?, ?, 0)`
  );
  face.run(MINE, FACE_MODEL, 'member', 'auto', 'pending');
  face.run(ASKED_OF_ME, FACE_MODEL, 'member', 'suggested', 'pending');
  face.run(NOT_ME, FACE_MODEL, 'member', 'suggested', 'rejected');
  face.run(ASKED_OF_OTHER, FACE_MODEL, 'other', 'suggested', 'pending');
  face.run(OWNERS, FACE_MODEL, 'owner', 'suggested', 'confirmed');
  face.run(OWNERS_UNANSWERED, FACE_MODEL, 'owner', 'suggested', 'pending');

  vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => immich(String(url), init));
  access = await import('#lib/server/asset-access.ts');
  albumAccess = await import('#lib/server/album-asset-access.ts');
  proxy = await import('../src/routes/api/immich/[...path]/+server');
  media = await import('../src/routes/api/external/media/[id]/+server');
  mint = await import('../src/routes/api/download/+server');
  redeem = await import('../src/routes/api/download/[token]/+server');
}, 120_000);

let cleanup: () => void = () => undefined;

afterAll(() => {
  vi.unstubAllGlobals();
  cleanup();
});

beforeEach(() => {
  state.user = MEMBER;
  immichDown = false;
  asked = [];
  access.clearAssetAccessCache();
  albumAccess.clearAlbumMembershipCache();
  db.prepare('DELETE FROM photo_access_permissions').run();
});

describe('a photo read by its id, by a member', () => {
  it('is served when a face of it is theirs, without asking Immich where it is', async () => {
    expect(await statuses(MINE)).toEqual(all(200));
    expect(asked.filter((a) => a.url.includes('assetId='))).toEqual([]);
  });

  it('is served when a face of it waits for their answer', async () => {
    expect(await statuses(ASKED_OF_ME)).toEqual(all(200));
  });

  it('is refused when the face waits for the answer of someone else', async () => {
    expect(await statuses(ASKED_OF_OTHER)).toEqual(all(403));
  });

  it('is refused once they answered that the face is not theirs', async () => {
    expect(await statuses(NOT_ME)).toEqual(all(403));
  });

  it('is served when it is a photo of a member who authorised them, and refused the moment the authorisation goes', async () => {
    expect(await statuses(OWNERS)).toEqual(all(403));
    db.prepare(
      "INSERT INTO photo_access_permissions (owner_id, authorized_id) VALUES ('owner', 'member')"
    ).run();
    expect(await statuses(OWNERS)).toEqual(all(200));
    db.prepare('DELETE FROM photo_access_permissions').run();
    expect(await statuses(OWNERS)).toEqual(all(403));
  });

  it('is refused when the member who authorised them has not said the face is theirs', async () => {
    db.prepare(
      "INSERT INTO photo_access_permissions (owner_id, authorized_id) VALUES ('owner', 'member')"
    ).run();
    expect(await statuses(OWNERS_UNANSWERED)).toEqual(all(403));
  });

  it('is served when it is in an album they may open', async () => {
    expect(await statuses(IN_OPEN)).toEqual(all(200));
  });

  it.each([
    ['in an album they may not open', IN_PRIVATE],
    ['in an album that is not one of the gallery', IN_FOREIGN],
    ['in no album', NOWHERE],
  ])('is refused when it is %s', async (_what, photo) => {
    expect(await statuses(photo)).toEqual(all(403));
  });

  it('is answered 503, neither served nor refused, when Immich does not say where it is', async () => {
    immichDown = true;
    expect(await statuses(IN_OPEN)).toEqual(all(503));
    // Nothing was learned, so nothing was kept: the next request asks again and is served.
    immichDown = false;
    expect(await statuses(IN_OPEN)).toEqual(all(200));
  });

  it('asks Immich once per photo within the window', async () => {
    await statuses(IN_PRIVATE);
    expect(asked.filter((a) => a.url.includes('assetId=')).length).toBe(1);
  });
});

describe('a grid of refused photos', () => {
  it('writes one line for the viewer, with its count and the first photos', async () => {
    const lines = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (let n = 0; n < 40; n++) {
        const path = `assets/${id(500 + n)}/thumbnail`;
        const event = eventFor(`/api/immich/${path}`, { path });
        expect(await statusOf(proxy.GET as unknown as Handler, event)).toBe(403);
      }
      const refused = () =>
        lines.mock.calls.filter((call) => String(call[0]).includes('photo reads refused'));
      // Nothing is written per tile; the window's one line comes when it closes.
      expect(refused()).toEqual([]);
      access.flushAssetRefusals();
      expect(refused().length).toBe(1);
      expect(refused()[0][1]).toEqual({
        viewer: MEMBER.id_user,
        count: 40,
        firstAssetIds: [0, 1, 2, 3, 4].map((n) => id(500 + n)),
      });
    } finally {
      lines.mockRestore();
    }
  });
});

describe('a photo read by its id, by the staff', () => {
  it('is served whatever it is, without asking Immich where it is', async () => {
    state.user = STAFF;
    expect(await statuses(NOWHERE)).toEqual(all(200));
    expect(asked.filter((a) => a.url.includes('assetId='))).toEqual([]);
  });
});

describe('a download', () => {
  it('is refused when one of its photos is not readable, and mints nothing', async () => {
    await expect(mintFor({ assetIds: [MINE, IN_PRIVATE] })).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    ['an id that is not an Immich id', { assetIds: [MINE, '../albums'] }],
    ['no photo', { assetIds: [] }],
    ['more photos than one archive holds', { assetIds: Array.from({ length: 201 }, () => MINE) }],
    ['an album id that is not an Immich id', { assetIds: [MINE], albumId: 'x' }],
  ])('is answered 400 for %s', async (_what, body) => {
    await expect(mintFor(body)).rejects.toMatchObject({ status: 400 });
  });

  it('carries exactly the photos judged when it was asked, whatever the redemption says', async () => {
    const { token } = (await (await mintFor({ assetIds: [MINE, ASKED_OF_ME] })).json()) as {
      token: string;
    };
    asked = [];
    const event = eventFor(`/api/download/${token}?assetIds=${IN_PRIVATE}`, { token });
    expect(await statusOf(redeem.GET as unknown as Handler, event)).toBe(200);
    const archive = asked.find((a) => a.url.endsWith('/api/download/archive'));
    expect(JSON.parse(archive?.body ?? '{}')).toEqual({ assetIds: [MINE, ASKED_OF_ME] });
    // One use: the same token opens nothing a second time.
    expect(await statusOf(redeem.GET as unknown as Handler, event)).toBe(404);
  });

  it('is redeemed by the member who asked for it, and by nobody else', async () => {
    const { token } = (await (await mintFor({ assetIds: [MINE] })).json()) as { token: string };
    const event = () => eventFor(`/api/download/${token}`, { token });
    state.user = { id_user: 'other', role: 'user' };
    expect(await statusOf(redeem.GET as unknown as Handler, event())).toBe(403);
    state.user = null;
    expect(await statusOf(redeem.GET as unknown as Handler, event())).toBe(401);
    // Refused redemptions did not spend it: its owner still downloads.
    state.user = MEMBER;
    expect(await statusOf(redeem.GET as unknown as Handler, event())).toBe(200);
  });

  it('reads the photos as those of the album it names', async () => {
    // Immich lists the album's photos; a photo of another album is not one of them.
    vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) =>
      String(url).endsWith(`/api/albums/${OPEN_ALBUM}`)
        ? Response.json({ id: OPEN_ALBUM, assets: [{ id: IN_OPEN }] })
        : immich(String(url), init)
    );
    try {
      expect((await mintFor({ assetIds: [IN_OPEN], albumId: OPEN_ALBUM })).status).toBe(200);
      await expect(mintFor({ assetIds: [IN_PRIVATE], albumId: OPEN_ALBUM })).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        mintFor({ assetIds: [IN_PRIVATE], albumId: PRIVATE_ALBUM })
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => immich(String(url), init));
    }
  });
});
