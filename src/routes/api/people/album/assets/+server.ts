import { json, error } from '@sveltejs/kit';

import type { RequestHandler } from './$types';
import { addAssetsToAlbum, removeAssetsFromAlbum } from '$lib/photos-cv/handlers';
import { requireScope } from '$lib/server/permissions';

/**
 * Bulk add/remove on the PhotoCV system album - the album id is resolved
 * server-side, callers only send ids. `POST /api/people` does the same thing
 * for the app itself; this route is what external API-key callers use, so it
 * still exists (it is hit on prod) and it goes through the same handlers.
 */
async function readAssetIds(request: Request): Promise<string[]> {
	const body = (await request.json()) as { assetIds?: string[]; ids?: string[] };
	const assetIds = body.assetIds || body.ids || [];
	if (!Array.isArray(assetIds) || assetIds.length === 0) {
		throw error(400, 'assetIds required');
	}
	return assetIds;
}

export const PUT: RequestHandler = async (event) => {
	await requireScope(event, 'write');
	const added = await addAssetsToAlbum(await readAssetIds(event.request), event.fetch);
	return json({ success: true, added });
};

export const DELETE: RequestHandler = async (event) => {
	await requireScope(event, 'write');
	const removed = await removeAssetsFromAlbum(await readAssetIds(event.request), event.fetch);
	return json({ success: true, removed });
};
