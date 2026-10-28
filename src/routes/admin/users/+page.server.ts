import type { PageServerLoad } from './$types';
import { requireAdminPage } from '#lib/server/auth.ts';
import { getDatabase } from '#lib/db/database.ts';
import type { UserRow } from '#lib/types/api.ts';

export const load: PageServerLoad = ({ locals, cookies, url }) => {
  const admin = requireAdminPage({ locals, cookies }, url);

  const db = getDatabase();
  const users = db
    .prepare(
      `SELECT id_user, name, first_name, last_name, photos_id, role, promo, formation
			 FROM users
			 ORDER BY role, promo DESC, name`
    )
    .all() as UserRow[];

  return { users, currentUserId: admin.id_user };
};
