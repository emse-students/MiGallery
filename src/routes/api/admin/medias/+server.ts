import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import { getAlbumInventory, getScanState, loadScanSnapshot } from '$lib/server/media-anomalies';
import type { ScanResult } from '$lib/server/media-anomalies';

/**
 * GET /api/admin/medias
 *
 * The instant half of the anomaly report: one upstream request plus one SQLite
 * query. The orphan count is NOT here on purpose - Immich's search reports the
 * size of the page rather than of the result set, so counting orphans means
 * paginating them, which is what `/orphans` does one page at a time.
 */
/**
 * The full multi-album list can run to hundreds of entries; the summary only
 * says whether there is one, how old it is and how much it covered.
 *
 * A function rather than a ternary because ESLint's `indent` rule and Prettier
 * disagree about an object literal nested in a ternary, and .ts files here
 * answer to both.
 */
function summarize(result: ScanResult | null) {
  if (!result) {
    return null;
  }
  return {
    scannedAt: result.scannedAt,
    albumsScanned: result.albumsScanned,
    albumsFailed: result.albumsFailed.length,
    assetsSeen: result.assetsSeen,
    multiAlbumCount: result.multiAlbum.length,
    truncated: result.truncated,
  };
}

export const GET: RequestHandler = async (event) => {
  await requireScope(event, 'admin');

  const inventory = await getAlbumInventory(event.fetch);
  const scan = getScanState();
  const lastResult = scan.result ?? loadScanSnapshot();

  return json({
    inventory,
    scan: {
      status: scan.status,
      startedAt: scan.startedAt,
      albumsTotal: scan.albumsTotal,
      albumsDone: scan.albumsDone,
      requests: scan.requests,
      error: scan.error,
      lastScan: summarize(lastResult),
    },
  });
};
