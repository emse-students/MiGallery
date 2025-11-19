import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPersonAssets, getAlbumAssets, getAlbumInfo, addAssetsToAlbum, removeAssetsFromAlbum } from '$lib/photos-cv/handlers';

// compatibility: this +server still supports the old ?action=.. query API but delegates logic to handlers

/**
 * GET /api/people?action=...&personId=...
 * 
 * Actions:
 * - my-photos: Photos de la personne HORS album PhotoCV
 * - album-photos: Photos de la personne DANS l'album PhotoCV (filtrées par personId)
 * - all-album-photos: TOUTES les photos DANS l'album PhotoCV (toutes personnes)
 * - album-info: Informations sur l'album PhotoCV
 */
export const GET: RequestHandler = async ({ url, fetch }) => {
	const action = url.searchParams.get('action');
	const personId = url.searchParams.get('personId');

	try {
		switch (action) {
			case 'my-photos': {
				if (!personId) throw error(400, 'personId is required');
				const assets = await getPersonAssets(personId, false, fetch);
				return json({ assets });
			}

			case 'album-photos': {
				if (!personId) throw error(400, 'personId is required');
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
				throw error(400, 'Invalid action. Valid actions: my-photos, album-photos, all-album-photos, album-info');
		}
	} catch (err) {
		console.error('Error in /api/people GET:', err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};

/**
 * POST /api/people
 * 
 * Actions:
 * - add-to-album: Ajouter des assets à l'album PhotoCV
 * - remove-from-album: Retirer des assets de l'album PhotoCV
 * 
 * Body: { action: string, assetIds: string[] }
 */
export const POST: RequestHandler = async ({ request, fetch }) => {
	try {
		const body = await request.json();
		const { action, assetIds } = body;

		if (!action || !assetIds || !Array.isArray(assetIds) || assetIds.length === 0) {
			throw error(400, 'action and assetIds[] are required');
		}

		switch (action) {
			case 'add-to-album': {
				const result = await addAssetsToAlbum(assetIds, fetch);
				return json({ success: true, added: result });
			}

			case 'remove-from-album': {
				const result = await removeAssetsFromAlbum(assetIds, fetch);
				return json({ success: true, removed: result });
			}

			default:
				throw error(400, 'Invalid action. Valid actions: add-to-album, remove-from-album');
		}
	} catch (err) {
		console.error('Error in /api/people POST:', err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};
