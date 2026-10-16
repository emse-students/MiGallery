/**
 * Who may read a face-linked photo set: the ONE server-side rule.
 *
 * A face-linked set ("every photo in which person X appears") is built from Immich's face
 * recognition, so it is biometric-derived personal data. It is visible to:
 *
 * - its OWNER: the member whose `users.photos_id` is that Immich person;
 * - a member the owner AUTHORISED: a `photo_access_permissions(owner_id, authorized_id)` row;
 * - an ADMIN session (moderation and support, as before this rule was enforced);
 * - an API KEY: keys are machine credentials issued by an admin (`/admin/api-keys`), carry no
 *   user, and were already the only external callers of these routes.
 *
 * A person that no member has linked (a non-member, or a member who never linked a selfie) has no
 * owner, so only an admin or an API key may read it. The directory of every Immich person is an
 * admin-only listing for the same reason.
 *
 * Every route that serves a face-linked set calls one of the `require*` guards below, so the rule
 * lives here and nowhere else. The UI still asks `/api/users/[userId]/photo-access` first, for
 * its own messages, and that endpoint answers from {@link faceAccessReason} as well.
 */

import { error, type RequestEvent } from '@sveltejs/kit';
import { getDatabase } from '$lib/db/database';
import { requireScope, type AuthResult } from '$lib/server/permissions';
import { createLogger } from '$lib/server/logger';

const log = createLogger('face-access');

/** Why a viewer may read an owner's face-linked photos. `null` = they may not. */
export type FaceAccessReason = 'admin' | 'own_photos' | 'granted';

/** The part of a viewer the rule reads. */
export interface FaceViewer {
  id_user: string;
  role?: string | null;
}

/**
 * The member who owns an Immich person, i.e. whose `photos_id` it is, or `null` when no member
 * has linked it.
 */
export function findPersonOwner(personId: string): string | null {
  const row = getDatabase()
    .prepare('SELECT id_user FROM users WHERE photos_id = ?')
    .get(personId) as {
    id_user: string;
  } | null;
  return row?.id_user ?? null;
}

/**
 * The rule itself, without a request: may `viewer` read the face-linked photos of `ownerId`?
 * `ownerId` null means the person is linked to nobody, which only an admin may read.
 */
export function faceAccessReason(
  viewer: FaceViewer,
  ownerId: string | null
): FaceAccessReason | null {
  if (ownerId && ownerId === viewer.id_user) {
    return 'own_photos';
  }
  if (viewer.role === 'admin') {
    return 'admin';
  }
  if (!ownerId) {
    return null;
  }
  const granted = getDatabase()
    .prepare('SELECT 1 FROM photo_access_permissions WHERE owner_id = ? AND authorized_id = ?')
    .get(ownerId, viewer.id_user);
  return granted ? 'granted' : null;
}

function refuse(auth: AuthResult, what: string, id: string): never {
  log.warn('face-linked photos refused', { viewer: auth.user?.id_user ?? null, what, id });
  throw error(403, 'Not authorised to view these photos');
}

function isAdminOrKey(auth: AuthResult): boolean {
  return auth.viaApiKey || auth.user?.role === 'admin';
}

/** Throws 403 unless `auth` may read the photos of Immich person `personId`. */
export function assertPersonAccess(auth: AuthResult, personId: string): void {
  if (isAdminOrKey(auth)) {
    return;
  }
  if (!auth.user || !faceAccessReason(auth.user, findPersonOwner(personId))) {
    refuse(auth, 'person', personId);
  }
}

/**
 * Throws 403 unless `auth` may CHANGE Immich person `personId` (its name, its featured face): its
 * owner, an admin or an API key - an authorised viewer may look, never edit.
 */
export function assertPersonOwner(auth: AuthResult, personId: string): void {
  if (isAdminOrKey(auth)) {
    return;
  }
  if (!auth.user || findPersonOwner(personId) !== auth.user.id_user) {
    refuse(auth, 'person-edit', personId);
  }
}

/**
 * Throws 403 unless `auth` may read EVERY person or every face at once (the Immich directory, raw
 * face records, a person search): an admin session or an API key.
 */
export function assertFaceAdmin(auth: AuthResult, what: string): void {
  if (!isAdminOrKey(auth)) {
    refuse(auth, 'face-directory', what);
  }
}

/**
 * Throws 403 unless `auth` manages the PhotoCV album as a whole (every member's CV portrait):
 * `admin`, `mitviste`, or an API key. A member reads their OWN CV portraits through
 * {@link assertPersonAccess} instead.
 */
export function assertPhotoCvManager(auth: AuthResult, what: string): void {
  if (auth.viaApiKey || auth.user?.role === 'admin' || auth.user?.role === 'mitviste') {
    return;
  }
  refuse(auth, 'photocv-album', what);
}

/** Route guard: authenticate (`read`), then {@link assertPersonAccess}. */
export async function requirePersonAccess(
  event: RequestEvent,
  personId: string
): Promise<AuthResult> {
  const auth = await requireScope(event, 'read');
  assertPersonAccess(auth, personId);
  return auth;
}

/** Route guard: authenticate, then {@link assertFaceAdmin}. */
export async function requireFaceAdmin(
  event: RequestEvent,
  scope: 'read' | 'write' = 'read'
): Promise<AuthResult> {
  const auth = await requireScope(event, scope);
  assertFaceAdmin(auth, event.url.pathname);
  return auth;
}

/** Route guard: authenticate, then {@link assertPhotoCvManager}. */
export async function requirePhotoCvManager(
  event: RequestEvent,
  scope: 'read' | 'write' = 'read'
): Promise<AuthResult> {
  const auth = await requireScope(event, scope);
  assertPhotoCvManager(auth, event.url.pathname);
  return auth;
}

/**
 * The generic Immich proxy forwards any path, so the face-linked ones are recognised here and
 * held to the same rule as the dedicated routes. `body` is the parsed JSON body of the request
 * when it has one, because a search names its people there. Paths that carry no person pass.
 */
export function assertProxiedFaceAccess(
  auth: AuthResult,
  method: string,
  path: string,
  query: URLSearchParams,
  body: unknown
): void {
  // Judge the path Immich will actually route: the URL the proxy builds resolves `.` segments,
  // and Immich's router is case-insensitive and tolerant of repeated slashes.
  const clean = new URL(`/api/${path}`, 'http://immich.invalid').pathname
    .replace(/\/{2,}/g, '/')
    .replace(/^\/api\//, '')
    .toLowerCase();
  const person = clean.match(/^people\/([^/]+)(\/.*)?$/);
  if (person) {
    const [, personId, rest] = person;
    if (method === 'GET' || method === 'HEAD') {
      assertPersonAccess(auth, personId);
    } else if (method === 'PUT' && !rest) {
      assertPersonOwner(auth, personId);
    } else {
      assertFaceAdmin(auth, clean);
    }
  } else if (/^(people|faces|search\/person)(\/|$)/.test(clean)) {
    assertFaceAdmin(auth, clean);
  }

  for (const key of ['personId', 'personIds']) {
    for (const value of query.getAll(key)) {
      for (const id of value.split(',').filter(Boolean)) {
        assertPersonAccess(auth, id);
      }
    }
  }

  if (body && typeof body === 'object') {
    const { personIds, personId } = body as { personIds?: unknown; personId?: unknown };
    const ids = [...(Array.isArray(personIds) ? personIds : []), ...(personId ? [personId] : [])];
    for (const id of ids) {
      assertPersonAccess(auth, String(id));
    }
  }
}
