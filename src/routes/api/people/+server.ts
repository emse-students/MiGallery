import { json, error, isHttpError } from '@sveltejs/kit';

import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { logEvent } from '$lib/server/logs';
import {
	getPersonAssets,
	getAlbumAssets,
	getAlbumInfo,
	addAssetsToAlbum,
	removeAssetsFromAlbum
} from '$lib/photos-cv/handlers';
import { requireScope } from '$lib/server/permissions';

/**
 * GET /api/people?action=...&personId=...
 *
 * Actions:
 * - my-photos: Person's photos OUTSIDE PhotoCV album
 * - album-photos: Person's photos IN PhotoCV album (filtered by personId)
 * - all-album-photos: ALL photos IN PhotoCV album (all people)
 * - album-info: Information about PhotoCV album
 */
export const GET: RequestHandler = async (event) => {
	const { url, fetch } = event;
	const action = url.searchParams.get('action');
	const personId = url.searchParams.get('personId');

	await requireScope(event, 'read');

	try {
		switch (action) {
			case 'my-photos': {
				if (!personId) {
					throw error(400, 'personId is required');
				}
				const assets = await getPersonAssets(personId, false, fetch);
				return json({ assets });
			}

			case 'album-photos': {
				if (!personId) {
					throw error(400, 'personId is required');
				}
				const assets = await getPersonAssets(personId, true, fetch);
				return json({ assets });
			}

			case 'all-album-photos': {
				const assets = await getAlbumAssets(fetch);
				return json({ assets });
			}

			case 'album-info': {
				const info = await getAlbumInfo(fetch);
				return json(info);
			}

			default:
				throw error(
					400,
					'Invalid action. Valid actions: my-photos, album-photos, all-album-photos, album-info'
				);
		}
	} catch (e: unknown) {
		if (isHttpError(e)) {
			throw e;
		}
		const err = ensureError(e);
		console.error('Error in /api/people GET:', err);
		throw error(500, err.message);
	}
};

/**
 * POST /api/people
 *
 * Actions:
 * - add-to-album: Add assets to PhotoCV album
 * - remove-from-album: Remove assets from PhotoCV album
 *
 * Body: { action: string, assetIds: string[] }
 */
export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'write');
	try {
		const body = (await event.request.json()) as { action?: string; assetIds?: string[] };
		const { action, assetIds } = body;
		const { fetch } = event;

		if (!action || !assetIds || !Array.isArray(assetIds) || assetIds.length === 0) {
			throw error(400, 'action and assetIds[] are required');
		}

		switch (action) {
			case 'add-to-album': {
				const result = await addAssetsToAlbum(assetIds, fetch);
				void logEvent(event, 'update', 'album', 'PhotoCV', {
					action: 'add_assets',
					count: assetIds.length,
					assetIds
				});
				return json({ success: true, added: result });
			}

			case 'remove-from-album': {
				const result = await removeAssetsFromAlbum(assetIds, fetch);
				void logEvent(event, 'update', 'album', 'PhotoCV', {
					action: 'remove_assets',
					count: assetIds.length,
					assetIds
				});
				return json({ success: true, removed: result });
			}

			default:
				throw error(400, 'Invalid action. Valid actions: add-to-album, remove-from-album');
		}
	} catch (e: unknown) {
		if (isHttpError(e)) {
			throw e;
		}
		const err = ensureError(e);
		console.error('Error in /api/people POST:', err);
		throw error(500, err.message);
	}
};
