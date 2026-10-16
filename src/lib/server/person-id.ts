/**
 * The ONE spelling of an Immich person id: a UUID, lowercase. Immich (and Postgres `uuid`) accept
 * any case, SQLite's `=` does not, so an id is normalised before it is stored, compared or
 * journaled - otherwise `ABC...` and `abc...` would be two owners of one person. Kept apart from
 * face-access.ts, which pulls in the request machinery, so the erasure code can use it too.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The normalised person id, or `null` when `id` is not one. */
export function normalisePersonId(id: unknown): string | null {
  if (typeof id !== 'string') {
    return null;
  }
  const trimmed = id.trim();
  return UUID.test(trimmed) ? trimmed.toLowerCase() : null;
}
