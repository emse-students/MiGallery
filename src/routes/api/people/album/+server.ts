import { json, error } from '@sveltejs/kit';
import type { ImmichAlbum } from '$lib/types/api';
import { ensureError } from '$lib/ts-utils';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { verifyRawKeyWithScope } from '$lib/db/api-keys';
import { getCurrentUser } from '$lib/server/auth';
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;
import { getOrCreateSystemAlbum } from '$lib/immich/system-albums';

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
		const albumRes = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}`, {
			headers: { 'x-api-key': IMMICH_API_KEY, Accept: 'application/json' }
		});
		if (!albumRes.ok) {
			throw error(500, `Failed to fetch album: ${albumRes.statusText}`);
		}
		const albumData = (await albumRes.json()) as ImmichAlbum;
		const assets = albumData.assets || [];
		return json({ assets });
	} catch (e: unknown) {
		const err = ensureError(e);
		console.error('Error in /api/people/album GET:', err);
		throw error(500, err.message);
	}
};
