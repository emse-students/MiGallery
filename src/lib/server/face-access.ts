/**
 * Who may read a member's face-matched photos, and what the Immich proxy refuses: the ONE
 * server-side rule (lot A6, docs/wiki/face-matching-option-c.md).
 *
 * A member's photos ("every photo in which member X appears") come from face matching, so they are
 * biometric-derived personal data. They are keyed by the OWNER's user id (`face_matches.user_id`)
 * and visible to:
 *
 * - the OWNER;
 * - a member the owner AUTHORISED: a `photo_access_permissions(owner_id, authorized_id)` row;
 * - an ADMIN session (moderation and support, as before);
 * - an API KEY: keys are machine credentials issued by an admin (`/admin/api-keys`), carry no
 *   user, and were already the only external callers of these routes.
 *
 * Immich's people and faces are reachable through NOTHING in the gallery: the generic proxy
 * refuses every person and face call for everyone, admins and API keys included
 * ({@link assertNoProxiedFaceCall}). Lot A8 deletes them from Immich.
 */

import { error, type RequestEvent } from '@sveltejs/kit';
import { getDatabase } from '#lib/db/database.ts';
import { requireScope, type AuthResult } from '#lib/server/permissions.ts';
import { createLogger } from '#lib/server/logger.ts';
import { normalisePersonId } from '#lib/server/person-id.ts';
import { canonicalProxiedPath } from '#lib/server/immich-proxy-allowlist.ts';

const log = createLogger('face-access');

export { normalisePersonId };

/** Why a viewer may read an owner's face-matched photos. `null` = they may not. */
export type FaceAccessReason = 'admin' | 'own_photos' | 'granted';

/** The part of a viewer the rule reads. */
export interface FaceViewer {
  id_user: string;
  role?: string | null;
}

/** The rule itself, without a request: may `viewer` read the face-matched photos of `ownerId`? */
export function faceAccessReason(viewer: FaceViewer, ownerId: string): FaceAccessReason | null {
  if (ownerId === viewer.id_user) {
    return 'own_photos';
  }
  if (viewer.role === 'admin') {
    return 'admin';
  }
  const granted = getDatabase()
    .prepare('SELECT 1 FROM photo_access_permissions WHERE owner_id = ? AND authorized_id = ?')
    .get(ownerId, viewer.id_user);
  return granted ? 'granted' : null;
}

function refuse(auth: AuthResult, what: string): never {
  log.warn('face-matched photos refused', { viewer: auth.user?.id_user ?? null, what });
  throw error(403, 'Not authorised to view these photos');
}

/** Throws 403 unless `auth` may read the photos of member `ownerId`. */
export function assertMemberPhotosAccess(auth: AuthResult, ownerId: string): void {
  if (auth.viaApiKey) {
    log.debug('member photos read with an API key');
    return;
  }
  if (!auth.user || !faceAccessReason(auth.user, ownerId)) {
    refuse(auth, 'member-photos');
  }
}

/** Route guard: authenticate (`read`), then {@link assertMemberPhotosAccess}. */
export async function requireMemberPhotosAccess(
  event: RequestEvent,
  ownerId: string
): Promise<AuthResult> {
  const auth = await requireScope(event, 'read');
  assertMemberPhotosAccess(auth, ownerId);
  return auth;
}

/**
 * Throws 403 unless `auth` manages the PhotoCV album as a whole (every member's CV portrait):
 * `admin`, `mitviste`, or an API key. A member reads their OWN CV portraits through
 * {@link assertMemberPhotosAccess} instead.
 */
export function assertPhotoCvManager(auth: AuthResult, what: string): void {
  if (auth.viaApiKey || auth.user?.role === 'admin' || auth.user?.role === 'mitviste') {
    return;
  }
  refuse(auth, `photocv-album ${what}`);
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

function refuseFaceCall(what: string): never {
  log.warn('proxied person or face call refused', { what });
  throw error(403, 'Person and face data are not available');
}

/** A key that names people, whatever its spelling: `personId`, `personIds[]`, `withPeople`... */
function namesPeople(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith('personid') || lower.startsWith('withpeople');
}

/**
 * The generic Immich proxy forwards any path, so every call that would reach Immich's people or
 * faces is recognised HERE and refused, whoever asks - a member, an admin, an API key, the
 * server's internal key: `people` and everything under it, `faces` and everything under it,
 * `search/person`, and any query key or JSON body key a parser could map to `personId(s)` or
 * `withPeople`, whatever its value. `body` is the parsed JSON body when there is one. A call
 * naming no person passes.
 */
export function assertNoProxiedFaceCall(
  method: string,
  path: string,
  query: URLSearchParams,
  body: unknown
): void {
  // Judge the path Immich will actually route (immich-proxy-allowlist.ts). The path param arrives
  // DECODED, so an encoded `?` or `#` in it would start a query of its own: refused.
  const clean = canonicalProxiedPath(path);
  if (clean === null) {
    log.warn('proxied path carrying a query or fragment refused', { path });
    throw error(400, 'Invalid path');
  }
  if (/^(people|faces|search\/person)(\/|$)/.test(clean)) {
    refuseFaceCall(`${method} ${clean}`);
  }

  for (const key of query.keys()) {
    if (namesPeople(key)) {
      refuseFaceCall(`${clean} query ${key}`);
    }
  }

  // Whatever the value - an id, a list, an empty list, false - the KEY is refused, at ANY depth
  // (Immich v3 nests its search conditions under `filter`): no request that names people has a
  // reason to pass through the gallery.
  const named = bodyKeyNamingPeople(body, 0);
  if (named !== null) {
    refuseFaceCall(`${clean} body ${named}`);
  }
  log.debug('proxied call names no person', { method });
}

/** Deeper than this a JSON body is refused as unjudgeable rather than walked. */
const MAX_BODY_DEPTH = 32;

/** The first key of `value`, at any depth, that names people; `null` when none does. */
function bodyKeyNamingPeople(value: unknown, depth: number): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  if (depth > MAX_BODY_DEPTH) {
    log.warn('proxied JSON body too deep to judge refused', { depth });
    throw error(400, 'Invalid JSON body');
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const named = bodyKeyNamingPeople(item, depth + 1);
      if (named !== null) return named;
    }
    return null;
  }
  for (const [key, inner] of Object.entries(value)) {
    if (namesPeople(key)) return key;
    const named = bodyKeyNamingPeople(inner, depth + 1);
    if (named !== null) return named;
  }
  return null;
}

/** The keys of an Immich answer that carry people or faces, removed by {@link stripFaceFields}. */
const FACE_FIELDS = ['people', 'unassignedFaces'];

/**
 * An answer nested deeper than {@link MAX_BODY_DEPTH}: it cannot be cleaned with certainty, so it
 * is refused rather than forwarded (a `people` key below the cap would otherwise leave untouched).
 */
export class FaceFieldsTooDeepError extends Error {
  constructor(readonly depth: number) {
    super(`proxied answer nested deeper than ${MAX_BODY_DEPTH}`);
    this.name = 'FaceFieldsTooDeepError';
  }
}

/**
 * Remove the people and faces Immich puts inside an answer (`GET /api/assets/:id` carries
 * `people` with their face boxes until lot A8 deletes them), at any depth, in place. Returns how
 * many fields went, for the log. Throws {@link FaceFieldsTooDeepError} past
 * {@link MAX_BODY_DEPTH}, the same bound as the request side: never a silent partial clean.
 */
export function stripFaceFields(value: unknown, depth = 0): number {
  if (!value || typeof value !== 'object') {
    return 0;
  }
  if (depth > MAX_BODY_DEPTH) {
    throw new FaceFieldsTooDeepError(depth);
  }
  let removed = 0;
  if (Array.isArray(value)) {
    for (const item of value) {
      removed += stripFaceFields(item, depth + 1);
    }
    return removed;
  }
  const record = value as Record<string, unknown>;
  for (const field of FACE_FIELDS) {
    if (field in record) {
      delete record[field];
      removed++;
    }
  }
  for (const child of Object.values(record)) {
    removed += stripFaceFields(child, depth + 1);
  }
  return removed;
}

/** What the proxy may do with a request body: nothing to judge, judge it as JSON, or refuse it. */
export type ProxiedBodyKind = 'none' | 'json' | 'upload' | 'refused';

/**
 * Classify the body of a proxied request by its media type, BEFORE anything is forwarded. Immich
 * parses JSON and urlencoded bodies alike, so a body type this proxy cannot judge would carry a
 * search's `personIds` past {@link assertNoProxiedFaceCall}. Only three kinds go through: JSON
 * (judged), the multipart upload of `POST assets`, and an `application/octet-stream` chunk of the
 * chunked upload. Everything else is refused. A body with no content type is not parsed by Immich
 * and is left alone.
 */
export function classifyProxiedBody(
  method: string,
  path: string,
  contentType: string | null,
  isChunk: boolean
): ProxiedBodyKind {
  if (method === 'GET' || method === 'HEAD') {
    return 'none';
  }
  const media = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!media) {
    return 'none';
  }
  if (media === 'application/json' || media.endsWith('+json')) {
    return 'json';
  }
  if (
    media === 'multipart/form-data' &&
    method === 'POST' &&
    path.replace(/^\/+/, '') === 'assets'
  ) {
    return 'upload';
  }
  if (media === 'application/octet-stream' && method === 'POST' && isChunk) {
    return 'upload';
  }
  return 'refused';
}

/**
 * The `photos_id` an ADMIN write (`POST /api/users`, `PUT /api/users/[id]`) may store for
 * `userId`: one spelling (a non-UUID admin value is kept as given, test fixtures use them), and
 * never a person another member already holds. `undefined` means "not in the request" and is
 * returned as `undefined`, so a caller can leave the column alone. Without this an admin write
 * bypassed both the 409 of the member path and, now, the unique index (a 500 with a SQL message).
 */
export function resolveAdminPersonLink(
  raw: unknown,
  userId: string
): { ok: true; personId: string | null | undefined } | { ok: false; reason: 'invalid' | 'taken' } {
  if (raw === undefined) {
    return { ok: true, personId: undefined };
  }
  if (raw === null || raw === '') {
    return { ok: true, personId: null };
  }
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'invalid' };
  }
  const personId = normalisePersonId(raw) ?? raw;
  const holder = getDatabase()
    .prepare('SELECT id_user FROM users WHERE photos_id = ? AND id_user != ?')
    .get(personId, userId) as { id_user: string } | null;
  if (holder) {
    log.warn('admin face link refused: the person belongs to another member', {
      userId,
      personId,
    });
    return { ok: false, reason: 'taken' };
  }
  return { ok: true, personId };
}
