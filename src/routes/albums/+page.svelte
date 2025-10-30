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
	<title>Albums - MiGallery</title>
	<style>
		* {
			box-sizing: border-box;
		}
	</style>
</svelte:head>

<style>
	main {
		max-width: 1400px;
		margin: 0 auto;
		padding: 20px;
	}

	h1 {
		color: #2c3e50;
		margin-bottom: 30px;
	}

	.loading, .error {
		padding: 20px;
		text-align: center;
		font-size: 1.1em;
		border-radius: 8px;
	}

	.loading {
		color: #3498db;
		background: #ebf5fb;
	}

	.error {
		color: #e74c3c;
		background: #fadbd8;
	}

	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	li {
		margin-bottom: 15px;
	}

	li a {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 20px 25px;
		background: white;
		border-radius: 10px;
		text-decoration: none;
		color: #2c3e50;
		font-size: 1.1em;
		box-shadow: 0 2px 8px rgba(0,0,0,0.1);
		transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
	}

	li a:hover {
		transform: translateY(-3px);
		box-shadow: 0 4px 16px rgba(0,0,0,0.15);
		background: #f8f9fa;
	}

	.album-name {
		font-weight: 500;
	}

	.album-count {
		color: #7f8c8d;
		font-size: 0.9em;
		background: #ecf0f1;
		padding: 5px 12px;
		border-radius: 20px;
	}

	.empty-state {
		text-align: center;
		padding: 60px 20px;
		color: #7f8c8d;
	}

	.empty-state p {
		font-size: 1.2em;
		margin: 20px 0;
	}
</style>

<main>
	<h1>📁 Albums</h1>
	
	{#if error}
		<div class="error">❌ Erreur: {error}</div>
	{/if}
	
	{#if loading}
		<div class="loading">⏳ Chargement des albums...</div>
	{/if}
	
	{#if !loading && !error && albums.length === 0}
		<div class="empty-state">
			<p>Aucun album trouvé</p>
		</div>
	{/if}
	
	{#if albums.length > 0}
		<ul>
			{#each albums as a}
				<li>
					<a href={`/albums/${a.id}`}>
						<span class="album-name">📸 {a.name}</span>
						{#if typeof a.assetCount === "number"}
							<span class="album-count">{a.assetCount} photo{a.assetCount > 1 ? 's' : ''}</span>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</main>
