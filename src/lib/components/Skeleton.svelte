<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		aspectRatio?: string;
		rounded?: boolean;
		icon?: string; // Name of the icon to display (optional)
		iconSize?: number;
		children?: Snippet;
	}

	const { aspectRatio = '1', rounded = false, icon, iconSize = 32, children }: Props = $props();
</script>

<div
	class="skeleton"
	class:rounded
	style="aspect-ratio: {aspectRatio}"
>
	<div class="skeleton-shimmer"></div>
	{#if icon}
		<div class="skeleton-content">
			<!-- We can't import Icon here easily if we want to avoid circular deps or complex imports if Icon uses something else.
			     But Icon is simple. Let's assume we can import it or just use SVG slot.
			     Actually, passing an icon name implies we import Icon.svelte. -->
			<!-- Using a slot is more flexible for custom SVGs like in AlbumCardSkeleton -->
		</div>
	{/if}
	<div class="skeleton-content">
		{@render children?.()}
	</div>
</div>

<style>
	.skeleton {
		width: 100%;
		background: var(--bg-secondary, rgba(255, 255, 255, 0.05));
		border-radius: 12px;
		overflow: hidden;
		position: relative;
	}

	.skeleton.rounded {
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
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(100%);
		}
	}

	.skeleton-content {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1;
	}

	/* Helper for SVGs inside slot */
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
