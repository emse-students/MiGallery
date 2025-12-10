import { json, error as svelteError } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';
import { ensureError } from '$lib/ts-utils';
import { env } from '$env/dynamic/private';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY ?? '';

/**
 * POST /api/albums/import
 * Importe tous les albums depuis Immich dans la BDD locale
 *
 * Retourne le nombre d'albums importés
 */
export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'write');

	try {
		if (!IMMICH_BASE_URL) {
			throw svelteError(500, 'IMMICH_BASE_URL not configured');
		}

		// 1. Récupérer tous les albums depuis Immich
		const res = await event.fetch(`${IMMICH_BASE_URL}/api/albums`, {
			headers: {
				'x-api-key': IMMICH_API_KEY,
				Accept: 'application/json'
			}
		});

		if (!res.ok) {
			const errorText = await res.text();
			throw svelteError(res.status, `Failed to fetch albums from Immich: ${errorText}`);
		}

		const albums = (await res.json()) as Array<{
			id?: string;
			albumId?: string;
			album_id?: string;
			_id?: string;
			name?: string;
			title?: string;
			albumName?: string;
		}>;

		if (!Array.isArray(albums)) {
			throw svelteError(500, 'Invalid response from Immich');
		}

		// 2. Importer chaque album dans la BDD locale
		const db = getDatabase();
		const stmt = db.prepare(
			'INSERT OR IGNORE INTO albums (id, name, date, location, visibility, visible) VALUES (?, ?, ?, ?, ?, ?)'
		);

		let imported = 0;
		for (const album of albums) {
			const immichId = album.id || album.albumId || album.album_id || album._id || null;
			if (!immichId) {
				continue;
			}

			let name = album.name || album.title || album.albumName || String(immichId);
			let dateVal: string | null = null;

			// Extraire la date du nom si format YYYY-MM-DD
			const dateMatch = name.match(/^([0-9]{4}-[0-9]{2}-[0-9]{2})\s*(.*)$/);
			if (dateMatch) {
				dateVal = dateMatch[1];
				name = dateMatch[2] || name;
			}

			const result = stmt.run(immichId, name, dateVal, null, 'private', 1);
			if (result.changes > 0) {
				imported++;
			}
		}

		return json({
			success: true,
			imported,
			total: albums.length
		});
	} catch (err) {
		const e = ensureError(err);
		console.error('POST /api/albums/import error:', e);
		if (e && typeof e === 'object' && 'status' in e) {
			throw e;
		}
		throw svelteError(500, e.message);
	}
};
