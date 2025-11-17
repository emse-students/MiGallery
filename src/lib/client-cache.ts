/**
 * Cache client-side pour les données API
 * Utilise IndexedDB pour la persistance entre sessions
 */

interface CacheEntry<T = any> {
	data: T;
	timestamp: number;
	etag?: string;
}

interface CacheConfig {
	name: string;
	version: number;
	stores: {
		name: string;
		ttl: number; // Time to live en millisecondes
	}[];
}

const DEFAULT_CONFIG: CacheConfig = {
	name: 'migallery-cache',
	version: 1,
	stores: [
		{ name: 'album-covers', ttl: 3600000 }, // 1h - Couvertures d'albums
		{ name: 'albums', ttl: 300000 },        // 5min - Détails albums
		{ name: 'assets', ttl: 600000 },        // 10min - Métadonnées assets
		{ name: 'people', ttl: 1800000 },       // 30min - Infos personnes
		{ name: 'thumbnails', ttl: 86400000 },  // 24h - Miniatures (URLs blob)
	]
};

class ClientCache {
	private db: IDBDatabase | null = null;
	private dbPromise: Promise<IDBDatabase> | null = null;
	private config: CacheConfig;

	constructor(config: CacheConfig = DEFAULT_CONFIG) {
		this.config = config;
	}

	/**
	 * Initialise la base de données IndexedDB
	 */
	private async initDB(): Promise<IDBDatabase> {
		if (this.db) return this.db;
		if (this.dbPromise) return this.dbPromise;

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
				
				// Créer les object stores
				for (const store of this.config.stores) {
					if (!db.objectStoreNames.contains(store.name)) {
						db.createObjectStore(store.name);
					}
				}
			};
		});

		return this.dbPromise;
	}

	/**
	 * Récupère une entrée du cache
	 */
	async get<T>(storeName: string, key: string): Promise<T | null> {
		try {
			const db = await this.initDB();
			const store = this.config.stores.find(s => s.name === storeName);
			if (!store) return null;

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

					// Vérifier la validité
					const age = Date.now() - entry.timestamp;
					if (age > store.ttl) {
						// Expirée, supprimer
						this.delete(storeName, key);
						resolve(null);
						return;
					}

					resolve(entry.data);
				};
			});
		} catch (error) {
			console.warn('Cache get error:', error);
			return null;
		}
	}

	/**
	 * Stocke une entrée dans le cache
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
					etag
				};

				const request = objectStore.put(entry, key);

				request.onerror = () => reject(request.error);
				request.onsuccess = () => resolve();
			});
		} catch (error) {
			console.warn('Cache set error:', error);
		}
	}

	/**
	 * Supprime une entrée du cache
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
		} catch (error) {
			console.warn('Cache delete error:', error);
		}
	}

	/**
	 * Vide tout un store
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
		} catch (error) {
			console.warn('Cache clear store error:', error);
		}
	}

	/**
	 * Vide tout le cache
	 */
	async clearAll(): Promise<void> {
		for (const store of this.config.stores) {
			await this.clearStore(store.name);
		}
	}

	/**
	 * Récupère les statistiques du cache
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
		} catch (error) {
			console.warn('Cache stats error:', error);
			return [];
		}
	}

	/**
	 * Nettoie les entrées expirées
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
		} catch (error) {
			console.warn('Cache cleanup error:', error);
		}
	}
}

// Instance singleton
export const clientCache = new ClientCache();

/**
 * Helper pour fetch avec cache automatique
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

	// Essayer de récupérer depuis le cache
	if (cacheStore && !bypassCache) {
		const cached = await clientCache.get<T>(cacheStore, cacheKey);
		if (cached !== null) {
			return cached;
		}
	}

	// Fetch depuis le serveur
	const response = await fetch(url, options);
	
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	const data = await response.json() as T;

	// Stocker en cache
	if (cacheStore) {
		const etag = response.headers.get('etag') || undefined;
		await clientCache.set(cacheStore, cacheKey, data, etag);
	}

	return data;
}
