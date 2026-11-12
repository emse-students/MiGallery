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

/** Test hook: forget every cached album membership. */
export function clearAlbumMembershipCache(): void {
  membershipCache.clear();
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
  try {
    const assets = await fetchAlbumAssets(
      event.fetch,
      env.IMMICH_BASE_URL,
      env.IMMICH_API_KEY ?? '',
      albumId
    );
    if (membershipCache.size >= MEMBERSHIP_MAX_ALBUMS && !membershipCache.has(albumId)) {
      const oldest = membershipCache.keys().next().value;
      if (oldest !== undefined) {
        membershipCache.delete(oldest);
      }
    }
    const ids = new Set(assets.map((a) => a.id));
    // An empty list is how a failed Immich search fallback looks: never cache it, or one hiccup
    // would lock legitimate viewers of the link out for the whole TTL.
    if (ids.size === 0) {
      return 'unknown';
    }
    membershipCache.set(albumId, { ids, expires: Date.now() + MEMBERSHIP_TTL_MS });
    return ids.has(assetId) ? 'member' : 'absent';
  } catch (e) {
    log.error(`membership check failed album=${albumId}`, e);
    return 'unknown';
  }
}

/**
 * The signed-in half of the rule, shared by the two guards below. A key is a machine credential and
 * reads any album, as before. A session reads the albums `checkAlbumAccess` gives it - the rule the
 * album pages apply: staff, a grant by name, a formation and promo pair, or an `authenticated`
 * album.
 *
 * @returns true when the caller reads every photo whatever the album (a key, or staff)
 * @throws 401 with no session and no key, 404 for an album the gallery does not know, 403 otherwise
 */
async function requireViewerOfAlbum(event: RequestEvent, albumId: string): Promise<boolean> {
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
    log.error('album photo not served: Immich did not say whether it is in the album', { albumId });
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
