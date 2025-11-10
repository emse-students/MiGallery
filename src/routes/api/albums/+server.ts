import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;

/**
 * GET /api/albums
 * Récupère la liste de tous les albums Immich
 * 
 * Cache: Les albums sont cachés via le proxy /api/immich
 */
export const GET: RequestHandler = async ({ fetch }) => {
	try {
		if (!IMMICH_BASE_URL) throw error(500, 'IMMICH_BASE_URL not configured');
		const res = await fetch(`${IMMICH_BASE_URL}/api/albums`, {
			headers: {
				'x-api-key': IMMICH_API_KEY,
				'Accept': 'application/json'
			}
		});

		if (!res.ok) {
			const errorText = await res.text();
			throw error(res.status, `Failed to fetch albums: ${errorText}`);
		}

		const albums = await res.json();
		
		// Filtrer l'album PhotoCV (caché)
		const visibleAlbums = albums.filter((a: any) => a.albumName !== 'PhotoCV');
		
		return json(visibleAlbums);
	} catch (err) {
		console.error('Error in /api/albums GET:', err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};
