<script lang="ts">
  import { onMount } from 'svelte';
  import ImageSkeleton from './ImageSkeleton.svelte';

  interface Props {
    src: string;
    alt: string;
    class?: string;
    aspectRatio?: string;
    isVideo?: boolean;
  }

  let { src, alt, class: className = '', aspectRatio = '1', isVideo = false }: Props = $props();

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
      {
        rootMargin: '200px',
        threshold: 0.01
      }
    );

    observer.observe(containerElement);

    return () => observer.disconnect();
  });

  function handleLoad() {
    // Wait a tiny bit to ensure the image is fully rendered
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
      src={src}
      {alt}
      class="lazy-image"
      class:loaded={isLoaded}
      onload={handleLoad}
      loading="lazy"
      decoding="async"
    />
    {#if isVideo}
      <div class="video-indicator">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      </div>
    {/if}
  {/if}
  {#if !isLoaded && hasStartedLoading}
    <div class="lazy-image-placeholder">
      <ImageSkeleton {aspectRatio} />
    </div>
  {/if}
</div>

<style>
  .lazy-image-container {
    position: relative;
    width: 100%;
    background: var(--bg-tertiary);
    overflow: hidden;
    opacity: 0;
    animation: fadeInUp 0.4s ease-out forwards;
  }

  @keyframes fadeInUp {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .lazy-image-container.loaded {
    animation: none;
    opacity: 1;
  }

  /* Mode auto: l'image dicte la hauteur */
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

  /* Mode avec aspect-ratio fixe */
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
    backdrop-filter: blur(4px);
  }

  .video-indicator svg {
    margin-left: 2px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
