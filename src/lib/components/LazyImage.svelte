<script lang="ts">
  import { onMount } from 'svelte';
  import Skeleton from './Skeleton.svelte';

  interface Props {
    src: string;
    alt: string;
    class?: string;
    aspectRatio?: string;
    isVideo?: boolean;
    radius?: string;
    /** Called when the image itself fails to load, so the caller can show its own fallback. */
    onError?: () => void;
  }

  let {
    src,
    alt,
    class: className = '',
    aspectRatio = '1',
    isVideo = false,
    radius = '12px',
    onError = undefined,
  }: Props = $props();

  let isLoaded = $state(false);
  let isInView = $state(false);
  let hasStartedLoading = $state(false);
  let imgElement: HTMLImageElement | null = $state(null);
  let containerElement: HTMLDivElement | null = $state(null);

  onMount(() => {
    if (!containerElement) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !isInView) {
            isInView = true;
            hasStartedLoading = true;
            observer.disconnect();
          }
        });
      },
      { rootMargin: '200px', threshold: 0.01 }
    );
    observer.observe(containerElement);
    return () => observer.disconnect();
  });

  function handleLoad() {
    requestAnimationFrame(() => {
      isLoaded = true;
    });
  }
</script>

<div
  bind:this={containerElement}
  class="lazy-image-container {className}"
  class:auto-ratio={aspectRatio === 'auto'}
  class:loaded={isLoaded}
  style={aspectRatio !== 'auto' ? `aspect-ratio: ${aspectRatio}` : ''}
>
  {#if isInView}
    <img
      bind:this={imgElement}
      {src}
      {alt}
      class="lazy-image"
      class:loaded={isLoaded}
      onload={handleLoad}
      onerror={() => onError?.()}
      loading="eager"
      decoding="async"
    />
    {#if isVideo}
      <div class="video-indicator">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      </div>
    {/if}
  {/if}

  {#if !isLoaded && hasStartedLoading}
    <div class="lazy-image-placeholder">
      <!-- Pass the radius here so the skeleton matches the parent style -->
      <Skeleton {aspectRatio} {radius} />
    </div>
  {/if}
</div>

<style>
  .lazy-image-container {
    position: relative;
    width: 100%;
    background: var(--bg-tertiary);
    overflow: hidden;
    /* Animation removed for stability */
  }

  /* Mode auto */
  .lazy-image-container.auto-ratio {
    display: block;
  }
  .lazy-image-container.auto-ratio .lazy-image {
    position: relative;
    width: 100%;
    height: auto;
    display: block;
  }
  .lazy-image-container.auto-ratio .lazy-image-placeholder {
    position: relative;
    min-height: 200px;
  }

  /* Mode fixed aspect-ratio */
  .lazy-image {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.3s ease;
  }

  .lazy-image.loaded {
    opacity: 1;
  }

  .lazy-image-placeholder {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .video-indicator {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 48px;
    height: 48px;
    background: rgba(0, 0, 0, 0.6);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    pointer-events: none;
  }
</style>
