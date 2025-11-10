import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { IMMICH_BASE_URL, IMMICH_API_KEY } from '$env/static/private';

const PHOTOCV_ALBUM_NAME = 'PhotoCV';

// Cache pour l'ID de l'album PhotoCV (évite de le rechercher à chaque requête)
let albumCache: { id: string; updatedAt: number } | null = null;
const ALBUM_CACHE_TTL = 60000; // 1 minute

/**
 * Récupère ou crée l'album PhotoCV caché
 */
async function getOrCreatePhotoCVAlbum(fetchFn: typeof fetch): Promise<string> {
	// Vérifier le cache
	if (albumCache && Date.now() - albumCache.updatedAt < ALBUM_CACHE_TTL) {
		return albumCache.id;
	}

	// Rechercher l'album existant
	const searchRes = await fetchFn(`${IMMICH_BASE_URL}/api/albums`, {
		headers: {
			'x-api-key': IMMICH_API_KEY,
			'Accept': 'application/json'
		}
	});

	if (!searchRes.ok) {
		throw new Error(`Failed to fetch albums: ${searchRes.statusText}`);
	}

	const albums = await searchRes.json();
	const existingAlbum = albums.find((a: any) => a.albumName === PHOTOCV_ALBUM_NAME);

	if (existingAlbum) {
		albumCache = { id: existingAlbum.id, updatedAt: Date.now() };
		return existingAlbum.id;
	}

	// Créer l'album s'il n'existe pas
	const createRes = await fetchFn(`${IMMICH_BASE_URL}/api/albums`, {
		method: 'POST',
		headers: {
			'x-api-key': IMMICH_API_KEY,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			albumName: PHOTOCV_ALBUM_NAME,
			description: 'Album système pour les photos CV (géré automatiquement)'
		})
	});

	if (!createRes.ok) {
		const errorText = await createRes.text();
		throw new Error(`Failed to create PhotoCV album: ${errorText}`);
	}

	const newAlbum = await createRes.json();
	albumCache = { id: newAlbum.id, updatedAt: Date.now() };
	return newAlbum.id;
}

/**
 * Récupère les assets d'une personne (avec pagination)
 */
async function getPersonAssets(personId: string, inAlbum: boolean, fetchFn: typeof fetch): Promise<any[]> {
	const albumId = await getOrCreatePhotoCVAlbum(fetchFn);
	
	// Récupérer TOUS les assets de la personne (avec pagination)
	const allAssets: any[] = [];
	let page = 1;
	let hasNext = true;

	while (hasNext) {
		const res = await fetchFn(`${IMMICH_BASE_URL}/api/search/metadata`, {
			method: 'POST',
			headers: {
				'x-api-key': IMMICH_API_KEY,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				personIds: [personId],
				type: 'IMAGE',
				page,
				size: 1000
			})
		});

		if (!res.ok) {
			throw new Error(`Search failed: ${res.statusText}`);
		}

		const data = await res.json();
		const items = data.assets?.items || [];
		
		if (items.length === 0) {
			break;
		}

		allAssets.push(...items);
		hasNext = data.assets?.nextPage !== null && data.assets?.nextPage !== undefined;
		page++;

		// Sécurité : ne pas dépasser 10 pages
		if (page > 10) break;
	}

	// Récupérer les assets de l'album PhotoCV
	const albumRes = await fetchFn(`${IMMICH_BASE_URL}/api/albums/${albumId}`, {
		headers: {
			'x-api-key': IMMICH_API_KEY,
			'Accept': 'application/json'
		}
	});

	if (!albumRes.ok) {
		throw new Error(`Failed to fetch album: ${albumRes.statusText}`);
	}

	const albumData = await albumRes.json();
	const albumAssetIds = new Set((albumData.assets || []).map((a: any) => a.id));

	// Filtrer selon inAlbum
	const filtered = allAssets.filter(asset => {
		const isInAlbum = albumAssetIds.has(asset.id);
		return inAlbum ? isInAlbum : !isInAlbum;
	});

	return filtered;
}

/**
 * GET /api/photos-cv?action=...&personId=...
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
				// Récupérer TOUTES les photos de l'album (sans filtrage par personne)
				const albumId = await getOrCreatePhotoCVAlbum(fetch);
				
				const albumRes = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}`, {
					headers: {
						'x-api-key': IMMICH_API_KEY,
						'Accept': 'application/json'
					}
				});

				if (!albumRes.ok) {
					throw error(500, `Failed to fetch album: ${albumRes.statusText}`);
				}

				const albumData = await albumRes.json();
				const assets = albumData.assets || [];
				return json({ assets });
			}

			case 'album-info': {
				const albumId = await getOrCreatePhotoCVAlbum(fetch);
				
				// Récupérer les détails de l'album
				const albumRes = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}`, {
					headers: {
						'x-api-key': IMMICH_API_KEY,
						'Accept': 'application/json'
					}
				});

				if (!albumRes.ok) {
					throw error(500, `Failed to fetch album: ${albumRes.statusText}`);
				}

				const albumData = await albumRes.json();
				return json({
					id: albumData.id,
					name: albumData.albumName,
					assetCount: albumData.assetCount || 0
				});
			}

			default:
				throw error(400, 'Invalid action. Valid actions: my-photos, album-photos, all-album-photos, album-info');
		}
	} catch (err) {
		console.error('Error in /api/photos-cv GET:', err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};

/**
 * POST /api/photos-cv
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

		const albumId = await getOrCreatePhotoCVAlbum(fetch);

		switch (action) {
			case 'add-to-album': {
				const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}/assets`, {
					method: 'PUT',
					headers: {
						'x-api-key': IMMICH_API_KEY,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ ids: assetIds })
				});

				if (!res.ok) {
					const errorText = await res.text();
					throw error(500, `Failed to add assets to album: ${errorText}`);
				}

				const result = await res.json();
				return json({ success: true, added: result });
			}

			case 'remove-from-album': {
				const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}/assets`, {
					method: 'DELETE',
					headers: {
						'x-api-key': IMMICH_API_KEY,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ ids: assetIds })
				});

				if (!res.ok) {
					const errorText = await res.text();
					throw error(500, `Failed to remove assets from album: ${errorText}`);
				}

				const result = await res.json();
				return json({ success: true, removed: result });
			}

			default:
				throw error(400, 'Invalid action. Valid actions: add-to-album, remove-from-album');
		}
	} catch (err) {
		console.error('Error in /api/photos-cv POST:', err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(500, err instanceof Error ? err.message : 'Internal server error');
	}
};
