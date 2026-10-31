import { getDatabase } from '#lib/db/database.ts';

/**
 * The most ids one `GET /api/users/avatar-presence` may carry. Mirrors Canari's own profile batch
 * (`MAX_PROFILE_BATCH`), whose callers this answers: a longer list is refused, never truncated, so
 * a caller can never read a short answer as "the rest have no photo".
 */
export const MAX_AVATAR_PRESENCE_IDS = 100;

/** A `?ids=` value that is not a list this route will answer, said as the reason. */
export class AvatarPresenceRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AvatarPresenceRequestError';
  }
}

/**
 * The distinct, non-empty ids of a comma-separated `?ids=` value.
 *
 * @throws AvatarPresenceRequestError when nothing is named or more than
 *   {@link MAX_AVATAR_PRESENCE_IDS} distinct ids are.
 */
export function parseAvatarPresenceIds(raw: string | null): string[] {
  const ids = [
    ...new Set(
      (raw ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ];
  if (ids.length === 0) throw new AvatarPresenceRequestError('ids is required');
  if (ids.length > MAX_AVATAR_PRESENCE_IDS) {
    throw new AvatarPresenceRequestError(
      `too many ids (${ids.length} > ${MAX_AVATAR_PRESENCE_IDS}) - split the request`
    );
  }
  return ids;
}

/**
 * Which of `ids` have a photo - the same fact `GET /api/users/<id>/avatar` answers with a 404 when
 * it is false (no row, or a row with no `photos_id`), stated for a whole list in one query.
 *
 * WHY IT EXISTS (Canari, Mi 9T, 2026-10-13): a client opening a salon asked the avatar of every
 * member and learned which ones have no photo by being refused - 37 404s in one walk, each a console
 * error line, for a fact this table already holds. Asking first costs one request for the list.
 *
 * What it does not promise: a `photos_id` whose Immich person is gone still 404s on the avatar
 * route. That is rare, and the caller then learns it as before.
 */
export function usersWithPhoto(ids: readonly string[]): string[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = getDatabase()
    .prepare(
      `SELECT id_user FROM users WHERE id_user IN (${placeholders}) AND photos_id IS NOT NULL AND photos_id != ''`
    )
    .all(...ids) as { id_user: string }[];
  return rows.map((row) => row.id_user);
}
