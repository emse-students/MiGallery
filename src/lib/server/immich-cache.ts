/**
 * Cache système pour les requêtes Immich
 * Optimise les performances en évitant les requêtes répétées
 */

interface CacheEntry {
	data: any;
	timestamp: number;
	etag?: string;
}

class ImmichCache {
	private cache = new Map<string, CacheEntry>();
	private defaultTTL = 60000; // 1 minute
	
	/**
	 * TTL personnalisés par pattern d'URL
	 */
	private ttlRules: Array<{ pattern: RegExp; ttl: number }> = [
		{ pattern: /^\/api\/people\/[^/]+$/, ttl: 300000 },          // 5 min - Profil personne
		{ pattern: /^\/api\/people\/[^/]+\/thumbnail$/, ttl: 3600000 }, // 1h - Photo profil
		{ pattern: /^\/api\/albums$/, ttl: 120000 },                 // 2 min - Liste albums
		{ pattern: /^\/api\/albums\/[^/]+$/, ttl: 60000 },           // 1 min - Album détails
		{ pattern: /^\/api\/search\/metadata/, ttl: 30000 },         // 30s - Recherche
		{ pattern: /^\/api\/assets\/[^/]+$/, ttl: 120000 },          // 2 min - Asset détails
	];

	/**
	 * Patterns qui NE doivent PAS être mis en cache
	 */
	private noCachePatterns: RegExp[] = [
		/^\/api\/assets$/,                    // POST upload
		/^\/api\/assets\/.*\/thumbnail$/,     // Assets thumbnails (trop nombreux)
		/^\/api\/search\/smart/,              // Recherche intelligente (contextuelle)
	];

	/**
	 * Vérifie si une URL peut être mise en cache
	 */
	canCache(method: string, path: string): boolean {
		if (method !== 'GET') return false;
		return !this.noCachePatterns.some(pattern => pattern.test(path));
	}

	/**
	 * Obtient le TTL approprié pour un chemin donné
	 */
	private getTTL(path: string): number {
		const rule = this.ttlRules.find(r => r.pattern.test(path));
		return rule ? rule.ttl : this.defaultTTL;
	}

	/**
	 * Génère une clé de cache
	 */
	private getCacheKey(method: string, url: string, body?: string): string {
		return `${method}:${url}${body ? ':' + body : ''}`;
	}

	/**
	 * Récupère depuis le cache si disponible et valide
	 */
	get(method: string, path: string, url: string, body?: string): any | null {
		if (!this.canCache(method, path)) return null;

		const key = this.getCacheKey(method, url, body);
		const entry = this.cache.get(key);
		
		if (!entry) return null;

		const ttl = this.getTTL(path);
		const age = Date.now() - entry.timestamp;
		
		if (age > ttl) {
			this.cache.delete(key);
			return null;
		}

		return entry.data;
	}

	/**
	 * Ajoute au cache
	 */
	set(method: string, path: string, url: string, data: any, body?: string, etag?: string): void {
		if (!this.canCache(method, path)) return;

		const key = this.getCacheKey(method, url, body);
		this.cache.set(key, {
			data,
			timestamp: Date.now(),
			etag
		});

		// Nettoyage automatique si trop d'entrées
		if (this.cache.size > 500) {
			this.cleanup();
		}
	}

	/**
	 * Invalide toutes les entrées liées à un pattern
	 * Utile après une mutation (POST/PUT/DELETE)
	 */
	invalidate(patterns: RegExp[]): void {
		for (const [key, _] of this.cache) {
			if (patterns.some(p => p.test(key))) {
				this.cache.delete(key);
			}
		}
	}

	/**
	 * Invalide les entrées d'un asset spécifique
	 */
	invalidateAsset(assetId: string): void {
		this.invalidate([
			new RegExp(`/api/assets/${assetId}`),
			new RegExp(`/api/search/metadata.*personIds.*${assetId}`)
		]);
	}

	/**
	 * Invalide les entrées d'une personne spécifique
	 */
	invalidatePerson(personId: string): void {
		this.invalidate([
			new RegExp(`/api/people/${personId}`),
			new RegExp(`/api/search/metadata.*personIds.*${personId}`)
		]);
	}

	/**
	 * Invalide les entrées d'un album spécifique
	 */
	invalidateAlbum(albumId: string): void {
		this.invalidate([
			new RegExp(`/api/albums/${albumId}`),
			new RegExp(`/api/albums$`)
		]);
	}

	/**
	 * Nettoie les entrées expirées
	 */
	private cleanup(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache) {
			// Extraire le path du key pour obtenir le TTL
			const pathMatch = key.match(/:([^:]+)/);
			const path = pathMatch ? pathMatch[1] : '';
			const ttl = this.getTTL(path);
			
			if (now - entry.timestamp > ttl) {
				this.cache.delete(key);
			}
		}

		// Si toujours trop, supprimer les plus anciennes
		if (this.cache.size > 500) {
			const entries = Array.from(this.cache.entries())
				.sort((a, b) => a[1].timestamp - b[1].timestamp);
			
			const toDelete = entries.slice(0, this.cache.size - 400);
			toDelete.forEach(([key]) => this.cache.delete(key));
		}
	}

	/**
	 * Vide complètement le cache
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * Statistiques du cache
	 */
	getStats(): { size: number; hits: number; misses: number } {
		return {
			size: this.cache.size,
			hits: 0, // TODO: ajouter compteurs
			misses: 0
		};
	}
}

// Instance singleton
export const immichCache = new ImmichCache();
