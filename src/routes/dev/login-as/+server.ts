import { dev } from '$app/environment';
import type { UserRow } from '$lib/types/api';
import { getDatabase } from '$lib/db/database';
import { createSession } from '$lib/db/sessions';
import { setSessionCookie } from '$lib/session';
import type { RequestHandler } from './$types';

const SYSTEM_USER_ID = 'dd68bb5b4f7c56878a1bd873593a3e7c3434242c80871e4ead9fe99d3f48a782';

/**
 * Dev-only helper: open a real session as a local user.
 * Usage (dev only): GET /dev/login-as?u=<user_id>
 *
 * It opens an ordinary session rather than a special cookie, so what is being
 * exercised in dev and in tests is the same code path production uses.
 *
 * SECURITY:
 * - In development (bun run dev): Always enabled
 * - In production: Disabled by default, returns 404
 * - To enable in prod: Add ENABLE_DEV_ROUTES=true in .env (DANGEROUS)
 *
 * RECOMMENDATION: NEVER enable in production except for supervised temporary debugging.
 */
export const GET: RequestHandler = ({ url, cookies }) => {
  const allowDevRoutes =
    dev || process.env.ENABLE_DEV_ROUTES === 'true' || process.env.NODE_ENV === 'test';

  if (!allowDevRoutes) {
    return new Response('Not found', { status: 404 });
  }

  const username = url.searchParams.get('u');
  if (!username) {
    return new Response('Missing parameter: u (username)', { status: 400 });
  }
  const db = getDatabase();

  const findUser = (id: string): UserRow | undefined =>
    db.prepare('SELECT * FROM users WHERE id_user = ? LIMIT 1').get(id) as UserRow | undefined;

  let user = findUser(username);

  if (!user) {
    if (process.env.NODE_ENV !== 'test' || username !== SYSTEM_USER_ID) {
      // Do NOT create or promote users in this dev helper outside the test suite.
      return new Response(
        `User ${username} not found in local DB. Create the user first (do not use this route to create/promote).`,
        { status: 404 }
      );
    }

    try {
      db.prepare(
        'INSERT OR IGNORE INTO users (id_user, name, first_name, last_name, role, promo, photos_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(username, 'System Admin', 'System', 'Admin', 'admin', null, null);
    } catch (e) {
      return new Response(`Failed to create system user: ${(e as Error).message}`, { status: 500 });
    }

    user = findUser(username);
    if (!user) {
      return new Response(`User ${username} not found after creation attempt.`, { status: 500 });
    }
  }

  const { token, expiresAt } = createSession(String(user.id_user));
  setSessionCookie(cookies, token, expiresAt);

  // Redirect back to home where the layout will pick up the session
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/',
    },
  });
};
