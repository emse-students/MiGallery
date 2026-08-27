/**
 * Client-side cache for API data
 * Uses IndexedDB for persistence across sessions
 */

interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  etag?: string;
}

interface CacheConfig {
  name: string;
  version: number;
  stores: {
    name: string;
    ttl: number; // Time to live in milliseconds
  }[];
}

const DEFAULT_CONFIG: CacheConfig = {
  name: 'migallery-cache',
  // v2 dropped 'album-covers': album covers are resolved server-side and
  // served from a stable, versioned URL, so the browser's HTTP cache holds
  // them and there is nothing left to mirror in IndexedDB.
  version: 2,
  stores: [
    { name: 'albums', ttl: 300000 },
    { name: 'assets', ttl: 600000 },
    { name: 'people', ttl: 1800000 },
    { name: 'thumbnails', ttl: 86400000 },
  ],
};

class ClientCache {
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private config: CacheConfig;

  constructor(config: CacheConfig = DEFAULT_CONFIG) {
    this.config = config;
  }

  /**
   * Initialize the IndexedDB database
   */
  private async initDB(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB not supported'));
        return;
      }

      const request = indexedDB.open(this.config.name, this.config.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        for (const store of this.config.stores) {
          if (!db.objectStoreNames.contains(store.name)) {
            db.createObjectStore(store.name);
          }
        }

        // Drop stores this version no longer declares, so a retired cache
        // does not keep occupying the user's disk forever.
        const declared = new Set(this.config.stores.map((s) => s.name));
        for (const name of Array.from(db.objectStoreNames)) {
          if (!declared.has(name)) {
            db.deleteObjectStore(name);
          }
        }
      };
    });

    return this.dbPromise;
  }

  /**
   * Get an entry from the cache
   */
  async get<T>(storeName: string, key: string): Promise<T | null> {
    try {
      const db = await this.initDB();
      const store = this.config.stores.find((s) => s.name === storeName);
      if (!store) {
        return null;
      }

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.get(key);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const entry = request.result as CacheEntry<T> | undefined;

          if (!entry) {
            resolve(null);
            return;
          }

          const age = Date.now() - entry.timestamp;
          if (age > store.ttl) {
            this.delete(storeName, key);
            resolve(null);
            return;
          }

          resolve(entry.data);
        };
      });
    } catch (error: unknown) {
      console.warn('Cache get error:', error);
      return null;
    }
  }

  /**
   * Store an entry in the cache
   */
  async set<T>(storeName: string, key: string, data: T, etag?: string): Promise<void> {
    try {
      const db = await this.initDB();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const objectStore = transaction.objectStore(storeName);

        const entry: CacheEntry<T> = {
          data,
          timestamp: Date.now(),
          etag,
        };

        const request = objectStore.put(entry, key);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error: unknown) {
      console.warn('Cache set error:', error);
    }
  }

  /**
   * Delete an entry from the cache
   */
  async delete(storeName: string, key: string): Promise<void> {
    try {
      const db = await this.initDB();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.delete(key);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error: unknown) {
      console.warn('Cache delete error:', error);
    }
  }

  /**
   * Clear an entire store
   */
  async clearStore(storeName: string): Promise<void> {
    try {
      const db = await this.initDB();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.clear();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error: unknown) {
      console.warn('Cache clear store error:', error);
    }
  }

  /**
   * Clear the entire cache
   */
  async clearAll(): Promise<void> {
    for (const store of this.config.stores) {
      await this.clearStore(store.name);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ storeName: string; count: number }[]> {
    try {
      const db = await this.initDB();
      const stats: { storeName: string; count: number }[] = [];

      for (const store of this.config.stores) {
        const count = await new Promise<number>((resolve, reject) => {
          const transaction = db.transaction(store.name, 'readonly');
          const objectStore = transaction.objectStore(store.name);
          const request = objectStore.count();

          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });

        stats.push({ storeName: store.name, count });
      }

      return stats;
    } catch (error: unknown) {
      console.warn('Cache stats error:', error);
      return [];
    }
  }

  /**
   * Clean up expired entries
   */
  async cleanup(): Promise<void> {
    try {
      const db = await this.initDB();

      for (const storeConfig of this.config.stores) {
        const transaction = db.transaction(storeConfig.name, 'readwrite');
        const objectStore = transaction.objectStore(storeConfig.name);
        const request = objectStore.openCursor();

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;

          if (cursor) {
            const entry = cursor.value as CacheEntry;
            const age = Date.now() - entry.timestamp;

            if (age > storeConfig.ttl) {
              cursor.delete();
            }

            cursor.continue();
          }
        };
      }
    } catch (error: unknown) {
      console.warn('Cache cleanup error:', error);
    }
  }
}

export const clientCache = new ClientCache();

/**
 * Helper for fetch with automatic caching
 */
export async function cachedFetch<T>(
  url: string,
  options?: RequestInit & {
    cacheStore?: string;
    cacheKey?: string;
    bypassCache?: boolean;
  }
): Promise<T> {
  const cacheStore = options?.cacheStore;
  const cacheKey = options?.cacheKey || url;
  const bypassCache = options?.bypassCache || false;

  if (cacheStore && !bypassCache) {
    const cached = await clientCache.get<T>(cacheStore, cacheKey);
    if (cached !== null) {
      return cached;
    }
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as unknown as T;

  if (cacheStore) {
    const etag = response.headers.get('etag') || undefined;
    await clientCache.set(cacheStore, cacheKey, data, etag);
  }

  return data;
}
