<script lang="ts">
    import type { Snippet } from 'svelte';

    interface Props {
        aspectRatio?: string;
        rounded?: boolean;
        radius?: string; 
        class?: string;  // Permettre l'injection de classes (Tailwind ou autre)
        icon?: string;
        iconSize?: number;
        children?: Snippet;
    }

    const {
        aspectRatio = '1',
        rounded = false,
        radius = '12px', 
        class: className = '',
        icon,
        iconSize = 32,
        children
    }: Props = $props();
</script>

<div
    class="skeleton {className}"
    class:rounded-full={rounded}
    style="aspect-ratio: {aspectRatio}; --skeleton-radius: {rounded ? '50%' : radius};"
>
    <div class="skeleton-shimmer"></div>
    {#if icon}
        <div class="skeleton-content">
            <!-- Icon placeholder logic if needed -->
        </div>
    {/if}
    <div class="skeleton-content">
        {@render children?.()}
    </div>
</div>

<style>
    .skeleton {
        width: 100%;
        height: 100%;
        background: var(--bg-secondary, rgba(255, 255, 255, 0.05));
        border-radius: var(--skeleton-radius); /* Utilisation de la variable */
        overflow: hidden;
        position: relative;
    }

    .rounded-full {
        border-radius: 50%;
    }

    .skeleton-shimmer {
        position: absolute;
        inset: 0;
        background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255, 255, 255, 0.05) 50%,
            transparent 100%
        );
        animation: shimmer 2s infinite;
    }

    @keyframes shimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
    }

    .skeleton-content {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1;
    }

    :global(.skeleton-content svg) {
        color: var(--text-muted, rgba(255, 255, 255, 0.3));
        opacity: 0.5;
        animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 0.6; }
    }
</style>
