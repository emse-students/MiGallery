import { error } from '@sveltejs/kit';
import { OUTBOUND_BUDGET_MS, immichCall } from '#lib/server/outbound.ts';
import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('album-assets');
const IMMICH_BASE_URL = (typeof process !== 'undefined' && process.env?.IMMICH_BASE_URL) || '';
const IMMICH_API_KEY = (typeof process !== 'undefined' && process.env?.IMMICH_API_KEY) || '';

export interface ImmichAlbumAssetLike {
  id: string;
  [type: string]: unknown;
}

export interface ImmichAlbumPayload {
  id?: string;
  albumName?: string;
  assets?: ImmichAlbumAssetLike[];
  assetCount?: number;
  [key: string]: unknown;
}

export async function fetchAlbumAssets(
  fetchFn: typeof fetch,
  baseUrl: string = IMMICH_BASE_URL,
  apiKey: string = IMMICH_API_KEY,
  albumId: string,
  expectedName?: string
): Promise<ImmichAlbumAssetLike[]> {
  if (!baseUrl || !albumId) {
    return [];
  }

  // The body is read INSIDE the call: the deadline also covers it, and a timeout there must be a 504.
  const album = await immichCall(log, 'GET /api/albums/{id}', async () => {
    const albumRes = await fetchFn(`${baseUrl.replace(/\/$/, '')}/api/albums/${albumId}`, {
      signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
    });
    if (!albumRes.ok) {
      await albumRes.body?.cancel().catch(() => undefined);
      // A 404 is a typed fact the caller may act on (a stored system album id that is gone).
      if (albumRes.status === 404) {
        throw error(404, 'Album not found');
      }
      log.error('Immich refused the album read', { status: albumRes.status });
      throw error(502, 'Immich refused the album read');
    }
    return (await albumRes.json()) as ImmichAlbumPayload;
  });
  // A stored id whose album was renamed still answers 200: the name is what proves it is the one.
  if (expectedName !== undefined && album?.albumName !== expectedName) {
    log.warn('album under the stored id is not the expected one', {
      expectedName,
      found: album?.albumName,
    });
    throw error(404, 'Album not found');
  }
  const inline = Array.isArray(album?.assets) ? album.assets : [];
  if (inline.length > 0) {
    return inline;
  }

  // Immich v3 no longer inlines the assets in the album detail, so fall back to
  // the metadata search - and PAGINATE it: a single page is capped at `size`
  // (1000), which silently truncated large albums (e.g. PhotoCV) and broke the
  // "Mes photos CV" intersection.
  const base = baseUrl.replace(/\/$/, '');
  const all: ImmichAlbumAssetLike[] = [];
  let page = 1;
  while (page <= 50) {
    const searchData = await immichCall(
      log,
      'POST /api/search/metadata (album members)',
      async () => {
        const searchRes = await fetchFn(`${base}/api/search/metadata`, {
          signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ albumIds: [albumId], page, size: 1000 }),
        });
        if (!searchRes.ok) {
          // Never a silent truncation: a half-read album would misfile the member's photos.
          await searchRes.body?.cancel().catch(() => undefined);
          log.error('Immich refused an album member page', { status: searchRes.status, page });
          throw error(502, 'Immich refused the album member search');
        }
        return (await searchRes.json()) as {
          assets?: {
            items?: ImmichAlbumAssetLike[];
            nextPage?: number | string | null;
          };
        };
      }
    );
    const items = Array.isArray(searchData?.assets?.items) ? searchData.assets.items : [];
    if (items.length === 0) {
      break;
    }
    all.push(...items);

    const nextPage = searchData.assets?.nextPage;
    if (nextPage === null || nextPage === undefined) {
      break;
    }
    page++;
  }
  return all;
}
