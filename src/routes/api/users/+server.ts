import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';
import { verifySigned } from '$lib/auth/cookies';
import { verifyRawKeyWithScope } from '$lib/db/api-keys';
import type { User } from '$lib/db/database';

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

export const GET: RequestHandler = async ({ locals, cookies, request }) => {
  // list users - admin only
  try {
    // accept admin via x-api-key header as well
    const apiKeyHeader = request.headers.get('x-api-key') || request.headers.get('X-API-KEY');
    if (apiKeyHeader) {
      if (!verifyRawKeyWithScope(apiKeyHeader, 'admin')) return json({ error: 'Unauthorized' }, { status: 401 });
    } else {
      const user = await getUserFromLocals(locals, cookies);
      if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
      if ((user.role || 'user') !== 'admin') return json({ error: 'Forbidden' }, { status: 403 });
    }

    const db = getDatabase();
    // Filtrer les utilisateurs système (promo_year IS NULL) pour le trombinoscope
    // Les admins peuvent voir tous les utilisateurs via d'autres routes si nécessaire
    const rows = db.prepare('SELECT id_user, email, prenom, nom, id_photos, role, promo_year FROM users WHERE promo_year IS NOT NULL ORDER BY promo_year DESC, nom, prenom').all();
    return json({ success: true, users: rows });
  } catch (e) {
    console.error('GET /api/users error', e);
    return json({ success: false, error: (e as Error).message }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
  // create user - admin only
  try {
    const user = await getUserFromLocals(locals, cookies);
    if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
    if ((user.role || 'user') !== 'admin') return json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json();
    const { id_user, email, prenom, nom, role = 'user', promo_year = null, id_photos = null } = body;
    if (!id_user || !email) return json({ error: 'id_user and email required' }, { status: 400 });

    const db = getDatabase();
    const insert = db.prepare('INSERT INTO users (id_user, email, prenom, nom, role, promo_year, id_photos, first_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const info = insert.run(id_user, email, prenom || '', nom || '', role, promo_year, id_photos, id_photos ? 0 : 1);
    const created = db.prepare('SELECT id_user, email, prenom, nom, id_photos, role, promo_year FROM users WHERE id_user = ?').get(id_user);
    return json({ success: true, created, changes: info.changes });
  } catch (e) {
    console.error('POST /api/users error', e);
    return json({ success: false, error: (e as Error).message }, { status: 500 });
  }
};
