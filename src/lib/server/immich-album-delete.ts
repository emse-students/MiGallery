import { env } from '$env/dynamic/private';
import { createLogger } from '$lib/server/logger';
import { OUTBOUND_BUDGET_MS } from '$lib/server/outbound';

const log = createLogger('immich-album-delete');
const IMMICH_BASE_URL = env.IMMICH_BASE_URL ?? '';
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';
const DELETE_BATCH_SIZE = 100;

interface ImmichAssetDetails {
  albums?: Array<{ id?: string }>;
}

export interface OrphanedAssetDeleteResult {
  checked: number;
  deleted: number;
  skipped: number;
  verificationFailures: number;
  deleteError?: string;
}

/**
 * Deletes only assets that no longer belong to another Immich album.
 * Asset membership is checked after the requested album has been deleted.
 */
export async function deleteOrphanedAlbumAssets(
  fetchFn: typeof fetch,
  albumId: string,
  assetIds: string[],
  baseUrl = IMMICH_BASE_URL,
  apiKey = IMMICH_API_KEY
): Promise<OrphanedAssetDeleteResult> {
  const uniqueAssetIds = [...new Set(assetIds.filter((id) => typeof id === 'string' && id))];
  const result: OrphanedAssetDeleteResult = {
    checked: uniqueAssetIds.length,
    deleted: 0,
    skipped: 0,
    verificationFailures: 0,
  };

  if (!baseUrl || uniqueAssetIds.length === 0) {
    return result;
  }

  const base = baseUrl.replace(/\/$/, '');
  const orphanedIds: string[] = [];

  for (const assetId of uniqueAssetIds) {
    try {
      const response = await fetchFn(`${base}/api/assets/${assetId}`, {
        signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
        headers: { 'x-api-key': apiKey, Accept: 'application/json' },
      });
      if (!response.ok) {
        result.verificationFailures++;
        result.skipped++;
        log.warn(`Could not verify album membership for asset ${assetId}: ${response.status}`);
        continue;
      }

      const details = (await response.json()) as ImmichAssetDetails;
      if (!Array.isArray(details.albums)) {
        result.verificationFailures++;
        result.skipped++;
        log.warn(`Could not verify album membership for asset ${assetId}: albums missing`);
        continue;
      }

      const belongsToAnotherAlbum = details.albums.some(
        (album) => typeof album?.id === 'string' && album.id !== albumId
      );
      if (belongsToAnotherAlbum) {
        result.skipped++;
      } else {
        orphanedIds.push(assetId);
      }
    } catch (error) {
      result.verificationFailures++;
      result.skipped++;
      log.warn(`Could not verify album membership for asset ${assetId}:`, error);
    }
  }

  for (let offset = 0; offset < orphanedIds.length; offset += DELETE_BATCH_SIZE) {
    const ids = orphanedIds.slice(offset, offset + DELETE_BATCH_SIZE);
    try {
      const response = await fetchFn(`${base}/api/assets`, {
        signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
        method: 'DELETE',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) {
        result.deleteError = `Immich asset deletion failed: ${response.status}`;
        log.warn(result.deleteError);
        break;
      }
      result.deleted += ids.length;
    } catch (error) {
      result.deleteError = error instanceof Error ? error.message : 'Immich asset deletion failed';
      log.warn(result.deleteError, error);
      break;
    }
  }

  return result;
}
