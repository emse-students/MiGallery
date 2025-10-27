<script lang="ts">
	import { onMount } from "svelte";

	let loading = $state(false);
	let error = $state<string | null>(null);
	let albums = $state<{ id: string; name: string; assetCount?: number }[]>([]);

	async function fetchAlbums() {
		loading = true;
		error = null;
		albums = [];
		try {
			const url = `/api/immich/albums`;
			const res = await fetch(url);
			if (!res.ok) {
				const txt = await res.text().catch(() => res.statusText);
				throw new Error(txt || `HTTP ${res.status}`);
			}

			const data = await res.json();
			const list: any[] = Array.isArray(data) ? data : [];
			albums = list
				.map((a: any) => ({
					id: a.id as string | undefined,
					name: String(a.albumName).trim(),
					assetCount: typeof a.assetCount === 'number' ? a.assetCount : undefined,
				}))
				.filter((a) => !!a.id && !!a.name) as { id: string; name: string; assetCount?: number }[];

			albums = albums.filter((a) => (typeof a.assetCount === "number" ? a.assetCount > 0 : true));
			albums.sort((x, y) => y.name.toLowerCase().localeCompare(x.name.toLowerCase()));
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	onMount(fetchAlbums);
</script>

<svelte:head>
	<title>Albums</title>
</svelte:head>

<main>
	<h1>Albums</h1>
	{#if error}<div>Erreur: {error}</div>{/if}
	<ul>
		{#each albums as a}
			<li>
				<a href={`/albums/${a.id}`}>{a.name}</a>{#if typeof a.assetCount === "number"}
					— {a.assetCount}{/if}
			</li>
		{/each}
	</ul>
</main>
