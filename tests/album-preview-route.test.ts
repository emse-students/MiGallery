/**
 * `GET /api/albums/[id]/preview` is the card Canari draws for an album link, for every visibility:
 * answered to a READ-scoped key (the scope Canari holds), refused without one, and carrying the
 * four fields a card needs and nothing else - the grant lists are `/info`'s, and the staff's.
 * The session half of the rule is pinned with every other album read in `album-read-routes.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { removeTempDir } from './test-helpers';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PRIVATE = id(1);
const OPEN = id(2);
const UNKNOWN = id(9);

type Handler = (event: RequestEvent) => Promise<Response> | Response;

let dbDir: string;
let GET: Handler;
let readKey: string;
let otherScopeKey: string;

/** A GET of the route, carrying `key` as MiGallery's `x-api-key` when one is given. */
function eventFor(album: string, key?: string): RequestEvent {
  const url = new URL(`http://gallery.test/api/albums/${album}/preview`);
  return {
    request: new Request(url, { headers: key ? { 'x-api-key': key } : {} }),
    url,
    params: { id: album },
    locals: {},
    cookies: { get: () => undefined },
  } as unknown as RequestEvent;
}

/** The status and body a handler ends with, whether it returned or threw a SvelteKit `error()`. */
async function answerOf(event: RequestEvent): Promise<{ status: number; body: unknown }> {
  try {
    const res = await GET(event);
    return { status: res.status, body: await res.json() };
  } catch (thrown) {
    const t = thrown as { status?: number; body?: unknown };
    return { status: t.status ?? 500, body: t.body };
  }
}

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'migallery-album-preview-'));
  process.env.DATABASE_PATH = join(dbDir, 'migallery.db');
  const { getDatabase } = await import('#lib/db/database.ts');
  const { createApiKey } = await import('#lib/db/api-keys.ts');
  const db = getDatabase();
  db.prepare(
    'INSERT INTO albums (id, name, date, location, visibility, visible) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(PRIVATE, 'Gala', '2026-11-20', 'Saint-Etienne', 'private', 1);
  db.prepare('INSERT INTO albums (id, name, visibility, visible) VALUES (?, ?, ?, ?)').run(
    OPEN,
    'Open',
    'authenticated',
    1
  );
  db.prepare('INSERT INTO album_permissions (album_id, kind, value) VALUES (?, ?, ?)').run(
    PRIVATE,
    'user',
    'someone'
  );
  readKey = createApiKey('canari', ['read']).rawKey;
  otherScopeKey = createApiKey('nothing', ['public']).rawKey;
  GET = (await import('../src/routes/api/albums/[id]/preview/+server')).GET as unknown as Handler;
}, 120_000);

afterAll(() => {
  removeTempDir(dbDir);
});

describe('the album preview', () => {
  it('answers a read-scoped key for a private album with exactly the four card fields', async () => {
    const { status, body } = await answerOf(eventFor(PRIVATE, readKey));
    expect(status).toBe(200);
    expect(body).toEqual({
      name: 'Gala',
      date: '2026-11-20',
      location: 'Saint-Etienne',
      visibility: 'private',
    });
  });

  it('never carries a grant list', async () => {
    const { body } = await answerOf(eventFor(PRIVATE, readKey));
    for (const field of ['users', 'tags', 'formations', 'promos', 'assets']) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it('states null for a date and a place the album does not have', async () => {
    const { body } = await answerOf(eventFor(OPEN, readKey));
    expect(body).toEqual({ name: 'Open', date: null, location: null, visibility: 'authenticated' });
  });

  it('asks for a key or a session, and refuses a key without the read scope', async () => {
    expect((await answerOf(eventFor(PRIVATE))).status).toBe(401);
    expect((await answerOf(eventFor(PRIVATE, otherScopeKey))).status).toBe(403);
    expect((await answerOf(eventFor(PRIVATE, 'not-a-key'))).status).toBe(403);
  });

  it('answers 404 to a key for an album the gallery does not know, 400 for a non-id', async () => {
    expect((await answerOf(eventFor(UNKNOWN, readKey))).status).toBe(404);
    expect((await answerOf(eventFor('..%2Fusers', readKey))).status).toBe(400);
  });
});
