<script lang="ts">
  import { page } from '$app/state';
  import { canonicalUrl, defaultImage, type SeoMeta } from '$lib/seo';

  let { meta }: { meta: SeoMeta } = $props();

  // The REQUEST's own origin, never a constant: MiGallery answers on its production hostname and
  // on localhost during development, and an absolute URL built from the wrong one is a preview
  // image no unfurler can fetch.
  const origin = $derived(page.url.origin);
  const canonical = $derived(canonicalUrl(origin, page.url.pathname));
  const image = $derived(meta.image || defaultImage(origin));
</script>

<svelte:head>
  <meta name="description" content={meta.description} />

  <!-- `static/robots.txt` already refuses every crawler, and this says the same thing to the ones
	     that fetch a page before reading it. It is not in tension with the tags below: an unfurler
	     ignores both, which is the entire reason those tags exist. -->
  <meta name="robots" content="noindex, nofollow" />
  <link rel="canonical" href={canonical} />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="MiGallery" />
  <meta property="og:locale" content="fr_FR" />
  <meta property="og:title" content={meta.title} />
  <meta property="og:description" content={meta.description} />
  <meta property="og:url" content={canonical} />
  <meta property="og:image" content={image} />
  {#if meta.imageAlt}
    <meta property="og:image:alt" content={meta.imageAlt} />
  {/if}
  <!-- Only when they describe THIS image. An unfurler that has them lays the card out before the
	     image arrives; one given the wrong ones lays it out wrong. -->
  {#if meta.image && meta.imageWidth && meta.imageHeight}
    <meta property="og:image:width" content={String(meta.imageWidth)} />
    <meta property="og:image:height" content={String(meta.imageHeight)} />
  {/if}
  {#if meta.image && meta.imageType}
    <meta property="og:image:type" content={meta.imageType} />
  {/if}

  <!-- Without an explicit card type, X and the several clients that copy its vocabulary render a
	     bare link rather than falling back to the Open Graph image. -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={meta.title} />
  <meta name="twitter:description" content={meta.description} />
  <meta name="twitter:image" content={image} />
</svelte:head>
