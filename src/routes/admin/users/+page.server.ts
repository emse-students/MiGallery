import type { PageServerLoad } from './$types';
import { requireAdminPage } from '#lib/server/auth.ts';
import { getDatabase } from '#lib/db/database.ts';
import { faceStatus } from '#lib/server/face-photos.ts';
import type { UserRow } from '#lib/types/api.ts';

/**
 * The member list. Each row says whether face matching is on for the member (lot A6) - a yes or
 * no, never a person id, a count of faces or a reference.
 */
export const load: PageServerLoad = ({ locals, cookies, url }) => {
  const admin = requireAdminPage({ locals, cookies }, url);

  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id_user, name, first_name, last_name, role, promo, formation
			 FROM users
			 ORDER BY role, promo DESC, name`
    )
    .all() as Array<Omit<UserRow, 'photos_id'>>;
  const users = rows.map((row) => ({
    ...row,
    face_enrolled: faceStatus(db, row.id_user).enrolled,
  }));

  return { users, currentUserId: admin.id_user };
};
