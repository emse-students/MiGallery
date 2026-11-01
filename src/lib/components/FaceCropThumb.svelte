<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { RotateCw, ImageOff } from '@lucide/svelte';
  import Skeleton from './Skeleton.svelte';
  import { CropLoadError, sharedCropLoader } from '#lib/face-crop-loader.ts';
  import { m } from '#lib/paraglide/messages.js';

  interface Props {
    assetId: string;
    faceIndex: number;
    alt: string;
  }

  let { assetId, faceIndex, alt }: Props = $props();

  /** idle: not near the viewport yet; loading: queued or asked; failed: shows a retry. */
  let status = $state<'idle' | 'loading' | 'loaded' | 'failed'>('idle');
  /** The picture, as an object URL this tile owns and revokes. */
  let src = $state<string | null>(null);
  /** A missing picture (404) says so; anything else says it could not load. */
  let missing = $state(false);
  let root: HTMLDivElement | undefined = $state();
  let observer: IntersectionObserver | null = null;
  let controller: AbortController | null = null;

  // One face given to the signed-in member, cut server-side around its stored box and served to
  // them alone (/api/users/me/face/crops, lot A6). Fetched through the page's ONE loader, which
  // asks a few at a time (face-crop-loader.ts explains why a plain lazy <img> left tiles empty).
  const url = $derived(
    `/api/users/me/face/crops/${encodeURIComponent(assetId)}/${encodeURIComponent(String(faceIndex))}`
  );

  async function load() {
    controller?.abort();
    controller = new AbortController();
    status = 'loading';
    missing = false;
    try {
      const blob = await sharedCropLoader().load(url, controller.signal);
      if (src) URL.revokeObjectURL(src);
      src = URL.createObjectURL(blob);
      status = 'loaded';
    } catch (e) {
      if (controller.signal.aborted) return;
      missing = e instanceof CropLoadError && e.status === 404;
      console.warn('[face-crop] a face picture did not load', (e as Error).message);
      status = 'failed';
    }
  }

  onMount(() => {
    if (!root || typeof IntersectionObserver === 'undefined') {
      void load();
      return;
    }
    // Asked when the tile comes near the viewport, once.
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer?.disconnect();
          observer = null;
          void load();
        }
      },
      { rootMargin: '400px 0px' }
    );
    observer.observe(root);
  });

  onDestroy(() => {
    observer?.disconnect();
    controller?.abort();
    if (src) URL.revokeObjectURL(src);
  });
</script>

<div class="face-crop" bind:this={root} aria-busy={status === 'loading'}>
  {#if src}
    <img {src} {alt} class="face-img" class:loaded={status === 'loaded'} decoding="async" />
  {/if}
  {#if status === 'idle' || status === 'loading'}
    <div class="face-skeleton">
      <Skeleton aspectRatio="1" radius="0" />
    </div>
  {:else if status === 'failed'}
    <div class="face-failed">
      <ImageOff size={22} aria-hidden="true" />
      <span>{missing ? m.mpc_crop_missing() : m.mpc_crop_failed()}</span>
      <button type="button" class="face-retry" onclick={() => void load()}>
        <RotateCw size={14} aria-hidden="true" />
        {m.mpc_crop_retry()}
      </button>
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

  .face-failed {
    position: absolute;
    inset: 0;
    /* Above a consumer's full-tile button (the profile picker), so the retry stays reachable. */
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.75rem;
    text-align: center;
  }

  .face-retry {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 2rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 0.75rem;
    font-weight: 600;
  }
</style>
