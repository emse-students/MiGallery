import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOrCreateSystemAlbum } from '$lib/immich/system-albums';

export const GET: RequestHandler = async ({ fetch }) => {
  try {
    const albumId = await getOrCreateSystemAlbum(fetch, 'PhotoCV');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (process.env.IMMICH_API_KEY) headers['x-api-key'] = process.env.IMMICH_API_KEY;
    const albumRes = await fetch(`${process.env.IMMICH_BASE_URL}/api/albums/${albumId}`, { headers });
    if (!albumRes.ok) throw error(500, `Failed to fetch album: ${albumRes.statusText}`);
    const albumData = await albumRes.json();
    return json({ id: albumData.id, name: albumData.albumName, assetCount: albumData.assetCount || 0 });
  } catch (err) {
    console.error('Error in /api/photos-cv/album/info GET:', err);
    throw error(500, err instanceof Error ? err.message : 'Internal server error');
  }
};
