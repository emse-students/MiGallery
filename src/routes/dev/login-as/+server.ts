import type { UserRow } from '#lib/types/api.ts';
import { getDatabase } from '#lib/db/database.ts';
import { createSession } from '#lib/db/sessions.ts';
import { setSessionCookie } from '#lib/session.ts';
import { createLogger } from '#lib/server/logger.ts';
import type { RequestHandler } from './$types';

const log = createLogger('dev-login-as');

/**
 * Dev and test only: open a real session as an EXISTING local user.
 * Usage: GET /dev/login-as?u=<user_id>
 *
 * THIS FILE IS NOT IN A PRODUCTION BUILD. The `devOnlyRoutes` plugin (`vite.config.ts`) replaces it
 * with a bare 404 at build time unless the build is `vite dev` or `vite build --mode test` (the one
 * `scripts/test-with-server.mjs` makes), so no runtime setting can switch it on. CI greps the
 * production build for the marker below to prove the replacement happened.
 *
 * It opens an ordinary session rather than a special cookie, so what is being exercised in dev and
 * in tests is the same code path production uses. It never creates or promotes a user: the test
 * runner writes its own admin row first (`scripts/test-with-server.mjs`).
 */
const DEV_LOGIN_MARKER = 'dev-login-as: no such local user';

export const GET: RequestHandler = ({ url, cookies }) => {
  const userId = url.searchParams.get('u');
  if (!userId) {
    return new Response('Missing parameter: u (user id)', { status: 400 });
  }
  const user = getDatabase()
    .prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1')
    .get(userId) as UserRow | undefined;
  if (!user) {
    log.warn(`${DEV_LOGIN_MARKER}: ${userId}`);
    return new Response(`${DEV_LOGIN_MARKER}: ${userId}. Create the user first.`, { status: 404 });
  }

  const { token, expiresAt } = createSession(String(user.id_user));
  setSessionCookie(cookies, token, expiresAt);
  log.debug(`dev session opened for ${userId}`);

  // Redirect back to home where the layout will pick up the session
  return new Response(null, { status: 303, headers: { Location: '/' } });
};
