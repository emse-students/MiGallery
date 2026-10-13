import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireScope } from '$lib/server/permissions';
import {
  AvatarPresenceRequestError,
  parseAvatarPresenceIds,
  usersWithPhoto,
} from '$lib/server/avatar-presence';
import { createLogger } from '$lib/server/logger';

const log = createLogger('users-avatar-presence');

/**
 * GET /api/users/avatar-presence?ids=<a>,<b>,<c>
 * Which of the named users have a profile photo, in one request: `{ withPhoto: [...] }`. Every id
 * not listed has none - `/api/users/<id>/avatar` would answer it 404.
 * Requires: authentication (session cookie, auth provider, or API key with 'read' scope), like the
 * avatar route it summarises.
 */
export const GET: RequestHandler = async (event) => {
  await requireScope(event, 'read');
  let ids: string[];
  try {
    ids = parseAvatarPresenceIds(event.url.searchParams.get('ids'));
  } catch (e) {
    if (e instanceof AvatarPresenceRequestError) return json({ error: e.message }, { status: 400 });
    throw e;
  }
  const withPhoto = usersWithPhoto(ids);
  log.debug('avatar presence', { asked: ids.length, withPhoto: withPhoto.length });
  return json({ withPhoto });
};
