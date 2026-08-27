/**
 * The login cookie.
 *
 * It carries an opaque session token and nothing else - never an identity. The
 * identity is read from the `sessions` table (see `$lib/db/sessions`), so the
 * server decides who the caller is instead of being told.
 */
import { dev } from '$app/environment';
import type { Cookies } from '@sveltejs/kit';
import { resolveSession, type ResolvedSession } from '$lib/db/sessions';
import type { SessionUser } from '$lib/auth';
import { createLogger } from '$lib/server/logger';

const log = createLogger('session');

export const SESSION_COOKIE_NAME = 'migallery_session';

/**
 * The cookie this replaced. It held a RAW user id that nothing verified, so any
 * value still sitting in a browser must be deleted rather than read - see
 * `hooks.server.ts`, which clears it on the way through.
 */
export const LEGACY_SESSION_COOKIE_NAME = '__session_user';

/** Cookies from the removed signed-id mechanism, cleared for the same reason. */
export const LEGACY_IMPERSONATION_COOKIES = ['current_user_id', 'impersonator_admin_id'];

/** Set the session cookie. It expires with the row it points at. */
export function setSessionCookie(cookies: Cookies, token: string, expiresAt: number): void {
  cookies.set(SESSION_COOKIE_NAME, token, {
    path: '/',
    expires: new Date(expiresAt * 1000),
    sameSite: 'lax',
    secure: !dev,
    httpOnly: true,
  });
}

/** Remove the session cookie. Deleting the DB row is a separate, deliberate step. */
export function clearSessionCookie(cookies: Cookies): void {
  cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
}

/** Read the raw token, for the callers that need to act on the session itself. */
export function getSessionToken(cookies: Cookies): string | null {
  return cookies.get(SESSION_COOKIE_NAME) ?? null;
}

/** Resolve the live session behind the cookie, or null. */
export function getSession(cookies: Cookies): ResolvedSession | null {
  try {
    return resolveSession(getSessionToken(cookies));
  } catch (e) {
    log.error('error resolving the session', e);

    return null;
  }
}

function normalizeRole(role: string | null | undefined): string {
  return role === 'admin' || role === 'mitviste' ? role : 'user';
}

/** The logged-in user for `locals.user`, or null. */
export function getSessionUser(cookies: Cookies): SessionUser | null {
  const session = getSession(cookies);
  if (!session) {
    return null;
  }

  const user = session.user;

  return {
    id: user.id_user,
    name: user.name,
    first_name: user.first_name,
    last_name: user.last_name,
    role: normalizeRole(user.role),
    promo: user.promo,
    formation: user.formation,
    locale: user.locale,
  };
}
