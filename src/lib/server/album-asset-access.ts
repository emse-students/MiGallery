import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getDatabase } from '$lib/db/database';
import { fetchAlbumAssets } from '$lib/immich/album-assets';
import { requireScope } from '$lib/server/permissions';
import { createLogger } from '$lib/server/logger';

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

/** True when Immich lists `assetId` in `albumId`. Cached briefly: a shared album loads one image per tile. */
async function albumContainsAsset(
  event: RequestEvent,
  albumId: string,
  assetId: string
): Promise<boolean> {
  const cached = membershipCache.get(albumId);
  if (cached && Date.now() < cached.expires) {
    return cached.ids.has(assetId);
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
    if (ids.size > 0) {
      membershipCache.set(albumId, { ids, expires: Date.now() + MEMBERSHIP_TTL_MS });
    }
    return ids.has(assetId);
  } catch (e) {
    log.error(`membership check failed album=${albumId}`, e);
    return false;
  }
}

/**
 * Authorises a request for ONE photo of an album.
 *
 * An `unlisted` album is a secret link: anyone holding it may see the album's OWN photos without
 * signing in, and nothing else. The visibility is read from the local DB only - never from the
 * request, which let `?visibility=unlisted` switch the sign-in off for any album - and the photo
 * must be a member of the album named in the URL, or the album id would be a free pass to every
 * asset id. Anything else needs a `read` session or key.
 */
export async function requireAlbumAssetAccess(
  event: RequestEvent,
  albumId: string,
  assetId: string
): Promise<void> {
  if (
    localVisibility(albumId) === 'unlisted' &&
    (await albumContainsAsset(event, albumId, assetId))
  ) {
    return;
  }
  await requireScope(event, 'read');
}

/** Authorises a request for an album's whole photo list: public only when the album is `unlisted`. */
export async function requireAlbumAccess(event: RequestEvent, albumId: string): Promise<void> {
  if (localVisibility(albumId) === 'unlisted') {
    return;
  }
  await requireScope(event, 'read');
}
