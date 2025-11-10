import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { IMMICH_BASE_URL, IMMICH_API_KEY } from '$env/static/private';

/**
 * POST /api/albums/covers
 * Récupère les covers de plusieurs albums en une seule requête optimisée
 * 
 * Body: { albumIds: string[] }
 * Returns: { [albumId]: { assetId: string, type: string } }
 */
export const POST: RequestHandler = async ({ request, fetch }) => {
	try {
		const { albumIds } = await request.json();
		
		if (!Array.isArray(albumIds) || albumIds.length === 0) {
			throw error(400, 'albumIds array is required');
		}

		const covers: Record<string, { assetId: string; type: string } | null> = {};

		// Récupérer les albums en parallèle (batch de 10)
		const batchSize = 10;
		for (let i = 0; i < albumIds.length; i += batchSize) {
			const batch = albumIds.slice(i, i + batchSize);
			
			await Promise.all(
				batch.map(async (albumId) => {
					try {
						const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}`, {
							headers: {
								'x-api-key': IMMICH_API_KEY,
								'Accept': 'application/json'
							}
						});

						if (res.ok) {
							const album = await res.json();
							const assets = album.assets || [];
							
							if (assets.length > 0) {
								// Prendre le thumbnail de l'album ou le premier asset
								const coverAsset = album.albumThumbnailAssetId 
									? assets.find((a: any) => a.id === album.albumThumbnailAssetId) || assets[0]
									: assets[0];
								
								covers[albumId] = {
									assetId: coverAsset.id,
									type: coverAsset.type || 'IMAGE'
								};
							} else {
								covers[albumId] = null;
							}
						} else {
							covers[albumId] = null;
						}
					} catch (e) {
						console.warn(`Failed to fetch cover for album ${albumId}:`, e);
						covers[albumId] = null;
					}
				})
			);
		}

		return json(covers);
	} catch (err) {
		console.error('Error in /api/albums/covers POST:', err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};
