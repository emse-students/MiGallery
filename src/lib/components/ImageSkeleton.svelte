<script lang="ts">
	interface Props {
		aspectRatio?: string;
		rounded?: boolean;
	}

	let { aspectRatio = '1', rounded = false }: Props = $props();
</script>

<div 
	class="skeleton" 
	class:rounded
	style="aspect-ratio: {aspectRatio}"
>
	<div class="skeleton-shimmer"></div>
</div>

<style>
	.skeleton {
		width: 100%;
		background: linear-gradient(
			90deg,
			rgba(255, 255, 255, 0.05) 0%,
			rgba(255, 255, 255, 0.1) 50%,
			rgba(255, 255, 255, 0.05) 100%
		);
		border-radius: 8px;
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
			rgba(255, 255, 255, 0.15) 50%,
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
</style>
