import type { PageServerLoad } from './$types';
import { getDatabase } from '$lib/db/database';
import { listAllAlbums, checkAlbumAccess } from '$lib/albums';
import type { User } from '$lib/types';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ cookies }) => {
  // require authenticated users
  const userId = cookies.get('current_user_id');
  if (!userId) {
    throw redirect(303, '/');
  }

  const db = getDatabase();
  const userRow = db.prepare('SELECT * FROM users WHERE id_user = ?').get(userId) as any;
  const user: User = userRow ? { id_user: userRow.id_user, email: userRow.email, prenom: userRow.prenom, nom: userRow.nom, id_photos: userRow.id_photos, first_login: userRow.first_login, role: userRow.role, promo_year: userRow.promo_year } : null as any;

  if (!user) throw redirect(303, '/');

  const albums = listAllAlbums();
  const allowed = albums.filter(a => checkAlbumAccess(user, a));

  return { albums: allowed };
};
