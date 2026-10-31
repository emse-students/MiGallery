import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '#lib/db/database.ts';
import { requireScope } from '#lib/server/permissions.ts';
import { isImpersonating } from '#lib/server/auth.ts';
import { revokeAvatarLinks } from '#lib/server/avatar-revocation.ts';
import { logEvent } from '#lib/server/logs.ts';

/**
 * DELETE /api/users/[id]/avatar-link
 * Admin: revokes every signed avatar link ever issued for user `id` (a leaked claim, a departed
 * member). See $lib/server/avatar-signature.
 */
export const DELETE: RequestHandler = async (event) => {
  await requireScope(event, 'admin');
  if (isImpersonating(event)) {
    return json({ error: 'Not allowed while impersonating' }, { status: 403 });
  }
  const targetId = event.params.id;
  if (!targetId || !revokeAvatarLinks(getDatabase(), targetId)) {
    return json({ error: 'User not found' }, { status: 404 });
  }
  await logEvent(event, 'update', 'user', targetId, { avatarLinksRevoked: true });
  return json({ success: true });
};
