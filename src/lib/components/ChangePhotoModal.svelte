<script lang="ts">
	import { onMount } from 'svelte';
	import { Image as ImageIcon, AlertCircle, CheckCircle } from 'lucide-svelte';
	import FaceCropThumb from './FaceCropThumb.svelte';
	import Spinner from './Spinner.svelte';
	import Modal from './Modal.svelte';
	import type { ImmichAsset } from '$lib/types/api';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		currentPhotoUrl?: string;
		onClose: () => void;
		onPhotoSelected?: (assetId: string) => void;
		peopleId?: string;
		photosState?: unknown;
	}

	let { currentPhotoUrl, onClose, onPhotoSelected, peopleId }: Props = $props();

	let show = $state(true);
	let selectedAssetId = $state<string | null>(null);
	let loading = $state(false);
	let assets = $state<ImmichAsset[]>([]);
	let loadingAssets = $state(true);
	let error = $state<string | null>(null);

	async function loadUserPhotos() {
		if (!peopleId) {
			error = 'Aucun identifiant utilisateur fourni';
			loadingAssets = false;
			return;
		}

		try {
			loadingAssets = true;
			error = null;

			const res = await fetch('/api/immich/search/metadata', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ personIds: [peopleId], type: 'IMAGE', page: 1, size: 1000 })
			});
			if (!res.ok) {
				const txt = await res.text().catch(() => res.statusText);
				throw new Error(txt || 'Error loading photos');
			}

			const data = (await res.json()) as { assets: { items: ImmichAsset[] } };
			const items = data?.assets?.items || [];
			assets = items.map((it) => ({
				...it,
				_raw: it
			}));
		} catch (e: unknown) {
			console.error('Error loading photos:', e);
			error = (e as Error).message;
		} finally {
			loadingAssets = false;
		}
	}

	async function handlePhotoSelect(assetId: string) {
		selectedAssetId = assetId;
	}

	async function confirmSelection() {
		if (!selectedAssetId) return;
		if (!onPhotoSelected) {
			onClose();
			return;
		}
		loading = true;
		try {
			await onPhotoSelected(selectedAssetId);
			onClose();
			setTimeout(() => {
				window.location.reload();
			}, 500);
		} catch (e: unknown) {
			console.error('Error during confirmation:', e);
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadUserPhotos();
	});
</script>

<Modal
	bind:show
	title={m.cpm_title()}
	icon="camera"
	wide={true}
	confirmText={loading ? m.common_processing() : m.common_validate()}
	confirmDisabled={!selectedAssetId || loading}
	showCloseButton={true}
	onConfirm={confirmSelection}
	onCancel={onClose}
>
	<div class="current-photo-section">
		{#if currentPhotoUrl}
			<div class="current-photo">
				<img src={currentPhotoUrl} alt={m.cpm_current()} />
				<p>{m.cpm_current()}</p>
			</div>
		{/if}

		<div class="instructions">
			<ImageIcon size={20} />
			<p>{m.cpm_pick()}</p>
		</div>
	</div>

	{#if error}
		<div class="error-message">
			<AlertCircle size={20} />
			<p>{error}</p>
		</div>
	{/if}

	{#if loading}
		<div class="loading-state">
			<Spinner size={40} />
			<p>{m.cpm_updating()}</p>
		</div>
	{:else if loadingAssets}
		<div class="loading-state">
			<Spinner size={40} />
			<p>{m.cpm_loading()}</p>
		</div>
	{:else if assets.length > 0}
		<div class="photos-grid">
			{#each assets as asset}
				<button
					class="photo-item {selectedAssetId === asset.id ? 'selected' : ''}"
					onclick={() => handlePhotoSelect(asset.id)}
					ondblclick={confirmSelection}
					title={asset.originalFileName || 'Photo'}
				>
					<FaceCropThumb
						assetId={asset.id}
						personId={peopleId ?? ''}
						alt={asset.originalFileName || 'Photo'}
					/>
					{#if selectedAssetId === asset.id}
						<div class="selected-overlay">
							<CheckCircle size={32} />
						</div>
					{/if}
				</button>
			{/each}
		</div>
	{:else}
		<div class="empty-state">
			<ImageIcon size={48} />
			<p>{m.pg_empty()}</p>
		</div>
	{/if}
</Modal>

<style>
	.current-photo-section {
		margin-bottom: 1.5rem;
	}

	.current-photo {
		text-align: center;
		margin-bottom: 1.5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.current-photo img {
		width: 120px;
		height: 120px;
		border-radius: 50%;
		object-fit: cover;
		border: 3px solid rgba(255, 255, 255, 0.2);
		margin-bottom: 0.75rem;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}

	.current-photo p {
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.875rem;
		margin: 0;
	}

	.instructions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		background: rgba(59, 130, 246, 0.1);
		border: 1px solid rgba(59, 130, 246, 0.3);
		border-radius: var(--radius-xs);
		color: rgba(255, 255, 255, 0.9);
	}

	.instructions p {
		margin: 0;
		font-size: 0.875rem;
	}

	.error-message {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: var(--radius-xs);
		color: rgba(255, 100, 100, 0.9);
		margin-bottom: 1rem;
	}

	.error-message p {
		margin: 0;
		font-size: 0.875rem;
	}

	.photos-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 1rem;
		margin-top: 1.5rem;
	}

	.photo-item {
		position: relative;
		aspect-ratio: 1;
		border-radius: var(--radius-xs);
		overflow: hidden;
		cursor: pointer;
		border: 2px solid transparent;
		transition: all 0.2s ease;
		background: rgba(255, 255, 255, 0.05);
		padding: 0;
	}

	.photo-item:hover {
		border-color: rgba(255, 255, 255, 0.3);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		z-index: 1;
	}

	.photo-item.selected {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3);
	}

	.selected-overlay {
		position: absolute;
		inset: 0;
		background: color-mix(in srgb, var(--accent) 30%, transparent);
		display: flex;
		align-items: center;
		justify-content: center;
		color: #fff;
		backdrop-filter: blur(2px);
	}

	.empty-state {
		text-align: center;
		padding: 3rem 1rem;
		color: var(--text-muted);
	}

	.empty-state p {
		margin-top: 1rem;
		font-size: 1rem;
	}

	.loading-state {
		text-align: center;
		padding: 2rem;
		color: var(--text-primary);
	}

	.loading-state p {
		margin-top: 1rem;
		color: var(--text-secondary);
	}

	@media (max-width: 768px) {
		.photos-grid {
			grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
			gap: 0.75rem;
		}

		.current-photo img {
			width: 100px;
			height: 100px;
		}
	}
</style>
