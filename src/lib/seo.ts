import { m } from '$lib/paraglide/messages';

/**
 * What a link to MiGallery becomes when somebody pastes it somewhere.
 *
 * This module has a deliberately narrow job, and the reason is `static/robots.txt`: MiGallery is a
 * private photo gallery and every crawler is refused with `Disallow: /`. That posture is not
 * changing, so there is nothing here for a search engine - no JSON-LD, no sitemap, no keywords.
 * A structured-data graph with no consumer is decoration that reads as effort.
 *
 * **An unfurler is not a crawler.** Discord, Slack, WhatsApp and Canari's own link preview fetch
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

/** Absolute URL of the default preview image, from a request origin. */
export function defaultImage(origin: string): string {
	return `${origin}/MiGallery.png`;
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
		imageAlt: m.app_logo_alt()
	};
}
