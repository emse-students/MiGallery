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

    if (!IMMICH_BASE_URL) throw error(500, 'IMMICH_BASE_URL not configured');
    
    // Récupérer l'album depuis Immich
    const res = await fetch(`${IMMICH_BASE_URL}/api/albums/${id}`, {
      headers: {
        'x-api-key': IMMICH_API_KEY,
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      return json({ error: 'Album non trouvé' }, { status: 404 });
    }

    const album = await res.json();

    // Récupérer les données locales (BDD)
    const db = getDatabase();

    // Charger les tags
    const tagsStmt = db.prepare('SELECT tag FROM album_tag_permissions WHERE album_id = ?');
    const tags = tagsStmt.all(id);

    // Charger les utilisateurs autorisés
    const usersStmt = db.prepare('SELECT id_user FROM album_user_permissions WHERE album_id = ?');
    const users = usersStmt.all(id);

    return json({
      success: true,
      album: {
        id: album.id,
        name: album.albumName,
        date: album.startDate || null,
        location: album.location || null,
        visibility: 'private', // Immich n'a pas ce champ, utiliser une valeur par défaut
        visible: 1
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
