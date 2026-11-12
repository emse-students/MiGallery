import { error, type RequestEvent } from '@sveltejs/kit';
import { env } from '#lib/server/env.ts';
import { getDatabase } from '#lib/db/database.ts';
import { fetchAlbumAssets } from '#lib/immich/album-assets.ts';
import { requireScope } from '#lib/server/permissions.ts';
import { checkAlbumAccess, getAlbumById } from '#lib/albums.ts';
import { isStaffRole } from '#lib/roles.ts';
import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('album-asset-access');

const MEMBERSHIP_TTL_MS = 60_000;
const MEMBERSHIP_MAX_ALBUMS = 50;
const membershipCache = new Map<string, { ids: Set<string>; expires: number }>();
/**
 * How long "Immich did not say" is kept for an album. Short, so a recovered Immich serves again
 * within seconds; long enough that a grid of photos asks Immich once, not once per tile.
 */
const UNKNOWN_TTL_MS = 10_000;
/** The albums Immich FAILED to answer for, and until when it is not asked again. */
const unknownUntil = new Map<string, number>();
/** The albums whose "Immich did not say" line is written, and until when it is not written again. */
const unknownLogged = new Map<string, number>();

/** `map.set`, dropping the oldest entry once the map holds {@link MEMBERSHIP_MAX_ALBUMS}. */
function setBounded<V>(map: Map<string, V>, key: string, value: V): void {
  if (map.size >= MEMBERSHIP_MAX_ALBUMS && !map.has(key)) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) {
      map.delete(oldest);
    }
  }
  map.set(key, value);
}

/**
 * Immich did not say what `albumId` holds. ONE line per album and window, however many photos of
 * it are asked. A request that FAILED is also not repeated within the window: every photo asked
 * meanwhile is answered from here. An answer that came back EMPTY is asked again by the next
 * request - it is how a transient search fallback looks, and the very next answer may be whole.
 */
function rememberUnknown(albumId: string, why: unknown, failed: boolean): 'unknown' {
  const now = Date.now();
  if (failed) {
    setBounded(unknownUntil, albumId, now + UNKNOWN_TTL_MS);
  }
  const logged = unknownLogged.get(albumId);
  if (logged === undefined || now >= logged) {
    setBounded(unknownLogged, albumId, now + UNKNOWN_TTL_MS);
    log.error(`Immich did not say what album ${albumId} holds; its photos are not served`, why);
  }
  return 'unknown';
}

/** Test hook: forget every cached album membership. */
export function clearAlbumMembershipCache(): void {
  membershipCache.clear();
  unknownUntil.clear();
  unknownLogged.clear();
}

/** The local DB's visibility for an album, or undefined when the album is unknown. */
function localVisibility(albumId: string): string | undefined {
  try {
    const row = getDatabase().prepare('SELECT visibility FROM albums WHERE id = ?').get(albumId) as
      | { visibility?: string }
      | undefined;
    return row?.visibility?.toLowerCase();
  } catch (e) {
    log.warn('failed to read local album visibility', e);
    return undefined;
  }
}

/**
 * Whether Immich lists `assetId` in `albumId`. `unknown` is not `absent`: Immich did not answer, or
 * answered an empty list (how its failed search fallback looks), so nothing was learned.
 */
type Membership = 'member' | 'absent' | 'unknown';

/** Asks Immich, through a brief cache: an album loads one image per tile. */
async function albumMembership(
  event: RequestEvent,
  albumId: string,
  assetId: string
): Promise<Membership> {
  const cached = membershipCache.get(albumId);
  if (cached && Date.now() < cached.expires) {
    return cached.ids.has(assetId) ? 'member' : 'absent';
  }
  const unknown = unknownUntil.get(albumId);
  if (unknown !== undefined && Date.now() < unknown) {
    return 'unknown';
  }
  try {
    const assets = await fetchAlbumAssets(
      event.fetch,
      env.IMMICH_BASE_URL,
      env.IMMICH_API_KEY ?? '',
      albumId
    );
    const ids = new Set(assets.map((a) => a.id));
    // An empty list is how a failed Immich search fallback looks: it is never kept as the album's
    // content, or one hiccup would lock legitimate viewers of the link out for the whole TTL.
    if (ids.size === 0) {
      return rememberUnknown(albumId, 'an empty list', false);
    }
    unknownUntil.delete(albumId);
    setBounded(membershipCache, albumId, { ids, expires: Date.now() + MEMBERSHIP_TTL_MS });
    return ids.has(assetId) ? 'member' : 'absent';
  } catch (e) {
    return rememberUnknown(albumId, e, true);
  }
}

/**
 * The signed-in half of the rule, shared by the two guards below and applied alone to an album's
 * Immich record, which a shared link does not open. A key is a machine credential and
 * reads any album, as before. A session reads the albums `checkAlbumAccess` gives it - the rule the
 * album pages apply: staff, a grant by name, a formation and promo pair, or an `authenticated`
 * album.
 *
 * @returns true when the caller reads every photo whatever the album (a key, or staff)
 * @throws 401 with no session and no key, 404 for an album the gallery does not know, 403 otherwise
 */
export async function requireViewerOfAlbum(event: RequestEvent, albumId: string): Promise<boolean> {
  const auth = await requireScope(event, 'read');
  if (auth.viaApiKey) {
    return true;
  }
  const album = getAlbumById(albumId);
  if (!album) {
    log.debug('album read refused: unknown album', { albumId });
    throw error(404, 'Album not found');
  }
  if (!checkAlbumAccess(auth.user, { ...album, visibility: album.visibility || 'private' })) {
    log.warn('album read refused: no access', { viewer: auth.user?.id_user ?? null, albumId });
    throw error(403, 'No access to this album');
  }
  return isStaffRole(auth.user?.role);
}

/**
 * Authorises a request for ONE photo of an album.
 *
 * An `unlisted` album is a secret link: anyone holding it may see the album's OWN photos without
 * signing in, and nothing else. The visibility is read from the local DB only - never from the
 * request, which let `?visibility=unlisted` switch the sign-in off for any album - and the photo
 * must be a member of the album named in the URL, or the album id would be a free pass to every
 * asset id. Anything else needs a key, or a session that may open the album
 * ({@link requireViewerOfAlbum}) - and, unless it is staff, a photo that IS in that album. When
 * Immich cannot say whether it is, the answer is 503: unknown is not refused.
 */
export async function requireAlbumAssetAccess(
  event: RequestEvent,
  albumId: string,
  assetId: string
): Promise<void> {
  if (
    localVisibility(albumId) === 'unlisted' &&
    (await albumMembership(event, albumId, assetId)) === 'member'
  ) {
    return;
  }
  if (await requireViewerOfAlbum(event, albumId)) {
    return;
  }
  const membership = await albumMembership(event, albumId, assetId);
  if (membership === 'member') {
    return;
  }
  if (membership === 'unknown') {
    // Logged once per album and window where it was learned (rememberUnknown), not per photo.
    throw error(503, 'Album contents unavailable');
  }
  log.warn('album photo refused: not in the album', { albumId, assetId });
  throw error(403, 'Photo not in this album');
}

/**
 * Authorises a request for an album itself - its record, its photo list: public only when the album
 * is `unlisted`, otherwise a key or a session that may open it ({@link requireViewerOfAlbum}).
 */
export async function requireAlbumAccess(event: RequestEvent, albumId: string): Promise<void> {
  if (localVisibility(albumId) === 'unlisted') {
    return;
  }
  await requireViewerOfAlbum(event, albumId);
}
