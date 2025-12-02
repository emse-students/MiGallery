<script module lang="ts">
  // Cache partagé en mémoire pour éviter de re-télécharger les mêmes thumbnails
  // clef: src (chemin relatif), valeur: objectURL
  export const imageUrlCache = new Map<string, string>();

  // Taille maximale du cache (nombre d'objectURLs). Ajustez selon mémoire/dispositif.
  const MAX_CACHE_SIZE = 200;

  function revokeUrl(url: string | undefined) {
    try {
      if (url) URL.revokeObjectURL(url);
    } catch (e: unknown) {
      // ignore
    }
  }

  export function getCached(src: string) {
    const v = imageUrlCache.get(src);
    if (!v) return undefined;
    // simple LRU: remettre l'entrée à la fin pour marquer comme récemment utilisée
    imageUrlCache.delete(src);
    imageUrlCache.set(src, v);
    return v;
  }

  export function setCached(src: string, objectUrl: string) {
    imageUrlCache.set(src, objectUrl);
    // si on dépasse la taille, supprimer les plus vieux
    while (imageUrlCache.size > MAX_CACHE_SIZE) {
      const firstKey = imageUrlCache.keys().next().value as string | undefined;
      if (!firstKey) break;
      const val = imageUrlCache.get(firstKey);
      imageUrlCache.delete(firstKey);
      revokeUrl(val);
    }
  }

  // Révoquer tout au déchargement (prévenir fuite mémoire si SPA navigue longuement)
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      for (const v of imageUrlCache.values()) revokeUrl(v);
      imageUrlCache.clear();
    });
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import Skeleton from './Skeleton.svelte';

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
  // Source réellement utilisée par l'<img>. Permet d'utiliser un objectURL cache
  let displaySrc = $state(src);

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

  $effect(() => {
    // Lorsque l'image doit commencer à charger en lazy, utiliser le cache si applicable
    if (isInView && hasStartedLoading) {
      // Par défaut, on affiche directement la source fournie
      displaySrc = src;

      try {
        // Si la source est un thumbnail Immich (proxy local), on va la fetcher en blob
        // et stocker un objectURL dans le cache pour réutilisation.
        if (typeof src === 'string' && src.includes('/api/immich') && src.includes('thumbnail')) {
          const cached = getCached(src);
          if (cached) {
            displaySrc = cached;
          } else {
            // fetch le binaire et créer un objectURL
            fetch(src)
              .then(r => {
                if (!r.ok) throw new Error('fetch error');
                return r.blob();
              })
              .then(b => {
                const url = URL.createObjectURL(b);
                setCached(src, url);
                displaySrc = url;
              })
              .catch(() => {
                // si erreur, retomber sur la source originale
                displaySrc = src;
              });
          }
        } else {
          displaySrc = src;
        }
      } catch (e: unknown) {
        displaySrc = src;
      }
    }
  });
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
      src={displaySrc}
      {alt}
      class="lazy-image"
      class:loaded={isLoaded}
      onload={handleLoad}
      loading="eager"
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
      <Skeleton {aspectRatio} />
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
