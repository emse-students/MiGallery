import { json, error } from '@sveltejs/kit';

import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { requireScope } from '$lib/server/permissions';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

/**
 * GET /api/people/people
 * Liste toutes les personnes reconnues par Immich
 */
export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'read');
	try {
		if (!IMMICH_BASE_URL) {
			throw error(500, 'IMMICH_BASE_URL not configured');
		}

		const res = await event.fetch(`${IMMICH_BASE_URL}/api/people`, {
			headers: {
				'x-api-key': IMMICH_API_KEY || '',
				Accept: 'application/json'
			}
		});

		if (!res.ok) {
			const errorText = await res.text();
			throw error(res.status, `Failed to fetch people: ${errorText}`);
		}

		const people = (await res.json()) as { id: string; name: string }[];
		return json({ people, total: people.length });
	} catch (e: unknown) {
		const err = ensureError(e);
		console.error('Error in /api/people/people GET:', err);
		if (e && typeof e === 'object' && 'status' in e) {
			throw e;
		}
		throw error(500, err.message);
	}
};
