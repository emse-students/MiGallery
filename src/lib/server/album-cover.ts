import fs from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import sharp from '$lib/server/sharp-config';
import { acquireSharp } from '$lib/server/sharp-limit';
import { getDatabase } from '$lib/db/database';
import { ensureCacheDir, readCacheFile, writeCacheFileAtomic } from '$lib/server/disk-cache';
import { searchAssetPage } from '$lib/server/immich-search';
import { createLogger } from '$lib/server/logger';
import { OUTBOUND_BUDGET_MS } from '$lib/server/outbound';

const log = createLogger('album-cover');

/**
 * Square album covers, persisted on disk.
 *
 * Two facts are stored, and neither is recomputed on a page load:
 *  - WHICH asset is the cover -> `albums.cover_asset_id` (SQLite).
 *  - WHAT the square image looks like -> `data/cache/covers/<assetId>.webp`.
 *
 * The file is named after the ASSET, not the album: two albums sharing a cover
 * share one file, and re-selecting a previously used cover is free. A file is
 * deleted only once no album references its asset any more (cover changed,
 * album deleted) - see `pruneCoverAsset` and `pruneOrphanCovers`.
 */

export const COVER_DIR = path.resolve('data/cache/covers');
/** Wide 1200x630 covers for link unfurling, keyed by ALBUM id. */
export const OG_COVER_DIR = path.resolve('data/cache/og-covers');

const COVER_SIZE = 400;
const COVER_QUALITY = 50;

try {
  ensureCacheDir(COVER_DIR);
} catch (e) {
  log.error('Failed to create cover cache dir', e);
}

export interface AlbumCover {
  assetId: string;
  type: string;
}

interface CoverRow {
  cover_asset_id?: string | null;
  cover_asset_type?: string | null;
}

/**
 * Read the persisted cover of an album, without contacting the media backend.
 * Returns null when the album is unknown or its cover was never resolved.
 */
export function getStoredCover(albumId: string): AlbumCover | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT cover_asset_id, cover_asset_type FROM albums WHERE id = ?')
    .get(albumId) as CoverRow | undefined;
  if (!row?.cover_asset_id) {
    return null;
  }
  return { assetId: row.cover_asset_id, type: row.cover_asset_type || 'IMAGE' };
}

/**
 * Persist which asset is an album's cover, pruning the image of the asset it
 * replaces when nothing else references it.
 */
export function storeCover(albumId: string, cover: AlbumCover): void {
  const previous = getStoredCover(albumId);
  const db = getDatabase();
  db.prepare('UPDATE albums SET cover_asset_id = ?, cover_asset_type = ? WHERE id = ?').run(
    cover.assetId,
    cover.type,
    albumId
  );
  if (previous && previous.assetId !== cover.assetId) {
    pruneCoverAsset(previous.assetId);
  }
  // The wide OG variant is keyed by album, so a cover change invalidates it.
  removeFile(path.join(OG_COVER_DIR, `${albumId}.webp`));
}

/**
 * Resolve an album's cover: the stored one if we have it, otherwise ask the
 * media backend once and persist the answer.
 *
 * Resolution asks for a SINGLE asset (`size: 1`), never the album's full asset
 * list: the whole point is to learn one id, and paginating thousands of assets
 * to do so is what made the albums page slow.
 */
export async function resolveCover(
  albumId: string,
  fetchFn: typeof fetch
): Promise<AlbumCover | null> {
  const stored = getStoredCover(albumId);
  if (stored) {
    return stored;
  }

  const baseUrl = (env.IMMICH_BASE_URL || '').replace(/\/$/, '');
  const apiKey = env.IMMICH_API_KEY || '';
  if (!baseUrl) {
    return null;
  }

  try {
    const albumRes = await fetchFn(`${baseUrl}/api/albums/${albumId}`, {
      signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
    });
    if (!albumRes.ok) {
      return null;
    }
    const album = (await albumRes.json()) as {
      albumThumbnailAssetId?: string | null;
      assets?: Array<{ id: string; type?: string }>;
    };

    const inline = Array.isArray(album.assets) ? album.assets : [];
    const pinned = album.albumThumbnailAssetId;

    if (pinned) {
      const match = inline.find((a) => a.id === pinned);
      const cover: AlbumCover = { assetId: pinned, type: match?.type || 'IMAGE' };
      storeCover(albumId, cover);
      return cover;
    }

    if (inline.length > 0) {
      const cover: AlbumCover = { assetId: inline[0].id, type: inline[0].type || 'IMAGE' };
      storeCover(albumId, cover);
      return cover;
    }

    // Assets are not inlined by recent backend versions: ask for exactly one.
    // A failure here throws and is caught below as "no cover", which is the
    // right answer for a cover: there is nothing to fall back to.
    const { items } = await searchAssetPage(fetchFn, { albumIds: [albumId] }, 1, 1);
    const first = items[0];
    if (!first?.id) {
      return null;
    }
    const cover: AlbumCover = { assetId: first.id, type: first.type || 'IMAGE' };
    storeCover(albumId, cover);
    return cover;
  } catch (e) {
    log.warn(`Failed to resolve cover for album ${albumId}`, e);
    return null;
  }
}

/**
 * Return the square WebP for an asset, generating and caching it on a miss.
 * Returns null when the queue is saturated, so the caller can fall back rather
 * than hold a native buffer in RAM under burst.
 */
export async function getCoverImage(
  assetId: string,
  fetchFn: typeof fetch
): Promise<Buffer | null> {
  const cacheFile = path.join(COVER_DIR, `${assetId}.webp`);
  const cached = readCacheFile(cacheFile);
  if (cached) {
    return cached;
  }

  const baseUrl = (env.IMMICH_BASE_URL || '').replace(/\/$/, '');
  const apiKey = env.IMMICH_API_KEY || '';
  if (!baseUrl) {
    return null;
  }

  // Acquire the lock BEFORE the download: bounding Sharp alone would still let
  // N concurrent requests materialize N native buffers.
  const release = await acquireSharp();
  if (!release) {
    return null;
  }

  try {
    // Source = the "preview" thumbnail (a few hundred KB), never the original
    // (JPEG 5-30 MB, RAW 50 MB+), to build a 400x400 square.
    //
    // The deadline matters MORE here than on a plain call: the Sharp slot is
    // already held, so a download that hangs does not stall one request, it
    // starves every other request waiting for a slot.
    const thumbRes = await fetchFn(`${baseUrl}/api/assets/${assetId}/thumbnail?size=preview`, {
      signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
      headers: { 'x-api-key': apiKey },
    });
    if (!thumbRes.ok) {
      return null;
    }
    const buf = Buffer.from(await thumbRes.arrayBuffer());
    const processed = await sharp(buf)
      .resize(COVER_SIZE, COVER_SIZE, { fit: 'cover', position: 'center' })
      .webp({ quality: COVER_QUALITY })
      .toBuffer();

    try {
      writeCacheFileAtomic(cacheFile, processed);
    } catch (e) {
      log.error('Cover cache write failed', e);
    }
    return processed;
  } catch (e) {
    log.error(`Failed to build cover image for asset ${assetId}`, e);
    return null;
  } finally {
    release();
  }
}

/** Delete a file, treating "already gone" as success. */
function removeFile(file: string): number {
  try {
    const size = fs.statSync(file).size;
    fs.unlinkSync(file);
    return size;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn(`Failed to delete ${file}`, e);
    }
    return 0;
  }
}

/**
 * Delete the square image of an asset, but only if no album still uses that
 * asset as its cover. This is the whole retention rule: a cover file lives
 * exactly as long as something points at it.
 */
export function pruneCoverAsset(assetId: string): void {
  const db = getDatabase();
  const stillUsed = db
    .prepare('SELECT 1 FROM albums WHERE cover_asset_id = ? LIMIT 1')
    .get(assetId) as unknown;
  if (stillUsed) {
    return;
  }
  removeFile(path.join(COVER_DIR, `${assetId}.webp`));
}

/**
 * Drop everything an album owned once it is deleted: its wide OG image (keyed
 * by album) and its square cover (if no other album shares the asset).
 */
export function pruneAlbumCovers(albumId: string, coverAssetId?: string | null): void {
  removeFile(path.join(OG_COVER_DIR, `${albumId}.webp`));
  if (coverAssetId) {
    pruneCoverAsset(coverAssetId);
  }
}

/**
 * Resolve every album whose cover was never persisted. Run before a sweep:
 * an unresolved album references nothing, so its still-valid cached image
 * would otherwise look like an orphan and be deleted.
 */
export async function resolveMissingCovers(fetchFn: typeof fetch): Promise<number> {
  const db = getDatabase();
  const pending = db.prepare('SELECT id FROM albums WHERE cover_asset_id IS NULL').all() as Array<{
    id: string;
  }>;

  let resolved = 0;
  // Sequential on purpose: this is an admin maintenance action, not a page
  // load, and a burst of hundreds of parallel calls helps nobody.
  for (const { id } of pending) {
    if (await resolveCover(id, fetchFn)) {
      resolved++;
    }
  }
  return resolved;
}

export interface PruneResult {
  deleted: number;
  bytes: number;
  kept: number;
}

/**
 * Sweep both cover caches for files no album references any more. Covers
 * accumulated before covers were tracked in SQLite are collected here.
 */
export function pruneOrphanCovers(): PruneResult {
  const db = getDatabase();
  const referencedAssets = new Set(
    (
      db
        .prepare('SELECT DISTINCT cover_asset_id FROM albums WHERE cover_asset_id IS NOT NULL')
        .all() as Array<{ cover_asset_id: string }>
    ).map((r) => r.cover_asset_id)
  );
  const knownAlbums = new Set(
    (db.prepare('SELECT id FROM albums').all() as Array<{ id: string }>).map((r) => r.id)
  );

  let deleted = 0;
  let bytes = 0;
  let kept = 0;

  const sweep = (dir: string, referenced: Set<string>) => {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn(`Failed to read ${dir}`, e);
      }
      return;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.webp')) {
        continue;
      }
      const key = entry.slice(0, -'.webp'.length);
      if (referenced.has(key)) {
        kept++;
        continue;
      }
      const size = removeFile(path.join(dir, entry));
      if (size > 0) {
        deleted++;
        bytes += size;
      }
    }
  };

  sweep(COVER_DIR, referencedAssets);
  sweep(OG_COVER_DIR, knownAlbums);

  return { deleted, bytes, kept };
}
