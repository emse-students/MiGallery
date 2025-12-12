<script module lang="ts">
    export const imageUrlCache = new Map<string, string>();
    const MAX_CACHE_SIZE = 200;

    function revokeUrl(url: string | undefined) {
        try { if (url) URL.revokeObjectURL(url); } catch (e) {}
    }

    export function getCached(src: string) {
        const v = imageUrlCache.get(src);
        if (!v) return undefined;
        imageUrlCache.delete(src);
        imageUrlCache.set(src, v);
        return v;
    }

    export function setCached(src: string, objectUrl: string) {
        imageUrlCache.set(src, objectUrl);
        while (imageUrlCache.size > MAX_CACHE_SIZE) {
            const firstKey = imageUrlCache.keys().next().value as string | undefined;
            if (!firstKey) break;
            const val = imageUrlCache.get(firstKey);
            imageUrlCache.delete(firstKey);
            revokeUrl(val);
        }
    }

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
        highRes?: string;
        highResDprThreshold?: number;
        alt: string;
        class?: string;
        aspectRatio?: string;
        isVideo?: boolean;
        radius?: string; // Prop pour contrôler le radius du skeleton interne
    }

    let { src, highRes = undefined, highResDprThreshold = 1.25, alt, class: className = '', aspectRatio = '1', isVideo = false, radius = '12px' }: Props = $props();

    let isLoaded = $state(false);
    let isInView = $state(false);
    let hasStartedLoading = $state(false);
    let imgElement: HTMLImageElement | null = $state(null);
    let containerElement: HTMLDivElement | null = $state(null);
    let displaySrc = $state(src);
    let highResLoaded = $state(false);

    onMount(() => {
        if (!containerElement) return;
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting && !isInView) {
                    isInView = true;
                    hasStartedLoading = true;
                    observer.disconnect();
                }
            });
        }, { rootMargin: '200px', threshold: 0.01 });
        observer.observe(containerElement);
        return () => observer.disconnect();
    });

    function handleLoad() {
        requestAnimationFrame(() => { isLoaded = true; });
    }

    $effect(() => {
        if (isInView && hasStartedLoading) {
            // Start by displaying the preview src
            displaySrc = src;
            // If a highRes URL is provided, fetch and swap to it lazily
            if (highRes && !highResLoaded) {
                const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
                if (dpr < (highResDprThreshold || 1)) {
                    // Skip fetching highRes for low-DPR displays to save bandwidth
                    return;
                }
                try {
                    const cachedHigh = getCached(highRes);
                    if (cachedHigh) {
                        displaySrc = cachedHigh;
                        highResLoaded = true;
                    } else {
                        fetch(highRes).then(r => r.ok ? r.blob() : Promise.reject())
                            .then(b => {
                                const url = URL.createObjectURL(b);
                                setCached(highRes, url);
                                displaySrc = url;
                                highResLoaded = true;
                            }).catch(() => {
                                // If highRes fails, fallback to preview src (already set)
                            });
                    }
                } catch (e) {
                    // ignore and keep preview
                }
            } else {
                // No highRes requested: fallback to previous behavior for preview fetching/caching
                try {
                    if (typeof src === 'string' && src.includes('/api/immich') && src.includes('thumbnail')) {
                        const cached = getCached(src);
                        if (cached) {
                            displaySrc = cached;
                        } else {
                            fetch(src).then(r => r.ok ? r.blob() : Promise.reject())
                                .then(b => {
                                    const url = URL.createObjectURL(b);
                                    setCached(src, url);
                                    displaySrc = url;
                                }).catch(() => { displaySrc = src; });
                        }
                    }
                } catch (e) { displaySrc = src; }
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
            <!-- On passe le radius ici pour que le skeleton respecte le style parent -->
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
        /* Animation supprimée pour plus de stabilité */
    }

    /* Mode auto */
    .lazy-image-container.auto-ratio { display: block; }
    .lazy-image-container.auto-ratio .lazy-image { position: relative; width: 100%; height: auto; display: block; }
    .lazy-image-container.auto-ratio .lazy-image-placeholder { position: relative; min-height: 200px; }

    /* Mode fixed aspect-ratio */
    .lazy-image {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        object-fit: cover;
        opacity: 0;
        transition: opacity 0.3s ease;
    }

    .lazy-image.loaded { opacity: 1; }

    .lazy-image-placeholder {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    }

    .video-indicator {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: 48px; height: 48px;
        background: rgba(0, 0, 0, 0.6);
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        color: white; pointer-events: none;
        backdrop-filter: blur(4px);
    }
</style>
