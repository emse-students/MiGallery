import { json, error } from '@sveltejs/kit';
import type { ImmichAsset } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';
import { getPersonAssets as getPersonAlbumAssets } from '$lib/photos-cv/handlers';
import { requireScope } from '$lib/server/permissions';

import { createLogger } from '$lib/server/logger';

const log = createLogger('people-people-personId-photos');
async function getPersonAssets(personId: string, inAlbum: boolean, fetchFn: typeof fetch) {
	// Combined personIds+albumIds search is done in the shared handler; here we
	// only enrich each result with its full asset detail.
	const filtered = await getPersonAlbumAssets(personId, inAlbum, fetchFn);

	const enrichedAssets = await Promise.all(
		filtered.map(async (asset) => {
			try {
				const detailRes = await fetchFn(`${IMMICH_BASE_URL}/api/assets/${asset.id}`, {
					headers: {
						'x-api-key': IMMICH_API_KEY,
						Accept: 'application/json'
					}
				});

				if (!detailRes.ok) {
					return asset;
				}

				return (await detailRes.json()) as ImmichAsset;
			} catch (e: unknown) {
				const _err = ensureError(e);
				return asset;
			}
		})
	);

	return enrichedAssets;
}

export const GET: RequestHandler = async (event) => {
	const personId = event.params.personId;
	if (!personId) {
		throw error(400, 'personId required');
	}
	const inAlbum = event.url.searchParams.get('in_album') === 'true';

	await requireScope(event, 'read');
	try {
		const assets = await getPersonAssets(personId, inAlbum, event.fetch);
		return json({ assets });
	} catch (e: unknown) {
		const err = ensureError(e);
		log.error('Error in /api/people/people/[personId]/photos GET:', err);
		throw error(500, err.message);
	}
};
