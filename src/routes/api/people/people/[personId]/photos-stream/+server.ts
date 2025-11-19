import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;
import { getAllAssetIdsInSystemAlbums } from '$lib/immich/system-albums';

/**
 * GET /api/people/people/[personId]/photos-stream
 * Streame les photos d'une personne en NDJSON
 * Phase 1: Métadonnées minimales (id, type, dimensions)
 * Phase 2: Enrichissement avec détails complets
 */
export const GET: RequestHandler = async ({ params, url, fetch }) => {
  const personId = params.personId;
  if (!personId) throw error(400, 'personId required');
  const inAlbum = url.searchParams.get('in_album') === 'true';

  try {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Récupérer tous les assets de la personne
          const allAssets: any[] = [];
          let page = 1;
          let hasNext = true;

          while (hasNext) {
            const res = await fetch(`${IMMICH_BASE_URL}/api/search/metadata`, {
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

          // Filtrer selon in_album
          const systemAssetIds = new Set(await getAllAssetIdsInSystemAlbums(fetch));
          const filtered = allAssets.filter(asset => {
            const isInAnySystem = systemAssetIds.has(asset.id);
            return inAlbum ? isInAnySystem : !isInAnySystem;
          });

          // Phase 1: Envoyer les métadonnées minimales
          for (const asset of filtered) {
            const minimalData = {
              id: asset.id,
              type: asset.type,
              width: asset.exifInfo?.exifImageWidth || null,
              height: asset.exifInfo?.exifImageHeight || null,
              aspectRatio: null as number | null
            };

            if (minimalData.width && minimalData.height) {
              minimalData.aspectRatio = minimalData.width / minimalData.height;
            }

            controller.enqueue(encoder.encode(JSON.stringify({
              phase: 'minimal',
              asset: minimalData
            }) + '\n'));
          }

          // Phase 2: Enrichir par batches
          const batchSize = 10;
          for (let i = 0; i < filtered.length; i += batchSize) {
            const batch = filtered.slice(i, i + batchSize);
            
            const detailsPromises = batch.map(async (asset: any) => {
              try {
                const detailRes = await fetch(`${IMMICH_BASE_URL}/api/assets/${asset.id}`, {
                  headers: {
                    'x-api-key': IMMICH_API_KEY,
                    'Accept': 'application/json'
                  }
                });

                if (detailRes.ok) {
                  const fullAsset = await detailRes.json();
                  return {
                    phase: 'full',
                    asset: fullAsset
                  };
                }
                return null;
              } catch (e) {
                console.warn(`Failed to fetch details for asset ${asset.id}:`, e);
                return null;
              }
            });

            const results = await Promise.allSettled(detailsPromises);
            
            for (const result of results) {
              if (result.status === 'fulfilled' && result.value) {
                controller.enqueue(encoder.encode(JSON.stringify(result.value) + '\n'));
              }
            }
          }

          controller.close();
        } catch (err) {
          console.error('Error in photos stream:', err);
          controller.error(err);
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (err) {
    console.error('Error in /api/people/people/[personId]/photos-stream GET:', err);
    throw error(500, err instanceof Error ? err.message : 'Internal server error');
  }
};
