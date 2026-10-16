import { json, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireSession } from '$lib/server/permissions';
import { faceAccessReason } from '$lib/server/face-access';

import { createLogger } from '$lib/server/logger';

const log = createLogger('users-userId-photo-access');
interface UserInfo {
  id_user: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  photos_id: string | null;
  photos_asset_id: string | null;
}

/**
 * GET /api/users/[userId]/photo-access
 * Whether the logged-in user may view the specified user's face-linked photos. The answer comes
 * from `faceAccessReason` (face-access.ts), the same rule every photo route enforces, so what this
 * says and what those routes serve cannot disagree.
 *
 * Returns:
 * - hasAccess: boolean
 * - reason: 'own_photos' | 'admin' | 'granted' | 'not_authorized'
 * - user: { id_user, name, first_name, last_name, photos_id, photos_asset_id } when hasAccess
 */
export const GET: RequestHandler = async (event) => {
  const user = await requireSession(event);
  const targetUserId = (event.params as { userId?: string })?.userId;

  if (!targetUserId) {
    return json({ error: 'userId is required' }, { status: 400 });
  }

  try {
    const reason = faceAccessReason(user, targetUserId);
    if (!reason) {
      return json({ success: true, hasAccess: false, reason: 'not_authorized' });
    }

    const targetUser = getDatabase()
      .prepare(
        'SELECT id_user, name, first_name, last_name, photos_id, photos_asset_id FROM users WHERE id_user = ?'
      )
      .get(targetUserId) as UserInfo | null;

    return json({ success: true, hasAccess: true, reason, user: targetUser });
  } catch (e) {
    if (isHttpError(e)) {
      throw e;
    }
    const err = e as Error;
    log.error('GET /api/users/[userId]/photo-access error', err);
    return json({ error: err.message }, { status: 500 });
  }
};
