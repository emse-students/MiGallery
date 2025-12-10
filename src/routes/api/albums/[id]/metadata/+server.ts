// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { json, error as svelteError } from '@sveltejs/kit';

import { getDatabase } from '$lib/db/database';
import type { RequestHandler } from '@sveltejs/kit';
import { requireScope } from '$lib/server/permissions';

/**
 * PUT /api/albums/[id]/metadata
 * Met à jour les métadonnées locales d'un album (name, date, location, visibility, visible)
 * Tags et utilisateurs autorisés sont gérés via les endpoints /api/albums/[id]/permissions/*
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
			return json({ error: 'Album ID manquant' }, { status: 400 });
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
			return json({ error: "Le nom de l'album est requis" }, { status: 400 });
		}

		const db = getDatabase();

		// Vérifier que l'album existe dans la base de données locale
		const existing = db.prepare('SELECT id FROM albums WHERE id = ?').get(id);
		if (!existing) {
			return json({ error: 'Album non trouvé' }, { status: 404 });
		}

		// Mettre à jour les métadonnées locales
		const stmt = db.prepare(
			'UPDATE albums SET name = ?, date = ?, location = ?, visibility = ?, visible = ? WHERE id = ?'
		);
		const info = stmt.run(name.trim(), date, location, visibility, visible ? 1 : 0, id);

		if (info.changes === 0) {
			return json({ error: "Impossible de mettre à jour l'album" }, { status: 500 });
		}

		// Retourner les données mises à jour
		const updated = db
			.prepare('SELECT id, name, date, location, visibility, visible FROM albums WHERE id = ?')
			.get(id);

		return json({
			success: true,
			album: updated
		});
	} catch (e: unknown) {
		const errorMessage = e instanceof Error ? e.message : 'Erreur inconnue';
		console.error(`Erreur PUT /api/albums/${id}/metadata:`, e);
		return json({ error: errorMessage }, { status: 500 });
	}
};
