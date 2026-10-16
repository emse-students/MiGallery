import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireSession } from '$lib/server/permissions';
import { isImpersonating } from '$lib/server/auth';
import { revokeAvatarLinks } from '$lib/server/avatar-revocation';
import { logEvent } from '$lib/server/logs';

/**
 * DELETE /api/users/me/avatar-link
 * Revokes every signed avatar link ever issued for the signed-in user (the `?sig=` URLs MiConnect
 * hands to MinoWiki and Archives; see $lib/server/avatar-signature). Session only.
 */
export const DELETE: RequestHandler = async (event) => {
  const user = await requireSession(event);
  // Revocation is irreversible for the member: not in the name of an account only being acted as.
  if (isImpersonating(event)) {
    return json({ error: 'Not allowed while impersonating' }, { status: 403 });
  }
  if (!revokeAvatarLinks(getDatabase(), user.id_user)) {
    return json({ error: 'User not found' }, { status: 404 });
  }
  await logEvent(event, 'update', 'user', user.id_user, { avatarLinksRevoked: true });
  return json({ success: true });
};
