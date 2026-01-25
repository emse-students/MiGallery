<script lang="ts">
	import { CheckSquare, Square, Download, Trash, Image as ImageIcon } from 'lucide-svelte';
	import PhotoCard from '$lib/components/PhotoCard.svelte';
	import PhotoModal from '$lib/components/PhotoModal.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import type { PhotosState } from '$lib/photos.svelte';
	import { groupByDay } from '$lib/photos.svelte';
	import type { User } from '$lib/types/api';
	import { page } from '$app/stores';
	import { toast } from '$lib/toast';
	import { activeOperations } from '$lib/operations';
	interface Props {
		state: PhotosState;
		onModalClose?: (hasChanges: boolean) => void;
		visibility?: string;
		albumId?: string;
		showFavorites?: boolean;
	}

	let {
		state: photosState,
		onModalClose,
		visibility,
		albumId,
		showFavorites = false
	}: Props = $props();

	let userRole = $derived(($page.data.session?.user as User)?.role || 'user');
	let canManagePhotos = $derived(userRole === 'mitviste' || userRole === 'admin');

	let showModal = $state(false);
	let modalAssetId = $state<string>('');
	let hasChanges = $state(false);

	let showDeleteModal = $state(false);
	let assetToDelete = $state<string | null>(null);

	let showDeleteSelectedModal = $state(false);
	let idsToDelete = $state<string[] | null>(null);

	let showDownloadSelectedModal = $state(false);

	async function handleDownloadSingle(id: string) {
		const operationId = `download-${id}-${Date.now()}`;
		activeOperations.start(operationId);

		try {
			await photosState.downloadSingle(id);
			toast.success('Photo téléchargée !');
		} catch (e: unknown) {
			toast.error('Erreur lors du téléchargement: ' + (e as Error).message);
		} finally {
			activeOperations.end(operationId);
		}
	}

	async function handleDeleteAsset(assetId: string) {
		assetToDelete = assetId;
		showDeleteModal = true;
	}

	async function handleDeleteSelected() {
		if (photosState.selectedAssets.length === 0) return;
		idsToDelete = [...photosState.selectedAssets];
		showDeleteSelectedModal = true;
	}

	async function confirmDeleteSelected() {
		if (!idsToDelete || idsToDelete.length === 0) return;
		const ids = idsToDelete;
		const count = ids.length;
		idsToDelete = null;
		showDeleteSelectedModal = false;

		const operationId = `delete-multiple-${Date.now()}`;
		activeOperations.start(operationId);
		try {
			const res = await fetch(`/api/immich/assets`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids })
			});

			if (!res.ok && res.status !== 204) {
				const errText = await res.text().catch(() => res.statusText);
				throw new Error(errText || 'Erreur lors de la suppression');
			}

			photosState.assets = photosState.assets.filter((a) => !ids.includes(a.id));
			photosState.assets = [...photosState.assets];
			photosState.selectedAssets = [];
			photosState.selecting = false;
			toast.success(`${count} photo(s) mise(s) à la corbeille !`);
		} catch (e: unknown) {
			toast.error('Erreur lors de la suppression: ' + (e as Error).message);
		} finally {
			activeOperations.end(operationId);
		}
	}

	function handleDownloadSelectedClick() {
		if (photosState.selectedAssets.length === 0) return;
		showDownloadSelectedModal = true;
	}

	async function confirmDownloadSelected() {
		showDownloadSelectedModal = false;
		try {
			await photosState.downloadSelected(true);
		} catch (e: unknown) {
			toast.error('Erreur lors du téléchargement: ' + (e as Error).message);
		}
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

			photosState.assets = photosState.assets.filter((a) => a.id !== assetToDelete);
			photosState.assets = [...photosState.assets];
			toast.success('Photo mise à la corbeille !');
		} catch (e: unknown) {
			toast.error('Erreur lors de la suppression: ' + (e as Error).message);
		} finally {
			activeOperations.end(operationId);
			assetToDelete = null;
		}
	}

	function closeModal() {
		showModal = false;
		photosState.assets = [...photosState.assets];
		if (onModalClose) {
			setTimeout(() => {
				try {
					onModalClose(hasChanges);
				} catch (e) {}
			}, 0);
		}
	}

	$effect(() => {
		const handlePopState = (event: PopStateEvent) => {
			if (showModal) {
				closeModal();
			}
		};
		window.addEventListener('popstate', handlePopState);
		return () => window.removeEventListener('popstate', handlePopState);
	});

	function handlePhotoCardClick(id: string) {
		if (photosState.selecting) {
			photosState.handlePhotoClick(id, new Event('click'));
		} else {
			modalAssetId = id;
			hasChanges = false;
			history.pushState({ modalOpen: true }, '');
			showModal = true;
		}
	}

	async function handleFavoriteToggle(assetId: string) {
		try {
			const newValue = await photosState.toggleFavorite(assetId);
			toast.success(newValue ? 'Ajouté aux favoris' : 'Retiré des favoris');
		} catch (e: unknown) {
			toast.error('Erreur: ' + (e as Error).message);
		}
	}

	let favoriteAssets = $derived(showFavorites ? photosState.assets.filter((a) => a.isFavorite) : []);

	let nonFavoriteAssets = $derived(
		showFavorites ? photosState.assets.filter((a) => !a.isFavorite) : photosState.assets
	);

	let assetsForModal = $derived(
		showFavorites ? [...favoriteAssets, ...nonFavoriteAssets] : photosState.assets
	);
</script>

<!-- Affichage principal -->
{#if photosState.assets.length > 0}
	<!-- Toolbar de sélection -->
	{#if photosState.selecting}
		<div class="selection-toolbar">
			<div class="selection-count">
				<CheckSquare size={18} />
				{photosState.selectedAssets.length} sélectionné{photosState.selectedAssets.length > 1
					? 's'
					: ''}
			</div>
			<div class="selection-actions">
				<button onclick={() => photosState.selectAll()} class="btn-secondary">
					<CheckSquare size={16} />
					Tout sélectionner
				</button>
				<button onclick={() => photosState.deselectAll()} class="btn-secondary">
					<Square size={16} />
					Tout désélectionner
				</button>
				<button
					onclick={handleDownloadSelectedClick}
					disabled={photosState.selectedAssets.length === 0}
					class="btn-primary"
				>
					{#if photosState.isDownloading}
						{#if photosState.downloadProgress >= 0}
							<Download size={16} />
							{Math.round(photosState.downloadProgress * 100)}%
						{:else}
							<Spinner size={16} />
							Téléchargement...
						{/if}
					{:else}
						<Download size={16} />
						Télécharger ({photosState.selectedAssets.length})
					{/if}
				</button>
				{#if canManagePhotos}
					<button
						onclick={() => handleDeleteSelected()}
						disabled={photosState.selectedAssets.length === 0}
						class="btn-delete-selection px-3 py-2 rounded-lg text-white border-0 cursor-pointer flex items-center gap-2"
					>
						<Trash size={16} />
						Supprimer ({photosState.selectedAssets.length})
					</button>
				{/if}
			</div>
		</div>
	{:else}
		<div class="photos-count">
			<strong>{photosState.assets.length}</strong> photo{photosState.assets.length > 1 ? 's' : ''}
		</div>
	{/if}

	<!-- Section Favoris -->
	{#if showFavorites && favoriteAssets.length > 0}
		<h3 class="day-label favorites-label">⭐ Favoris</h3>
		<div class="photos-grid">
			{#each favoriteAssets as a}
				<PhotoCard
					asset={a}
					isSelected={photosState.selectedAssets.includes(a.id)}
					isSelecting={photosState.selecting}
					canDelete={canManagePhotos}
					albumVisibility={visibility}
					{albumId}
					showFavorite={true}
					onFavoriteToggle={() => handleFavoriteToggle(a.id)}
					onCardClick={() => handlePhotoCardClick(a.id)}
					onDownload={() => handleDownloadSingle(a.id)}
					onDelete={() => handleDeleteAsset(a.id)}
					onSelectionToggle={(id, selected) => photosState.toggleSelect(id, selected)}
				/>
			{/each}
		</div>
	{/if}

	<!-- Grille de photos groupées par jour -->
	{#each Object.entries(groupByDay(nonFavoriteAssets)) as [dayLabel, items]}
		<h3 class="day-label">{dayLabel}</h3>
		<div class="photos-grid">
			{#each items as a}
				<PhotoCard
					asset={a}
					isSelected={photosState.selectedAssets.includes(a.id)}
					isSelecting={photosState.selecting}
					canDelete={canManagePhotos}
					albumVisibility={visibility}
					{albumId}
					showFavorite={showFavorites}
					onFavoriteToggle={() => handleFavoriteToggle(a.id)}
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
		<ImageIcon size={48} />
		<p>Aucune photo trouvée</p>
	</div>
{/if}

<!-- Modal de visualisation -->
{#if showModal}
	<PhotoModal
		bind:assetId={modalAssetId}
		assets={assetsForModal}
		albumVisibility={visibility}
		{albumId}
		showFavorite={showFavorites}
		onFavoriteToggle={handleFavoriteToggle}
		onClose={() => {
			if (history.state?.modalOpen) {
				history.back();
			} else {
				closeModal();
			}
		}}
		onAssetDeleted={(id) => {
			photosState.assets = photosState.assets.filter((a) => a.id !== id);
			hasChanges = true;
		}}
		on:assetDeleted={(e) => {
			const id = e.detail as string;
			photosState.assets = photosState.assets.filter((a) => a.id !== id);
			hasChanges = true;
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

<!-- Modal suppression multiple -->
<Modal
	bind:show={showDeleteSelectedModal}
	title="Supprimer les photos sélectionnées"
	type="confirm"
	confirmText="Mettre à la corbeille"
	cancelText="Annuler"
	onConfirm={confirmDeleteSelected}
>
	{#snippet children()}
		<p>
			Voulez-vous vraiment mettre {photosState.selectedAssets.length} photo(s) sélectionnée(s) à la corbeille
			?
		</p>
	{/snippet}
</Modal>

<!-- Modal téléchargement multiple -->
<Modal
	bind:show={showDownloadSelectedModal}
	title="Télécharger les photos sélectionnées"
	type="confirm"
	confirmText="Télécharger"
	cancelText="Annuler"
	onConfirm={confirmDownloadSelected}
>
	{#snippet children()}
		<p>
			Voulez-vous télécharger {photosState.selectedAssets.length} photo(s) sélectionnée(s) en une archive
			?
		</p>
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

	.favorites-label {
		color: var(--accent);
		opacity: 1;
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

	:global(.btn-delete-selection) {
		background: #dc2626 !important;
		color: white !important;
		border: 0;
	}

	:global(.btn-delete-selection:hover:not(:disabled)) {
		background: #b91c1c !important;
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

	/* Responsive - grille carrée sur mobile */
	@media (max-width: 768px) {
		.photos-grid {
			gap: 3px;
		}

		.selection-toolbar {
			flex-direction: column;
			gap: 0.75rem;
			padding: 0.75rem;
		}

		.selection-actions {
			width: 100%;
			justify-content: center;
		}

		.selection-actions button {
			padding: 0.5rem 0.75rem;
			font-size: 0.75rem;
		}

		.day-label {
			font-size: 0.8125rem;
			margin-top: 2rem;
			margin-bottom: 1rem;
		}

		.photos-count {
			font-size: 0.8125rem;
			margin-bottom: 1rem;
		}
	}

	@media (max-width: 480px) {
		.photos-grid {
			gap: 2px;
		}
	}
</style>
