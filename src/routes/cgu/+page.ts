import type { PageLoad } from './$types';
import { siteSeo, type SeoMeta } from '$lib/seo';
import { m } from '$lib/paraglide/messages';

/**
 * The terms page's head: the gallery's card with the page's own description. Returned as `seo`
 * rather than written in the page's `<svelte:head>`, because the root layout already writes a
 * description and two `<meta name="description">` is a search engine picking one.
 */
export const load: PageLoad = () => {
  const seo: SeoMeta = {
    ...siteSeo(),
    title: m.cgu_page_title(),
    description: m.cgu_meta_desc(),
  };
  return { seo };
};
