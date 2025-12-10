import { json, error as svelteError } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';
import { ensureError } from '$lib/ts-utils';

/**
 * GET /api/albums/list
 * Liste tous les albums de la BDD locale avec leurs métadonnées
 */
export const GET: RequestHandler = async (event) => {
	await requireScope(event, 'read');

	try {
		const db = getDatabase();
		const albums = db.prepare('SELECT * FROM albums ORDER BY date DESC, name ASC').all();

		return json({ success: true, data: albums });
	} catch (err) {
		const e = ensureError(err);
		console.error('GET /api/albums/list error:', e);
		throw svelteError(500, e.message);
	}
};
