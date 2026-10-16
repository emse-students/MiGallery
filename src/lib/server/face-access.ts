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
import { normalisePersonId } from '$lib/server/person-id';
import { env } from '$env/dynamic/private';
import { OUTBOUND_BUDGET_MS } from '$lib/server/outbound';

const log = createLogger('face-access');

export { normalisePersonId };

/** Why a viewer may read an owner's face-linked photos. `null` = they may not. */
export type FaceAccessReason = 'admin' | 'own_photos' | 'granted';

/** The part of a viewer the rule reads. */
export interface FaceViewer {
  id_user: string;
  role?: string | null;
}

/**
 * The member who owns an Immich person, i.e. whose `photos_id` it is, or `null` when no member
 * has linked it (or the id is not a person id at all).
 */
export function findPersonOwner(personId: string): string | null {
  const id = normalisePersonId(personId);
  if (!id) {
    return null;
  }
  const row = getDatabase().prepare('SELECT id_user FROM users WHERE photos_id = ?').get(id) as {
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
  // The path param arrives DECODED, so an encoded `?` or `#` in it would start a query (or a
  // fragment) of its own in the URL the proxy builds - one this check would never see.
  if (/[?#]/.test(path)) {
    log.warn('proxied path carrying a query or fragment refused', { path });
    throw error(400, 'Invalid path');
  }
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
    } else if ((method === 'PUT' || method === 'PATCH') && !rest) {
      assertPersonOwner(auth, personId);
    } else {
      assertFaceAdmin(auth, clean);
    }
  } else if (/^(people|faces|search\/person)(\/|$)/.test(clean)) {
    assertFaceAdmin(auth, clean);
  }

  // Every spelling of the key a query parser could map to personId(s): `personIds[]`, `PersonId`...
  for (const [key, value] of query) {
    if (key.toLowerCase() === 'withpeople') {
      assertFaceAdmin(auth, `${clean} withPeople`);
    }
    if (key.toLowerCase().startsWith('personid')) {
      for (const id of value.split(',').filter(Boolean)) {
        assertPersonAccess(auth, id);
      }
    }
  }

  if (body && typeof body === 'object') {
    const { personIds, personId, withPeople } = body as {
      personIds?: unknown;
      personId?: unknown;
      withPeople?: unknown;
    };
    // Whatever shape the value has - an array, one id, a comma list - every id in it is checked;
    // whether Immich would accept that shape is not this check's to assume.
    const asIds = (v: unknown): unknown[] =>
      Array.isArray(v) ? v : typeof v === 'string' ? v.split(',').filter(Boolean) : v ? [v] : [];
    const ids = [...asIds(personIds), ...asIds(personId)];
    for (const id of ids) {
      assertPersonAccess(auth, String(id));
    }
    // A search asked to list the people in EVERY result would hand back the whole face graph,
    // from which any person's set can be rebuilt.
    if (withPeople) {
      assertFaceAdmin(auth, `${clean} withPeople`);
    }
  }
}

/** How fresh the selfie must be: the detection flow links within about a minute of uploading. */
export const SELFIE_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Whether Immich asset `assetId` passes the selfie checks for `personId` (a speed bump, NOT proof
 * that the face is the caller's - see docs/wiki/photos-cv.md): uploaded by `callerId`
 * through this proxy as a new file (not a duplicate), within
 * {@link SELFIE_MAX_AGE_MS}, and showing exactly one person, that one. Read server-side from
 * Immich, so the client cannot assert it.
 */
export async function selfieProves(
  fetchFn: typeof fetch,
  assetId: unknown,
  personId: string,
  callerId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (typeof assetId !== 'string' || !/^[0-9a-f-]{36}$/i.test(assetId)) {
    return { ok: false, reason: 'no selfie asset' };
  }
  // The caller must have uploaded it THEMSELVES, as a new file: every upload reaches Immich with
  // the one shared key, so only the proxy's own audit row (`import`, written by
  // finishImmichUpload with the uploader as actor) ties an asset to a member.
  const uploaded = getDatabase()
    .prepare(
      "SELECT details FROM logs WHERE event_type = 'import' AND target_type = 'asset' AND target_id = ? AND actor = ? ORDER BY id DESC"
    )
    .get(assetId, callerId) as { details: string | null } | null;
  if (!uploaded) {
    return { ok: false, reason: 'selfie not uploaded by the caller' };
  }
  if (uploaded.details && (JSON.parse(uploaded.details) as { duplicate?: boolean }).duplicate) {
    return { ok: false, reason: 'selfie is a duplicate of an existing asset' };
  }
  const base = env.IMMICH_BASE_URL?.replace(/\/$/, '');
  if (!base) {
    return { ok: false, reason: 'IMMICH_BASE_URL not configured' };
  }
  const res = await fetchFn(`${base}/api/assets/${assetId}`, {
    signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS),
    headers: { 'x-api-key': env.IMMICH_API_KEY ?? '', Accept: 'application/json' },
  });
  if (!res.ok) {
    return { ok: false, reason: `asset lookup ${res.status}` };
  }
  const asset = (await res.json()) as { createdAt?: string; people?: Array<{ id?: string }> };
  const age = Date.now() - Date.parse(asset.createdAt ?? '');
  if (!(age >= -60_000 && age <= SELFIE_MAX_AGE_MS)) {
    return { ok: false, reason: 'selfie not freshly uploaded' };
  }
  const people = asset.people ?? [];
  if (people.length !== 1 || normalisePersonId(people[0].id) !== personId) {
    return { ok: false, reason: 'selfie does not show exactly that person' };
  }
  return { ok: true };
}

/** What the proxy may do with a request body: nothing to judge, judge it as JSON, or refuse it. */
export type ProxiedBodyKind = 'none' | 'json' | 'upload' | 'refused';

/**
 * Classify the body of a proxied request by its media type, BEFORE anything is forwarded. Immich
 * parses JSON and urlencoded bodies alike, so a body type this proxy cannot judge would carry a
 * search's `personIds` past {@link assertProxiedFaceAccess}. Only three kinds go through: JSON
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
