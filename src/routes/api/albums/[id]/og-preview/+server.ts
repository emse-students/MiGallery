import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';

/**
 * GET /api/albums/[id]/og-preview
 *
 * Endpoint public (sans authentification) qui retourne les métadonnées d'un
 * album au format JSON, utilisées pour générer des link previews enrichies
 * dans des applications externes (ex. Canari).
 *
 * Les albums privés retournent 403. Pour les albums non-privés, retourne :
 * { name, date, location, visibility, coverUrl }
 *
 * `coverUrl` pointe vers /api/albums/[id]/og-cover, qui sert l'image publiquement.
 */
export const GET: RequestHandler = async ({ params, url }) => {
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
