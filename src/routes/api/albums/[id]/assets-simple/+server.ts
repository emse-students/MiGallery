import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;

/**
 * GET /api/albums/[id]/assets-simple
 * Retourne les assets d'un album en JSON simple (pas de streaming)
 * Évite les problèmes de Proxy avec Svelte 5
 */
export const GET: RequestHandler = async ({ params, fetch }) => {
	try {
		const { id } = params;
		
		if (!IMMICH_BASE_URL) throw error(500, 'IMMICH_BASE_URL not configured');

		// Récupérer l'album avec ses assets
		const albumRes = await fetch(`${IMMICH_BASE_URL}/api/albums/${id}`, {
			headers: {
				'x-api-key': IMMICH_API_KEY,
				'Accept': 'application/json'
			}
		});

		if (!albumRes.ok) {
			const errorText = await albumRes.text();
			throw error(albumRes.status, `Failed to fetch album: ${errorText}`);
		}

		const album = await albumRes.json();
		const rawAssets = Array.isArray(album?.assets) ? album.assets : [];

		// Nettoyer les assets pour éviter les Proxies
		const assets = rawAssets.map((asset: any) => ({
			id: asset.id,
			originalFileName: asset.originalFileName,
			type: asset.type,
			width: asset.exifInfo?.exifImageWidth || asset.width || null,
			height: asset.exifInfo?.exifImageHeight || asset.height || null,
			fileCreatedAt: asset.fileCreatedAt || null,
			createdAt: asset.createdAt || null,
			updatedAt: asset.updatedAt || null,
			fileModifiedAt: asset.fileModifiedAt || null,
			albumName: album.albumName || album.name || null
		}));

		return new Response(
			JSON.stringify({ assets }),
			{
				status: 200,
				headers: {
					'Content-Type': 'application/json'
				}
			}
		);
	} catch (err) {
		console.error(`Error in /api/albums/${params.id}/assets-simple GET:`, err);
		throw error(500, `Internal server error: ${(err as Error).message}`);
	}
};
