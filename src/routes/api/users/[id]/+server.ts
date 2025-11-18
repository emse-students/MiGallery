import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';
import { verifySigned } from '$lib/auth/cookies';
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

export const GET: RequestHandler = async ({ params, locals, cookies, request }) => {
  // get user by id - admin or self
  try {
    // allow admin via API key header
    const apiKeyHeader = request.headers.get('x-api-key') || request.headers.get('X-API-KEY');
    let caller = null;
    if (apiKeyHeader) {
      const { verifyRawKeyWithScope } = await import('$lib/db/api-keys');
      if (!verifyRawKeyWithScope(apiKeyHeader, 'admin')) return json({ error: 'Unauthorized' }, { status: 401 });
      // caller remains null but admin privileges allowed via API key
    } else {
      caller = await getUserFromLocals(locals, cookies);
      if (!caller) return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const targetId = params.id as string;
    if (!targetId) return json({ error: 'Bad Request' }, { status: 400 });

    if (caller && (caller.role || 'user') !== 'admin' && caller.id_user !== targetId) {
      return json({ error: 'Forbidden' }, { status: 403 });
    }

    const db = getDatabase();
    const row = db.prepare('SELECT id_user, email, prenom, nom, id_photos, role, promo_year FROM users WHERE id_user = ? LIMIT 1').get(targetId);
    if (!row) return json({ error: 'Not Found' }, { status: 404 });
    return json({ success: true, user: row });
  } catch (e) {
    console.error('GET /api/users/[id] error', e);
    return json({ success: false, error: (e as Error).message }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ params, request, locals, cookies }) => {
  // update user - admin only
  try {
    const caller = await getUserFromLocals(locals, cookies);
    if (!caller) return json({ error: 'Unauthorized' }, { status: 401 });
    if ((caller.role || 'user') !== 'admin') return json({ error: 'Forbidden' }, { status: 403 });

    const targetId = params.id as string;
    const body = await request.json();
    const { email, prenom, nom, role, promo_year, id_photos } = body;

    const db = getDatabase();
    const stmt = db.prepare('UPDATE users SET email = ?, prenom = ?, nom = ?, role = ?, promo_year = ?, id_photos = ? WHERE id_user = ?');
    const info = stmt.run(email || null, prenom || null, nom || null, role || 'user', promo_year || null, id_photos || null, targetId);
    const updated = db.prepare('SELECT id_user, email, prenom, nom, id_photos, role, promo_year FROM users WHERE id_user = ?').get(targetId);
    return json({ success: true, updated, changes: info.changes });
  } catch (e) {
    console.error('PUT /api/users/[id] error', e);
    return json({ success: false, error: (e as Error).message }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ params, locals, cookies }) => {
  // delete user - admin only
  try {
    const caller = await getUserFromLocals(locals, cookies);
    if (!caller) return json({ error: 'Unauthorized' }, { status: 401 });
    if ((caller.role || 'user') !== 'admin') return json({ error: 'Forbidden' }, { status: 403 });

    const targetId = params.id as string;
    const db = getDatabase();
    const info = db.prepare('DELETE FROM users WHERE id_user = ?').run(targetId);
    return json({ success: true, changes: info.changes });
  } catch (e) {
    console.error('DELETE /api/users/[id] error', e);
    return json({ success: false, error: (e as Error).message }, { status: 500 });
  }
};
