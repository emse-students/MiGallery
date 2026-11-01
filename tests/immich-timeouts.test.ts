import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows = new Map<string, string>();
vi.mock('#lib/server/env.ts', () => ({
  env: { IMMICH_BASE_URL: 'http://immich.test', IMMICH_API_KEY: 'k' },
}));
vi.mock('#lib/db/database.ts', () => ({
  getDatabase: () => ({
    exec: () => undefined,
    prepare: (sql: string) => ({
      get: (name: string) => (rows.has(name) ? { id: rows.get(name) } : undefined),
      run: (...a: string[]) => {
        if (sql.startsWith('DELETE')) rows.delete(a[0]);
        else rows.set(a[0], a[1]);
      },
    }),
  }),
}));
const errors = vi.hoisted(() => vi.fn());
vi.mock('#lib/server/logger.ts', () => ({
  createLogger: () => ({ warn() {}, info() {}, debug() {}, error: errors }),
}));

import { getOrCreateSystemAlbum, forgetSystemAlbum } from '../src/lib/immich/system-albums';
import { fetchAlbumAssets } from '../src/lib/immich/album-assets';
import { immichCall } from '../src/lib/server/outbound';
import { photosFailureMessage } from '../src/lib/photos-failure';

const timeout = () => new DOMException('The operation timed out.', 'TimeoutError');
const json = (b: unknown) =>
  new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  rows.clear();
  errors.mockClear();
});

describe('system album id is durable', () => {
  it('lists Immich albums once, then never again', async () => {
    const fetchFn = vi.fn(async () => json([{ id: 'a1', albumName: 'PhotoCV' }]));
    expect(await getOrCreateSystemAlbum(fetchFn as never, 'PhotoCV')).toBe('a1');
    expect(await getOrCreateSystemAlbum(fetchFn as never, 'PhotoCV')).toBe('a1');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('asks Immich again once the id is forgotten', async () => {
    const fetchFn = vi.fn(async () => json([{ id: 'a2', albumName: 'PhotoCV' }]));
    rows.set('PhotoCV', 'old');
    forgetSystemAlbum('PhotoCV');
    expect(await getOrCreateSystemAlbum(fetchFn as never, 'PhotoCV')).toBe('a2');
  });

  it('types a timed-out album list as 504 and logs the call with its elapsed time', async () => {
    const fetchFn = vi.fn(async () => {
      throw timeout();
    });
    const failure = await getOrCreateSystemAlbum(fetchFn as never, 'PhotoCV').catch((e) => e);
    expect(failure.status).toBe(504);
    expect(errors).toHaveBeenCalledWith(
      'Immich did not answer in time',
      expect.objectContaining({ call: 'GET /api/albums', elapsedMs: expect.any(Number) })
    );
  });
});

describe('immichCall', () => {
  it('classifies an unreachable Immich as 502', async () => {
    const failure = await immichCall({ error: errors } as never, 'x', async () => {
      throw new TypeError('fetch failed');
    }).catch((e) => e);
    expect(failure.status).toBe(502);
  });
});

describe('album reads', () => {
  it('a 404 is a typed 404, a timeout a 504, a refused member page a 502 (never a truncation)', async () => {
    const notFound = vi.fn(async () => new Response('', { status: 404 }));
    expect(
      (await fetchAlbumAssets(notFound as never, 'http://i', 'k', 'x').catch((e) => e)).status
    ).toBe(404);
    const slow = vi.fn(async () => {
      throw timeout();
    });
    expect(
      (await fetchAlbumAssets(slow as never, 'http://i', 'k', 'x').catch((e) => e)).status
    ).toBe(504);
    let n = 0;
    const refusing = vi.fn(async () =>
      n++ === 0 ? json({ id: 'x' }) : new Response('', { status: 500 })
    );
    expect(
      (await fetchAlbumAssets(refusing as never, 'http://i', 'k', 'x').catch((e) => e)).status
    ).toBe(502);
  });
});

describe('what the member reads', () => {
  it('says the server is busy for 502 and 504, keeps the text otherwise', () => {
    const busy = photosFailureMessage(504, 'x');
    expect(photosFailureMessage(502, 'x')).toBe(busy);
    expect(photosFailureMessage(500, 'boom')).not.toBe(busy);
  });
});
