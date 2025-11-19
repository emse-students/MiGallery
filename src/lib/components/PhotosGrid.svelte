<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import PhotoCard from '$lib/components/PhotoCard.svelte';
	import PhotoModal from '$lib/components/PhotoModal.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import type { PhotosState } from '$lib/photos.svelte';
	import { groupByDay } from '$lib/photos.svelte';
	import { page } from '$app/stores';
	import { toast } from '$lib/toast';
	import { activeOperations } from '$lib/operations';

	interface Props {
		state: PhotosState;
	}

	let { state: photosState }: Props = $props();

	console.log('✓ [PhotosGrid] Composant chargé');

	// Vérifier le rôle de l'utilisateur
	let userRole = $derived(($page.data.session?.user as any)?.role || 'user');
	let canManagePhotos = $derived(userRole === 'mitviste' || userRole === 'admin');

	// État du modal
	let showModal = $state(false);
	let modalAssetId = $state<string>('');

	// État du modal de confirmation de suppression
	let showDeleteModal = $state(false);
	let assetToDelete = $state<string | null>(null);

	async function handleDownloadSingle(id: string) {
		const operationId = `download-${id}-${Date.now()}`;
		activeOperations.start(operationId);

		try {
			await photosState.downloadSingle(id);
			toast.success('Photo téléchargée !');
		} catch (e) {
			toast.error('Erreur lors du téléchargement: ' + (e as Error).message);
		} finally {
			activeOperations.end(operationId);
		}
	}

	async function handleDeleteAsset(assetId: string) {
		assetToDelete = assetId;
		showDeleteModal = true;
	}

	async function confirmDelete() {
		if (!assetToDelete) return;

		const operationId = `delete-${assetToDelete}-${Date.now()}`;
		activeOperations.start(operationId);

		try {
			const res = await fetch(`/api/immich/assets`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids: [assetToDelete] })
			});

			if (!res.ok && res.status !== 204) {
				const errText = await res.text().catch(() => res.statusText);
				throw new Error(errText || 'Erreur lors de la suppression');
			}

			// Retirer l'asset de la liste locale
			photosState.assets = photosState.assets.filter(a => a.id !== assetToDelete);
			toast.success('Photo mise à la corbeille !');
		} catch (e) {
			toast.error('Erreur lors de la suppression: ' + (e as Error).message);
		} finally {
			activeOperations.end(operationId);
			assetToDelete = null;
		}
	}

	function handlePhotoCardClick(id: string) {
		if (photosState.selecting) {
			photosState.handlePhotoClick(id, new Event('click'));
		} else {
			modalAssetId = id;
			showModal = true;
		}
	}
</script>

<!-- Affichage principal -->
{#if photosState.assets.length > 0}
	<!-- Toolbar de sélection -->
	{#if photosState.selecting}
		<div class="selection-toolbar">
			<div class="selection-count">
				<Icon name="check-square" size={18} />
				{photosState.selectedAssets.length} sélectionné{photosState.selectedAssets.length > 1 ? 's' : ''}
			</div>
			<div class="selection-actions">
				<button onclick={() => photosState.selectAll()} class="btn-secondary">
					<Icon name="check-square" size={16} />
					Tout sélectionner
				</button>
				<button onclick={() => photosState.deselectAll()} class="btn-secondary">
					<Icon name="square" size={16} />
					Tout désélectionner
				</button>
				<button onclick={() => photosState.downloadSelected()} disabled={photosState.isDownloading || photosState.selectedAssets.length === 0} class="btn-primary">
					{#if photosState.isDownloading}
						{#if photosState.downloadProgress >= 0}
							<Icon name="download" size={16} />
							{Math.round(photosState.downloadProgress * 100)}%
						{:else}
							<Spinner size={16} />
							Téléchargement...
						{/if}
					{:else}
						<Icon name="download" size={16} />
						Télécharger ({photosState.selectedAssets.length})
					{/if}
				</button>
			</div>
		</div>
	{:else}
		<div class="photos-count"><strong>{photosState.assets.length}</strong> photo{photosState.assets.length > 1 ? 's' : ''} trouvée{photosState.assets.length > 1 ? 's' : ''}</div>
	{/if}

	<!-- Grille de photos groupées par jour -->
	{#each Object.entries(groupByDay(photosState.assets)) as [dayLabel, items]}
		<h3 class="day-label">{dayLabel}</h3>
		<div class="photos-grid">
			{#each items as a}
				<PhotoCard
					asset={a}
					isSelected={photosState.selectedAssets.includes(a.id)}
					isSelecting={photosState.selecting}
					canDelete={canManagePhotos}
					onCardClick={() => handlePhotoCardClick(a.id)}
					onDownload={() => handleDownloadSingle(a.id)}
					onDelete={() => handleDeleteAsset(a.id)}
					onSelectionToggle={(id, selected) => photosState.toggleSelect(id, selected)}
				/>
			{/each}
		</div>
	{/each}
{:else if !photosState.loading && !photosState.error}
	<!-- État vide -->
	<div class="empty-state">
		<Icon name="image" size={48} />
		<p>Aucune photo trouvée</p>
	</div>
{/if}

<!-- Modal de visualisation -->
{#if showModal}
	<PhotoModal 
		bind:assetId={modalAssetId}
		assets={photosState.assets} 
		onClose={() => {
			showModal = false;
		}}
		onAssetDeleted={(id) => {
			photosState.assets = photosState.assets.filter(a => a.id !== id);
		}}
	/>
{/if}

<!-- Modal de confirmation de suppression -->
<Modal
	bind:show={showDeleteModal}
	title="Supprimer la photo"
	type="confirm"
	confirmText="Mettre à la corbeille"
	cancelText="Annuler"
	onConfirm={confirmDelete}
>
	{#snippet children()}
		<p>Voulez-vous vraiment mettre cette photo à la corbeille ?</p>
	{/snippet}
</Modal>

<style>
  .selection-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    margin-bottom: 2rem;
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
  }

  .selection-count {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .selection-actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .selection-actions button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    border: none;
    border-radius: var(--radius-sm);
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .selection-actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .photos-count {
    margin-bottom: 2rem;
    color: var(--text-secondary);
    font-size: 0.9375rem;
  }

  .day-label {
    margin-top: 3rem;
    margin-bottom: 1.5rem;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    opacity: 0.6;
  }

  .day-label:first-of-type {
    margin-top: 0;
  }

  .photos-grid {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 2rem;
  }

  /* Élément fantôme pour empêcher l'étirement de la dernière ligne */
  .photos-grid::after {
    content: '';
    flex-grow: 999999;
  }

  .btn-primary {
    background: var(--accent);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn-secondary {
    background: var(--bg-elevated);
    color: var(--text-primary);
  }

  .btn-secondary:hover {
    background: var(--bg-tertiary);
  }

  .empty-state {
    text-align: center;
    padding: 4rem 2rem;
    color: var(--text-muted);
  }

  .empty-state p {
    margin-top: 1rem;
    font-size: 1.125rem;
  }

  /* Responsive - ajustement de la hauteur des cartes */
  @media (max-width: 768px) {
    .photos-grid {
      gap: 3px;
    }
  }
</style>
