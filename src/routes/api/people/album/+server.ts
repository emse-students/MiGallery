import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;
import { getOrCreateSystemAlbum } from '$lib/immich/system-albums';

export const GET: RequestHandler = async ({ fetch }) => {
  try {
    const albumId = await getOrCreateSystemAlbum(fetch, 'PhotoCV');
    const albumRes = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}`, {
      headers: { 'x-api-key': IMMICH_API_KEY, Accept: 'application/json' }
    });
    if (!albumRes.ok) throw error(500, `Failed to fetch album: ${albumRes.statusText}`);
    const albumData = await albumRes.json();
    const assets = albumData.assets || [];
    return json({ assets });
  } catch (err) {
    console.error('Error in /api/people/album GET:', err);
    throw error(500, err instanceof Error ? err.message : 'Internal server error');
  }
};
