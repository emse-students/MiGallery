import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import { getScanState, loadScanSnapshot, startDeepScan } from '$lib/server/media-anomalies';
import { logEvent } from '$lib/server/logs';

/**
 * The deep scan: which assets sit in more than one album.
 *
 * POST starts it and answers immediately; GET reports progress and, once it is
 * finished, the full list. Nothing here holds a request open for the two to
 * four minutes the scan takes - 581 paginated upstream requests for prod's 528
 * albums, because no Immich query answers "assets in N albums".
 */
export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	const before = getScanState().status;
	const state = startDeepScan();

	// Worth an audit line: this is an admin deliberately spending a few hundred
	// upstream requests. A second click that joins a running scan is not one.
	if (before !== 'running') {
		void logEvent(event, 'read', 'media_scan', 'multi-album', { albums: state.albumsTotal });
	}

	return json({ started: before !== 'running', status: state.status });
};

/**
 * GET /api/admin/medias/scan
 *
 * Progress while it runs, the full multi-album list once it is done. The list
 * is READ-ONLY: an asset in several albums is not necessarily wrong, and
 * deciding what to drop is a separate job from noticing it.
 */
export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	const state = getScanState();
	const result = state.result ?? loadScanSnapshot();

	return json({
		status: state.status,
		startedAt: state.startedAt,
		albumsTotal: state.albumsTotal,
		albumsDone: state.albumsDone,
		requests: state.requests,
		error: state.error,
		result
	});
};
