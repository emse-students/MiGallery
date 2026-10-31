/**
 * Immich not configured is a STATE, not a failure: system albums are not resolved, nothing is
 * fetched, the cause is typed (`ImmichNotConfiguredError`), said once at info and answered 503 by
 * the routes - while a REAL failure to resolve a system album keeps its error line.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

const env = vi.hoisted(() => ({ IMMICH_BASE_URL: '', IMMICH_API_KEY: 'k' }));
vi.mock('#lib/server/env.ts', () => ({ env }));

let errors: MockInstance<(...args: unknown[]) => void>;
let infos: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  // The logger reads its threshold at load (tests default to errors only): info must be seen here.
  process.env.LOG_LEVEL = 'info';
  vi.resetModules();
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  infos = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.LOG_LEVEL;
  errors.mockRestore();
  infos.mockRestore();
});

const said = () =>
  infos.mock.calls.filter((c) => c.some((a) => String(a).includes('Immich is not configured')))
    .length;

describe('Immich not configured', () => {
  it('resolves no system album, fetches nothing, and says it once at info, never as an error', async () => {
    env.IMMICH_BASE_URL = '';
    const { getOrCreateSystemAlbum } = await import('#lib/immich/system-albums.ts');
    const { ImmichNotConfiguredError } = await import('#lib/immich/not-configured.ts');
    const fetchFn = vi.fn() as unknown as typeof fetch;
    await expect(getOrCreateSystemAlbum(fetchFn, 'PhotoCV')).rejects.toBeInstanceOf(
      ImmichNotConfiguredError
    );
    await expect(getOrCreateSystemAlbum(fetchFn, 'PhotoCV')).rejects.toBeInstanceOf(
      ImmichNotConfiguredError
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect(said()).toBe(1);
    expect(errors).not.toHaveBeenCalled();
  });

  it('keeps a real failure to resolve a system album at error', async () => {
    env.IMMICH_BASE_URL = 'http://immich.test';
    const { getOrCreateSystemAlbum } = await import('#lib/immich/system-albums.ts');
    const { ImmichNotConfiguredError } = await import('#lib/immich/not-configured.ts');
    const fetchFn = vi.fn(
      async () => new Response('down', { status: 502, statusText: 'Bad Gateway' })
    ) as unknown as typeof fetch;
    const failure = await getOrCreateSystemAlbum(fetchFn, 'PhotoCV').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ImmichNotConfiguredError);
    expect(
      errors.mock.calls.some((c) => String(c[0]).includes('failed to resolve system album'))
    ).toBe(true);
  });

  it('is answered 503 by a route, with no error line', async () => {
    env.IMMICH_BASE_URL = '';
    vi.doMock('#lib/server/face-access.ts', () => ({
      requirePhotoCvManager: async () => undefined,
    }));
    const route = await import('../src/routes/api/people/album/info/+server');
    const status = await (route.GET as (e: unknown) => Promise<Response>)({
      fetch: vi.fn(),
    }).then(
      (r) => r.status,
      (e: { status?: number }) => e.status
    );
    expect(status).toBe(503);
    expect(errors).not.toHaveBeenCalled();
  });
});
