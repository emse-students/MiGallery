<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from './Icon.svelte';
	import LazyImage from './LazyImage.svelte';
	import Spinner from './Spinner.svelte';
	import Modal from './Modal.svelte';
	import type { ImmichAsset } from '$lib/types/api';

	interface Props {
		currentPhotoUrl?: string;
		onClose: () => void;
		onPhotoSelected?: (assetId: string) => void;
		peopleId?: string;
			// Accept optional PhotosState when some callers pass it (backwards compatibility)
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
			error = "Aucun identifiant utilisateur fourni";
			loadingAssets = false;
			return;
		}

		try {
			loadingAssets = true;
			error = null;

			// Utiliser l'endpoint de recherche pour récupérer les assets associés à la personne
			const res = await fetch('/api/immich/search/metadata', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ personIds: [peopleId], type: 'IMAGE', page: 1, size: 1000 })
			});
			if (!res.ok) {
				const txt = await res.text().catch(() => res.statusText);
				throw new Error(txt || 'Erreur lors du chargement des photos');
			}

			const data = (await res.json()) as { assets: { items: ImmichAsset[] } };
			const items = data?.assets?.items || [];
			// Normaliser le format pour le rendu
			assets = items.map((it) => ({
				...it,
				_raw: it
			}));
		} catch (e: unknown) {
			console.error('Erreur chargement photos:', e);
			error = (e as Error).message;
		} finally {
			loadingAssets = false;
		}
	}

	async function handlePhotoSelect(assetId: string) {
		// garder la selection en local; la confirmation se fait via le bouton
		selectedAssetId = assetId;
		// Supporter le double-clic pour confirmer rapidement
		// (la confirmation réelle est dans confirmSelection)
	}

	async function confirmSelection() {
		if (!selectedAssetId) return;
		if (!onPhotoSelected) {
			// Si aucun callback fourni, fermer simplement
			onClose();
			return;
		}
		loading = true;
		try {
			await onPhotoSelected(selectedAssetId);
			onClose();
			// Recharger la page automatiquement après la mise à jour réussie
			setTimeout(() => {
				window.location.reload();
			}, 500);
		} catch (e: unknown) {
			console.error('Erreur lors de la confirmation:', e);
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
	bind:show={show}
	title="Changer la photo de profil"
	icon="camera"
	wide={true}
	confirmText={loading ? 'Traitement...' : 'Valider'}
	confirmDisabled={!selectedAssetId || loading}
	showCloseButton={true}
	onConfirm={confirmSelection}
	onCancel={onClose}
>
	<div class="current-photo-section">
		{#if currentPhotoUrl}
			<div class="current-photo">
				<img src={currentPhotoUrl} alt="Profil actuel" />
				<p>Photo de profil actuelle</p>
			</div>
		{/if}

		<div class="instructions">
			<Icon name="image" size={20} />
			<p>Cliquez sur une photo ci-dessous pour la définir comme photo de profil</p>
		</div>
	</div>

	{#if error}
		<div class="error-message">
			<Icon name="alert-circle" size={20} />
			<p>{error}</p>
		</div>
	{/if}

	{#if loading}
		<div class="loading-state">
			<Spinner size={40} />
			<p>Mise à jour en cours...</p>
		</div>
	{:else if loadingAssets}
		<div class="loading-state">
			<Spinner size={40} />
			<p>Chargement de vos photos...</p>
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
					<LazyImage
						src={`/api/immich/assets/${asset.id}/thumbnail?size=thumbnail`}
						alt={asset.originalFileName || 'Photo'}
						class="photo-thumbnail"
						aspectRatio="1"
						isVideo={asset.type === 'VIDEO'}
					/>
					{#if selectedAssetId === asset.id}
						<div class="selected-overlay">
							<Icon name="check-circle" size={32} />
						</div>
					{/if}
				</button>
			{/each}
		</div>
	{:else}
		<div class="empty-state">
			<Icon name="image" size={48} />
			<p>Aucune photo trouvée</p>
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
		border-radius: 8px;
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
		border-radius: 8px;
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
		border-radius: 8px;
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

	.photo-item :global(.lazy-image-container) {
		width: 100%;
		height: 100%;
	}

	.photo-item :global(.lazy-image) {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.selected-overlay {
		position: absolute;
		inset: 0;
		background: rgba(59, 130, 246, 0.3);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		backdrop-filter: blur(2px);
	}

	.empty-state {
		text-align: center;
		padding: 3rem 1rem;
		color: rgba(255, 255, 255, 0.5);
	}

	.empty-state p {
		margin-top: 1rem;
		font-size: 1rem;
	}

	.loading-state {
		text-align: center;
		padding: 2rem;
		color: white;
	}

	.loading-state p {
		margin-top: 1rem;
		color: rgba(255, 255, 255, 0.7);
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
