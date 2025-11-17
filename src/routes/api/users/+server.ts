import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '$lib/db/database';

export const GET: RequestHandler = async ({ locals }) => {
  // list users - admin only
  try {
    const session = await locals.auth();
    const user = session?.user as any | undefined;
    if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
    if ((user.role || 'user') !== 'admin') return json({ error: 'Forbidden' }, { status: 403 });

    const db = getDatabase();
    const rows = db.prepare('SELECT id_user, email, prenom, nom, id_photos, role, promo_year FROM users ORDER BY promo_year DESC, nom, prenom').all();
    return json({ success: true, users: rows });
  } catch (e) {
    console.error('GET /api/users error', e);
    return json({ success: false, error: (e as Error).message }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request, locals }) => {
  // create user - admin only
  try {
    const session = await locals.auth();
    const user = session?.user as any | undefined;
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
