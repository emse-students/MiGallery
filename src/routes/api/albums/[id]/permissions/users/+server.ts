import { json, error as svelteError } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireScope } from '$lib/server/permissions';
import { ensureError } from '$lib/ts-utils';

import { createLogger } from '$lib/server/logger';

const log = createLogger('albums-id-permissions-users');
/**
 * POST /api/albums/[id]/permissions/users
 * Manages authorized users for an album
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
				"INSERT OR IGNORE INTO album_permissions (album_id, kind, value) VALUES (?, 'user', ?)"
			);
			for (const userId of body.add) {
				const trimmedUserId = String(userId).trim();
				if (trimmedUserId) {
					const result = stmt.run(albumId, trimmedUserId);
					addedCount += result.changes;
				}
			}
		}

		if (Array.isArray(body.remove) && body.remove.length > 0) {
			const stmt = db.prepare(
				"DELETE FROM album_permissions WHERE album_id = ? AND kind = 'user' AND value = ?"
			);
			for (const userId of body.remove) {
				const trimmedUserId = String(userId).trim();
				if (trimmedUserId) {
					const result = stmt.run(albumId, trimmedUserId);
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
		log.error('POST /api/albums/[id]/permissions/users error:', e);
		throw svelteError(500, e.message);
	}
};
