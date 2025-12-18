import { json, error as svelteError } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';
import { ensureError } from '$lib/ts-utils';

/**
 * POST /api/albums/[id]/permissions/tags
 * Gère les tags autorisés pour un album
 *
 * Body: {
 *   add?: string[],
 *   remove?: string[]
 * }
 */
export const POST: RequestHandler = async (event) => {
	await requireScope(event, 'write');

	const albumId = event.params.id;
	if (!albumId) {
		throw svelteError(400, 'Album ID required');
	}

	try {
		const body = (await event.request.json()) as {
			add?: string[];
			remove?: string[];
		};

		const db = getDatabase();

		const existing = db.prepare('SELECT id FROM albums WHERE id = ?').get(albumId);
		if (!existing) {
			throw svelteError(404, 'Album not found');
		}

		let addedCount = 0;
		let removedCount = 0;

		if (Array.isArray(body.add) && body.add.length > 0) {
			const stmt = db.prepare(
				'INSERT OR IGNORE INTO album_tag_permissions (album_id, tag) VALUES (?, ?)'
			);
			for (const tag of body.add) {
				const trimmedTag = String(tag).trim();
				if (trimmedTag) {
					const result = stmt.run(albumId, trimmedTag);
					addedCount += result.changes;
				}
			}
		}

		if (Array.isArray(body.remove) && body.remove.length > 0) {
			const stmt = db.prepare('DELETE FROM album_tag_permissions WHERE album_id = ? AND tag = ?');
			for (const tag of body.remove) {
				const trimmedTag = String(tag).trim();
				if (trimmedTag) {
					const result = stmt.run(albumId, trimmedTag);
					removedCount += result.changes;
				}
			}
		}

		return json({
			success: true,
			added: addedCount,
			removed: removedCount
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		const e = ensureError(err);
		console.error('POST /api/albums/[id]/permissions/tags error:', e);
		throw svelteError(500, e.message);
	}
};
