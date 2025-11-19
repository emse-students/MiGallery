import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;
import { getAllAssetIdsInSystemAlbums } from '$lib/immich/system-albums';

async function getPersonAssets(personId: string, inAlbum: boolean, fetchFn: typeof fetch) {
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
      body: JSON.stringify({ personIds: [personId], type: 'IMAGE', page, size: 1000 })
    });

    if (!res.ok) throw new Error(`Search failed: ${res.statusText}`);
    const data = await res.json();
    const items = data.assets?.items || [];
    if (items.length === 0) break;
    allAssets.push(...items);
    hasNext = data.assets?.nextPage !== null && data.assets?.nextPage !== undefined;
    page++;
    if (page > 10) break;
  }

  const systemAssetIds = new Set(await getAllAssetIdsInSystemAlbums(fetchFn));
  const filtered = allAssets.filter(asset => {
    const isInAnySystem = systemAssetIds.has(asset.id);
    return inAlbum ? isInAnySystem : !isInAnySystem;
  });

  const enrichedAssets = await Promise.all(
    filtered.map(async (asset) => {
      try {
        const detailRes = await fetchFn(`${IMMICH_BASE_URL}/api/assets/${asset.id}`, {
          headers: {
            'x-api-key': IMMICH_API_KEY,
            'Accept': 'application/json'
          }
        });
        
        if (!detailRes.ok) {
          return asset;
        }
        
        return await detailRes.json();
      } catch (err) {
        return asset;
      }
    })
  );
  
  return enrichedAssets;
}

export const GET: RequestHandler = async ({ params, url, fetch }) => {
  const personId = params.personId;
  if (!personId) throw error(400, 'personId required');
  const inAlbum = url.searchParams.get('in_album') === 'true';
  try {
    const assets = await getPersonAssets(personId, inAlbum, fetch);
    return json({ assets });
  } catch (err) {
    console.error('Error in /api/people/people/[personId]/photos GET:', err);
    throw error(500, err instanceof Error ? err.message : 'Internal server error');
  }
};
