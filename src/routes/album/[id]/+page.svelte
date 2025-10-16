<script lang="ts">
	import { page } from "$app/state";

	let loading = $state(false);
	let error = $state<string | null>(null);
	let title = $state("");
	type Asset = { id: string; originalFileName?: string };
	let assets = $state<Asset[]>([]);

	async function fetchAlbum(id: string) {
		loading = true;
		error = null;
		title = "";
		assets = [];
		try {
			const res = await fetch(`/api/immich/albums/${id}`);
			const data = await res.json();
			title = data.albumName;
			const list: any[] = Array.isArray(data?.assets) ? data.assets : [];

			assets = list
				.map((a: any) => ({ id: a.id as string, originalFileName: String(a.originalFileName) }))
				.filter((a) => !!a.id);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const id = page.params.id as string | undefined;
		if (id) fetchAlbum(id);
	});
</script>

<svelte:head>
	<title>{title || "Album"}</title>
</svelte:head>

<main>
	<h1>{title}</h1>
	{#if error}<div>Erreur: {error}</div>{/if}
	{#if loading}<div>Chargement…</div>{/if}
	<div>
		{#each assets as a}
			<div>
				<img
					alt={a.originalFileName ?? "thumb"}
					src={`/api/immich/assets/${a.id}/thumbnail?size=thumbnail&t=${Date.now()}`}
				/>
				<div>{a.originalFileName}</div>
			</div>
		{/each}
	</div>
</main>
