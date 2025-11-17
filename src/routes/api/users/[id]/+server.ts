import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';

export const GET: RequestHandler = async ({ params, locals }) => {
  // get user by id - admin or self
  try {
    const session = await locals.auth();
    const caller = session?.user as any | undefined;
    if (!caller) return json({ error: 'Unauthorized' }, { status: 401 });

    const targetId = params.id as string;
    if (!targetId) return json({ error: 'Bad Request' }, { status: 400 });

    if ((caller.role || 'user') !== 'admin' && caller.id_user !== targetId) {
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

export const PUT: RequestHandler = async ({ params, request, locals }) => {
  // update user - admin only
  try {
    const session = await locals.auth();
    const caller = session?.user as any | undefined;
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

export const DELETE: RequestHandler = async ({ params, locals }) => {
  // delete user - admin only
  try {
    const session = await locals.auth();
    const caller = session?.user as any | undefined;
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
