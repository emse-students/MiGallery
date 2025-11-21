import type { RequestHandler } from './$types';

import { ensureError } from '$lib/ts-utils';
import { json, error } from '@sveltejs/kit';
import { getPersonAssets } from '$lib/photos-cv/handlers';
import { verifyRawKeyWithScope } from '$lib/db/api-keys';
import { getCurrentUser } from '$lib/server/auth';

export const GET: RequestHandler = async ({ params, fetch, request, locals, cookies }) => {
	const personId = params.id;
	if (!personId) {
		throw error(400, 'personId is required');
	}

	// Autorisation: session utilisateur OU x-api-key avec scope "read"
	const user = await getCurrentUser({ locals, cookies });
	if (!user) {
		const raw = request.headers.get('x-api-key') || undefined;
		if (!verifyRawKeyWithScope(raw, 'read')) {
			throw error(401, 'Unauthorized');
		}
	}
	try {
		const assets = await getPersonAssets(personId, false, fetch);
		return json({ assets });
	} catch (e: unknown) {
		const _err = ensureError(e);
		console.error('GET /api/people/person/[id]/my-photos error', e);
		throw error(500, e instanceof Error ? e.message : 'Internal');
	}
};
