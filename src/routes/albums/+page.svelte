<script lang="ts">
	import { page } from '$app/state';

	let loading = $state(false);
	let error = $state<string | null>(null);
	let albums = $state<{ id: string; name: string; visibility?: string; date?: string }[]>([]);

	// Use Svelte runes effect to react to page.data changes
	$effect(() => {
		if (page.data?.albums) {
			albums = (page.data.albums as any[]).map(a => ({ id: a.id, name: a.name, visibility: a.visibility, date: a.date }));
		}
	});

	// helper: group albums by month name
	function monthLabelFor(dateStr?: string) {
		if (!dateStr) return 'Sans date';
		const d = new Date(dateStr);
		if (isNaN(d.getTime())) return 'Sans date';
		return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
	}

	function groupAlbumsByMonth(list: any[]) {
		const out: Record<string, any[]> = {};
		for (const a of list) {
			const key = monthLabelFor((a as any).date);
			if (!out[key]) out[key] = [];
			out[key].push(a);
		}
		return out;
	}

	import { fetchArchive, saveBlobAs } from '$lib/immich/download';

	// Per-album downloading state: only the album being downloaded shows progress
	let downloadingAlbumId = $state<string | null>(null);
	let downloadingProgress = $state<Record<string, number>>({});

	// controller to allow aborting a download when navigating away
	let currentDownloadController: AbortController | null = null;

	async function downloadAlbumAssets(immichId: string, albumName?: string) {
			if (!confirm(`Télécharger toutes les images de l'album "${albumName || immichId}" au format ZIP ?`)) return;
			downloadingAlbumId = immichId;
			downloadingProgress = { ...downloadingProgress, [immichId]: 0 };
			// prepare controller
			if (currentDownloadController) {
				try { currentDownloadController.abort(); } catch (e) {}
				currentDownloadController = null;
			}
			const controller = new AbortController();
			currentDownloadController = controller;
			try {
				const res = await fetch(`/api/immich/albums/${immichId}`);
				if (!res.ok) throw new Error('Erreur récupération assets');
				const data = await res.json();
				const list: any[] = Array.isArray(data?.assets) ? data.assets : [];
				const assetIds = list.map(x => x.id).filter(Boolean);
				if (assetIds.length === 0) return alert('Aucun asset à télécharger');
				const blob = await fetchArchive(assetIds, {
								  onProgress: (p) => {
										// p === -1 means indeterminate (no content-length); otherwise 0..1
										downloadingProgress = { ...downloadingProgress, [immichId]: p };
								  },
								  signal: controller.signal,
				});
				saveBlobAs(blob, `${albumName || immichId}.zip`);
			} catch (e) {
				if ((e as any)?.name === 'AbortError') {
					console.info('Téléchargement annulé');
				} else {
					alert('Erreur lors du téléchargement en ZIP: ' + (e as Error).message);
				}
			} finally {
				const copy = { ...downloadingProgress };
				delete copy[immichId];
				downloadingProgress = copy;
				downloadingAlbumId = null;
				// cleanup controller
				if (currentDownloadController === controller) currentDownloadController = null;
			}
		}

	import { onDestroy } from 'svelte';
	onDestroy(() => {
		if (currentDownloadController) {
			try { currentDownloadController.abort(); } catch (e) {}
			currentDownloadController = null;
		}
	});
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

	/* small spinner used for indeterminate download state */
	.spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255,255,255,0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin-right: 6px;
		vertical-align: middle;
	}

	@keyframes spin { to { transform: rotate(360deg); } }
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
		<!-- Group albums by month/year -->
		{#each Object.entries(groupAlbumsByMonth(albums)) as [month, items]}
			<h3 style="margin-top:18px;color:#556;">{month}</h3>
			<ul>
				{#each items as a}
					<li>
						<div style="display:flex;gap:12px;align-items:center;">
							<a href={`/albums/${a.id}`} style="flex:1;" onclick={(e) => { if (downloadingAlbumId) { e.preventDefault(); } }}>
								<span class="album-name">📸 {a.name}</span>
								{#if a.visibility}
									<span class="album-count">{a.visibility === 'unlisted' ? 'Accès par lien' : a.visibility}</span>
								{/if}
							</a>
														<button onclick={() => downloadAlbumAssets(a.id, a.name)} disabled={downloadingAlbumId === a.id} title="Télécharger toutes les images" style="padding:8px 10px;border-radius:8px;background:#2ecc71;color:white;border:none;cursor:pointer">
															{#if downloadingAlbumId === a.id}
																{#if typeof downloadingProgress[a.id] === 'number' && downloadingProgress[a.id] >= 0}
																	⏳ {Math.round(downloadingProgress[a.id] * 100)}% Téléchargement...
																{:else}
																	<span class="spinner" aria-hidden="true"></span> Téléchargement...
																{/if}
															{:else}
																⬇️ Télécharger
															{/if}
														</button>
						</div>
					</li>
				{/each}
			</ul>
		{/each}
	{/if}
</main>

<!-- single top-level <script> is present above; helper functions and logic are defined there to avoid duplicate scripts -->
