import { json, error } from "@sveltejs/kit";
import { getDatabase } from "$lib/db/database";
import type { RequestHandler } from "@sveltejs/kit";
import { env } from '$env/dynamic/private';

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;

export const GET: RequestHandler = async ({ params, fetch }) => {
  try {
    const { id } = params;
    if (!id) {
      return json({ error: "Album ID manquant" }, { status: 400 });
    }

    const db = getDatabase();

    // Récupérer d'abord l'album depuis notre BDD locale (source de vérité)
    const albumRow = db.prepare(
      'SELECT id, name, date, location, visibility, visible FROM albums WHERE id = ?'
    ).get(id) as any;

    if (!albumRow) {
      return json({ error: 'Album non trouvé dans la base locale' }, { status: 404 });
    }

    // Charger les tags
    const tagsStmt = db.prepare('SELECT tag FROM album_tag_permissions WHERE album_id = ?');
    const tags = tagsStmt.all(id);

    // Charger les utilisateurs autorisés
    const usersStmt = db.prepare('SELECT id_user FROM album_user_permissions WHERE album_id = ?');
    const users = usersStmt.all(id);

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
      tags: tags.map((r: any) => r.tag),
      users: users.map((r: any) => r.id_user)
    });
  } catch (error) {
    console.error("Erreur chargement album info:", error);
    return json({ 
      error: error instanceof Error ? error.message : "Erreur" 
    }, { status: 500 });
  }
};
