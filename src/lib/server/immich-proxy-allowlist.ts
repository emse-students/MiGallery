/**
 * What the generic Immich proxy (`src/routes/api/immich/[...path]`) may forward: an ALLOWLIST of
 * methods and paths, the ones MiGallery's own pages use. The proxy speaks to Immich with the
 * server's key, so a path that is not listed here is never forwarded, whoever asks - a new Immich
 * endpoint, or one MiGallery never needed, stays out until it is added on purpose with its test
 * (tests/immich-proxy-allowlist.test.ts).
 *
 * ONE PATH FOR EVERY DECISION. The proxy computes {@link canonicalProxiedPath} once, and that one
 * string is what the public-asset exception, this list, the face rule, the body rule, the audit
 * and the URL sent to Immich all read. A check on one spelling and a request on another is how a
 * dot segment (`%2e%2e`, decoded once by the router and resolved by the URL parser) would walk out
 * of a path that was judged.
 */

import { error } from '@sveltejs/kit';
import { createLogger } from '#lib/server/logger.ts';
import type { AuthResult } from '#lib/server/permissions.ts';
import { uploadedAllOf } from '#lib/server/asset-uploads.ts';

const log = createLogger('immich-proxy-allowlist');

/** An Immich id: the proxy forwards no other shape of id in a path. */
export const IMMICH_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID = IMMICH_ID;

/** One allowed route. `admin`: the caller must also hold the admin scope. */
export interface ProxyRule {
  methods: readonly string[];
  path: RegExp;
  /** Further condition on the query string, when the route is allowed only for one use. */
  query?: (q: URLSearchParams) => boolean;
  admin?: boolean;
}

/** Every route the proxy forwards, each with the page that needs it. */
export const PROXY_ALLOWLIST: readonly ProxyRule[] = [
  // The viewer, the grids, the profile pages: one asset, its picture, its file, its video.
  { methods: ['GET', 'HEAD'], path: new RegExp(`^assets/${UUID}$`) },
  {
    methods: ['GET', 'HEAD'],
    path: new RegExp(`^assets/${UUID}/(thumbnail|original|video/playback)$`),
  },
  // Uploads (simple and chunked), the resume probe of a chunked upload, and bulk deletion (who may
  // delete what is decided by the proxy: assertProxiedDeleteAllowed).
  { methods: ['POST', 'DELETE'], path: /^assets$/ },
  { methods: ['GET'], path: /^assets$/, query: (q) => q.has('chunk-status') },
  // The profile photo picker (its body is held to PROXIED_SEARCH_KEYS by the proxy).
  { methods: ['POST'], path: /^search\/metadata$/ },
  // An album's own record (src/lib/immich/albums.ts).
  { methods: ['GET', 'HEAD'], path: new RegExp(`^albums/${UUID}$`) },
  // The linked person (photos.svelte.ts, the settings and "Mes photos" pages); face-access.ts
  // then holds each to the consent rule.
  { methods: ['GET', 'HEAD'], path: new RegExp(`^people/${UUID}(/thumbnail)?$`) },
  { methods: ['PUT'], path: new RegExp(`^people/${UUID}$`) },
  // The admin trash page.
  { methods: ['GET'], path: /^timeline\/buckets?$/, admin: true },
  { methods: ['POST'], path: /^trash\/restore\/assets$/, admin: true },
];

/** The only keys a proxied `POST search/metadata` body may carry: the profile photo picker's. */
export const PROXIED_SEARCH_KEYS: ReadonlySet<string> = new Set([
  'personIds',
  'type',
  'page',
  'size',
]);

/**
 * The path Immich will actually route for the decoded proxy path `path`, the ONE string every
 * decision of the proxy reads: `.` and `%2e` segments resolved as the URL parser resolves them,
 * case folded and repeated slashes collapsed as Immich's router does. Null - refused - when the
 * path carries a `?` or `#` of its own (decoded from `%3F` / `%23`), a `%` after resolution (a
 * second level of encoding, which no page sends and which the forwarded URL would read
 * differently), or resolves outside `/api/`.
 */
export function canonicalProxiedPath(path: string): string | null {
  if (/[?#]/.test(path)) {
    return null;
  }
  const resolved = new URL(`/api/${path}`, 'http://immich.invalid').pathname.replace(
    /\/{2,}/g,
    '/'
  );
  if (!resolved.startsWith('/api/') || resolved.includes('%')) {
    return null;
  }
  return resolved.slice('/api/'.length).toLowerCase();
}

/**
 * The rule allowing `method` on the CANONICAL path `clean` with `query`, or null when the proxy
 * must refuse it.
 */
export function findProxyRule(
  method: string,
  clean: string,
  query: URLSearchParams
): ProxyRule | null {
  const rule = PROXY_ALLOWLIST.find(
    (r) => r.methods.includes(method) && r.path.test(clean) && (!r.query || r.query(query))
  );
  if (!rule) {
    log.warn('proxied route outside the allowlist refused', { method, path: clean });
    return null;
  }
  return rule;
}

/** The public-asset exception: an anonymous read of one asset's picture, file or video. */
const PUBLIC_ASSET = new RegExp(`^assets/(${UUID})/(thumbnail|original|video/playback)$`);

/** The asset id of a canonical path the public exception may serve, or null. */
export function publicAssetId(clean: string): string | null {
  return PUBLIC_ASSET.exec(clean)?.[1] ?? null;
}

/**
 * Throws 400 unless `body` is what the profile photo picker sends to `POST search/metadata`:
 * only {@link PROXIED_SEARCH_KEYS}, and a non-empty `personIds` (which face-access.ts then holds
 * to the consent rule). A search over the whole library, or with any other condition, has no
 * page that needs it through this proxy.
 */
export function assertProxiedSearchBody(body: unknown): void {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  const extra = record ? Object.keys(record).filter((k) => !PROXIED_SEARCH_KEYS.has(k)) : [];
  const personIds = (record as { personIds?: unknown } | null)?.personIds;
  if (!record || extra.length > 0 || !Array.isArray(personIds) || personIds.length === 0) {
    log.warn('proxied search refused: not the profile photo picker', { keys: extra.length });
    throw error(400, 'Unsupported search');
  }
}

/**
 * Throws unless `auth` may delete every asset of the `DELETE assets` body `body` (`{ ids: [...] }`):
 * an admin or mitviste session, an admin API key, or a member deleting only assets they uploaded
 * themselves (asset-uploads.ts - the settings page's selfie cleanup). Anyone else is refused (403),
 * and a body without ids is a 400.
 */
export function assertProxiedDeleteAllowed(auth: AuthResult, body: unknown): void {
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
    log.warn('proxied asset deletion refused: no ids');
    throw error(400, 'ids required');
  }
  const role = auth.user?.role;
  if (
    (auth.viaApiKey && auth.grantedScope === 'admin') ||
    (!auth.viaApiKey && (role === 'admin' || role === 'mitviste'))
  ) {
    return;
  }
  if (auth.user && uploadedAllOf(ids as string[], auth.user.id_user)) {
    log.debug('member deletes their own uploads', { count: ids.length });
    return;
  }
  log.warn('proxied asset deletion refused', {
    viewer: auth.user?.id_user ?? null,
    count: ids.length,
  });
  throw error(403, 'Not allowed to delete these assets');
}
