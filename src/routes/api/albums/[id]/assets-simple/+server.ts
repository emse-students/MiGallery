import { error as svelteError } from '@sveltejs/kit';
import type { ImmichAsset } from '$lib/types/api';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { fetchAlbumAssets } from '$lib/immich/album-assets';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';
import { requireScope } from '$lib/server/permissions';

/**
 * GET /api/albums/[id]/assets-simple
 * Returns the assets of an album in simple JSON (no streaming)
 * Avoids Proxy issues with Svelte 5
 */
export const GET: RequestHandler = async (event) => {
	try {
		await requireScope(event, 'read');
		const { id } = event.params;
		const { fetch } = event;

		if (!IMMICH_BASE_URL) {
			throw svelteError(500, 'IMMICH_BASE_URL not configured');
		}

		const rawAssets = await fetchAlbumAssets(fetch, IMMICH_BASE_URL, IMMICH_API_KEY, id);

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
			albumName: null
		}));

		return new Response(JSON.stringify({ assets }), {
			status: 200,
			headers: {
				'Content-Type': 'application/json'
			}
		});
	} catch (e: unknown) {
		console.error(`Error in /api/albums/${event.params.id}/assets-simple GET:`, e);
		const errorMessage = e instanceof Error ? e.message : 'Internal server error';
		throw svelteError(500, `Internal server error: ${errorMessage}`);
	}
};
