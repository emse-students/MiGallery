import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { completeOIDCFlow } from '#lib/auth.ts';
import { setSessionCookie } from '#lib/session.ts';
import { createSession, deleteExpiredSessions } from '#lib/db/sessions.ts';
import { RETURN_COOKIE_NAME, safeRedirectTarget } from '#lib/auth-redirect.ts';

import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('auth-callback');
export const GET: RequestHandler = async ({ cookies, url }) => {
  // Home unless the login carried a destination - validated again here, since
  // the cookie is as much browser input as the query param that filled it.
  const targetRedirect = safeRedirectTarget(cookies.get(RETURN_COOKIE_NAME)) ?? '/';

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code) {
    log.warn('GET /api/auth/callback: refused 400, missing authorization code');
    throw error(400, 'Missing authorization code');
  }

  if (!state) {
    log.warn('GET /api/auth/callback: refused 400, missing state parameter');
    throw error(400, 'Missing state parameter');
  }

  // Validate state
  const storedState = cookies.get('__oidc_state');
  if (state !== storedState) {
    log.warn('GET /api/auth/callback: refused 400, state mismatch');
    cookies.delete(RETURN_COOKIE_NAME, { path: '/' });
    throw error(400, 'State validation failed');
  }

  let result: Awaited<ReturnType<typeof completeOIDCFlow>>;
  try {
    // Complete OIDC flow
    const callbackUrl = new URL('/api/auth/callback', url.origin);
    result = await completeOIDCFlow(code, callbackUrl.toString());
  } catch (e) {
    log.error('Error during authentication:', e);
    throw error(500, 'Authentication error');
  }

  // The identity provider refused the code (forged, expired, replayed) or could not be reached:
  // the OIDC seam cannot tell the two apart and logs the cause. Either way this visitor is not
  // signed in, which is a 401 and not a server fault. Thrown OUTSIDE the try: it was caught by it
  // and answered 500 on every bad code.
  if (!result) {
    // The CAUSE is logged by the OIDC seam at its own level (a refused code is the client's, an
    // unreachable provider the server's); this line is the answer, and a 401 is the client's.
    log.warn('GET /api/auth/callback: refused 401, the sign-in did not complete');
    throw error(401, 'Authentication failed');
  }

  try {
    // Open a server-side session and hand the browser its token. Login is the
    // one moment we are already writing to `sessions`, so purge the dead rows here.
    deleteExpiredSessions();
    const { token, expiresAt } = createSession(result.dbUser.id_user);
    setSessionCookie(cookies, token, expiresAt);

    // Clear OIDC cookies
    cookies.delete('__oidc_state', { path: '/' });
    cookies.delete('__oidc_nonce', { path: '/' });
    cookies.delete(RETURN_COOKIE_NAME, { path: '/' });
  } catch (e) {
    log.error('Error during authentication:', e);
    throw error(500, 'Authentication error');
  }

  throw redirect(302, targetRedirect);
};
