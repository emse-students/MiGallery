import type { RequestHandler } from './$types';

import { ensureError } from '$lib/ts-utils';
import { json, error } from '@sveltejs/kit';
import { getPersonAssets } from '$lib/photos-cv/handlers';
import { requireScope } from '$lib/server/permissions';

export const GET: RequestHandler = async (event) => {
	const personId = event.params.id;
	if (!personId) {
		throw error(400, 'personId is required');
	}

	await requireScope(event, 'read');

	try {
		const assets = await getPersonAssets(personId, true, event.fetch);
		return json({ assets });
	} catch (e: unknown) {
		const _err = ensureError(e);
		console.error('GET /api/people/person/[id]/album-photos error', e);
		throw error(500, e instanceof Error ? e.message : 'Internal');
	}
};
