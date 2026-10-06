import { m } from '$lib/paraglide/messages';

/**
 * What a link to MiGallery becomes when somebody pastes it somewhere.
 *
 * **Exactly ONE page is indexable: the home page (user decision, 2026-10-06)** - a presentation of the
 * gallery and a sign-in button, never a photo, an album or a name. {@link isIndexable} is that
 * allowlist of one; `static/robots.txt`, the `robots` meta in `Seo.svelte` and the `X-Robots-Tag` header
 * in `hooks.server.ts` all read it, so the three cannot disagree. Every album stays unindexed:
 * it is photographs of named students.
 *
 * **An unfurler is not a crawler**, and it is a second audience that has not changed. Discord, Slack, WhatsApp and Canari's own link preview fetch
 * the page directly and ignore `robots.txt` entirely - that is the whole reason the album page
 * already carried Open Graph tags. So the head exists for exactly one audience, and it is judged by
 * exactly one question: does a shared album link render as a card, or as a bare URL?
 *
 * Two facts follow:
 *
 * 1. **The tags must be complete for that audience.** Open Graph alone leaves X and the several
 *    clients that copy its vocabulary rendering a bare link, because they want an explicit
 *    `twitter:card` before they will draw one.
 * 2. **Absolute URLs, from the REQUEST's own origin.** `og:image` and `og:url` are resolved by a
 *    machine with no page context; a relative path is silently useless to every one of them.
 */

/** Everything one page contributes to the head. Assembled in a `load`, rendered by the layout. */
export interface SeoMeta {
  /** The card's heading. NOT the `<title>` element - pages own that themselves. */
  title: string;
  /** The sentence the card shows under the title. */
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

/** Absolute URL of the default preview image, from a request origin. */
export function defaultImage(origin: string): string {
  return `${origin}${DEFAULT_IMAGE.path}`;
}

/** Absolute URL for a path, from a request origin. Query and hash are deliberately dropped. */
export function canonicalUrl(origin: string, pathname: string): string {
  return `${origin}${pathname}`;
}

/**
 * The card every page falls back to: the gallery itself.
 *
 * A page contributes its own by returning `seo` from its `load`; the album page is the only one
 * that does, because it is the only URL anybody shares.
 */
export function siteSeo(): SeoMeta {
  return {
    title: 'MiGallery',
    description: m.app_meta_description(),
    image: null,
    imageAlt: m.app_logo_alt(),
  };
}

/** The `X-Robots-Tag` value every response but the home page carries. */
export const NOINDEX_HEADER = 'noindex, nofollow';

/**
 * Whether a path may be indexed: ONLY the home page. An allowlist of one, so a new route is
 * un-indexable until somebody decides otherwise. The album pages are shared as LINKS and unfurled by
 * chat clients, which ignore this entirely - they are not search results and must never become some.
 */
export function isIndexable(pathname: string): boolean {
  return pathname === '/';
}

/**
 * The site as schema.org describes it, for the home page only: what the gallery is and who runs it,
 * from facts the app already states. No photo, no album and no person.
 */
export function siteNode(origin: string): Record<string, unknown> {
  return {
    '@type': 'WebSite',
    '@id': `${origin}/#website`,
    name: 'MiGallery',
    url: `${origin}/`,
    description: m.app_meta_description(),
    inLanguage: 'fr',
    publisher: { '@type': 'Organization', name: 'MiTV' },
  };
}

/**
 * The `<script type="application/ld+json">` element, as a string.
 *
 * `JSON.stringify` leaves `</script>` intact, and inside a script element that sequence ENDS the
 * element, so `<` and `&` become unicode escapes: identical to a JSON parser, inert to the HTML
 * tokenizer. Assembled here and not in a `.svelte` file, where the closing tag needs an escape to stop
 * the Svelte parser ending the block early.
 */
export function jsonLdScript(nodes: Record<string, unknown>[]): string {
  const body = JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes })
    .replace(/</g, '\\u003c')
    .replace(/&/g, '\\u0026');
  return `<script type="application/ld+json">${body}</script>`;
}
