import { json, error } from "@sveltejs/kit";
import { getDatabase } from "$lib/db/database";
import type { RequestHandler } from "@sveltejs/kit";
import { env } from '$env/dynamic/private';
import { verifySigned } from "$lib/auth/cookies";
import type { User } from "$lib/db/database";

const IMMICH_BASE_URL = env.IMMICH_BASE_URL;
const IMMICH_API_KEY = env.IMMICH_API_KEY;

async function getUserFromLocals(locals: any, cookies: any): Promise<User | null> {
  const db = getDatabase();
  
  // Try cookie first (fast path)
  const cookieSigned = cookies.get('current_user_id');
  if (cookieSigned) {
    const verified = verifySigned(cookieSigned);
    if (verified) {
      const userInfo = db.prepare("SELECT * FROM users WHERE id_user = ? LIMIT 1").get(verified) as User | null;
      if (userInfo) return userInfo;
    }
  }
  
  // Fallback to auth provider
  if (locals && typeof locals.auth === 'function') {
    const session = await locals.auth();
    if (session?.user) {
      const providerId = (session.user as any).id || (session.user as any).preferred_username || (session.user as any).sub;
      if (providerId) {
        const userInfo = db.prepare("SELECT * FROM users WHERE id_user = ? LIMIT 1").get(providerId) as User | null;
        if (userInfo) return userInfo;
      }
    }
  }
  
  return null;
}

/**
 * GET /api/users/[username]/avatar
 * Récupère la photo de profil d'un utilisateur par son id_user
 * Requires: authentification (permission 'read')
 */
export const GET: RequestHandler = async ({ params, fetch, locals, cookies }) => {
  try {
    // Vérifier l'authentification
    const caller = await getUserFromLocals(locals, cookies);
    if (!caller) {
      return error(401, 'Unauthorized');
    }

    const { username } = params;
    if (!username) {
      return error(400, "Nom d'utilisateur manquant");
    }

    const db = getDatabase();

    // Chercher l'utilisateur par son id_user
    const userStmt = db.prepare('SELECT id_photos FROM users WHERE id_user = ?');
    const user = userStmt.get(username) as any;
    
    if (!user) {
      return error(404, 'Utilisateur non trouvé');
    }

    const userId = user.id_photos;
    if (!userId) {
      return error(404, 'Utilisateur sans id_photos');
    }

    if (!IMMICH_BASE_URL) {
      return error(500, 'IMMICH_BASE_URL not configured');
    }

    // Récupérer la photo de profil depuis Immich
    const res = await fetch(`${IMMICH_BASE_URL}/api/people/${userId}/thumbnail`, {
      headers: {
        'x-api-key': IMMICH_API_KEY
      }
    });

    if (!res.ok) {
      return error(res.status, 'Photo non trouvée');
    }

    const blob = await res.blob();
    
    return new Response(blob, {
      headers: {
        'Content-Type': res.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (err) {
    console.error("Erreur /api/users/[username]/avatar:", err);
    return error(500, err instanceof Error ? err.message : 'Erreur serveur');
  }
};
