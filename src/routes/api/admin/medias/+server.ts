import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import { getAlbumInventory, getScanState, loadScanSnapshot } from '$lib/server/media-anomalies';

/**
 * GET /api/admin/medias
 *
 * The instant half of the anomaly report: one upstream request plus one SQLite
 * query. The orphan count is NOT here on purpose - Immich's search reports the
 * size of the page rather than of the result set, so counting orphans means
 * paginating them, which is what `/orphans` does one page at a time.
 */
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
			// The full multi-album list can run to hundreds of entries; the summary
			// only says whether there is one and how old it is.
			lastScan: lastResult
				? {
						scannedAt: lastResult.scannedAt,
						albumsScanned: lastResult.albumsScanned,
						albumsFailed: lastResult.albumsFailed.length,
						assetsSeen: lastResult.assetsSeen,
						multiAlbumCount: lastResult.multiAlbum.length,
						truncated: lastResult.truncated
					}
				: null
		}
	});
};
