import { json, error } from '@sveltejs/kit';
import type { ImmichAlbum } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { getOrCreateSystemAlbum } from '$lib/immich/system-albums';
import { verifyRawKeyWithScope } from '$lib/db/api-keys';
import { getCurrentUser } from '$lib/server/auth';

export const GET: RequestHandler = async ({ fetch, request, locals, cookies }) => {
	try {
		// Autorisation: session utilisateur OU x-api-key avec scope "read"
		const user = await getCurrentUser({ locals, cookies });
		if (!user) {
			const raw = request.headers.get('x-api-key') || undefined;
			if (!verifyRawKeyWithScope(raw, 'read')) {
				throw error(401, 'Unauthorized');
			}
		}
		const albumId = await getOrCreateSystemAlbum(fetch, 'PhotoCV');
		const headers: Record<string, string> = { Accept: 'application/json' };
		if (process.env.IMMICH_API_KEY) {
			headers['x-api-key'] = process.env.IMMICH_API_KEY;
		}
		const albumRes = await fetch(`${process.env.IMMICH_BASE_URL}/api/albums/${albumId}`, { headers });
		if (!albumRes.ok) {
			throw error(500, `Failed to fetch album: ${albumRes.statusText}`);
		}
		const albumData = (await albumRes.json()) as ImmichAlbum;
		return json({
			id: albumData.id,
			name: albumData.albumName,
			assetCount: albumData.assetCount || 0
		});
	} catch (e: unknown) {
		const err = ensureError(e);
		console.error('Error in /api/people/album/info GET:', err);
		throw error(500, err.message);
	}
};
