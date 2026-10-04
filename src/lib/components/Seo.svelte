<script lang="ts">
  import { page } from '$app/state';
  import {
    canonicalUrl,
    DEFAULT_IMAGE,
    defaultImage,
    robotsDirective,
    type SeoMeta,
  } from '$lib/seo';

  let { meta }: { meta: SeoMeta } = $props();

  // The CONFIGURED origin (`ORIGIN`, via the root layout), never a constant and never the host a
  // request happened to reach: the canonical must name the gallery's one public hostname, whichever
  // name it ends up with.
  const origin = $derived(page.data.siteOrigin);
  const canonical = $derived(canonicalUrl(origin, page.url.pathname));
  const robots = $derived(robotsDirective(page.url.pathname));
  const image = $derived(meta.image || defaultImage(origin));
  // Declared only for an image whose size is known: the page's own, or the default card.
  const size = $derived(
    meta.image
      ? meta.imageWidth && meta.imageHeight
        ? { width: meta.imageWidth, height: meta.imageHeight, type: meta.imageType }
        : meta.imageType
          ? { type: meta.imageType }
          : null
      : DEFAULT_IMAGE
  );
</script>

<svelte:head>
  <meta name="description" content={meta.description} />

  <!-- `index` on the public pages only (`INDEXABLE_PATHS`, the same list robots.txt and the sitemap
	     read); every other page says `noindex`. Not in tension with the card below: an unfurler
	     ignores both robots.txt and this, which is the entire reason the card exists. -->
  <meta name="robots" content={robots} />
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
  {#if size && 'width' in size && size.width && size.height}
    <meta property="og:image:width" content={String(size.width)} />
    <meta property="og:image:height" content={String(size.height)} />
  {/if}
  {#if size?.type}
    <meta property="og:image:type" content={size.type} />
  {/if}

  <!-- Without an explicit card type, X and the several clients that copy its vocabulary render a
	     bare link rather than falling back to the Open Graph image. -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={meta.title} />
  <meta name="twitter:description" content={meta.description} />
  <meta name="twitter:image" content={image} />
</svelte:head>
