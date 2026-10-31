/**
 * Square crops of ONE matched face (lot A6, docs/wiki/face-matching-option-c.md).
 *
 * A crop is cut from the Immich preview of the photo, centred on the box the face store holds for
 * that face (`faces.db` `face_embeddings`: x1, y1, x2, y2 in the frame `img_w` x `img_h` the
 * detector saw). Nothing here asks Immich where a face is: Immich's people and faces are deleted
 * by lot A8, and the box the store holds is the one the match was decided on.
 *
 * WHOSE CROPS. A crop is cached in the directory of the MEMBER who holds the face
 * (`data/cache/faces/members/<hash of the member id>/<asset>_<face>.webp`), and only for a member:
 * the confirmation screen and the profile photo are the two readers, and both are served to that
 * member alone (the avatar is the member's own choice of photo). So a withdrawal deletes the whole
 * directory ({@link deleteMemberFaceCrops}) in the same path that deletes the matches, and an
 * answer of "not me" deletes that one crop ({@link deleteMemberFaceCrop}).
 *
 * The older crops of A1, keyed by an Immich person (`data/cache/faces/<asset>_<person>.webp`), are
 * no longer generated; {@link deletePersonFaceCrops} still removes them when a linked person is
 * erased, until lot A8 deletes the persons themselves.
 */

import { env } from '#lib/server/env.ts';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from '#lib/server/sharp-config.ts';
import { acquireSharp } from '#lib/server/sharp-limit.ts';
import { createLogger } from '#lib/server/logger.ts';
import { ensureCacheDir, readCacheFile, writeCacheFileAtomic } from '#lib/server/disk-cache.ts';
import { OUTBOUND_BUDGET_MS } from '#lib/server/outbound.ts';
import type { FaceKey } from '#lib/server/face-store.ts';

const log = createLogger('face-crop');
const CACHE_DIR = path.resolve('data/cache/faces');
const MEMBERS_DIR = path.join(CACHE_DIR, 'members');

// Square edge (px) of the generated face thumbnail. Fixed server-side so every
// consumer (confirmation screen, avatar) gets a consistent size instead of
// relying on CSS.
export const OUTPUT_SIZE = 320;
// The face box should fill ~62% of the square, leaving some context/margin.
const FACE_TARGET = 0.62;
const WEBP_QUALITY = 68;

/** An asset id as it may appear in a cache file name: Immich ids are UUIDs. */
const SAFE_ASSET_ID = /^[\w-]{1,64}$/;

/**
 * A face box in pixels of the image the detector saw (`imgW` x `imgH`), as the face store keeps
 * it. Scaled to the preview actually downloaded before cropping, so the two frames may differ.
 */
export interface FaceBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  imgW: number;
  imgH: number;
}

type Region = { left: number; top: number; width: number; height: number };

type FetchFn = typeof fetch;

/**
 * Result of a crop. On failure, `reason` lets the caller pick an HTTP response: 'busy' -> 503 (the
 * Sharp pool is full); 'notfound' -> 404; 'config' -> 500 (missing Immich env); 'error' -> 500.
 */
export type FaceCropResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; reason: 'busy' | 'notfound' | 'config' | 'error' };

/**
 * The cache directory of one member. Named by a hash of the id so an id that is not a safe file
 * name (a dot, a slash) can never escape the cache root.
 */
export function memberCropDir(userId: string): string {
  const digest = createHash('sha256').update(userId).digest('hex').slice(0, 32);
  return path.join(MEMBERS_DIR, digest);
}

function memberCropFile(userId: string, face: FaceKey): string {
  return path.join(memberCropDir(userId), `${face.assetId}_${face.faceIndex}.webp`);
}

/**
 * Generate (or read from the member's cache) a square WebP of one face, centred on its stored
 * box. The CALLER has checked that `userId` holds that face; `stillHeld` is asked again after a
 * fresh crop is written, and a face that left the member meanwhile (a withdrawal, an answer, a
 * re-decision) has its file deleted at once, so a crop never outlives the match it was made for in
 * the member's directory because of a race.
 */
export async function generateMemberFaceCrop(
  userId: string,
  face: FaceKey,
  box: FaceBox,
  fetchFn: FetchFn,
  stillHeld: () => boolean
): Promise<FaceCropResult> {
  log.debug('member face crop asked', { faceIndex: face.faceIndex });
  const apiKey = env.IMMICH_API_KEY;
  const baseUrl = env.IMMICH_BASE_URL?.replace(/\/$/, '');
  if (!apiKey || !baseUrl) {
    log.error('face crop asked while Immich is not configured');
    return { ok: false, reason: 'config' };
  }
  if (!SAFE_ASSET_ID.test(face.assetId) || !Number.isInteger(face.faceIndex)) {
    log.warn('face crop refused: not a usable face key');
    return { ok: false, reason: 'notfound' };
  }

  const cacheFile = memberCropFile(userId, face);
  try {
    const cached = readCacheFile(cacheFile);
    if (cached) {
      return { ok: true, buffer: cached };
    }
  } catch (e) {
    log.warn('face crop cache read failed, regenerating', (e as Error).message);
  }

  // Acquire the Sharp slot BEFORE downloading the source so concurrent requests
  // do not each materialize a preview buffer in native RAM (see sharp-limit).
  const release = await acquireSharp();
  if (!release) {
    log.warn('face crop refused: the Sharp pool is full');
    return { ok: false, reason: 'busy' };
  }

  try {
    // Source = "preview" thumbnail (a few hundred KB), never the full-resolution original. The
    // Sharp slot is already held, so a hung download would starve the pool: same deadline as
    // every outbound call.
    const previewRes = await fetchFn(
      `${baseUrl}/api/assets/${encodeURIComponent(face.assetId)}/thumbnail?size=preview`,
      { signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS), headers: { 'x-api-key': apiKey } }
    );
    if (!previewRes.ok) {
      log.warn('face crop: the preview was not served', { status: previewRes.status });
      await previewRes.body?.cancel().catch(() => undefined);
      return { ok: false, reason: 'notfound' };
    }

    const image = sharp(Buffer.from(await previewRes.arrayBuffer()));
    const meta = await image.metadata();
    const sw = meta.width ?? 0;
    const sh = meta.height ?? 0;
    if (!sw || !sh) {
      log.error('face crop: the preview has no dimensions');
      return { ok: false, reason: 'error' };
    }

    const processed = await image
      .extract(computeSquare(box, sw, sh))
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'cover' })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();

    try {
      // `ensureCacheDir` HERE, not once at import: it survives the directory going away under a
      // running process (a withdrawal removes it on purpose).
      ensureCacheDir(memberCropDir(userId));
      writeCacheFileAtomic(cacheFile, processed);
      if (!stillHeld()) {
        log.info('face crop written for a face the member no longer holds; deleted');
        deleteMemberFaceCrop(userId, face);
      }
    } catch (e) {
      log.error('face crop cache write failed', (e as Error).message);
    }

    return { ok: true, buffer: processed };
  } catch (e) {
    log.error('error generating a face crop', (e as Error).message);
    return { ok: false, reason: 'error' };
  } finally {
    release();
  }
}

/**
 * An integer square crop region (for sharp.extract) centred on the face box, scaled from the
 * detector's frame to the actual source pixels, so the face fills about {@link FACE_TARGET} of
 * the square, then clamped so the square never leaves the image. A box with no usable frame
 * centre-crops the whole image (exported for tests).
 */
export function computeSquare(box: FaceBox, sw: number, sh: number): Region {
  const maxSquare = Math.min(sw, sh);
  if (!(box.imgW > 0) || !(box.imgH > 0) || !(box.x2 > box.x1) || !(box.y2 > box.y1)) {
    log.warn('face box unusable; centre crop');
    return {
      left: Math.round((sw - maxSquare) / 2),
      top: Math.round((sh - maxSquare) / 2),
      width: maxSquare,
      height: maxSquare,
    };
  }

  const sx = sw / box.imgW;
  const sy = sh / box.imgH;
  const x1 = box.x1 * sx;
  const y1 = box.y1 * sy;
  const x2 = box.x2 * sx;
  const y2 = box.y2 * sy;

  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const faceSize = Math.max(x2 - x1, y2 - y1);

  let side = Math.round(Math.min(faceSize / FACE_TARGET, maxSquare));
  side = Math.max(1, side);

  let left = Math.round(cx - side / 2);
  let top = Math.round(cy - side / 2);
  left = Math.min(Math.max(0, left), sw - side);
  top = Math.min(Math.max(0, top), sh - side);

  return { left, top, width: side, height: side };
}

/**
 * Delete every crop cached for member `userId` (their whole directory): the withdrawal and the
 * account deletion call it in the path that deletes their matches (face-erasure.ts). NEVER throws
 * - it runs after a commit, where a file error must not turn a completed withdrawal into an error -
 * and logs every failure. Returns whether a directory was there.
 */
export function deleteMemberFaceCrops(userId: string): boolean {
  const dir = memberCropDir(userId);
  try {
    const existed = fs.existsSync(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    log.info('member face crops deleted', { existed });
    return existed;
  } catch (e) {
    log.error('member face crops could not be deleted', (e as Error).message);
    return false;
  }
}

/** Delete one cached crop of `userId` (an answer of "not me"). Never throws; logs a failure. */
export function deleteMemberFaceCrop(userId: string, face: FaceKey): void {
  if (!SAFE_ASSET_ID.test(face.assetId)) {
    log.warn('member face crop delete skipped: not a usable face key');
    return;
  }
  try {
    fs.unlinkSync(memberCropFile(userId, face));
    log.debug('member face crop deleted');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error('member face crop could not be deleted', (e as Error).message);
    }
  }
}

/**
 * Delete every cached crop of Immich person `personId` (`<assetId>_<personId>.webp`, the A1
 * layout), when that person's face data is erased (src/lib/server/face-erasure.ts). NEVER throws:
 * it runs after a commit and in a worker, where an EPERM or EBUSY on one file must neither undo a
 * withdrawal nor stop the rest - each failure is logged. Returns how many files went; a missing
 * cache directory is zero.
 */
export function deletePersonFaceCrops(personId: string): number {
  const suffix = `_${personId}.webp`;
  let names: string[];
  try {
    names = fs.readdirSync(CACHE_DIR);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error('face crop cache could not be listed', (e as Error).message);
    }
    return 0;
  }
  let deleted = 0;
  for (const name of names.filter((n) => n.endsWith(suffix))) {
    try {
      fs.unlinkSync(path.join(CACHE_DIR, name));
      deleted++;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.error('face crop could not be deleted', { name, error: (e as Error).message });
      }
    }
  }
  log.info('face crops deleted for an erased person', { deleted });
  return deleted;
}
