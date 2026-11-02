import type { UserRow } from '#lib/types/api.ts';
import { getSession } from '#lib/session.ts';
import { createLogger } from '#lib/server/logger.ts';
import { newFirstPaint } from '#lib/first-paint.ts';
import { getDatabase } from '#lib/db/database.ts';
import { faceStatus } from '#lib/server/face-photos.ts';
import type { LayoutServerLoad } from './$types';

const log = createLogger('layout');

type SessionPageUser = NonNullable<NonNullable<App.PageData['session']>['user']>;
type SessionRole = NonNullable<SessionPageUser['role']>;

function normalizeRole(role: UserRow['role']): SessionRole {
  return role === 'admin' || role === 'mitviste' || role === 'user' ? role : 'user';
}

function toSessionUser(user: UserRow, faceEnrolled: boolean): SessionPageUser {
  return {
    id_user: user.id_user,
    name: user.name,
    first_name: user.first_name,
    last_name: user.last_name,
    // Whether face matching is on for them (lot A6): enrolled, or holding photos. The Immich
    // person link (`photos_id`) no longer decides anything a page shows.
    face_enrolled: faceEnrolled,
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
 * the hydration agree (see `#lib/first-paint.ts`).
 */
export const load: LayoutServerLoad = (event) => {
  const firstPaint = newFirstPaint();
  try {
    const session = getSession(event.cookies);
    if (!session) {
      return { session: null, firstPaint };
    }

    // The faces waiting for their answer sit in the layout data, so the menu's badge and the
    // "Mes photos" banner read ONE number, and the confirmation screen refreshes both with
    // `invalidate('app:face-status')` after each answer.
    event.depends('app:face-status');
    const face = faceStatus(getDatabase(), session.user.id_user);
    return {
      session: { user: toSessionUser(session.user, face.enrolled) },
      faceToConfirm: face.toConfirm,
      firstPaint,
    };
  } catch (e) {
    log.warn('error while loading the session', e);

    return { session: null, firstPaint };
  }
};
