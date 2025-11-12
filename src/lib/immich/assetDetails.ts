// Lightweight client-side asset details fetcher with caching and concurrency limit.
// Purpose: reduce duplicate network requests and avoid firing hundreds of parallel GETs.

type AssetLike = any;

const memoryCache = new Map<string, AssetLike>();
const inflight = new Map<string, Promise<AssetLike | null>>();

function readStorage(key: string) {
  try {
    if (typeof window === 'undefined') return null;
    const v = sessionStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: any) {
  try {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export async function fetchAssetDetail(id: string): Promise<AssetLike | null> {
  if (!id) return null;
  if (memoryCache.has(id)) return memoryCache.get(id) as AssetLike;

  const storageKey = `asset:${id}`;
  const fromStorage = readStorage(storageKey);
  if (fromStorage) {
    memoryCache.set(id, fromStorage);
    return fromStorage;
  }

  if (inflight.has(id)) return inflight.get(id) as Promise<AssetLike | null>;

  const p = (async () => {
    try {
      const res = await fetch(`/api/immich/assets/${id}`);
      if (!res.ok) return null;
      const json = await res.json();
      memoryCache.set(id, json);
      writeStorage(storageKey, json);
      return json;
    } catch (e) {
      return null;
    } finally {
      inflight.delete(id);
    }
  })();

  inflight.set(id, p);
  return p;
}

export async function fetchAssetsDetails(ids: string[], concurrency = 8): Promise<Array<AssetLike | null>> {
  if (!Array.isArray(ids)) return [];
  const out: Array<AssetLike | null> = new Array(ids.length).fill(null);

  // simple concurrency pool
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= ids.length) break;
      const id = ids[i];
      const detail = await fetchAssetDetail(id);
      out[i] = detail ?? null;
    }
  }

  const workers = [];
  const w = Math.max(1, Math.min(concurrency, ids.length));
  for (let i = 0; i < w; i++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

export function clearAssetCaches() {
  memoryCache.clear();
  try { if (typeof window !== 'undefined') sessionStorage.clear(); } catch {}
}
