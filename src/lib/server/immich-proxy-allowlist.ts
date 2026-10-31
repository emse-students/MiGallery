/**
 * What the generic Immich proxy (`src/routes/api/immich/[...path]`) may forward: an ALLOWLIST of
 * methods and paths, the ones MiGallery's own pages use. The proxy speaks to Immich with the
 * server's key, so a path that is not listed here is never forwarded, whoever asks - a new Immich
 * endpoint, or one MiGallery never needed, stays out until it is added on purpose with its test
 * (tests/immich-proxy-allowlist.test.ts). No person, face or search route is listed (lot A6):
 * face-access.ts refuses those for everyone on top, and every JSON answer loses its face fields.
 */

import { createLogger } from '#lib/server/logger.ts';

const log = createLogger('immich-proxy-allowlist');

/** An Immich id: the proxy forwards no other shape of id in a path. */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

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
  // Uploads (simple and chunked), the resume probe of a chunked upload, and bulk deletion.
  { methods: ['POST', 'DELETE'], path: /^assets$/ },
  { methods: ['GET'], path: /^assets$/, query: (q) => q.has('chunk-status') },
  // An album's own record (src/lib/immich/albums.ts).
  { methods: ['GET', 'HEAD'], path: new RegExp(`^albums/${UUID}$`) },
  // The admin trash page.
  { methods: ['GET'], path: /^timeline\/buckets?$/, admin: true },
  { methods: ['POST'], path: /^trash\/restore\/assets$/, admin: true },
];

/**
 * The path Immich will actually route for the decoded proxy path `path`: the URL the proxy
 * builds resolves `.` segments, and Immich's router is case-insensitive and tolerant of repeated
 * slashes. Null when the path carries a `?` or `#` of its own (decoded from `%3F` / `%23`), which
 * would start a query or fragment the checks never see.
 */
export function canonicalProxiedPath(path: string): string | null {
  if (/[?#]/.test(path)) {
    return null;
  }
  return new URL(`/api/${path}`, 'http://immich.invalid').pathname
    .replace(/\/{2,}/g, '/')
    .replace(/^\/api\//, '')
    .toLowerCase();
}

/** The rule allowing `method` on `path` with `query`, or null when the proxy must refuse it. */
export function findProxyRule(
  method: string,
  path: string,
  query: URLSearchParams
): ProxyRule | null {
  const clean = canonicalProxiedPath(path);
  if (clean === null) {
    log.warn('proxied path carrying a query or fragment refused', { path });
    return null;
  }
  const rule = PROXY_ALLOWLIST.find(
    (r) => r.methods.includes(method) && r.path.test(clean) && (!r.query || r.query(query))
  );
  if (!rule) {
    log.warn('proxied route outside the allowlist refused', { method, path: clean });
    return null;
  }
  return rule;
}
