import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';

/**
 * GET /api/albums/[id]/og-preview
 *
 * Public endpoint (no authentication) that returns the metadata of an
 * album in JSON format, used to generate enriched link previews
 * in external applications (e.g., Canari).
 *
 * Private albums return 403. For non-private albums, returns:
 * { name, date, location, visibility, coverUrl }
 *
 * `coverUrl` points to /api/albums/[id]/og-cover, which serves the image publicly.
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
		| { name: string; date?: string | null; location?: string | null; visibility?: string }
		| undefined;

	if (!row) {
		throw error(404, 'Album not found');
	}

	const visibility = row.visibility || 'private';
	if (visibility === 'private') {
		throw error(403, 'Album is private');
	}

	const coverUrl = `${url.origin}/api/albums/${id}/og-cover`;

	return json({
		name: row.name,
		date: row.date || null,
		location: row.location || null,
		visibility,
		coverUrl
	});
};
