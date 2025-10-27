<script lang="ts">
	import { page } from "$app/state";

	let assetId = $derived(page.params.id);
	let asset = $state<any | null>(null);
	let imageUrl = $state<string | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);

	async function loadAsset(id: string) {
		if (!id) return;
		loading = true;
		error = null;
		asset = null;
		imageUrl = null;
		try {
			const metaRes = await fetch(`/api/immich/assets/${id}`);
			if (metaRes.ok) asset = await metaRes.json();
			const imgRes = await fetch(`/api/immich/assets/${id}/original`);
			if (imgRes.ok) {
				const blob = await imgRes.blob();
				imageUrl = URL.createObjectURL(blob);
			}
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (assetId) loadAsset(assetId);
	});
</script>

<svelte:head>
	<title>{asset?.originalFileName || "Asset"}</title>
</svelte:head>

<main>
	{#if loading}
		<div>Chargement...</div>
	{:else if error}
		<div>Erreur: {error}</div>
	{:else if imageUrl}
		<img
			src={imageUrl}
			alt={asset.originalFileName}
			style="display:block;max-width:100%;height:auto;margin:0 auto;"
		/>
	{/if}
</main>
