/**
 * An id that is about to become a segment of an Immich URL. Immich's ids are UUIDs, and only a
 * UUID is ever placed in a path sent with the server's key: anything else is answered 400 here, so
 * no caller-chosen string decides which Immich route the request reaches.
 */
import { error } from '@sveltejs/kit';
import { IMMICH_ID } from '#lib/server/immich-proxy-allowlist.ts';

const PATTERN = new RegExp(`^${IMMICH_ID}$`, 'i');

/** True when `id` has the shape of an Immich id. */
export function isImmichId(id: unknown): id is string {
  return typeof id === 'string' && PATTERN.test(id);
}

/** `id` itself when it is an Immich id; a 400 naming `what` otherwise. */
export function assertImmichId(id: unknown, what: 'album' | 'asset'): string {
  if (!isImmichId(id)) {
    throw error(400, `Invalid ${what} id`);
  }
  return id;
}
