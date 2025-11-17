<script lang="ts">
	import { page } from "$app/state";
	import Icon from "$lib/components/Icon.svelte";
	import Spinner from "$lib/components/Spinner.svelte";

	let assetId = $derived(page.params.id);
	let asset = $state<any | null>(null);
	let mediaUrl = $state<string | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let isVideo = $state(false);

	async function loadAsset(id: string) {
		if (!id) return;
		loading = true;
		error = null;
		asset = null;
		mediaUrl = null;
		isVideo = false;
		try {
			const metaRes = await fetch(`/api/immich/assets/${id}`);
			if (metaRes.ok) {
				asset = await metaRes.json();
				isVideo = asset?.type === 'VIDEO';
			}
			
			if (isVideo) {
				// Pour les vidéos, on stream directement sans télécharger
				mediaUrl = `/api/immich/assets/${id}/video/playback`;
		} else {
			// Pour les images, charger une grande miniature adaptée au viewport
			let size = 'preview';
			try {
				const vw = window.innerWidth || 1024;
				if (vw < 600) size = 'thumbnail';
				else size = 'preview';
			} catch (e) {
				size = 'preview';
			}
			mediaUrl = `/api/immich/assets/${id}/thumbnail?size=${size}`;
		}
	} catch (e) {
		error = (e as Error).message;
	} finally {
		loading = false;
	}
}	$effect(() => {
		if (assetId) loadAsset(assetId);
	});
</script>

<svelte:head>
	<title>{asset?.originalFileName || "Asset"}</title>
</svelte:head>

<main style="padding: 2rem; max-width: 1400px; margin: 0 auto;">
	<nav style="margin-bottom: 1.5rem;">
		<button onclick={() => window.history.back()} style="display: inline-flex; align-items: center; gap: 0.5rem; background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 0.5rem; border-radius: var(--radius-xs);">
			<Icon name="chevron-left" size={16} />
			Retour
		</button>
	</nav>

	{#if loading}
	    <div style="display: flex; align-items: center; justify-content: center; min-height: 400px; gap: 0.75rem; color: var(--text-secondary);">
		    <Spinner size={24} />
		    Chargement...
	    </div>
	{:else if error}
		<div style="display: flex; align-items: center; gap: 0.75rem; padding: 1rem; background: var(--bg-secondary); border-radius: var(--radius); color: var(--error);">
			<Icon name="x-circle" size={20} />
			Erreur: {error}
		</div>
	{:else if mediaUrl}
		<div style="background: var(--bg-secondary); border-radius: var(--radius); padding: 1rem;">
			{#if asset?.originalFileName}
				<h2 style="margin: 0 0 1rem 0; font-size: 1.25rem; color: var(--text-primary);">
					<Icon name={isVideo ? 'image' : 'photo'} size={24} />
					{asset.originalFileName}
				</h2>
			{/if}
			
			{#if isVideo}
				<video
					src={mediaUrl}
					controls
					style="display: block; max-width: 100%; max-height: 80vh; margin: 0 auto; border-radius: var(--radius);"
				>
					<track kind="captions" />
					Votre navigateur ne supporte pas la lecture de vidéos.
				</video>
			{:else}
				<img
					src={mediaUrl}
					alt={asset?.originalFileName || 'Image'}
					style="display: block; max-width: 100%; height: auto; margin: 0 auto; border-radius: var(--radius);"
				/>
			{/if}
		</div>
	{/if}
</main>
