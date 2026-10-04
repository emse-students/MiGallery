import type { RequestHandler } from './$types';
import { robotsTxt } from '$lib/seo';
import { siteOrigin } from '$lib/server/site-origin';

/**
 * `robots.txt`, rendered rather than static because it names the sitemap by ABSOLUTE URL, and that
 * URL follows `ORIGIN`. The policy itself is `robotsTxt` in `$lib/seo` (docs/wiki/seo.md).
 */
export const GET: RequestHandler = ({ url }) => {
  return new Response(robotsTxt(siteOrigin(url.origin)), {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
