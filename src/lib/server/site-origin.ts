import { env } from '$env/dynamic/private';
import { createLogger } from '$lib/server/logger';

const log = createLogger('site-origin');

let warnedUnset = false;

/**
 * Turn a configured origin into the exact form every absolute URL is built from: scheme, host and
 * port, no path, no trailing slash. Null for anything that is not an http(s) URL.
 */
export function normalizeOrigin(raw: string | undefined): string | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The gallery's public origin: `ORIGIN`, the variable adapter-node already reads for the same fact
 * (`docker-compose.prod.yml`, `docs/wiki/deployment.md`). The canonical links, `og:url`,
 * `og:image`, `robots.txt` and `sitemap.xml` are all built from it, so moving the gallery to its
 * final hostname is one variable, not a code change.
 *
 * The request origin is used only when `ORIGIN` is unset or unparseable - `vite dev` without a
 * `.env` - and that is logged, once, because in production it means every canonical names
 * whatever host the request happened to reach.
 */
export function siteOrigin(requestOrigin: string): string {
  const configured = normalizeOrigin(env.ORIGIN);
  if (configured) {
    return configured;
  }
  if (!warnedUnset) {
    warnedUnset = true;
    log.warn('ORIGIN is unset or not an http(s) URL: canonical URLs use the request origin', {
      origin: env.ORIGIN,
      requestOrigin,
    });
  }
  return requestOrigin;
}
