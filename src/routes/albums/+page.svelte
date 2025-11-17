<script lang="ts">
	import { page } from '$app/stores';
	import Icon from '$lib/components/Icon.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import LazyImage from '$lib/components/LazyImage.svelte';
	import CreateAlbumModal from '$lib/components/CreateAlbumModal.svelte';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';

	// Marquer comme en cours de chargement jusqu'à réception des données
	let loading = $state(true);
	let loadingCovers = $state(false);
	let error = $state<string | null>(null);
	let albums = $state<{ id: string; name: string; visibility?: string; date?: string }[]>([]);
	let showCreateAlbumModal = $state(false);

	// État du modal de confirmation
	let showConfirmModal = $state(false);
	let confirmModalConfig = $state<{
		title: string;
		message: string;
		confirmText?: string;
		onConfirm: () => void;
	} | null>(null);

	// Vérifier le rôle de l'utilisateur
	let userRole = $derived(($page.data.session?.user as any)?.role || 'user');
	let canCreateAlbum = $derived(userRole === 'mitviste' || userRole === 'admin');

	$effect(() => {
		// Lorsque la page fournie par le load server est prête, on met à jour la liste
		if (typeof $page.data !== 'undefined') {
			if ($page.data?.albums) {
				albums = ($page.data.albums as any[]).map(a => ({ id: a.id, name: a.name, visibility: a.visibility, date: a.date }));
			} else {
				albums = [];
			}
			loading = false;
		}
	});

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

	let downloadingAlbumId = $state<string | null>(null);
	let downloadingProgress = $state<Record<string, number>>({});
	let albumCovers = $state<Record<string, { id: string; type?: string }>>({});
	let currentDownloadController: AbortController | null = null;

	$effect(() => {
		if (albums.length > 0) {
			loadingCovers = true;
			(async () => {
				try {
					// Utiliser le nouvel endpoint optimisé pour les covers
					const albumIds = albums.map(a => a.id);
					const res = await fetch('/api/albums/covers', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ albumIds })
					});
					
					if (res.ok) {
						const covers = await res.json();
						const mapped: Record<string, { id: string; type?: string }> = {};
						
						for (const [albumId, cover] of Object.entries(covers)) {
							if (cover && typeof cover === 'object' && 'assetId' in cover) {
								mapped[albumId] = {
									id: (cover as any).assetId,
									type: (cover as any).type
								};
							}
						}
						
						albumCovers = { ...albumCovers, ...mapped };
					}
				} catch (e) {
					console.warn('Error loading album covers', e);
				} finally {
					loadingCovers = false;
				}
			})();
		}
	});

	function getVisibilityIcon(visibility?: string): string {
		if (!visibility || visibility === 'private') return 'lock';
		if (visibility === 'unlisted') return 'link';
		if (visibility === 'authenticated') return 'eye';
		return 'eye';
	}

	function getVisibilityLabel(visibility?: string): string {
		if (!visibility || visibility === 'private') return 'Privé';
		if (visibility === 'unlisted') return 'Accès par lien';
		if (visibility === 'authenticated') return 'Authentifié';
		return visibility;
	}

	async function downloadAlbumAssets(immichId: string, albumName?: string) {
		if (!confirm(`Télécharger toutes les images de l'album "${albumName || immichId}" au format ZIP ?`)) return;
		downloadingAlbumId = immichId;
		downloadingProgress = { ...downloadingProgress, [immichId]: 0 };
		
		if (currentDownloadController) {
			try { currentDownloadController.abort(); } catch (e) {}
			currentDownloadController = null;
		}
		const controller = new AbortController();
		currentDownloadController = controller;
		try {
			const res = await fetch(`/api/albums/${immichId}`);
			if (!res.ok) throw new Error('Erreur récupération assets');
			const data = await res.json();
			const list: any[] = Array.isArray(data?.assets) ? data.assets : [];
			const assetIds = list.map(x => x.id).filter(Boolean);
			if (assetIds.length === 0) return alert('Aucun asset à télécharger');
			const blob = await fetchArchive(assetIds, {
				onProgress: (p) => {
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
			if (currentDownloadController === controller) currentDownloadController = null;
		}
	}

	async function deleteAlbum(immichId: string, albumName?: string) {
		confirmModalConfig = {
			title: 'Supprimer l\'album',
			message: `Voulez-vous vraiment supprimer l'album "${albumName || immichId}" ?\n\nCette action supprimera l'album d'Immich et de la base de données locale.`,
			confirmText: 'Supprimer',
			onConfirm: async () => {
				showConfirmModal = false;
				try {
					// Supprimer via le nouvel endpoint optimisé
					const res = await fetch(`/api/albums/${immichId}`, {
						method: 'DELETE'
					});

					if (!res.ok) {
						const errText = await res.text().catch(() => res.statusText);
						throw new Error(errText || 'Erreur lors de la suppression de l\'album');
					}

					// Supprimer de la BDD locale
					await fetch('/api/db', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							sql: 'DELETE FROM albums WHERE id = ?',
							params: [immichId]
						})
					});

					// Rafraîchir la liste
					albums = albums.filter(a => a.id !== immichId);
				} catch (e) {
					alert('Erreur lors de la suppression: ' + (e as Error).message);
				}
			}
		};
		showConfirmModal = true;
	}	import { onDestroy } from 'svelte';
	onDestroy(() => {
		if (currentDownloadController) {
			try { currentDownloadController.abort(); } catch (e) {}
			currentDownloadController = null;
		}
	});

	async function handleAlbumCreated() {
		// Recharger la page pour afficher le nouvel album
		window.location.reload();
	}
</script>

<svelte:head>
	<title>Albums - MiGallery</title>
</svelte:head>

<main class="albums-main">
	<div class="page-background">
		<div class="gradient-blob blob-1"></div>
		<div class="gradient-blob blob-2"></div>
		<div class="gradient-blob blob-3"></div>
	</div>
	
	<div class="header-with-actions">
		<h1><Icon name="folder" size={28} /> Albums</h1>
		{#if canCreateAlbum}
			<button class="btn-create-album" onclick={() => showCreateAlbumModal = true}>
				<Icon name="plus" size={20} />
				<span>Créer un album</span>
			</button>
		{/if}
	</div>
	
	{#if error}
		<div class="error"><Icon name="x-circle" size={20} /> Erreur: {error}</div>
	{/if}
	
	{#if loading || loadingCovers}
		<div class="loading"><Spinner size={20} /> Chargement des albums...</div>
	{/if}
	
	{#if !loading && !error && albums.length === 0}
		<div class="empty-state">
			<p>Aucun album trouvé</p>
		</div>
	{/if}
	
	{#if !loading && !loadingCovers && albums.length > 0}
		{#each Object.entries(groupAlbumsByMonth(albums)) as [month, items]}
			<h3 class="mt-4 text-slate-600">{month}</h3>
			<ul class="album-list">
				{#each items as a}
					<li class="album-item">
						<a href={`/albums/${a.id}`} class="album-link" onclick={(e) => { if (downloadingAlbumId) { e.preventDefault(); } }}>
						{#if albumCovers[a.id]}
							<LazyImage
								src={`/api/immich/assets/${albumCovers[a.id].id}/thumbnail?size=thumbnail`}
								alt={a.name}
								class="album-cover"
								aspectRatio="1"
								isVideo={albumCovers[a.id].type === 'VIDEO'}
							/>
						{:else}
							<div class="album-cover-placeholder">
								<Icon name="folder" size={48} />
							</div>
						{/if}
						<div class="album-overlay">
							<div class="album-info">
								<span class="album-name" title={a.name}>{a.name}</span>
								<div class="album-details">
									{#if a.date}
										<span class="album-date">{new Date(a.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
									{/if}
									<span class="album-meta">
										<Icon name={getVisibilityIcon(a.visibility)} size={12} />
									</span>
								</div>
							</div>
						</div>
					</a>
					<button 
						onclick={(e) => { e.preventDefault(); downloadAlbumAssets(a.id, a.name); }} 
						disabled={downloadingAlbumId === a.id} 
						title="Télécharger toutes les images" 
						class="btn-icon album-download"
					>
						{#if downloadingAlbumId === a.id}
							{#if typeof downloadingProgress[a.id] === 'number' && downloadingProgress[a.id] >= 0}
								{Math.round(downloadingProgress[a.id] * 100)}%
							{:else}
								<Spinner size={16} />
							{/if}
						{:else}
							<Icon name="download" size={16} />
						{/if}
					</button>
					{#if canCreateAlbum}
						<button 
							onclick={(e) => { e.preventDefault(); deleteAlbum(a.id, a.name); }}
							title="Supprimer l'album" 
							class="btn-icon album-delete"
						>
							<Icon name="trash" size={16} />
						</button>
					{/if}
					</li>
				{/each}
			</ul>
		{/each}
	{/if}

	{#if showCreateAlbumModal}
		<CreateAlbumModal 
			onClose={() => showCreateAlbumModal = false}
			onAlbumCreated={handleAlbumCreated}
		/>
	{/if}

	{#if showConfirmModal && confirmModalConfig}
		<ConfirmModal
			title={confirmModalConfig.title}
			message={confirmModalConfig.message}
			confirmText={confirmModalConfig.confirmText}
			onConfirm={confirmModalConfig.onConfirm}
			onCancel={() => showConfirmModal = false}
		/>
	{/if}
</main>

<style>
	.header-with-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 2rem;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.btn-create-album {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		background: linear-gradient(90deg, var(--accent), #8b5cf6);
		color: white;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
	}

	.btn-create-album:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 24px rgba(59, 130, 246, 0.4);
	}

	.album-download {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		z-index: 10;
		opacity: 0;
		transition: opacity 0.2s, transform 0.2s;
	}

	.album-item:hover .album-download {
		opacity: 1;
	}

	.album-delete {
		position: absolute;
		bottom: 0.75rem;
		right: 0.75rem;
		z-index: 10;
		background: rgba(220, 38, 38, 0.9) !important;
		opacity: 0;
		transition: opacity 0.2s, transform 0.2s;
	}

	.album-item:hover .album-delete {
		opacity: 1;
	}

	.album-delete:hover {
		background: rgba(220, 38, 38, 1) !important;
		transform: scale(1.1);
	}

	@media (max-width: 640px) {
		.header-with-actions {
			flex-direction: column;
			align-items: stretch;
		}

		.btn-create-album {
			justify-content: center;
		}
	}
</style>
