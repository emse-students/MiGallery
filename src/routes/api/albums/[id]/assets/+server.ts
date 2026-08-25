import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import { addAlbumAssets, removeAlbumAssets } from '$lib/server/immich-album-assets';

/** Both callers in the app send `{ ids }`; anything else is an empty add. */
async function readIds(request: Request): Promise<string[]> {
	const body = (await request.json()) as { ids?: unknown } | null;
	const ids = body?.ids;
	return Array.isArray(ids) ? (ids as string[]) : [];
}

/**
 * PUT /api/albums/[id]/assets
 * Adds assets to an album.
 *
 * Body: { ids: string[] }
 */
export const PUT: RequestHandler = async (event) => {
	await requireScope(event, 'write');
	const ids = await readIds(event.request);
	return json(await addAlbumAssets(event.fetch, event.params.id, ids));
};

/**
 * DELETE /api/albums/[id]/assets
 * Removes assets from an album.
 *
 * Body: { ids: string[] }
 */
export const DELETE: RequestHandler = async (event) => {
	await requireScope(event, 'write');
	const ids = await readIds(event.request);
	return json(await removeAlbumAssets(event.fetch, event.params.id, ids));
};
