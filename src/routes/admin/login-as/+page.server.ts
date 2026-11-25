import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDatabase } from '#lib/db/database.ts';
import { requireAdminPage } from '#lib/server/auth.ts';
import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('admin-login-as');

/**
 * The confirmation before an admin acts as another user: `/admin/login-as?u=<user_id>`.
 *
 * A READ, and only a read. Opening this URL names the account and writes nothing - the
 * impersonation itself is the page's `POST /api/change-user`, behind the Origin check and the
 * step-up like every other change (docs/wiki/authentication.md, "Impersonation"). It used to be
 * written by this GET, so any link to it changed the admin's session on a single visit.
 */
export const load: PageServerLoad = ({ locals, cookies, url }) => {
  requireAdminPage({ locals, cookies }, url);

  const id = url.searchParams.get('u');
  if (!id) {
    log.debug('no user named');
    throw error(400, 'Missing parameter: u (user id)');
  }

  const target = getDatabase()
    .prepare('SELECT id_user, name FROM users WHERE id_user = ? LIMIT 1')
    .get(id) as { id_user: string; name: string } | null | undefined;
  if (!target) {
    log.debug('unknown user', { id });
    throw error(404, 'User not found');
  }

  return { target: { id: target.id_user, name: target.name } };
};
