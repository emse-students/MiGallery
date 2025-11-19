import { json, error } from "@sveltejs/kit";
import { getDatabase } from "$lib/db/database";
import type { RequestHandler } from "@sveltejs/kit";

/**
 * PUT /api/albums/[id]/metadata
 * Met à jour les métadonnées locales d'un album (name, date, location, visibility, visible)
 * Tags et utilisateurs autorisés sont gérés via /api/db directement
 * 
 * Body: {
 *   name?: string,
 *   date?: string | null,
 *   location?: string | null,
 *   visibility?: 'private' | 'authenticated' | 'unlisted',
 *   visible?: boolean
 * }
 */
export const PUT: RequestHandler = async ({ params, request }) => {
  try {
    const { id } = params;
    if (!id) {
      return json({ error: "Album ID manquant" }, { status: 400 });
    }

    const body = await request.json();
    const { name, date = null, location = null, visibility = 'private', visible = true } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return json({ error: "Le nom de l'album est requis" }, { status: 400 });
    }

    const db = getDatabase();

    // Vérifier que l'album existe dans la base de données locale
    const existing = db.prepare('SELECT id FROM albums WHERE id = ?').get(id);
    if (!existing) {
      return json({ error: "Album non trouvé" }, { status: 404 });
    }

    // Mettre à jour les métadonnées locales
    const stmt = db.prepare(
      'UPDATE albums SET name = ?, date = ?, location = ?, visibility = ?, visible = ? WHERE id = ?'
    );
    const info = stmt.run(
      name.trim(),
      date,
      location,
      visibility,
      visible ? 1 : 0,
      id
    );

    if (info.changes === 0) {
      return json({ error: "Impossible de mettre à jour l'album" }, { status: 500 });
    }

    // Retourner les données mises à jour
    const updated = db.prepare(
      'SELECT id, name, date, location, visibility, visible FROM albums WHERE id = ?'
    ).get(id);

    return json({
      success: true,
      album: updated
    });
  } catch (err) {
    console.error(`Erreur PUT /api/albums/${params.id}/metadata:`, err);
    return json(
      { error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
};
