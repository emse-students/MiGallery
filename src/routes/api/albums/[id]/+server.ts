import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;

/**
 * GET /api/albums/[id]
 * Récupère les détails d'un album avec ses assets
 * 
 * Cache: Les albums sont cachés via le proxy /api/immich
 */
export const GET: RequestHandler = async ({ params, fetch }) => {
	try {
		const { id } = params;
		
	if (!IMMICH_BASE_URL) throw error(500, 'IMMICH_BASE_URL not configured');
	const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${id}`, {
			headers: {
				'x-api-key': IMMICH_API_KEY,
				'Accept': 'application/json'
			}
		});

		if (!res.ok) {
			const errorText = await res.text();
			throw error(res.status, `Failed to fetch album: ${errorText}`);
		}

		const album = await res.json();
		return json(album);
	} catch (err) {
		console.error(`Error in /api/albums/${params.id} GET:`, err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};

/**
 * DELETE /api/albums/[id]
 * Supprime un album
 */
export const DELETE: RequestHandler = async ({ params, fetch }) => {
	try {
		const { id } = params;
		
	if (!IMMICH_BASE_URL) throw error(500, 'IMMICH_BASE_URL not configured');
	const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${id}`, {
			method: 'DELETE',
			headers: {
				'x-api-key': IMMICH_API_KEY
			}
		});

		if (!res.ok) {
			const errorText = await res.text();
			throw error(res.status, `Failed to delete album: ${errorText}`);
		}

		return json({ success: true });
	} catch (err) {
		console.error(`Error in /api/albums/${params.id} DELETE:`, err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};

/**
 * PATCH /api/albums/[id]
 * Met à jour un album
 * 
 * Body: { albumName?: string, description?: string }
 */
export const PATCH: RequestHandler = async ({ params, request, fetch }) => {
	try {
		const { id } = params;
		const body = await request.json();
		
	if (!IMMICH_BASE_URL) throw error(500, 'IMMICH_BASE_URL not configured');
	const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${id}`, {
			method: 'PATCH',
			headers: {
				'x-api-key': IMMICH_API_KEY,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		});

		if (!res.ok) {
			const errorText = await res.text();
			throw error(res.status, `Failed to update album: ${errorText}`);
		}

		const album = await res.json();
		return json(album);
	} catch (err) {
		console.error(`Error in /api/albums/${params.id} PATCH:`, err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};
