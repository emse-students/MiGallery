import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;

/**
 * GET /api/people/people
 * Liste toutes les personnes reconnues par Immich
 */
export const GET: RequestHandler = async ({ fetch }) => {
	try {
		if (!IMMICH_BASE_URL) throw error(500, 'IMMICH_BASE_URL not configured');
		
		const res = await fetch(`${IMMICH_BASE_URL}/api/people`, {
			headers: {
				'x-api-key': IMMICH_API_KEY || '',
				'Accept': 'application/json'
			}
		});

		if (!res.ok) {
			const errorText = await res.text();
			throw error(res.status, `Failed to fetch people: ${errorText}`);
		}

		const people = await res.json();
		return json({ people, total: people.length });
	} catch (err) {
		console.error('Error in /api/people/people GET:', err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};
