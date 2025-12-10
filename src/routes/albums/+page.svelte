<script lang="ts">
	import { page } from '$app/stores';
	import Icon from '$lib/components/Icon.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import LazyImage from '$lib/components/LazyImage.svelte';
	import AlbumModal from '$lib/components/AlbumModal.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { consumeNDJSONStream } from '$lib/streaming';
	import { showConfirm } from '$lib/confirm';
	import { toast } from '$lib/toast';
	import { clientCache } from '$lib/client-cache';
	import type { User, Album, ImmichAsset } from '$lib/types/api';

	// Marquer comme en cours de chargement jusqu'à réception des données
	let loading = $state(true);
	let error = $state<string | null>(null);
	let albums = $state<Album[]>([]);
	let showAlbumModal = $state(false);

	// État du modal de confirmation
	let showConfirmModal = $state(false);
	let confirmModalConfig = $state<{
		title: string;
		message: string;
		confirmText?: string;
		onConfirm: () => void;
	} | null>(null);

	// Vérifier le rôle de l'utilisateur
	let userRole = $derived(($page.data.session?.user as User)?.role || 'user');
	let canCreateAlbum = $derived(userRole === 'mitviste' || userRole === 'admin');

	$effect(() => {
		// Lorsque la page fournie par le load server est prête, on met à jour la liste
		if (typeof $page.data !== 'undefined') {
			if ($page.data?.albums) {
				albums = ($page.data.albums as Album[]);
			} else {
				albums = [];
			}
			loading = false;
		}
	});

	function monthLabelFor(dateStr?: string | null) {
		if (!dateStr) return 'Sans date';
		const d = new Date(dateStr);
		if (isNaN(d.getTime())) return 'Sans date';
		return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
	}

	function groupAlbumsByMonth(list: Album[]) {
		const out: Record<string, Album[]> = {};
		for (const a of list) {
			const key = monthLabelFor(a.date);
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
			// Ne pas bloquer l'affichage - on charge les covers en arrière-plan
			(async () => {
				try {
					// D'abord, essayer de charger depuis le cache
					const albumIds = albums.map(a => a.id);
					const cachedCovers: Record<string, { id: string; type?: string }> = {};

					for (const albumId of albumIds) {
						const cached = await clientCache.get<{ id: string; type?: string }>('album-covers', albumId);
						if (cached) {
							cachedCovers[albumId] = cached;
						}
					}

					// Afficher immédiatement les covers en cache
					if (Object.keys(cachedCovers).length > 0) {
						albumCovers = { ...albumCovers, ...cachedCovers };
					}

					// Utiliser le nouvel endpoint streamé pour les covers
					const res = await fetch('/api/albums/covers', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ albumIds })
					});

					await consumeNDJSONStream<{ albumId: string; cover: { assetId: string; type: string } }>(
						res,
						({ albumId, cover }) => {
							if (cover && typeof cover === 'object' && 'assetId' in cover) {
								const coverData = {
									id: cover.assetId,
									type: cover.type
								};

								albumCovers = {
									...albumCovers,
									[albumId]: coverData
								};

								// Stocker en cache
								clientCache.set('album-covers', albumId, coverData);
							}
						}
					);
				} catch (e: unknown) {
					console.warn('Error loading album covers', e);
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
		const ok = await showConfirm(`Télécharger toutes les images de l'album "${albumName || immichId}" au format ZIP ?`, 'Télécharger');
		if (!ok) return;
		downloadingAlbumId = immichId;
		downloadingProgress = { ...downloadingProgress, [immichId]: 0 };

		if (currentDownloadController) {
			try { currentDownloadController.abort(); } catch (e: unknown) {}
			currentDownloadController = null;
		}
		const controller = new AbortController();
		currentDownloadController = controller;
		try {
			const res = await fetch(`/api/albums/${immichId}`);
			if (!res.ok) throw new Error('Erreur récupération assets');
			const data = (await res.json()) as { assets: ImmichAsset[] };
			const list: ImmichAsset[] = Array.isArray(data?.assets) ? data.assets : [];
			const assetIds = list.map(x => x.id).filter(Boolean);
			if (assetIds.length === 0) {
				toast.info('Aucun asset à télécharger');
				return;
			}
			const blob = await fetchArchive(assetIds, {
				onProgress: (p) => {
					downloadingProgress = { ...downloadingProgress, [immichId]: p };
				},
				signal: controller.signal,
			});
			saveBlobAs(blob, `${albumName || immichId}.zip`);
		} catch (e: unknown) {
			if ((e as Error).name === 'AbortError') {
				// Téléchargement annulé par l'utilisateur
			} else {
				toast.error('Erreur lors du téléchargement en ZIP: ' + (e as Error).message);
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

				// La suppression de la BDD locale est gérée par l'endpoint DELETE /api/albums/[id]

				// Invalider le cache pour cet album
				await clientCache.delete('album-covers', immichId);
				await clientCache.delete('albums', immichId);

				// Rafraîchir la liste
				albums = albums.filter(a => a.id !== immichId);
				} catch (e: unknown) {
					toast.error('Erreur lors de la suppression: ' + (e as Error).message);
				}
			}
		};
		showConfirmModal = true;
	}	import { onDestroy } from 'svelte';
	onDestroy(() => {
		if (currentDownloadController) {
			try { currentDownloadController.abort(); } catch (e: unknown) {}
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
		<h1>Albums</h1>
		{#if canCreateAlbum}
			<button class="btn-create-album" onclick={() => showAlbumModal = true}>
				<Icon name="plus" size={20} />
				<span>Créer un album</span>
			</button>
		{/if}
	</div>

	{#if error}
		<div class="error"><Icon name="x-circle" size={20} /> Erreur: {error}</div>
	{/if}

	{#if loading}
		<div class="loading"><Spinner size={20} /> Chargement des albums...</div>
	{/if}

	{#if !loading && !error && albums.length === 0}
		<div class="empty-state">
			<p>Aucun album trouvé</p>
		</div>
	{/if}

	{#if !loading && albums.length > 0}
		{#each Object.entries(groupAlbumsByMonth(albums)) as [month, items]}
			<h3 class="mt-4 text-slate-600">{month}</h3>
			<ul class="album-list">
				{#each items as a}
					<li class="album-item" class:album-hidden={!a.visible && canCreateAlbum}>
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
							<Skeleton aspectRatio="1">
								<svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
									<path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z" fill="currentColor" opacity="0.3"/>
								</svg>
							</Skeleton>
						{/if}
						<div class="album-overlay">
							<div class="album-info">
								<span class="album-name" title={a.name}>
									{a.name}
								</span>
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

	{#if showAlbumModal}
		<AlbumModal
			onClose={() => showAlbumModal = false}
			onSuccess={handleAlbumCreated}
		/>
	{/if}

	{#if showConfirmModal && confirmModalConfig}
		<Modal
			bind:show={showConfirmModal}
			title={confirmModalConfig.title}
			type="confirm"
			confirmText={confirmModalConfig.confirmText}
			onConfirm={confirmModalConfig.onConfirm}
			onCancel={() => showConfirmModal = false}
		>
			<p style="white-space: pre-wrap;">{confirmModalConfig.message}</p>
		</Modal>
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

	.header-with-actions h1 {
		margin: 0;
		text-align: center;
		flex: 1;
		font-size: 3rem;
		font-weight: 700;
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

	.album-item.album-hidden {
		opacity: 0.6;
		filter: grayscale(30%);
		position: relative;
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
