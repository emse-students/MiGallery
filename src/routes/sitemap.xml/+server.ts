import type { RequestHandler } from './$types';
import { sitemapXml } from '$lib/seo';
import { siteOrigin } from '$lib/server/site-origin';

/**
 * `sitemap.xml`: the public pages only, answered with a 200 (never a redirect - a crawler drops a
 * sitemap that moves). No album is listed, whatever its visibility (docs/wiki/seo.md).
 */
export const GET: RequestHandler = ({ url }) => {
  return new Response(sitemapXml(siteOrigin(url.origin)), {
    status: 200,
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
