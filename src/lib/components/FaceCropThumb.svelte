<script lang="ts">
  import Skeleton from './Skeleton.svelte';

  interface Props {
    assetId: string;
    faceIndex: number;
    alt: string;
  }

  let { assetId, faceIndex, alt }: Props = $props();

  let loaded = $state(false);
  let failed = $state(false);

  // One face given to the signed-in member, cut server-side around its stored box and served to
  // them alone (/api/users/me/face/crops, lot A6), so this only displays the returned square.
  const src = $derived(
    `/api/users/me/face/crops/${encodeURIComponent(assetId)}/${encodeURIComponent(String(faceIndex))}`
  );
</script>

<div class="face-crop">
  {#if !failed}
    <img
      {src}
      {alt}
      class="face-img"
      class:loaded
      loading="lazy"
      decoding="async"
      onload={() => (loaded = true)}
      onerror={() => (failed = true)}
    />
  {/if}
  {#if !loaded}
    <div class="face-skeleton">
      <Skeleton aspectRatio="1" radius="0" />
    </div>
  {/if}
</div>

<style>
  /* Fill the nearest positioned ancestor (the consumer wraps this in a
	   position:relative, aspect-ratio square). */
  .face-crop {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: var(--bg-tertiary);
  }

  .face-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.3s ease;
  }

  .face-img.loaded {
    opacity: 1;
  }

  .face-skeleton {
    position: absolute;
    inset: 0;
  }
</style>
