<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import Icon from './Icon.svelte';
	import LazyImage from './LazyImage.svelte';
	import Spinner from './Spinner.svelte';

	interface Props {
		currentPhotoUrl?: string;
		onClose: () => void;
		onPhotoSelected?: (assetId: string) => void;
		peopleId?: string;
	}

	let { currentPhotoUrl, onClose, onPhotoSelected, peopleId }: Props = $props();

	let selectedAssetId = $state<string | null>(null);
	let loading = $state(false);
	let assets = $state<any[]>([]);
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

			const data = await res.json();
			const items = data?.assets?.items || [];
			// Normaliser le format pour le rendu
			assets = items.map((it: any) => ({
				id: it.id,
				originalFileName: it.originalFileName,
				type: it.type,
				_raw: it
			}));
		} catch (e) {
			console.error('Erreur chargement photos:', e);
			error = (e as Error).message;
		} finally {
			loadingAssets = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
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
		} catch (e) {
			console.error('Erreur lors de la confirmation:', e);
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	function cancelSelection() {
		selectedAssetId = null;
	}

	onMount(() => {
		window.addEventListener('keydown', handleKeydown);
		document.body.classList.add('modal-open');
		loadUserPhotos();
	});

	onDestroy(() => {
		window.removeEventListener('keydown', handleKeydown);
		document.body.classList.remove('modal-open');
	});
</script>

<div class="modal-backdrop" onclick={handleBackdropClick} role="button" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}>
	<div class="modal-content">
		<div class="modal-header">
			<div class="modal-title">
				<Icon name="camera" size={24} />
				<span>Changer la photo de profil</span>
			</div>
			<button class="btn-icon" onclick={onClose} title="Fermer">
				<Icon name="x" size={24} />
			</button>
		</div>

		<div class="modal-body">
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

				<!-- Floating validate button: only visible when a photo is selected -->
				{#if selectedAssetId}
					<button class="floating-validate" onclick={confirmSelection} disabled={loading} title="Valider la sélection">
						{#if loading}
							<Spinner size={18} />
							<span style="margin-left:8px">Traitement...</span>
						{:else}
							Valider
						{/if}
					</button>
				{/if}
			{:else}
				<div class="empty-state">
					<Icon name="image" size={48} />
					<p>Aucune photo trouvée</p>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.9);
		backdrop-filter: blur(20px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		animation: fadeIn 0.2s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.modal-content {
		width: 100%;
		max-width: 900px;
		max-height: 90vh;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 16px;
		backdrop-filter: blur(20px);
		border: 1px solid rgba(255, 255, 255, 0.1);
		animation: slideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	@keyframes slideUp {
		from {
			transform: translateY(20px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.5rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}

	.modal-title {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: white;
		font-size: 1.25rem;
		font-weight: 600;
	}

	.btn-icon {
		background: rgba(255, 255, 255, 0.1);
		border: none;
		color: white;
		padding: 0.5rem;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.btn-icon:hover {
		background: rgba(255, 255, 255, 0.2);
		transform: scale(1.05);
	}

	.modal-body {
		padding: 1.5rem;
		overflow-y: auto;
		flex: 1;
		min-height: 0;
		position: relative;
	}

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
		transform: scale(1.05);
		border-color: rgba(255, 255, 255, 0.3);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
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

	.floating-validate {
		/* Fixed to viewport bottom so it doesn't depend on modal scroll */
		position: fixed;
		left: 50%;
		transform: translateX(-50%);
		bottom: calc(env(safe-area-inset-bottom, 1rem) + 20px);
		z-index: 999999; /* ensure above other modal layers */
		background: linear-gradient(90deg, var(--accent), #8b5cf6);
		color: white;
		padding: 0.9rem 1.4rem;
		border-radius: 999px;
		border: 1px solid rgba(255,255,255,0.08);
		cursor: pointer;
		box-shadow: 0 -28px 60px rgba(0,0,0,0.65), 0 18px 48px rgba(0,0,0,0.48);
		font-weight: 700;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		max-width: calc(100% - 2rem);
		height: auto;
		transition: transform 180ms cubic-bezier(.2,0,.2,1), box-shadow 180ms ease, filter 120ms ease;
		text-shadow: 0 1px 2px rgba(0,0,0,0.6);
	}

	.floating-validate:hover:not(:disabled) {
		transform: translateX(-50%) translateY(-6px) scale(1.03);
		box-shadow: 0 -44px 78px rgba(0,0,0,0.72), 0 22px 56px rgba(0,0,0,0.55);
		filter: brightness(1.06);
	}

	.floating-validate:active:not(:disabled) {
		transform: translateX(-50%) translateY(-2px) scale(0.995);
	}

	.floating-validate::before {
		/* subtle gradient behind the fixed button to improve contrast; kept under the button */
		content: '';
		position: fixed;
		left: 50%;
		/* place gradient slightly below the button so it doesn't overlap */
		bottom: calc(env(safe-area-inset-bottom, 1rem) - 40px);
		transform: translateX(-50%);
		width: 220%;
		height: 140px;
		background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%);
		z-index: 999998; /* below button */
		pointer-events: none;
		border-radius: 0 0 16px 16px;
	}

	.floating-validate:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	@media (max-width: 768px) {
		.modal-content {
			max-width: 95vw;
			max-height: 95vh;
		}

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
