import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import { pruneOrphanCovers, resolveMissingCovers } from '$lib/server/album-cover';
import { createLogger } from '$lib/server/logger';

const log = createLogger('admin-covers-prune');

/**
 * POST /api/admin/covers-prune
 *
 * Deletes every cached cover image no album references any more.
 *
 * Albums whose cover was never resolved are resolved FIRST: an unresolved
 * album points at nothing, so its perfectly valid cached image would otherwise
 * look like an orphan and be thrown away (and rebuilt on the next visit).
 */
export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'admin');

	const resolved = await resolveMissingCovers(event.fetch);
	const result = pruneOrphanCovers();

	log.info(
		`Cover prune: resolved ${resolved} album(s), deleted ${result.deleted} file(s) (${result.bytes} bytes), kept ${result.kept}`
	);

	return json({ success: true, resolved, ...result });
};
