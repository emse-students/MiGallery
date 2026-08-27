import path from 'node:path';
import { env } from '$env/dynamic/private';
import { getDatabase } from '$lib/db/database';
import { ensureCacheDir, readCacheFile, writeCacheFileAtomic } from '$lib/server/disk-cache';
import { createLogger } from '$lib/server/logger';
import { searchAssetPage } from '$lib/server/immich-search';
import { OUTBOUND_BUDGET_MS } from '$lib/server/outbound';
import type { ImmichAlbum, ImmichAsset } from '$lib/types/api';

const log = createLogger('media-anomalies');

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

const SCAN_DIR = path.resolve('data/cache');
const SCAN_FILE = path.join(SCAN_DIR, 'media-scan.json');

/** Orphans are listed live, one page per request, so each stays inside one outbound budget. */
export const ORPHAN_PAGE_SIZE = 1000;

/**
 * How many albums the deep scan may walk before giving up. Prod has 528, so
 * this is a backstop against an upstream that keeps paginating, not a limit
 * anyone should reach.
 */
const MAX_ALBUMS = 5000;
/** Assets tracked at once during a scan, so a runaway upstream cannot exhaust the heap. */
const MAX_TRACKED_ASSETS = 500_000;
/** Pages per album. The biggest album on prod is 9 689 assets, so 10 pages. */
const ALBUM_PAGE_CAP = 50;
/** Albums queried at once. Gentle on purpose: Immich has slow windows on prod. */
const SCAN_CONCURRENCY = 3;

export interface AlbumInventory {
  immichAlbums: number;
  trackedAlbums: number;
  /** Albums that exist upstream with no row in our database. */
  untracked: Array<{ id: string; name: string; assetCount: number }>;
  /** Rows in our database whose upstream album is gone. */
  ghosts: Array<{ id: string; name: string }>;
}

export interface OrphanAsset {
  id: string;
  fileName: string;
  type: string;
  takenAt: string | null;
}

export interface OrphanPage {
  assets: OrphanAsset[];
  nextPage: number | null;
}

export interface MultiAlbumAsset {
  id: string;
  fileName: string;
  type: string;
  albums: Array<{ id: string; name: string }>;
}

export interface ScanResult {
  scannedAt: number;
  albumsScanned: number;
  albumsFailed: string[];
  assetsSeen: number;
  multiAlbum: MultiAlbumAsset[];
  truncated: boolean;
}

export interface ScanState {
  status: 'idle' | 'running' | 'done' | 'error';
  startedAt: number | null;
  albumsTotal: number;
  albumsDone: number;
  requests: number;
  error: string | null;
  result: ScanResult | null;
}

/**
 * Which assets sit in more than one album is the one question here that no
 * Immich query answers: there is no "assets in N albums" filter, and album
 * membership is only visible one album at a time. Answering it means walking
 * every album's asset list - 581 paginated requests for prod's 528 albums,
 * two to four minutes.
 *
 * So it is a MANUAL scan, run in the background, its progress polled, and its
 * answer kept: in memory for this process, and in `data/cache/media-scan.json`
 * so a restart does not throw away four minutes of upstream traffic.
 *
 * The result is READ-ONLY by design (the user's explicit call): an asset in
 * several albums is not necessarily wrong, and deciding which membership to
 * drop is a separate job from noticing it.
 */
let state: ScanState = {
  status: 'idle',
  startedAt: null,
  albumsTotal: 0,
  albumsDone: 0,
  requests: 0,
  error: null,
  result: null,
};

/** In-flight scan, so a second click joins the first instead of starting a rival. */
let running: Promise<void> | null = null;

/** Fetch every album upstream. The list carries assetCount but never inlines assets. */
async function fetchImmichAlbums(fetchFn: typeof fetch): Promise<ImmichAlbum[]> {
  if (!IMMICH_BASE_URL) {
    throw new Error('IMMICH_BASE_URL not configured');
  }
  const res = await fetchFn(`${IMMICH_BASE_URL}/api/albums`, {
    signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
    headers: { 'x-api-key': IMMICH_API_KEY, Accept: 'application/json' },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to fetch albums: ${res.status} ${txt}`);
  }
  return (await res.json()) as ImmichAlbum[];
}

/**
 * Compare the upstream album list against our own rows.
 *
 * Cheap: one upstream request and one SQLite query, no asset traffic at all.
 * PhotoCV is expected to be untracked - it is a system album we create and
 * deliberately keep out of the gallery listing - so it is reported like any
 * other and the page labels it.
 */
export async function getAlbumInventory(fetchFn: typeof fetch): Promise<AlbumInventory> {
  const albums = await fetchImmichAlbums(fetchFn);
  const db = getDatabase();
  const rows = db.prepare('SELECT id, name FROM albums').all() as Array<{
    id: string;
    name: string;
  }>;

  const trackedIds = new Set(rows.map((r) => r.id));
  const upstreamIds = new Set(albums.map((a) => a.id));

  return {
    immichAlbums: albums.length,
    trackedAlbums: rows.length,
    untracked: albums
      .filter((a) => !trackedIds.has(a.id))
      .map((a) => ({ id: a.id, name: a.albumName || '(sans nom)', assetCount: a.assetCount || 0 })),
    ghosts: rows.filter((r) => !upstreamIds.has(r.id)).map((r) => ({ id: r.id, name: r.name })),
  };
}

/**
 * One page of assets that belong to no album.
 *
 * NO TYPE FILTER, deliberately: prod's 4 533 orphans include 145 videos, and
 * the `type: 'IMAGE'` that the trombinoscope searches pin would hide every one
 * of them. Trashed assets are already excluded - Immich's search leaves them
 * out unless asked for them.
 */
export async function getOrphanPage(fetchFn: typeof fetch, page: number): Promise<OrphanPage> {
  const result = await searchAssetPage(fetchFn, { isNotInAlbum: true }, page, ORPHAN_PAGE_SIZE);

  return {
    assets: result.items.map(toOrphan),
    nextPage: result.nextPage,
  };
}

function toOrphan(asset: ImmichAsset): OrphanAsset {
  return {
    id: asset.id,
    fileName: asset.originalFileName || asset.id,
    type: asset.type || 'IMAGE',
    takenAt: asset.localDateTime || asset.fileCreatedAt || null,
  };
}

/** Snapshot of the current scan, safe to serialize. */
export function getScanState(): ScanState {
  return state;
}

/**
 * Reload the last scan from disk, so a fresh process does not report "never
 * scanned" when a perfectly good answer is sitting in the cache.
 */
export function loadScanSnapshot(): ScanResult | null {
  if (state.result) {
    return state.result;
  }
  // A scan in flight owns the status; never let a disk read report it finished.
  if (state.status === 'running') {
    return null;
  }
  const raw = readCacheFile(SCAN_FILE);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as ScanResult;
    if (!Array.isArray(parsed.multiAlbum)) {
      return null;
    }
    state = { ...state, status: 'done', result: parsed };
    return parsed;
  } catch (e) {
    log.warn('ignoring unreadable scan snapshot', e);
    return null;
  }
}

function saveScanSnapshot(result: ScanResult): void {
  try {
    ensureCacheDir(SCAN_DIR);
    writeCacheFileAtomic(SCAN_FILE, Buffer.from(JSON.stringify(result), 'utf8'));
  } catch (e) {
    // A scan that cannot be persisted is still a scan: keep the in-memory answer.
    log.error('failed to persist scan snapshot', e);
  }
}

/**
 * Start a deep scan unless one is already running, and return immediately.
 *
 * The caller polls `getScanState()`: no HTTP request stays open for the two to
 * four minutes this takes, which is also why the progress counters live in
 * module state rather than in the response - and why the scan uses the global
 * fetch rather than the one belonging to the request that started it.
 */
export function startDeepScan(): ScanState {
  if (running) {
    return state;
  }

  state = {
    status: 'running',
    startedAt: Date.now(),
    albumsTotal: 0,
    albumsDone: 0,
    requests: 0,
    error: null,
    result: state.result,
  };

  // The GLOBAL fetch, never the request's: this outlives the response that
  // started it by minutes, and `event.fetch` belongs to a request that is over.
  running = runDeepScan(fetch)
    .catch((e: unknown) => {
      // There is no `handleError` hook in this app, and this runs detached from
      // any request, so an unlogged throw here would vanish completely.
      const message = e instanceof Error ? e.message : String(e);
      log.error('deep scan failed', e);
      state = { ...state, status: 'error', error: message };
    })
    .finally(() => {
      running = null;
    });

  return state;
}

/**
 * Walk every album and tally how many albums each asset belongs to.
 *
 * MEMORY: one map entry per asset seen (167k on prod). The value holds the
 * album id as a plain string until a second album claims the same asset, and
 * only then becomes an array - so the overwhelmingly common single-album case
 * costs one interned reference, not an array. File names are recorded only at
 * that promotion, because the asset object is in hand exactly then; keeping
 * names for all 167k assets would be the expensive part, and the answer needs
 * about 600 of them.
 */
async function runDeepScan(fetchFn: typeof fetch): Promise<void> {
  const albums = (await fetchImmichAlbums(fetchFn)).slice(0, MAX_ALBUMS);
  state = { ...state, albumsTotal: albums.length, requests: state.requests + 1 };

  const albumNames = new Map(albums.map((a) => [a.id, a.albumName || '(sans nom)']));
  const membership = new Map<string, string | string[]>();
  const details = new Map<string, { fileName: string; type: string }>();
  const failed: string[] = [];
  let truncated = false;

  const record = (asset: ImmichAsset, albumId: string) => {
    const known = membership.get(asset.id);
    if (known === undefined) {
      if (membership.size >= MAX_TRACKED_ASSETS) {
        truncated = true;
        return;
      }
      membership.set(asset.id, albumId);
      return;
    }
    if (typeof known === 'string') {
      if (known === albumId) {
        return;
      }
      membership.set(asset.id, [known, albumId]);
      details.set(asset.id, {
        fileName: asset.originalFileName || asset.id,
        type: asset.type || 'IMAGE',
      });
      return;
    }
    if (!known.includes(albumId)) {
      known.push(albumId);
    }
  };

  const queue = [...albums];
  const worker = async () => {
    for (;;) {
      const album = queue.shift();
      if (!album) {
        return;
      }
      try {
        await scanAlbum(fetchFn, album.id, record);
      } catch (e) {
        // One album that times out must not sink a four-minute scan: record it
        // and carry on, so the result says what it could not see.
        log.warn(`scan skipped album ${album.id}`, e);
        failed.push(albumNames.get(album.id) || album.id);
      }
      state = { ...state, albumsDone: state.albumsDone + 1 };
    }
  };

  await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));

  const multiAlbum: MultiAlbumAsset[] = [];
  for (const [assetId, value] of membership) {
    if (typeof value === 'string') {
      continue;
    }
    const detail = details.get(assetId);
    multiAlbum.push({
      id: assetId,
      fileName: detail?.fileName || assetId,
      type: detail?.type || 'IMAGE',
      albums: value.map((id) => ({ id, name: albumNames.get(id) || id })),
    });
  }
  multiAlbum.sort((a, b) => b.albums.length - a.albums.length);

  const result: ScanResult = {
    scannedAt: Date.now(),
    albumsScanned: albums.length - failed.length,
    albumsFailed: failed,
    assetsSeen: membership.size,
    multiAlbum,
    truncated,
  };

  saveScanSnapshot(result);
  state = { ...state, status: 'done', result };
  log.info(
    `deep scan done: ${result.albumsScanned}/${albums.length} albums, ${result.assetsSeen} assets, ${multiAlbum.length} in several albums`
  );
}

/** Paginate one album's assets, retrying once - a single slow window is not a failure. */
async function scanAlbum(
  fetchFn: typeof fetch,
  albumId: string,
  record: (asset: ImmichAsset, albumId: string) => void
): Promise<void> {
  try {
    await walkAlbum(fetchFn, albumId, record);
  } catch {
    await walkAlbum(fetchFn, albumId, record);
  }
}

/**
 * Paginated page by page rather than through `searchAllAssets`: the tally only
 * ever needs the page in hand, and the biggest album on prod holds 9 689 assets
 * that there is no reason to collect into an array just to discard it.
 */
async function walkAlbum(
  fetchFn: typeof fetch,
  albumId: string,
  record: (asset: ImmichAsset, albumId: string) => void
): Promise<void> {
  let page: number | null = 1;
  let fetched = 0;

  while (page !== null && fetched < ALBUM_PAGE_CAP) {
    const result = await searchAssetPage(fetchFn, { albumIds: [albumId] }, page, ORPHAN_PAGE_SIZE);
    fetched++;
    state = { ...state, requests: state.requests + 1 };
    for (const asset of result.items) {
      record(asset, albumId);
    }
    page = result.nextPage;
  }
}
