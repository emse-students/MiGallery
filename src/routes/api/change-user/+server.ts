import { json } from '@sveltejs/kit';

import { ensureError } from '#lib/ts-utils.ts';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '#lib/db/database.ts';
import { canStopImpersonating, getRequestSession } from '#lib/server/auth.ts';
import { isAdminRole } from '#lib/roles.ts';
import { getSessionToken } from '#lib/session.ts';
import { setSessionImpersonation } from '#lib/db/sessions.ts';

import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('change-user');

/**
 * Whether the request is one this site's own page sent: its `Origin` is exactly this site's (a
 * missing one is refused, not assumed), and its body is declared JSON. Stricter than the global
 * check in `hooks.server.ts`, which lets a missing `Origin` and the partner origins through: an
 * impersonation is only ever started or stopped from MiGallery's own pages.
 */
function isOwnPageRequest(request: Request, url: URL): boolean {
  const contentType = request.headers.get('content-type') ?? '';
  return (
    request.headers.get('origin') === url.origin &&
    contentType.split(';')[0].trim().toLowerCase() === 'application/json'
  );
}

/**
 * Start or stop impersonating, on the caller's own session.
 * Body: `{ userId }` to impersonate, `{ userId: null }` to stop.
 *
 * A session-only action: an API key is refused outright, whatever else the request carries, so a
 * key's scope can never stand in for the session's own account. Both halves are judged on the
 * session's REAL account.
 */
export const POST: RequestHandler = async (event) => {
  const { request, cookies, locals, url } = event;

  if (request.headers.has('x-api-key')) {
    log.warn('refused: an API key cannot impersonate');
    return json({ success: false, error: 'Session only' }, { status: 403 });
  }
  if (!isOwnPageRequest(request, url)) {
    log.warn('refused: not a JSON request from this site', {
      origin: request.headers.get('origin'),
    });
    return json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const token = getSessionToken(cookies);
  const session = getRequestSession({ locals, cookies });
  if (!token || !session) {
    return json({ success: false, error: 'No session' }, { status: 401 });
  }

  try {
    const { userId } = (await request.json()) as { userId: string | null | undefined };

    // Stopping is judged on the REAL account, which is still the admin that started it.
    if (userId === null || userId === undefined) {
      if (!canStopImpersonating({ locals, cookies })) {
        return json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
      setSessionImpersonation(token, null);

      return json({ success: true });
    }

    // Starting one requires the REAL account to be an admin, and no impersonation already running:
    // switching goes through a stop, so each start is judged on the admin's own account.
    if (!isAdminRole(session.realUser.role)) {
      log.warn('non-admin session tried to start an impersonation', {
        id: session.realUser.id_user,
      });
      return json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    if (session.impersonating) {
      log.debug('refused: already impersonating');
      return json({ success: false, error: 'Already impersonating' }, { status: 409 });
    }

    // Refuse a target that does not exist: storing it would leave the session
    // pointing at nothing, which only surfaces later as a cleared impersonation.
    const target = getDatabase()
      .prepare('SELECT id_user FROM users WHERE id_user = ? LIMIT 1')
      .get(String(userId));
    if (!target) {
      return json({ success: false, error: 'User not found' }, { status: 404 });
    }

    setSessionImpersonation(token, String(userId));
    log.info('impersonation started', { by: session.realUser.id_user });

    return json({ success: true });
  } catch (error: unknown) {
    const err = ensureError(error);
    log.error('Error changing user:', err);
    return json({ success: false, error: err.message }, { status: 500 });
  }
};
