import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOrCreateSystemAlbum } from '$lib/immich/system-albums';
import { env } from '$env/dynamic/private';
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;

export const PUT: RequestHandler = async ({ request, fetch }) => {
  try {
    const body = await request.json();
    const assetIds = body.assetIds || body.ids || [];
    if (!Array.isArray(assetIds) || assetIds.length === 0) throw error(400, 'assetIds required');
    const albumId = await getOrCreateSystemAlbum(fetch, 'PhotoCV');
    const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}/assets`, {
      method: 'PUT',
      headers: { 'x-api-key': IMMICH_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: assetIds })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw error(500, `Failed to add assets: ${txt}`);
    }
    const data = await res.json();
    return json({ success: true, added: data });
  } catch (err) {
    console.error('Error in /api/people/album/assets PUT:', err);
    throw error(500, err instanceof Error ? err.message : 'Internal server error');
  }
};

export const DELETE: RequestHandler = async ({ request, fetch }) => {
  try {
    const body = await request.json();
    const assetIds = body.assetIds || body.ids || [];
    if (!Array.isArray(assetIds) || assetIds.length === 0) throw error(400, 'assetIds required');
    const albumId = await getOrCreateSystemAlbum(fetch, 'PhotoCV');
    const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${albumId}/assets`, {
      method: 'DELETE',
      headers: { 'x-api-key': IMMICH_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: assetIds })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw error(500, `Failed to remove assets: ${txt}`);
    }
    const data = await res.json();
    return json({ success: true, removed: data });
  } catch (err) {
    console.error('Error in /api/people/album/assets DELETE:', err);
    throw error(500, err instanceof Error ? err.message : 'Internal server error');
  }
};
