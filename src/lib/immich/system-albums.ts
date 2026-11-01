import { error, isHttpError } from '@sveltejs/kit';
import { env } from '#lib/server/env.ts';
import { getDatabase, type DatabaseInstance } from '#lib/db/database.ts';
import { requireImmichBaseUrl } from '#lib/immich/not-configured.ts';
import { createLogger } from '#lib/server/logger.ts';
import type { ImmichAlbum } from '#lib/types/api.ts';
import { OUTBOUND_BUDGET_MS, immichCall } from '#lib/server/outbound.ts';
const log = createLogger('system-albums');

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

/**
 * A system album's id is DURABLE: it never changes once the album exists, so it is stored in the
 * database and read per request from there, never re-resolved by listing Immich's albums
 * (`GET /api/albums` answers EVERY album - 534 on prod - and is what timed out under Immich load
 * on 2026-11-01). Immich is asked only the first time, or after {@link forgetSystemAlbum}.
 */
function albumTable(): DatabaseInstance {
  // The table is part of schema.sql, which ensureSchema applies on every open of the database.
  return getDatabase();
}

function storedAlbumId(albumName: string): string | null {
  const row = albumTable().prepare('SELECT id FROM system_albums WHERE name = ?').get(albumName) as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

function storeAlbumId(albumName: string, id: string): void {
  albumTable()
    .prepare('INSERT OR REPLACE INTO system_albums (name, id) VALUES (?, ?)')
    .run(albumName, id);
}

/** Drop the stored id of `albumName`: Immich no longer has that album (it answered 404 on it). */
export function forgetSystemAlbum(albumName: string): void {
  log.warn('system album forgotten: Immich no longer has it', { albumName });
  albumTable().prepare('DELETE FROM system_albums WHERE name = ?').run(albumName);
}

async function fetchAlbums(fetchFn: typeof fetch): Promise<ImmichAlbum[]> {
  return immichCall(log, 'GET /api/albums', async () => {
    const res = await fetchFn(`${IMMICH_BASE_URL}/api/albums`, {
      signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
      headers: { 'x-api-key': IMMICH_API_KEY, Accept: 'application/json' },
    });
    if (!res.ok) {
      log.error('Immich refused the album list', { status: res.status });
      throw error(502, 'Immich refused the album list');
    }
    return (await res.json()) as ImmichAlbum[];
  });
}

/**
 * The id of the system album `albumName`, created in Immich when missing, then kept durably.
 * Throws `ImmichNotConfiguredError` when Immich is not configured (said once, at info). An Immich
 * that does not answer in time is a typed 504 (a 502 when unreachable), logged by
 * {@link immichCall} with the call name and the elapsed time.
 */
export async function getOrCreateSystemAlbum(
  fetchFn: typeof fetch,
  albumName: string
): Promise<string> {
  // Immich not configured is a state, not a failure: typed, said once at info, never logged here.
  requireImmichBaseUrl();
  const stored = storedAlbumId(albumName);
  if (stored) {
    return stored;
  }
  // Two requests that both find no stored id share ONE resolution: otherwise both would create the
  // album in Immich and one of them would be orphaned.
  let pending = resolving.get(albumName);
  if (!pending) {
    pending = resolveSystemAlbum(fetchFn, albumName).finally(() => resolving.delete(albumName));
    resolving.set(albumName, pending);
  }
  return pending;
}

const resolving = new Map<string, Promise<string>>();

/**
 * Run `run` against the stored id of `albumName`. When Immich answers 404 on it (the album was
 * deleted, or renamed: see `expectedName` in `fetchAlbumAssets`), the id is forgotten and the call
 * is retried ONCE with a freshly resolved id, so the member never sees the stale id's failure.
 */
export async function withSystemAlbum<T>(
  fetchFn: typeof fetch,
  albumName: string,
  run: (albumId: string) => Promise<T>
): Promise<T> {
  try {
    return await run(await getOrCreateSystemAlbum(fetchFn, albumName));
  } catch (e: unknown) {
    if (!isHttpError(e) || e.status !== 404) {
      throw e;
    }
    forgetSystemAlbum(albumName);
    return run(await getOrCreateSystemAlbum(fetchFn, albumName));
  }
}

async function resolveSystemAlbum(fetchFn: typeof fetch, albumName: string): Promise<string> {
  const albums = await fetchAlbums(fetchFn);
  const existing = albums.find((a) => a.albumName === albumName);
  if (existing) {
    storeAlbumId(albumName, existing.id);
    return existing.id;
  }

  // The body is read INSIDE the call: the deadline also covers it, and a timeout there must be a 504.
  const newAlbum = await immichCall(log, 'POST /api/albums', async () => {
    const createRes = await fetchFn(`${IMMICH_BASE_URL}/api/albums`, {
      signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
      method: 'POST',
      headers: { 'x-api-key': IMMICH_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ albumName, description: `System album ${albumName}` }),
    });
    if (!createRes.ok) {
      const txt = await createRes.text().catch(() => createRes.statusText);
      log.error('Immich refused to create the system album', {
        albumName,
        status: createRes.status,
        upstream: txt.slice(0, 300),
      });
      throw error(502, 'Immich refused to create the system album');
    }
    return (await createRes.json()) as ImmichAlbum;
  });
  storeAlbumId(albumName, newAlbum.id);
  return newAlbum.id;
}
