import { json, error } from '@sveltejs/kit';

import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';
import { verifyRawKeyWithScope } from '$lib/db/api-keys';
import { getCurrentUser } from '$lib/server/auth';

/**
 * GET /api/people/people
 * Liste toutes les personnes reconnues par Immich
 */
export const GET: RequestHandler = async ({ fetch, request, locals, cookies }) => {
	try {
		if (!IMMICH_BASE_URL) {
			throw error(500, 'IMMICH_BASE_URL not configured');
		}

		// Autorisation: session utilisateur OU x-api-key with scope "read"
		const user = await getCurrentUser({ locals, cookies });
		if (!user) {
			const raw = request.headers.get('x-api-key') || undefined;
			if (!verifyRawKeyWithScope(raw, 'read')) {
				throw error(401, 'Unauthorized');
			}
		}

		const res = await fetch(`${IMMICH_BASE_URL}/api/people`, {
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
