<script lang="ts">
	import { SquareCheck, Square, Download, Trash2, Image as ImageIcon, CircleMinus } from 'lucide-svelte';
	import PhotoCard from '$lib/components/PhotoCard.svelte';
	import PhotoModal from '$lib/components/PhotoModal.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import type { PhotosState } from '$lib/photos.svelte';
	import { groupByDay } from '$lib/photos.svelte';
	import type { User } from '$lib/types/api';
	import { page } from '$app/state';
	import { toast } from '$lib/toast';
	import { activeOperations } from '$lib/operations';
	import { m } from '$lib/paraglide/messages';
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

	let userRole = $derived((page.data.session?.user as User)?.role || 'user');
	let canManagePhotos = $derived(userRole === 'mitviste' || userRole === 'admin');

	let showModal = $state(false);
	let modalAssetId = $state<string>('');
	let hasChanges = $state(false);

	let showDeleteModal = $state(false);
	let assetToDelete = $state<string | null>(null);

	let showDeleteSelectedModal = $state(false);
	let idsToDelete = $state<string[] | null>(null);

	let showRemoveFromAlbumModal = $state(false);

	let showDownloadSelectedModal = $state(false);

	async function handleDownloadSingle(id: string) {
		const operationId = `download-${id}-${Date.now()}`;
		activeOperations.start(operationId);

		try {
			await photosState.downloadSingle(id);
			toast.success(m.pg_photo_downloaded());
		} catch (e: unknown) {
			toast.error(m.download_error_long({ error: (e as Error).message }));
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

	async function handleRemoveFromAlbum() {
		if (photosState.selectedAssets.length === 0) return;
		showRemoveFromAlbumModal = true;
	}

	async function confirmRemoveFromAlbum() {
		if (!albumId || photosState.selectedAssets.length === 0) return;
		const ids = photosState.selectedAssets;
		const count = ids.length;
		showRemoveFromAlbumModal = false;

		const operationId = `remove-from-album-${Date.now()}`;
		activeOperations.start(operationId);

		try {
			const res = await fetch(`/api/albums/${albumId}/assets`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids })
			});

			if (!res.ok) {
				const errText = await res.text().catch(() => res.statusText);
				throw new Error(errText || 'Failed to remove from album');
			}

			// Local update: remove assets from view
			photosState.assets = photosState.assets.filter((a) => !ids.includes(a.id));
			photosState.assets = [...photosState.assets];
			photosState.selectedAssets = [];
			photosState.selecting = false;
			toast.success(m.pg_removed_count({ count }));
		} catch (e: unknown) {
			toast.error(m.pg_remove_error({ error: (e as Error).message }));
		} finally {
			activeOperations.end(operationId);
		}
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
				throw new Error(errText || m.albums_delete_failed());
			}

			photosState.assets = photosState.assets.filter((a) => !ids.includes(a.id));
			photosState.assets = [...photosState.assets];
			photosState.selectedAssets = [];
			photosState.selecting = false;
			toast.success(m.pg_trashed_count({ count }));
		} catch (e: unknown) {
			toast.error(m.delete_error_long({ error: (e as Error).message }));
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
			toast.error(m.download_error_long({ error: (e as Error).message }));
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
				throw new Error(errText || m.albums_delete_failed());
			}

			photosState.assets = photosState.assets.filter((a) => a.id !== assetToDelete);
			photosState.assets = [...photosState.assets];
			toast.success(m.pg_photo_trashed());
		} catch (e: unknown) {
			toast.error(m.delete_error_long({ error: (e as Error).message }));
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
			toast.success(newValue ? m.pg_fav_added() : m.pg_fav_removed());
		} catch (e: unknown) {
			toast.error(m.common_error_detail({ error: (e as Error).message }));
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

<!-- Main view -->
{#if photosState.assets.length > 0}
	<!-- Selection toolbar -->
	{#if photosState.selecting}
		<div class="selection-toolbar">
			<div class="selection-count">
				<SquareCheck size={18} />
				{m.pg_selected_count({ count: photosState.selectedAssets.length })}
			</div>
			<div class="selection-actions">
				<button onclick={() => photosState.selectAll()} class="btn-glass">
					<SquareCheck size={16} />
					{m.pg_select_all()}
				</button>
				<button onclick={() => photosState.deselectAll()} class="btn-glass">
					<Square size={16} />
					{m.pg_deselect_all()}
				</button>
				<button
					onclick={handleDownloadSelectedClick}
					disabled={photosState.selectedAssets.length === 0}
					class="btn-glass primary"
				>
					{#if photosState.isDownloading}
						{#if photosState.downloadProgress >= 0}
							<Download size={16} />
							{Math.round(photosState.downloadProgress * 100)}%
						{:else}
							<Spinner size={16} />
							{m.pg_downloading()}
						{/if}
					{:else}
						<Download size={16} />
						{m.pg_download_count({ count: photosState.selectedAssets.length })}
					{/if}
				</button>
				{#if canManagePhotos && albumId}
					<button
						onclick={() => handleRemoveFromAlbum()}
						disabled={photosState.selectedAssets.length === 0}
						class="btn-glass"
						title={m.pg_remove_from_album_title()}
					>
						<CircleMinus size={16} />
						{m.pg_remove_count({ count: photosState.selectedAssets.length })}
					</button>
				{/if}
				{#if canManagePhotos}
					<button
						onclick={() => handleDeleteSelected()}
						disabled={photosState.selectedAssets.length === 0}
						class="btn-glass danger"
					>
						<Trash2 size={16} />
						{m.pg_delete_count({ count: photosState.selectedAssets.length })}
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

	<!-- Photo grid grouped by day -->
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
		<p>{m.pg_empty()}</p>
	</div>
{/if}

<!-- Photo viewer modal -->
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
	/>
{/if}

<!-- Delete confirmation modal -->
<Modal
	bind:show={showDeleteModal}
	title={m.photo_delete_title()}
	type="confirm"
	confirmText={m.trash_to_bin()}
	cancelText={m.common_cancel()}
	onConfirm={confirmDelete}
>
	{#snippet children()}
		<p>{m.photo_trash_confirm()}</p>
	{/snippet}
</Modal>

<!-- Modal suppression multiple -->
<Modal
	bind:show={showDeleteSelectedModal}
	title={m.pg_delete_selected_title()}
	type="confirm"
	confirmText={m.trash_to_bin()}
	cancelText={m.common_cancel()}
	onConfirm={confirmDeleteSelected}
>
	{#snippet children()}
		<p>
			{m.pg_delete_selected_body({ count: photosState.selectedAssets.length })}
		</p>
		<p class="text-sm text-muted" style="margin-top: 0.5rem;">
			{m.pg_delete_selected_warn()}
		</p>
	{/snippet}
</Modal>

<!-- Modal retrait de l'album -->
<Modal
	bind:show={showRemoveFromAlbumModal}
	title={m.pg_remove_from_album()}
	type="confirm"
	confirmText={m.pg_remove_from_album()}
	cancelText={m.common_cancel()}
	onConfirm={confirmRemoveFromAlbum}
>
	{#snippet children()}
		<p>
			{m.pg_remove_body({ count: photosState.selectedAssets.length })}
		</p>
		<p class="text-sm text-muted" style="margin-top: 0.5rem;">
			{m.pg_remove_warn()}
		</p>
	{/snippet}
</Modal>

<!-- Bulk download modal -->
<Modal
	bind:show={showDownloadSelectedModal}
	title={m.pg_download_selected_title()}
	type="confirm"
	confirmText={m.common_download()}
	cancelText={m.common_cancel()}
	onConfirm={confirmDownloadSelected}
>
	{#snippet children()}
		<p>
			{m.pg_download_body({ count: photosState.selectedAssets.length })}
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

	/* Phantom element to prevent the last row from stretching */
	.photos-grid::after {
		content: '';
		flex-grow: 999999;
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

	/* Responsive - square grid on mobile */
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

		.selection-actions .btn-glass {
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
