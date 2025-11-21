<script lang="ts">
	const { aspectRatio = '1' }: { aspectRatio?: string } = $props();
</script>

<div class="album-skeleton" style="aspect-ratio: {aspectRatio}">
	<div class="skeleton-shimmer"></div>
	<div class="skeleton-content">
		<div class="skeleton-icon">
			<svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
				<path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z" fill="currentColor" opacity="0.3"/>
			</svg>
		</div>
	</div>
</div>

<style>
	.album-skeleton {
		position: relative;
		background: var(--bg-secondary);
		border-radius: 12px;
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

	.skeleton-icon {
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
