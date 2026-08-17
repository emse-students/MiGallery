import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';
import { getStoredCover } from '$lib/server/album-cover';

/**
 * GET /api/albums/[id]/og-preview
 *
 * Public endpoint (no authentication) that returns the metadata of an
 * album in JSON format, used to generate enriched link previews
 * in external applications (e.g., Canari).
 *
 * Private albums return 403. For non-private albums, returns:
 * { name, date, location, visibility, coverUrl, squareCoverUrl }
 *
 * `coverUrl` points to /api/albums/[id]/og-cover (1200x630), the shape link
 * unfurlers expect. `squareCoverUrl` points to /api/albums/[id]/cover (1:1),
 * for consumers that render the cover in a square or a narrow thumbnail strip
 * where the wide image would be cropped to an unreadable band. Both are public
 * for non-private albums.
 */
export const GET: RequestHandler = ({ params, url }) => {
	const { id } = params;
	if (!id) {
		throw error(400, 'Album ID missing');
	}

	const db = getDatabase();
	const row = db
		.prepare('SELECT name, date, location, visibility FROM albums WHERE id = ?')
		.get(id) as
		{ name: string; date?: string | null; location?: string | null; visibility?: string } | undefined;

	if (!row) {
		throw error(404, 'Album not found');
	}

	const visibility = row.visibility || 'private';
	if (visibility === 'private') {
		throw error(403, 'Album is private');
	}

	const coverUrl = `${url.origin}/api/albums/${id}/og-cover`;
	// Versioned when the cover is already resolved, so a cover change is picked
	// up immediately instead of sitting in a downstream cache.
	const stored = getStoredCover(id);
	const squareCoverUrl = `${url.origin}/api/albums/${id}/cover${stored ? `?v=${stored.assetId}` : ''}`;

	return json({
		name: row.name,
		date: row.date || null,
		location: row.location || null,
		visibility,
		coverUrl,
		squareCoverUrl
	});
};
