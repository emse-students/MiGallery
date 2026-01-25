<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { XCircle, Trash, X, CheckSquare, Square, ArrowLeft } from 'lucide-svelte';
	import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import LazyImage from '$lib/components/LazyImage.svelte';
	import PhotoModal from '$lib/components/PhotoModal.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { groupByDay } from '$lib/photos.svelte';
	import type { User, ImmichAsset } from '$lib/types/api';
	import type { Asset } from '$lib/photos.svelte';
	import { toast } from '$lib/toast';

	let loading = $state(false);
	let error = $state<string | null>(null);
	let assets = $state<Asset[]>([]);
	let selectedAssets = $state<string[]>([]);
	let selecting = $state(false);
	let showPhotoModal = $state(false);
	let modalAssetId = $state<string>('');

	let progress = $state<number>(0);
	let totalToLoad = $state<number>(0);

	let showConfirmModal = $state(false);
	let confirmModalConfig = $state<{
		title: string;
		message: string;
		confirmText?: string;
		onConfirm: () => void;
	} | null>(null);

	let userRole = $derived(($page.data.session?.user as User)?.role || 'user');
	let canAccess = $derived(userRole === 'mitviste' || userRole === 'admin');

	async function fetchTrashedAssets() {
		loading = true;
		error = null;
		assets = [];
		progress = 0;
		totalToLoad = 0;

		try {
			const bucketsRes = await fetch('/api/immich/timeline/buckets?isTrashed=true&size=MONTH');
			if (!bucketsRes.ok)
				throw new Error(`Erreur lors du chargement des buckets: ${bucketsRes.statusText}`);

			const buckets = (await bucketsRes.json()) as { timeBucket: string; count: number }[];
			if (!Array.isArray(buckets) || buckets.length === 0) {
				assets = [];
				return;
			}

			const allAssetIds: string[] = [];
			for (const bucket of buckets) {
				try {
					const bucketRes = await fetch(
						`/api/immich/timeline/bucket?timeBucket=${bucket.timeBucket}&isTrashed=true&size=MONTH`
					);
					if (!bucketRes.ok) {
						console.warn(`Erreur bucket ${bucket.timeBucket}:`, bucketRes.statusText);
						continue;
					}
					const bucketData = (await bucketRes.json()) as { id: string[] };
					if (Array.isArray(bucketData.id) && bucketData.id.length > 0) {
						allAssetIds.push(...bucketData.id);
					}
				} catch (e: unknown) {
					console.warn('Erreur lors de la récupération du bucket', bucket, e);
				}
			}

			totalToLoad = allAssetIds.length;
			if (totalToLoad === 0) {
				assets = [];
				return;
			}

			const concurrency = 8;
			const results: ImmichAsset[] = [];

			for (let i = 0; i < allAssetIds.length; i += concurrency) {
				const batch = allAssetIds.slice(i, i + concurrency);
				const promises = batch.map(async (id) => {
					try {
						const res = await fetch(`/api/immich/assets/${id}`);
						if (!res.ok) {
							console.warn('Asset fetch failed', id, res.status);
							return null;
						}
						const data = (await res.json()) as ImmichAsset;
						return data;
					} catch (e: unknown) {
						console.warn('Asset fetch error', id, e);
						return null;
					} finally {
						progress = progress + 1;
					}
				});

				const batchResults = await Promise.all(promises);
				results.push(...(batchResults.filter((r) => r) as ImmichAsset[]));
			}

			assets = results.map((it) => ({
				...it,
				date: it.deletedAt || it.takenAt || it.fileCreatedAt || it.updatedAt || null
			}));
		} catch (err: unknown) {
			console.error('Error:', err);
			error = err instanceof Error ? err.message : 'Une erreur est survenue';
		} finally {
			loading = false;
		}
	}

	function handlePhotoClick(id: string, event?: Event) {
		if (selecting) {
			event?.preventDefault();
			const isSelected = selectedAssets.includes(id);
			toggleSelect(id, !isSelected);
		} else {
			modalAssetId = id;
			showPhotoModal = true;
		}
	}

	function toggleSelect(id: string, checked: boolean) {
		if (checked) {
			if (!selectedAssets.includes(id)) {
				selectedAssets = [...selectedAssets, id];
				if (!selecting) selecting = true;
			}
		} else {
			selectedAssets = selectedAssets.filter((x) => x !== id);
			if (selectedAssets.length === 0) selecting = false;
		}
	}

	function selectAll() {
		selectedAssets = assets.map((a) => a.id);
	}

	function deselectAll() {
		selectedAssets = [];
		selecting = false;
	}

	async function restoreAssets(assetIds: string[]) {
		confirmModalConfig = {
			title: 'Restaurer les éléments',
			message: `Voulez-vous restaurer ${assetIds.length} élément(s) ?`,
			confirmText: 'Restaurer',
			onConfirm: async () => {
				showConfirmModal = false;
				try {
					const res = await fetch('/api/immich/trash/restore/assets', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ ids: assetIds })
					});

					if (!res.ok && res.status !== 204) {
						const errText = await res.text().catch(() => res.statusText);
						console.error('Restore error:', { status: res.status, body: errText });
						throw new Error(errText || 'Erreur lors de la restauration');
					}

					assets = assets.filter((a) => !assetIds.includes(a.id));
					selectedAssets = [];
					selecting = false;

					toast.success(`${assetIds.length} élément(s) restauré(s) avec succès !`);
				} catch (e: unknown) {
					toast.error('Erreur lors de la restauration: ' + (e as Error).message);
				}
			}
		};
		showConfirmModal = true;
	}

	async function deleteAssetsPermanently(assetIds: string[]) {
		confirmModalConfig = {
			title: 'Supprimer définitivement',
			message: `⚠️ ATTENTION : Voulez-vous supprimer DÉFINITIVEMENT ${assetIds.length} élément(s) ?\n\nCette action est IRRÉVERSIBLE !`,
			confirmText: 'Supprimer définitivement',
			onConfirm: async () => {
				showConfirmModal = false;
				try {
					const uuidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
					for (const id of assetIds) {
						if (!uuidRe.test(id)) {
							throw new Error('Invalid asset id in selection');
						}
					}

					const res = await fetch('/api/immich/assets', {
						method: 'DELETE',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							ids: assetIds,
							force: true
						})
					});

					if (!res.ok && res.status !== 204) {
						const errText = await res.text().catch(() => res.statusText);
						console.error('Permanent delete error:', { status: res.status, body: errText });
						throw new Error(errText || 'Erreur lors de la suppression');
					}

					assets = assets.filter((a) => !assetIds.includes(a.id));
					selectedAssets = [];
					selecting = false;

					toast.success(`${assetIds.length} élément(s) supprimé(s) définitivement.`);
				} catch (e: unknown) {
					toast.error('Erreur lors de la suppression: ' + (e as Error).message);
				}
			}
		};
		showConfirmModal = true;
	}

	function getAspectRatio(asset: Asset): number {
		if (asset.exifInfo?.exifImageWidth && asset.exifInfo?.exifImageHeight) {
			return asset.exifInfo.exifImageWidth / asset.exifInfo.exifImageHeight;
		}
		if (asset._raw?.exifInfo?.exifImageWidth && asset._raw?.exifInfo?.exifImageHeight) {
			return asset._raw.exifInfo.exifImageWidth / asset._raw.exifInfo.exifImageHeight;
		}
		if (asset._raw?.width && asset._raw?.height) {
			return asset._raw.width / asset._raw.height;
		}
		return 3 / 2;
	}

	onMount(() => {
		if (!canAccess) {
			goto('/');
			return;
		}
		fetchTrashedAssets();
	});
</script>

<svelte:head>
	<title>Corbeille - MiGallery</title>
</svelte:head>

<main class="corbeille-main">
	<BackgroundBlobs />

	<header class="page-header centered">
		<div class="header-content">
			<h1>Corbeille</h1>
		</div>
	</header>

	{#if error}
		<div class="error"><XCircle size={20} /> Erreur: {error}</div>
	{/if}

	{#if loading}
		<div class="loading"><Spinner size={20} /> Chargement des éléments supprimés...</div>
	{/if}

	{#if !loading && !error && assets.length === 0}
		<div class="empty-state">
			<Trash size={48} />
			<p>La corbeille est vide</p>
		</div>
	{/if}

	{#if assets.length > 0}
		<div class="toolbar">
			<div class="items-count">
				<strong>{assets.length}</strong> élément{assets.length > 1 ? 's' : ''} dans la corbeille
			</div>

			<div class="toolbar-actions">
				<button
					onclick={() => (selecting = !selecting)}
					class="px-3 py-2 rounded-lg {selecting
						? 'bg-gray-600 hover:bg-gray-700'
						: 'bg-blue-600 hover:bg-blue-700'} text-white border-0 cursor-pointer flex items-center gap-2"
				>
					{#if selecting}
						<X size={16} />
					{:else}
						<CheckSquare size={16} />
					{/if}
					{selecting ? 'Annuler' : 'Sélectionner'}
				</button>
			</div>
		</div>

		{#if selecting && selectedAssets.length > 0}
			<div class="selection-toolbar">
				<div class="selection-count">
					<CheckSquare size={18} />
					{selectedAssets.length} sélectionné{selectedAssets.length > 1 ? 's' : ''}
				</div>
				<div class="selection-actions">
					<button onclick={selectAll} class="px-2 py-2">
						<CheckSquare size={16} />
						Tout sélectionner
					</button>
					<button onclick={deselectAll} class="px-2 py-2 bg-gray-400">
						<Square size={16} />
						Tout désélectionner
					</button>
					<button
						onclick={() => restoreAssets(selectedAssets)}
						class="px-2 py-2 bg-emerald-600 hover:bg-emerald-700"
					>
						<ArrowLeft size={16} />
						Restaurer ({selectedAssets.length})
					</button>
					<button
						onclick={() => deleteAssetsPermanently(selectedAssets)}
						class="btn-delete-selection px-2 py-2 text-white"
					>
						<Trash size={16} />
						Supprimer définitivement ({selectedAssets.length})
					</button>
				</div>
			</div>
		{/if}

		{#each Object.entries(groupByDay(assets)) as [dayLabel, items]}
			<h3 class="day-label">{dayLabel}</h3>
			<div class="photos-flex {selecting ? 'selection-mode' : ''}">
				{#each items as asset}
					{@const aspectRatio = getAspectRatio(asset)}
					{@const flexBasis = aspectRatio * 220}
					{@const flexGrow = aspectRatio * 100}
					<div
						class="photo-card glass-card {selectedAssets.includes(asset.id) ? 'selected' : ''}"
						style="flex-basis: {flexBasis}px; flex-grow: {flexGrow};"
						role="button"
						tabindex="0"
						onclick={(e) => handlePhotoClick(asset.id, e)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								handlePhotoClick(asset.id, e);
							}
						}}
					>
						<div class="selection-checkbox {selectedAssets.includes(asset.id) ? 'checked' : ''}">
							<input
								type="checkbox"
								checked={selectedAssets.includes(asset.id)}
								onchange={(e) => toggleSelect(asset.id, (e.target as HTMLInputElement).checked)}
								onclick={(e) => e.stopPropagation()}
							/>
						</div>

						{#if !selecting}
							<button
								class="restore-btn"
								title="Restaurer"
								onclick={(e) => {
									e.stopPropagation();
									restoreAssets([asset.id]);
								}}
							>
								<ArrowLeft size={16} />
							</button>
							<button
								class="delete-permanent-btn"
								title="Supprimer définitivement"
								onclick={(e) => {
									e.stopPropagation();
									deleteAssetsPermanently([asset.id]);
								}}
							>
								<Trash size={16} />
							</button>
						{/if}

						<LazyImage
							src={`/api/immich/assets/${asset.id}/thumbnail?size=thumbnail`}
							highRes={`/api/immich/assets/${asset.id}/thumbnail?size=preview`}
							alt={asset.originalFileName || 'Photo'}
							isVideo={asset.type === 'VIDEO'}
						/>

						<div class="photo-info" title={asset.originalFileName || asset.id}>
							{asset.originalFileName || asset.id}
						</div>
					</div>
				{/each}
				<div class="flex-spacer"></div>
				<div class="flex-spacer"></div>
				<div class="flex-spacer"></div>
			</div>
		{/each}
	{/if}

	{#if showPhotoModal && modalAssetId}
		<PhotoModal
			assetId={modalAssetId}
			{assets}
			onClose={() => {
				showPhotoModal = false;
				modalAssetId = '';
				assets = [...assets];
			}}
			onAssetDeleted={(id) => {
				assets = assets.filter((a) => a.id !== id);
			}}
			on:assetDeleted={(e) => {
				const id = e.detail as string;
				assets = assets.filter((a) => a.id !== id);
			}}
		/>
	{/if}

	{#if showConfirmModal && confirmModalConfig}
		<Modal
			bind:show={showConfirmModal}
			title={confirmModalConfig.title}
			type="confirm"
			confirmText={confirmModalConfig.confirmText}
			onConfirm={confirmModalConfig.onConfirm}
			onCancel={() => (showConfirmModal = false)}
		>
			<p style="white-space: pre-wrap;">{confirmModalConfig.message}</p>
		</Modal>
	{/if}
</main>

<style>
	.corbeille-main {
		position: relative;
		min-height: 100vh;
	}

	/* Titles handled by shared styles in app.css */

	.toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.toolbar-actions {
		display: flex;
		gap: 0.5rem;
	}

	.selection-toolbar {
		background: rgba(255, 255, 255, 0.05);
		border-radius: 12px;
		padding: 1rem 1.5rem;
		margin-bottom: 1.5rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 1rem;
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
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.selection-actions button {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 8px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: white;
	}

	.items-count {
		margin-bottom: 2rem;
		font-size: 0.9375rem;
		color: var(--text-secondary);
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

	/* Masonry layout like Mes photos */
	.photos-flex {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: 2rem;
	}

	.photos-flex::after {
		content: '';
		flex-grow: 999999999;
	}

	.flex-spacer {
		content: '';
		flex-grow: 999999999;
		margin: 0;
		padding: 0;
		height: 0;
	}

	.photo-card {
		position: relative;
		margin: 2px;
		/* glass-style background */
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.06);
		backdrop-filter: blur(6px) saturate(120%);
		border-radius: var(--radius-xs);
		overflow: hidden;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		cursor: pointer;
		user-select: none;
		border: 2px solid transparent;
		will-change: transform;
		height: 220px;
		opacity: 0;
		animation: photoFadeIn 0.5s ease-out forwards;
	}

	.photo-card:hover {
		transform: translateY(-6px) scale(1.02);
		box-shadow:
			0 12px 30px rgba(2, 6, 23, 0.45),
			0 6px 15px rgba(2, 6, 23, 0.25);
		border-color: rgba(255, 255, 255, 0.08);
		z-index: 10;
	}

	.photo-card.selected {
		border-color: var(--accent);
		box-shadow:
			0 0 0 3px rgba(59, 130, 246, 0.3),
			0 8px 25px rgba(59, 130, 246, 0.2);
	}

	@keyframes photoFadeIn {
		from {
			opacity: 0;
			transform: scale(0.95) translateY(10px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	.photo-card :global(.lazy-image-container) {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
	}

	.photo-card :global(.lazy-image) {
		transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		object-fit: cover;
	}

	.photo-card:hover :global(.lazy-image) {
		transform: scale(1.05);
	}

	.photo-info {
		padding: 0.75rem;
		font-size: 0.75rem;
		color: white;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		background: linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent);
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		opacity: 0;
		transition: opacity 0.3s ease;
		pointer-events: none;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
	}

	.photo-card:hover .photo-info {
		opacity: 1;
	}

	.restore-btn {
		position: absolute;
		top: 0.625rem;
		right: 0.625rem;
		z-index: 10;
		padding: 0.5rem;
		width: 36px;
		height: 36px;
		background: rgba(34, 197, 94, 0.9);
		backdrop-filter: blur(8px);
		border: none;
		border-radius: var(--radius-sm, 6px);
		color: white;
		cursor: pointer;
		opacity: 0;
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.photo-card:hover .restore-btn {
		opacity: 1;
	}

	.restore-btn:hover {
		background: rgba(34, 197, 94, 1);
		transform: scale(1.1);
	}

	.delete-permanent-btn {
		position: absolute;
		bottom: 0.625rem;
		right: 0.625rem;
		z-index: 10;
		padding: 0.5rem;
		width: 36px;
		height: 36px;
		background: rgba(220, 38, 38, 0.9);
		backdrop-filter: blur(8px);
		border: none;
		border-radius: var(--radius-sm, 6px);
		color: white;
		cursor: pointer;
		opacity: 0;
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.photo-card:hover .delete-permanent-btn {
		opacity: 1;
	}

	.delete-permanent-btn:hover {
		background: rgba(220, 38, 38, 1);
		transform: scale(1.1);
	}

	.selection-checkbox {
		position: absolute;
		top: 0.625rem;
		left: 0.625rem;
		z-index: 5;
		opacity: 0;
		transition: opacity 0.2s ease;
	}

	.selection-mode .selection-checkbox,
	.photo-card:hover .selection-checkbox {
		opacity: 1;
	}

	.selection-checkbox.checked {
		opacity: 1;
	}

	.selection-checkbox input[type='checkbox'] {
		width: 1.25rem;
		height: 1.25rem;
		cursor: pointer;
		accent-color: var(--accent);
	}

	.photo-card.selected {
		outline: 3px solid var(--accent, #3b82f6);
		outline-offset: -3px;
	}

	.btn-delete-selection {
		background: #dc2626 !important;
	}

	.btn-delete-selection:hover:not(:disabled) {
		background: #b91c1c !important;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 4rem 1rem;
		color: var(--text-secondary);
	}

	.empty-state p {
		font-size: 1.125rem;
		margin: 0;
	}

	@media (max-width: 768px) {
		.photos-flex {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
			gap: 0.75rem;
		}

		.photo-card {
			margin: 0;
			height: 160px;
		}

		.flex-spacer {
			display: none;
		}
	}

	@media (max-width: 480px) {
		.photos-flex {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
