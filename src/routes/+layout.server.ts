import type { UserRow } from '$lib/types/api';
import { getSession } from '$lib/session';
import { createLogger } from '$lib/server/logger';
import { newFirstPaint } from '$lib/first-paint';
import type { LayoutServerLoad } from './$types';

const log = createLogger('layout');

type SessionPageUser = NonNullable<NonNullable<App.PageData['session']>['user']>;
type SessionRole = NonNullable<SessionPageUser['role']>;

function normalizeRole(role: UserRow['role']): SessionRole {
  return role === 'admin' || role === 'mitviste' || role === 'user' ? role : 'user';
}

function toSessionUser(user: UserRow): SessionPageUser {
  return {
    id_user: user.id_user,
    name: user.name,
    first_name: user.first_name,
    last_name: user.last_name,
    photos_id: user.photos_id,
    photos_asset_id: user.photos_asset_id,
    role: normalizeRole(user.role),
    promo: user.promo,
    formation: user.formation,
  };
}

/**
 * Expose the logged-in user to every page. The session already carries the
 * effective user (the impersonated one while an admin impersonates), so there
 * is nothing to resolve here beyond shaping it for the client.
 *
 * `firstPaint` is the ONE draw of chance and clock the page renders from, so the server render and
 * the hydration agree (see `$lib/first-paint`).
 */
export const load: LayoutServerLoad = (event) => {
  const firstPaint = newFirstPaint();
  try {
    const session = getSession(event.cookies);
    if (!session) {
      return { session: null, firstPaint };
    }

    return { session: { user: toSessionUser(session.user) }, firstPaint };
  } catch (e) {
    log.warn('error while loading the session', e);

    return { session: null, firstPaint };
  }
};
