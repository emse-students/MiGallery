<script lang="ts">
	import Skeleton from './Skeleton.svelte';

	interface Props {
		assetId: string;
		personId: string;
		alt?: string;
	}

	let { assetId, personId, alt = 'Face' }: Props = $props();

	let loaded = $state(false);
	let failed = $state(false);

	// Square face crop generated and cached server-side (see /api/faces). The
	// server centers on the person's detected face, so the component only has to
	// display the returned square. "center" forces a plain center crop.
	const src = $derived(`/api/faces/${assetId}/${personId || 'center'}`);
</script>

<div class="face-crop">
	{#if !failed}
		<img
			{src}
			{alt}
			class="face-img"
			class:loaded
			loading="lazy"
			decoding="async"
			onload={() => (loaded = true)}
			onerror={() => (failed = true)}
		/>
	{/if}
	{#if !loaded}
		<div class="face-skeleton">
			<Skeleton aspectRatio="1" radius="0" />
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
</style>
