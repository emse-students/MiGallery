import { m } from '$lib/paraglide/messages';

/**
 * What MiGallery's pages tell a search engine, and what a link to them becomes when pasted.
 *
 * Two audiences, one head:
 *
 * 1. **A crawler, for the PUBLIC surface only.** MiGallery is indexed since 2026-10-04 (decided by
 *    the user, against the default of refusing every crawler for a private gallery), but what may
 *    rank is exactly the pages an anonymous visitor can open: {@link INDEXABLE_PATHS}. That ONE list
 *    drives the robots meta, `robots.txt` and `sitemap.xml`, so the three cannot disagree. Every
 *    other page either redirects an anonymous visitor to the sign-in, or is an UNLISTED album -
 *    reachable without a session, but by definition only by whoever was handed the link - and both
 *    carry `noindex` and sit behind a `Disallow`.
 * 2. **An unfurler, everywhere.** Discord, Slack, WhatsApp and Canari's own link preview fetch the
 *    exact URL somebody pasted and never read `robots.txt`. Sharing an album link is a supported
 *    action, so the card it produces is part of the product, and it must be complete: Open Graph
 *    alone leaves X and the clients that copy its vocabulary rendering a bare link.
 *
 * Every absolute URL - canonical, `og:url`, `og:image`, the sitemap's `<loc>` - is built from the
 * CONFIGURED origin (`ORIGIN`, read by `$lib/server/site-origin`), never a constant: the gallery's
 * final hostname is not decided, and a canonical naming the wrong host hands its ranking away.
 */

/**
 * The pages a search engine may index: those an anonymous visitor can open, and nothing else.
 *
 * An unlisted album is reachable without a session and is deliberately NOT here: "unlisted" means
 * only the people given the link, and a sitemap is a link handed to everybody.
 */
export const INDEXABLE_PATHS = ['/', '/cgu'] as const;

/**
 * Files in `static/` a crawler may fetch while rendering an indexable page. `tests/seo.test.ts`
 * holds this list to the directory, so a new static file cannot silently stay disallowed.
 */
export const CRAWLABLE_STATIC_FILES = [
  '/apple-touch-icon.png',
  '/favicon.ico',
  '/icon-192.png',
  '/logo-512.png',
  '/logo.webp',
  '/manifest.webmanifest',
  '/og-image.jpg',
] as const;

/** Whether a page may be indexed. Exact match: `/cgu/anything` is not the terms page. */
export function isIndexable(pathname: string): boolean {
  return (INDEXABLE_PATHS as readonly string[]).includes(pathname);
}

/** The robots meta for a page, from {@link isIndexable}. */
export function robotsDirective(pathname: string): string {
  return isIndexable(pathname) ? 'index, follow' : 'noindex, nofollow';
}

/**
 * `robots.txt`: an ALLOWLIST. Each public page and the assets it renders with are allowed, and
 * everything else - `/api`, `/admin`, every album and every signed-in page - falls under the final
 * `Disallow: /`. A denylist would publish the next private route the day somebody adds it.
 *
 * Crawlers resolve Allow against Disallow by the LONGEST match, so `Allow: /$` (the home page alone,
 * `$` anchoring the end) wins over `Disallow: /` without opening anything under it.
 */
export function robotsTxt(origin: string): string {
  const allow = [
    ...INDEXABLE_PATHS.map((path) => `${path}$`),
    // The app's JS and CSS: a search engine renders a page before judging it.
    '/_app/',
    ...CRAWLABLE_STATIC_FILES,
    '/sitemap.xml',
  ];
  return [
    '# MiGallery: only the pages reachable without a session may be crawled (docs/wiki/seo.md).',
    'User-agent: *',
    ...allow.map((path) => `Allow: ${path}`),
    'Disallow: /',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** `sitemap.xml`: the indexable pages, and only them - no album, of any visibility, is listed. */
export function sitemapXml(origin: string): string {
  const urls = INDEXABLE_PATHS.map(
    (path) => `  <url><loc>${escapeXml(canonicalUrl(origin, path))}</loc></url>`
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

/** Everything one page contributes to the head. Assembled in a `load`, rendered by the layout. */
export interface SeoMeta {
  /** The card's heading. NOT the `<title>` element - pages own that themselves. */
  title: string;
  /** The sentence the card shows under the title, and the page's meta description. */
  description: string;
  /**
   * Absolute URL of the preview image, or null for the site logo.
   *
   * Null is not only "no cover": the album loader deliberately withholds it for a PRIVATE album,
   * because a preview image is readable by anyone the link reaches.
   */
  image?: string | null;
  /** What the image shows, for a reader who cannot see it. */
  imageAlt?: string;
  /**
   * Pixel size and MIME type of {@link image}, when they are KNOWN.
   *
   * An unfurler that has them lays the card out before the image arrives, so the preview does not
   * reflow. They belong to a specific image, not to the concept of one: the album cover endpoint
   * renders a fixed 1200x630 WebP, the site logo does not, and declaring a size the image does not
   * have is worse than declaring none.
   */
  imageWidth?: number;
  imageHeight?: number;
  imageType?: string;
}

/**
 * The preview image every page without its own falls back to: the logo on a light 1200x630 card,
 * a JPEG because not every unfurler reads WebP. Its size is declared because it is KNOWN - the test
 * reads the file and holds these numbers to it.
 */
export const DEFAULT_IMAGE = {
  path: '/og-image.jpg',
  width: 1200,
  height: 630,
  type: 'image/jpeg',
} as const;

/** Absolute URL of the default preview image, from the configured origin. */
export function defaultImage(origin: string): string {
  return `${origin}${DEFAULT_IMAGE.path}`;
}

/** Absolute URL for a path, from the configured origin. Query and hash are deliberately dropped. */
export function canonicalUrl(origin: string, pathname: string): string {
  return `${origin}${pathname}`;
}

/**
 * The card every page falls back to: the gallery itself.
 *
 * A page contributes its own by returning `seo` from its `load` - the album page (the URL people
 * share) and the terms page (a public page with its own description) do.
 */
export function siteSeo(): SeoMeta {
  return {
    title: 'MiGallery',
    description: m.app_meta_description(),
    image: null,
    imageAlt: m.app_logo_alt(),
  };
}
