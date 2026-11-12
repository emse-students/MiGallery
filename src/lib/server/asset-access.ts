/**
 * Who may read ONE photo that is asked for by its id alone - through the Immich proxy, the external
 * media route or a download. The album routes name their album and have their own guard
 * (album-asset-access.ts); this is the rule for a request that names none.
 *
 * A key reads any photo, and so does the staff, as before. A member's session reads a photo when
 * one of these holds, each read from DURABLE state on every request, never from a cache:
 *
 * - a face of the photo is THEIRS: a `face_matches` row of theirs that is not rejected - shown, or
 *   waiting for their yes or no (the whole photograph behind a face they are asked about);
 * - a face of the photo is shown as a member's who AUTHORISED them (`photo_access_permissions`);
 * - the photo is in an album they may open (`checkAlbumAccess`, the rule of the album pages).
 *
 * Only the last one needs Immich, which alone knows what albums hold a photo. That answer is kept
 * for a minute per photo; when Immich does not give it, the photo is answered 503 - not known is
 * not refused, and it is not served either.
 */

import { error, type RequestEvent } from '@sveltejs/kit';
import { env } from '#lib/server/env.ts';
import { getDatabase } from '#lib/db/database.ts';
import { checkAlbumAccess, getAlbumById } from '#lib/albums.ts';
import { isStaffRole } from '#lib/roles.ts';
import { FACE_MODEL } from '#lib/face-embedding.ts';
import { VISIBLE_MATCH_SQL } from '#lib/server/face-photos.ts';
import { assertImmichId } from '#lib/server/immich-id.ts';
import { OUTBOUND_BUDGET_MS } from '#lib/server/outbound.ts';
import type { AuthResult } from '#lib/server/permissions.ts';
import { createLogger } from '#lib/server/logger.ts';
import { registerShutdown } from '#lib/server/shutdown.ts';

const log = createLogger('asset-access');

/** How long Immich's answer on one photo's albums is kept, and the window of one refusal line. */
const WINDOW_MS = 60_000;
/** A grid asks for hundreds of photos at once; past this the oldest entry goes. */
const MAX_ENTRIES = 2000;

const albumsOfAsset = new Map<string, { ids: string[]; expires: number }>();
/** How many photo ids one refusal line names. */
const REFUSAL_SAMPLE = 5;
/** The refusals of each viewer that wait for their one line. */
const pendingRefusals = new Map<string, { count: number; sample: string[] }>();
let refusalFlush: ReturnType<typeof setTimeout> | null = null;

/**
 * Writes the ONE line each viewer's refusals of the window get - how many, and the first few
 * photos - and empties the window. Run by the window's timer and at shutdown; a test calls it.
 */
export function flushAssetRefusals(): void {
  if (refusalFlush !== null) {
    clearTimeout(refusalFlush);
    refusalFlush = null;
  }
  for (const [viewer, { count, sample }] of pendingRefusals) {
    log.warn('photo reads refused', { viewer, count, firstAssetIds: sample });
  }
  pendingRefusals.clear();
}
registerShutdown('photo refusal log', flushAssetRefusals);

/** Test hook: forget what Immich said and which refusals were logged. */
export function clearAssetAccessCache(): void {
  albumsOfAsset.clear();
  pendingRefusals.clear();
  if (refusalFlush !== null) {
    clearTimeout(refusalFlush);
    refusalFlush = null;
  }
}

/** `map.set`, dropping the oldest entry once the map holds {@link MAX_ENTRIES}. */
function setBounded<V>(map: Map<string, V>, key: string, value: V): void {
  if (map.size >= MAX_ENTRIES && !map.has(key)) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) {
      map.delete(oldest);
    }
  }
  map.set(key, value);
}

/** Why a face of the photo lets `viewerId` read it, or null when none does. */
export function faceReadReason(viewerId: string, assetId: string): 'own_face' | 'granted' | null {
  const db = getDatabase();
  const own = db
    .prepare(
      `SELECT 1 FROM face_matches WHERE asset_id = ? AND model = ? AND user_id = ?
        AND state != 'rejected' LIMIT 1`
    )
    .get(assetId, FACE_MODEL, viewerId);
  if (own) {
    return 'own_face';
  }
  const granted = db
    .prepare(
      `SELECT 1 FROM face_matches
        JOIN photo_access_permissions p ON p.owner_id = face_matches.user_id
        WHERE asset_id = ? AND model = ? AND p.authorized_id = ? AND ${VISIBLE_MATCH_SQL} LIMIT 1`
    )
    .get(assetId, FACE_MODEL, viewerId);
  return granted ? 'granted' : null;
}

/** The ids of the Immich albums holding `assetId`, or null when Immich did not say. */
async function albumsHolding(fetchFn: typeof fetch, assetId: string): Promise<string[] | null> {
  const cached = albumsOfAsset.get(assetId);
  if (cached && Date.now() < cached.expires) {
    return cached.ids;
  }
  const base = env.IMMICH_BASE_URL?.replace(/\/$/, '');
  if (!base) {
    log.error('albums of a photo not read: Immich is not configured');
    return null;
  }
  try {
    const res = await fetchFn(`${base}/api/albums?assetId=${assetId}`, {
      signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
      headers: { 'x-api-key': env.IMMICH_API_KEY ?? '', accept: 'application/json' },
    });
    if (!res.ok) {
      log.error('albums of a photo not read: Immich answered an error', { status: res.status });
      return null;
    }
    const body: unknown = await res.json();
    if (!Array.isArray(body)) {
      log.error('albums of a photo not read: Immich answered something that is not a list');
      return null;
    }
    const ids = body
      .map((album) => (album as { id?: unknown } | null)?.id)
      .filter((id): id is string => typeof id === 'string');
    setBounded(albumsOfAsset, assetId, { ids, expires: Date.now() + WINDOW_MS });
    return ids;
  } catch (e) {
    log.error('albums of a photo not read: Immich did not answer', e);
    return null;
  }
}

/**
 * Whether `assetId` is a photo of a shared link: Immich lists it in an album the gallery holds as
 * `unlisted`. The album is named by Immich and by nothing the request carries. Null when Immich
 * did not say.
 */
export async function isSharedLinkPhoto(
  fetchFn: typeof fetch,
  assetId: string
): Promise<boolean | null> {
  const albumIds = await albumsHolding(fetchFn, assetId.toLowerCase());
  if (albumIds === null) {
    return null;
  }
  const shared = albumIds.some(
    (albumId) => getAlbumById(albumId)?.visibility?.toLowerCase() === 'unlisted'
  );
  log.debug('shared-link read judged', { shared, albums: albumIds.length });
  return shared;
}

/**
 * Counts a refusal towards the viewer's one line of the window ({@link flushAssetRefusals}): a
 * grid of refused tiles is one line with its count, not a line per tile. The timer only decides
 * WHEN that line is written; no decision reads it.
 */
function logRefusal(viewerId: string, assetId: string): void {
  const pending = pendingRefusals.get(viewerId);
  if (pending) {
    pending.count++;
    if (pending.sample.length < REFUSAL_SAMPLE && !pending.sample.includes(assetId)) {
      pending.sample.push(assetId);
    }
  } else {
    setBounded(pendingRefusals, viewerId, { count: 1, sample: [assetId] });
  }
  if (refusalFlush === null) {
    refusalFlush = setTimeout(flushAssetRefusals, WINDOW_MS);
    refusalFlush.unref?.();
  }
}

/**
 * Throws unless `auth` may read the photo `assetId` (the rule at the top of this file).
 *
 * @throws 400 for an id that is not an Immich id, 403 when no rule lets the viewer in, 503 when
 *   only an album could and Immich did not say which albums hold the photo
 */
export async function requireAssetRead(
  event: RequestEvent,
  auth: AuthResult,
  assetId: string
): Promise<void> {
  const id = assertImmichId(assetId, 'asset').toLowerCase();
  if (auth.viaApiKey || isStaffRole(auth.user?.role)) {
    return;
  }
  const viewer = auth.user;
  if (!viewer) {
    log.error('photo read reached its rule without a caller; refused');
    throw error(401, 'Authentication required');
  }
  const face = faceReadReason(viewer.id_user, id);
  if (face) {
    log.debug('photo read by a face rule', { reason: face });
    return;
  }
  const albumIds = await albumsHolding(event.fetch, id);
  if (albumIds === null) {
    throw error(503, 'Photo access could not be checked');
  }
  for (const albumId of albumIds) {
    const album = getAlbumById(albumId);
    if (
      album &&
      checkAlbumAccess(viewer, { ...album, visibility: album.visibility || 'private' })
    ) {
      log.debug('photo read through an album the viewer may open');
      return;
    }
  }
  logRefusal(viewer.id_user, id);
  throw error(403, 'No access to this photo');
}

/** {@link requireAssetRead} for every id of a list, stopping at the first that is not readable. */
export async function requireAssetsRead(
  event: RequestEvent,
  auth: AuthResult,
  assetIds: readonly string[]
): Promise<void> {
  for (const id of assetIds) {
    await requireAssetRead(event, auth, id);
  }
}
