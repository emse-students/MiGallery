<script lang="ts">
	let { aspectRatio = '1.5' }: { aspectRatio?: string | number } = $props();
</script>

<div class="photo-skeleton" style="aspect-ratio: {aspectRatio}">
	<div class="skeleton-shimmer"></div>
	<div class="skeleton-content">
		<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" fill="currentColor" opacity="0.3"/>
		</svg>
	</div>
</div>

<style>
	.photo-skeleton {
		position: relative;
		background: var(--bg-secondary);
		border-radius: 8px;
		overflow: hidden;
		width: 100%;
	}

	.skeleton-shimmer {
		position: absolute;
		top: 0;
		left: -100%;
		width: 100%;
		height: 100%;
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
			left: -100%;
		}
		100% {
			left: 100%;
		}
	}

	.skeleton-content {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.skeleton-content svg {
		color: var(--text-muted);
		opacity: 0.5;
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 0.3;
		}
		50% {
			opacity: 0.6;
		}
	}
</style>
