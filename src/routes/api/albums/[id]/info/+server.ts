import { json } from '@sveltejs/kit';

import { getDatabase } from '$lib/db/database';
import type { RequestHandler } from '@sveltejs/kit';
import { requireScope } from '$lib/server/permissions';

import { createLogger } from '$lib/server/logger';

const log = createLogger('albums-id-info');
export const GET: RequestHandler = async (event) => {
	try {
		await requireScope(event, 'read');
		const { id } = event.params;
		if (!id) {
			return json({ error: 'Album ID manquant' }, { status: 400 });
		}

		const db = getDatabase();

		const albumRow = db
			.prepare('SELECT id, name, date, location, visibility, visible FROM albums WHERE id = ?')
			.get(id) as
			| {
					id: number;
					name: string;
					date?: string | null;
					location?: string | null;
					visibility?: string;
					visible?: boolean | number;
			  }
			| undefined;

		if (!albumRow) {
			return json({ error: 'Album non trouvé dans la base locale' }, { status: 404 });
		}

		const tagsRows = db
			.prepare("SELECT value FROM album_permissions WHERE album_id = ? AND kind = 'tag'")
			.all(id) as { value: string }[];

		const usersRows = db
			.prepare("SELECT value FROM album_permissions WHERE album_id = ? AND kind = 'user'")
			.all(id) as { value: string }[];

		const formationsRows = db
			.prepare(
				"SELECT value FROM album_permissions WHERE album_id = ? AND kind = 'formation' ORDER BY value ASC"
			)
			.all(id) as { value: string }[];

		const promosRows = db
			.prepare(
				"SELECT value FROM album_permissions WHERE album_id = ? AND kind = 'promo' ORDER BY CAST(value AS INTEGER) ASC"
			)
			.all(id) as { value: string }[];

		return json({
			success: true,
			album: {
				id: albumRow.id,
				name: albumRow.name,
				date: albumRow.date || null,
				location: albumRow.location || null,
				visibility: albumRow.visibility || 'private',
				visible: albumRow.visible
			},
			tags: tagsRows.map((r) => r.value),
			users: usersRows.map((r) => r.value),
			formations: formationsRows.map((r) => r.value),
			promos: promosRows.map((r) => Number(r.value))
		});
	} catch (err: unknown) {
		const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue';
		log.error('Error loading album info:', err);
		return json(
			{
				error: errorMessage
			},
			{ status: 500 }
		);
	}
};
