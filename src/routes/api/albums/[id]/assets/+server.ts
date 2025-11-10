import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;

/**
 * PUT /api/albums/[id]/assets
 * Ajoute des assets à un album
 * 
 * Body: { ids: string[] }
 */
export const PUT: RequestHandler = async ({ params, request, fetch }) => {
	try {
		const { id } = params;
		const body = await request.json();
		
	if (!IMMICH_BASE_URL) throw error(500, 'IMMICH_BASE_URL not configured');
	const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${id}/assets`, {
			method: 'PUT',
			headers: {
				'x-api-key': IMMICH_API_KEY,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		});

		if (!res.ok) {
			const errorText = await res.text();
			throw error(res.status, `Failed to add assets to album: ${errorText}`);
		}

		const result = await res.json();
		return json(result);
	} catch (err) {
		console.error(`Error in /api/albums/${params.id}/assets PUT:`, err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};

/**
 * DELETE /api/albums/[id]/assets
 * Retire des assets d'un album
 * 
 * Body: { ids: string[] }
 */
export const DELETE: RequestHandler = async ({ params, request, fetch }) => {
	try {
		const { id } = params;
		const body = await request.json();
		
	if (!IMMICH_BASE_URL) throw error(500, 'IMMICH_BASE_URL not configured');
	const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${id}/assets`, {
			method: 'DELETE',
			headers: {
				'x-api-key': IMMICH_API_KEY,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		});

		if (!res.ok) {
			const errorText = await res.text();
			throw error(res.status, `Failed to remove assets from album: ${errorText}`);
		}

		const result = await res.json();
		return json(result);
	} catch (err) {
		console.error(`Error in /api/albums/${params.id}/assets DELETE:`, err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};
