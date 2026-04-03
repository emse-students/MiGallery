import { json } from '@sveltejs/kit';

import { getDatabase } from '$lib/db/database';
import type { RequestHandler } from '@sveltejs/kit';
import { requireScope } from '$lib/server/permissions';

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
			.prepare('SELECT tag FROM album_tag_permissions WHERE album_id = ?')
			.all(id) as { tag: string }[];

		const usersRows = db
			.prepare('SELECT id_user FROM album_user_permissions WHERE album_id = ?')
			.all(id) as { id_user: string }[];

		const formationsRows = db
			.prepare(
				'SELECT formation FROM album_formation_permissions WHERE album_id = ? ORDER BY formation ASC'
			)
			.all(id) as { formation: string }[];

		const promosRows = db
			.prepare(
				'SELECT promo_year FROM album_promo_permissions WHERE album_id = ? ORDER BY promo_year ASC'
			)
			.all(id) as { promo_year: number }[];

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
			tags: tagsRows.map((r) => r.tag),
			users: usersRows.map((r) => r.id_user),
			formations: formationsRows.map((r) => r.formation),
			promos: promosRows.map((r) => r.promo_year)
		});
	} catch (err: unknown) {
		const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue';
		console.error('Erreur chargement album info:', err);
		return json(
			{
				error: errorMessage
			},
			{ status: 500 }
		);
	}
};
