import { env } from '$env/dynamic/private';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;

// Albums systèmes centralisés
export const SYSTEM_ALBUMS = ['PhotoCV', 'PortailEtu'];

// Simple in-memory cache for album ids
const albumIdCache: Record<string, { id: string; updatedAt: number }> = {};
const ALBUM_CACHE_TTL = 60 * 1000; // 1 minute

async function fetchAlbums(fetchFn: typeof fetch) {
  if (!IMMICH_BASE_URL) throw new Error('IMMICH_BASE_URL not configured');
  const res = await fetchFn(`${IMMICH_BASE_URL}/api/albums`, {
    headers: {
      'x-api-key': IMMICH_API_KEY,
      Accept: 'application/json'
    }
  });
  if (!res.ok) throw new Error(`Failed to fetch albums: ${res.statusText}`);
  return await res.json();
}

export async function getOrCreateSystemAlbum(fetchFn: typeof fetch, albumName: string) {
  if (albumIdCache[albumName] && Date.now() - albumIdCache[albumName].updatedAt < ALBUM_CACHE_TTL) {
    return albumIdCache[albumName].id;
  }

  const albums = await fetchAlbums(fetchFn);
  const existing = albums.find((a: any) => a.albumName === albumName);
  if (existing) {
    albumIdCache[albumName] = { id: existing.id, updatedAt: Date.now() };
    return existing.id;
  }

  // Create the album
  const createRes = await fetchFn(`${IMMICH_BASE_URL}/api/albums`, {
    method: 'POST',
    headers: {
      'x-api-key': IMMICH_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ albumName, description: `Album système ${albumName}` })
  });

  if (!createRes.ok) {
    const txt = await createRes.text().catch(() => createRes.statusText);
    throw new Error(`Failed to create album ${albumName}: ${txt}`);
  }

  const newAlbum = await createRes.json();
  albumIdCache[albumName] = { id: newAlbum.id, updatedAt: Date.now() };
  return newAlbum.id;
}

export async function getSystemAlbumIds(fetchFn: typeof fetch) {
  const ids: string[] = [];
  for (const name of SYSTEM_ALBUMS) {
    try {
      const id = await getOrCreateSystemAlbum(fetchFn, name);
      if (id) ids.push(id);
    } catch (e) {
      // ignore per-album failures
      console.warn('getSystemAlbumIds: failed for', name, e);
    }
  }
  return ids;
}

export async function getAllAssetIdsInSystemAlbums(fetchFn: typeof fetch) {
  const albumIds = await getSystemAlbumIds(fetchFn);
  const allAssetIds = new Set<string>();
  for (const aid of albumIds) {
    try {
      const res = await fetchFn(`${IMMICH_BASE_URL}/api/albums/${aid}`, {
        headers: { 'x-api-key': IMMICH_API_KEY, Accept: 'application/json' }
      });
      if (!res.ok) continue;
      const album = await res.json();
      const assets = album.assets || [];
      for (const a of assets) allAssetIds.add(a.id);
    } catch (e) {
      // ignore
    }
  }
  return Array.from(allAssetIds);
}
