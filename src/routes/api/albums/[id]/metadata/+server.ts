import { json } from '@sveltejs/kit';

import { getDatabase } from '$lib/db/database';
import type { RequestHandler } from '@sveltejs/kit';
import { requireScope } from '$lib/server/permissions';

import { createLogger } from '$lib/server/logger';

const log = createLogger('albums-id-metadata');
/**
 * PUT /api/albums/[id]/metadata
 * Updates the local metadata of an album (name, date, location, visibility, visible)
 * Tags and authorized users are managed via the /api/albums/[id]/permissions/* endpoints
 *
 * Body: {
 *   name?: string,
 *   date?: string | null,
 *   location?: string | null,
 *   visibility?: 'private' | 'authenticated' | 'unlisted',
 *   visible?: boolean
 * }
 */
export const PUT: RequestHandler = async (event) => {
	await requireScope(event, 'write');
	try {
		const { id } = event.params;
		if (!id) {
			return json({ error: 'Missing album ID' }, { status: 400 });
		}

		const body = (await event.request.json()) as Record<string, unknown>;

		const name = typeof body.name === 'string' ? body.name : null;
		const date =
			typeof body.date === 'string' || body.date === null ? (body.date as string | null) : null;
		const location =
			typeof body.location === 'string' || body.location === null
				? (body.location as string | null)
				: null;
		const visibility = typeof body.visibility === 'string' ? body.visibility : 'private';
		const visible = typeof body.visible === 'boolean' ? body.visible : true;

		if (!name || typeof name !== 'string' || !name.trim()) {
			return json({ error: 'Album name is required' }, { status: 400 });
		}

		const db = getDatabase();

		const existing = db.prepare('SELECT id FROM albums WHERE id = ?').get(id);
		if (!existing) {
			return json({ error: 'Album not found' }, { status: 404 });
		}

		const stmt = db.prepare(
			'UPDATE albums SET name = ?, date = ?, location = ?, visibility = ?, visible = ? WHERE id = ?'
		);
		const info = stmt.run(name.trim(), date, location, visibility, visible ? 1 : 0, id);

		if (info.changes === 0) {
			return json({ error: 'Failed to update the album' }, { status: 500 });
		}

		const updated = db
			.prepare('SELECT id, name, date, location, visibility, visible FROM albums WHERE id = ?')
			.get(id);

		return json({
			success: true,
			album: updated
		});
	} catch (e: unknown) {
		const errorMessage = e instanceof Error ? e.message : 'Unknown error';
		log.error(`Error PUT /api/albums/${event.params.id}/metadata:`, e);
		return json({ error: errorMessage }, { status: 500 });
	}
};
