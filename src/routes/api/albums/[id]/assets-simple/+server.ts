import { error as svelteError } from '@sveltejs/kit';
import type { ImmichAlbum, ImmichAsset } from '$lib/types/api';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';
import { requireScope } from '$lib/server/permissions';

/**
 * GET /api/albums/[id]/assets-simple
 * Retourne les assets d'un album en JSON simple (pas de streaming)
 * Évite les problèmes de Proxy avec Svelte 5
 */
export const GET: RequestHandler = async (event) => {
	try {
		await requireScope(event, 'read');
		const { id } = event.params;
		const { fetch } = event;

		if (!IMMICH_BASE_URL) {
			throw svelteError(500, 'IMMICH_BASE_URL not configured');
		}

		// Récupérer l'album avec ses assets
		const albumRes = await fetch(`${IMMICH_BASE_URL}/api/albums/${id}`, {
			headers: {
				'x-api-key': IMMICH_API_KEY,
				Accept: 'application/json'
			}
		});

		if (!albumRes.ok) {
			const errorText = await albumRes.text();
			throw svelteError(albumRes.status, `Failed to fetch album: ${errorText}`);
		}

		const album = (await albumRes.json()) as ImmichAlbum;
		const rawAssets = Array.isArray(album?.assets) ? album.assets : [];

		// Nettoyer les assets pour éviter les Proxies
		const assets = rawAssets.map((asset: ImmichAsset) => ({
			id: asset.id,
			originalFileName: asset.originalFileName,
			type: asset.type,
			width: asset.exifInfo?.exifImageWidth || null,
			height: asset.exifInfo?.exifImageHeight || null,
			fileCreatedAt: asset.fileCreatedAt || null,
			createdAt: asset.createdAt || null,
			updatedAt: asset.updatedAt || null,
			fileModifiedAt: asset.fileModifiedAt || null,
			albumName: album.albumName || null
		}));

		return new Response(JSON.stringify({ assets }), {
			status: 200,
			headers: {
				'Content-Type': 'application/json'
			}
		});
	} catch (e: unknown) {
		console.error(`Error in /api/albums/${id}/assets-simple GET:`, e);
		const errorMessage = e instanceof Error ? e.message : 'Internal server error';
		throw svelteError(500, `Internal server error: ${errorMessage}`);
	}
};
