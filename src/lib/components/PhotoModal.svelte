<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import Icon from './Icon.svelte';
	import ConfirmModal from './ConfirmModal.svelte';
	import { page } from '$app/stores';
	import type { ImmichAsset, User } from '$lib/types/api';
	import type { Asset } from '$lib/photos.svelte';
	import { toast } from '$lib/toast';

	interface Props {
		assetId: string;
		assets: Asset[];
		onClose: () => void;
		onAssetDeleted?: (assetId: string) => void;
		albumVisibility?: string;
		albumId?: string;
	}

	let { assetId = $bindable(), assets, onClose, onAssetDeleted, albumVisibility, albumId }: Props = $props();
	const dispatch = createEventDispatcher();

	let currentIndex = $state(0);
	let asset = $state<Asset | null>(null);
	let mediaUrl = $state<string | null>(null);
	let loading = $state(false);
	let isVideo = $state(false);
	let imageLoaded = $state(false);
	let scale = $state(1);
	let minScale = $state(0.1); // will be recomputed to a dynamic value when the image loads

	// Vérifier le rôle de l'utilisateur
	let userRole = $derived(($page.data.session?.user as User)?.role || 'user');
	let canManagePhotos = $derived(userRole === 'mitviste' || userRole === 'admin');

	// État du modal de confirmation
	let showConfirmModal = $state(false);
	let confirmModalConfig = $state<{
		title: string;
		message: string;
		confirmText?: string;
		onConfirm: () => void;
	} | null>(null);

	function computeMinScale() {
		if (!imgElement || !containerElement) return;
		const imgRect = imgElement.getBoundingClientRect();
		const containerRect = containerElement.getBoundingClientRect();
		if (!imgRect.width || !imgRect.height) return;
		const candidate = Math.min(containerRect.width / imgRect.width, containerRect.height / imgRect.height);
		// permissive: allow dezoom but ensure image still touches at least one side
		minScale = Math.min(1, candidate || 1);
	}
	let isDragging = $state(false);
	let dragStart = $state({ x: 0, y: 0 });
	let translate = $state({ x: 0, y: 0 });
	// baseScale removed: we rely on CSS (max-width / max-height) so scale=1 means "fit to container"
	let imgElement = $state<HTMLImageElement | null>(null);
	let containerElement = $state<HTMLDivElement | null>(null);

	// Prévenir les rechargements répétés de la même asset
	let lastLoadedAssetId = $state<string | null>(null);

	// Trouver l'index actuel
	$effect(() => {
		const index = assets.findIndex(a => a.id === assetId);
		if (index >= 0) currentIndex = index;
	});

	// Charger l'asset actuel
	async function loadAsset(id: string) {
		if (!id) return;
		loading = true;
		imageLoaded = false;
		asset = null;
		mediaUrl = null;
		isVideo = false;

		try {
				// Si l'asset est présent dans la liste `assets`, réutiliser les données locales
				const local = assets.find(a => a.id === id);
				if (local) {
					asset = local;
					isVideo = asset?.type === 'VIDEO';
				} else {
					// Sinon, tenter de récupérer les métadonnées depuis l'API Immich.
					// Pour les albums "unlisted" en accès anonyme, cette requête peut renvoyer 401,
					// donc on la tente uniquement si nécessaire et on ignore les erreurs non fatales.
					try {
						const metaRes = await fetch(`/api/immich/assets/${id}`);
						if (metaRes.ok) {
							const rawAsset = (await metaRes.json()) as ImmichAsset;
							asset = {
								id: rawAsset.id,
								originalFileName: rawAsset.originalFileName,
								type: rawAsset.type,
								_raw: rawAsset
							};
							isVideo = asset?.type === 'VIDEO';
						}
					} catch (err) {
						// Ignorer les erreurs (ex: 401) — on garde les informations minimales si disponibles
						console.debug('Meta fetch failed (ignored):', err);
					}
				}

			if (isVideo) {
				mediaUrl = `/api/immich/assets/${id}/video/playback`;
				imageLoaded = true;
			} else {
			// Choisir dynamiquement la taille de la miniature selon la taille du conteneur
			// Utiliser preview pour les écrans larges, thumbnail pour les petits écrans
			let size = 'preview';
			try {
				const containerWidth = containerElement ? containerElement.clientWidth : window.innerWidth;
				if (containerWidth < 600) size = 'thumbnail';
				else size = 'preview';
			} catch (e: unknown) {
				size = 'preview';
			}

				// Pour les albums en mode "unlisted" on utilise la route publique qui proxy la vignette
				if (albumVisibility === 'unlisted' && albumId) {
					mediaUrl = `/api/albums/${albumId}/asset-thumbnail/${id}/thumbnail?size=${size}`;
				} else {
					mediaUrl = `/api/immich/assets/${id}/thumbnail?size=${size}`;
				}
		}
	} catch (e: unknown) {
		console.error('Erreur chargement asset:', e);
	} finally {
		loading = false;
	}
}

	$effect(() => {
		if (assetId && assetId !== lastLoadedAssetId) {
			loadAsset(assetId);
			lastLoadedAssetId = assetId;
			// Reset zoom and position when changing photo
			// minScale will be set after image loads
			scale = 1;
			translate = { x: 0, y: 0 };
		}
	});

	function handleWheel(e: WheelEvent) {
		if (!mediaUrl || isVideo) return;
		e.preventDefault();

		const container = e.currentTarget as HTMLElement;
		const rect = container.getBoundingClientRect();

		// Position du curseur par rapport au conteneur (0 à 1)
		const mouseX = (e.clientX - rect.left) / rect.width;
		const mouseY = (e.clientY - rect.top) / rect.height;

		const delta = e.deltaY > 0 ? -0.1 : 0.1;
		const oldScale = scale;
		const newScale = Math.min(Math.max(minScale, scale + delta), 3);

		if (newScale !== oldScale) {
			// Calculer le nouveau translate pour garder le point sous le curseur fixe
			const scaleChange = newScale / oldScale;

			// Convertir les coordonnées de la souris en position dans l'image
			const imgCenterX = rect.width / 2;
			const imgCenterY = rect.height / 2;

			// Distance du curseur au centre
			const offsetX = (e.clientX - rect.left) - imgCenterX;
			const offsetY = (e.clientY - rect.top) - imgCenterY;

			// Ajuster le translate
			translate = {
				x: translate.x * scaleChange + offsetX * (1 - scaleChange),
				y: translate.y * scaleChange + offsetY * (1 - scaleChange)
			};

			scale = newScale;

			// Contraindre le translate après le zoom
			// Utiliser un petit délai pour que l'image ait le temps de se redimensionner
			setTimeout(() => {
				translate = constrainTranslate(translate);
			}, 0);
		}

		// Reset position if zoomed out completely
		if (scale <= minScale) {
			translate = { x: 0, y: 0 };
		}
	}

	function handleDoubleClick(e: MouseEvent) {
		if (!mediaUrl || isVideo) return;
		e.preventDefault();

		const rect = (containerElement as HTMLElement).getBoundingClientRect();
		const oldScale = scale;

		// Toggle between a focused zoom (2x) and the minScale
		const target = oldScale >= 2 ? minScale : Math.min(2, 3);
		const newScale = Math.min(Math.max(minScale, target), 3);

		if (newScale === oldScale) return;

		const scaleChange = newScale / oldScale;

		const imgCenterX = rect.width / 2;
		const imgCenterY = rect.height / 2;

		const offsetX = (e.clientX - rect.left) - imgCenterX;
		const offsetY = (e.clientY - rect.top) - imgCenterY;

		translate = {
			x: translate.x * scaleChange + offsetX * (1 - scaleChange),
			y: translate.y * scaleChange + offsetY * (1 - scaleChange)
		};

		scale = newScale;

		// Constrain after zoom. Use timeout so layout updates first.
		setTimeout(() => { translate = constrainTranslate(translate); }, 0);

		if (scale <= minScale) translate = { x: 0, y: 0 };
	}

	function handleMouseDown(e: MouseEvent) {
		if (scale < 1) return; // Permettre le drag même à zoom 100% (scale === 1)
		isDragging = true;
		dragStart = { x: e.clientX - translate.x, y: e.clientY - translate.y };
	}

	function constrainTranslate(newTranslate: { x: number; y: number }): { x: number; y: number } {
		if (!imgElement || !containerElement || scale <= 1) {
			return { x: 0, y: 0 };
		}

		const imgRect = imgElement.getBoundingClientRect();
		const containerRect = containerElement.getBoundingClientRect();

		// Dimensions de l'image zoomée
		const imgWidth = imgRect.width;
		const imgHeight = imgRect.height;

		// Dimensions du conteneur
		const containerWidth = containerRect.width;
		const containerHeight = containerRect.height;

		// Calculer les limites maximales de déplacement
		const maxTranslateX = Math.max(0, (imgWidth - containerWidth) / 2);
		const maxTranslateY = Math.max(0, (imgHeight - containerHeight) / 2);

		return {
			x: Math.max(-maxTranslateX, Math.min(maxTranslateX, newTranslate.x)),
			y: Math.max(-maxTranslateY, Math.min(maxTranslateY, newTranslate.y))
		};
	}

	function handleMouseMove(e: MouseEvent) {
		if (!isDragging) return;
		const newTranslate = { x: e.clientX - dragStart.x, y: e.clientY - dragStart.y };
		translate = constrainTranslate(newTranslate);
	}



	function handleMouseUp() {
		isDragging = false;
	}

	function resetZoom() {
		scale = minScale;
		translate = { x: 0, y: 0 };
	}

	function goToPrevious() {
		if (currentIndex > 0) {
			assetId = assets[currentIndex - 1].id;
		}
	}

	function goToNext() {
		if (currentIndex < assets.length - 1) {
			assetId = assets[currentIndex + 1].id;
		}
	}

	async function downloadAsset() {
		if (!assetId || !asset) return;
		try {
			const res = await fetch(`/api/immich/assets/${assetId}/original`);
			if (res.ok) {
				const blob = await res.blob();
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = asset.originalFileName || `photo-${assetId}.jpg`;
				a.click();
				URL.revokeObjectURL(url);
			}
		} catch (e: unknown) {
			console.error('Erreur téléchargement:', e);
		}
	}

	async function deleteCurrentAsset(skipConfirmation = false) {
		if (!canManagePhotos || !assetId) return;

		const performDelete = async () => {
			showConfirmModal = false;
			try {
				const res = await fetch(`/api/immich/assets`, {
					method: 'DELETE',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ ids: [assetId] })
				});

				if (!res.ok) {
					// Ne pas essayer de lire le corps si 204 No Content
					if (res.status === 204) {
						// C'est un succès, continuer
					} else {
						const errText = await res.text().catch(() => res.statusText);
						throw new Error(errText || 'Erreur lors de la suppression');
					}
				}

				// Calculer la prochaine photo à afficher AVANT de notifier le parent
				// (évite les conditions de course si le parent met à jour `assets` immédiatement)
				const nextIndexSnapshot = currentIndex < assets.length - 1 ? currentIndex + 1 : currentIndex - 1;
				const nextAssetId = (nextIndexSnapshot >= 0 && nextIndexSnapshot < assets.length) ? assets[nextIndexSnapshot].id : null;

				// Notifier le parent
				if (onAssetDeleted) {
					onAssetDeleted(assetId);
				}
				// Émettre un événement Svelte au cas où le parent écoute via on:assetDeleted
				dispatch('assetDeleted', assetId);

				// Passer à la photo suivante (pré-calculée) ou fermer
				if (nextAssetId) {
					assetId = nextAssetId;
				} else {
					onClose();
				}
			} catch (e: unknown) {
				toast.error('Erreur lors de la suppression: ' + (e as Error).message);
			}
		};

		if (skipConfirmation) {
			await performDelete();
		} else {
			confirmModalConfig = {
				title: 'Supprimer la photo',
				message: 'Voulez-vous vraiment mettre cette photo à la corbeille ?',
				confirmText: 'Mettre à la corbeille',
				onConfirm: performDelete
			};
			showConfirmModal = true;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
		else if (e.key === 'ArrowLeft') goToPrevious();
		else if (e.key === 'ArrowRight') goToNext();
		else if (e.key === '+' || e.key === '=') scale = Math.min(scale + 0.2, 3);
		else if (e.key === '-' || e.key === '_') scale = Math.max(scale - 0.2, minScale);
		else if (e.key === '0') resetZoom();
		else if (e.key === 'Delete') {
			// Shift+Delete = suppression sans confirmation
			// Delete seul = suppression avec confirmation
			if (canManagePhotos) {
				deleteCurrentAsset(e.shiftKey);
			}
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}

	onMount(() => {
		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
		window.addEventListener('resize', () => {
			// recompute minScale on resize
			if (imageLoaded) computeMinScale();
		});
		document.body.classList.add('modal-open');
	});

	onDestroy(() => {
		window.removeEventListener('keydown', handleKeydown);
		window.removeEventListener('mousemove', handleMouseMove);
		window.removeEventListener('mouseup', handleMouseUp);
		document.body.classList.remove('modal-open');
		// Revoke object URL only if we created one
		if (mediaUrl && mediaUrl.startsWith && mediaUrl.startsWith('blob:')) {
			try { URL.revokeObjectURL(mediaUrl); } catch {}
		}
	});
</script>

<div class="modal-backdrop" onclick={handleBackdropClick} role="button" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}>
	<div class="modal-content">
		<div class="modal-header">
			<div class="modal-title">
				{#if asset?.originalFileName}
					<Icon name="image" size={20} />
					<span>{asset.originalFileName}</span>
				{:else}
					<span>Chargement...</span>
				{/if}
			</div>
			<div class="modal-actions">
				{#if !isVideo && mediaUrl}
					<button class="btn-icon" onclick={() => scale = Math.max(scale - 0.2, minScale)} title="Zoom -" disabled={scale <= minScale}>
						<Icon name="minus" size={20} />
					</button>
					<span class="zoom-level">{Math.round(scale * 100)}%</span>
					<button class="btn-icon" onclick={() => scale = Math.min(scale + 0.2, 3)} title="Zoom +" disabled={scale >= 3}>
						<Icon name="plus" size={20} />
					</button>
					<button class="btn-icon" onclick={resetZoom} title="Reset (100%)" disabled={scale === 1}>
						<Icon name="refresh-cw" size={20} />
					</button>
				{/if}
				<button class="btn-icon" onclick={downloadAsset} title="Télécharger" disabled={!asset}>
					<Icon name="download" size={20} />
				</button>
				{#if canManagePhotos}
					<button class="btn-icon btn-delete" onclick={() => deleteCurrentAsset(false)} title="Supprimer (Suppr)" disabled={!asset}>
						<Icon name="trash" size={20} />
					</button>
				{/if}
				<button class="btn-icon" onclick={onClose} title="Fermer">
					<Icon name="x" size={20} />
				</button>
			</div>
		</div>

		<div class="modal-body">
			{#if currentIndex > 0}
				<button class="nav-button nav-left" onclick={goToPrevious} title="Photo précédente">
					<Icon name="chevron-left" size={32} />
				</button>
			{/if}

			<div
				class="media-container"
				onwheel={handleWheel}
				role="img"
				tabindex="-1"
				bind:this={containerElement}
			>


				{#if mediaUrl}
					{#if isVideo}
						<video
							src={mediaUrl}
							controls
							class="media"
							class:loaded={imageLoaded}
						>
							<track kind="captions" />
						</video>
					{:else}
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<img
							bind:this={imgElement}
							src={mediaUrl}
							alt={asset?.originalFileName || 'Photo'}
							class="media"
							class:loaded={imageLoaded}
							class:zoomed={scale > 1}
							class:no-transition={isDragging}
							style="transform: scale({scale}) translate({translate.x / scale}px, {translate.y / scale}px); cursor: {scale >= 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'}"
							onload={() => {
								imageLoaded = true;
								computeMinScale();
								// Apply minScale after computing it
								scale = minScale;
								setTimeout(() => { translate = constrainTranslate(translate); }, 0);
							}}
							onmousedown={handleMouseDown}
							ondblclick={handleDoubleClick}
							draggable="false"
						/>
					{/if}
				{/if}
			</div>

			{#if currentIndex < assets.length - 1}
				<button class="nav-button nav-right" onclick={goToNext} title="Photo suivante">
					<Icon name="chevron-right" size={32} />
				</button>
			{/if}
		</div>

		<div class="modal-footer">
			<span class="counter">{currentIndex + 1} / {assets.length}</span>
		</div>
	</div>
</div>

{#if showConfirmModal && confirmModalConfig}
	<ConfirmModal
		title={confirmModalConfig.title}
		message={confirmModalConfig.message}
		confirmText={confirmModalConfig.confirmText}
		onConfirm={confirmModalConfig.onConfirm}
		onCancel={() => showConfirmModal = false}
	/>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.95);
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
		max-width: 1400px;
		height: 90vh;
		display: flex;
		flex-direction: column;
		animation: slideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1);
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
		padding: 1rem;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 12px 12px 0 0;
		backdrop-filter: blur(10px);
		z-index: 10;
		position: relative;
	}

	.modal-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: white;
		font-weight: 600;
		overflow: hidden;
	}

	.modal-title span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.modal-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.zoom-level {
		color: white;
		font-size: 0.875rem;
		font-weight: 600;
		min-width: 50px;
		text-align: center;
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

	.btn-icon:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.2);
		transform: scale(1.05);
	}

	.btn-icon:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-delete {
		background: rgba(220, 38, 38, 0.8);
	}

	.btn-delete:hover:not(:disabled) {
		background: rgba(220, 38, 38, 1);
	}

	.modal-body {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		min-height: 0;
	}

	.media-container {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		max-height: 100%;
		overflow: hidden;
		user-select: none;
	}



	.media {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		border-radius: 12px;
		opacity: 0;
		/* smooth transform for wheel/button/dblclick zooms */
		transition: opacity 0.3s ease, transform 160ms cubic-bezier(0.2, 0, 0, 1);
		will-change: transform;
	}

	.media.loaded {
		opacity: 1;
	}

	/* disable animation while dragging for immediate response */
	.media.no-transition {
		transition: none !important;
	}

	.nav-button {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		background: rgba(255, 255, 255, 0.1);
		backdrop-filter: blur(10px);
		border: none;
		color: white;
		width: 48px;
		height: 48px;
		border-radius: 50%;
		cursor: pointer;
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10;
	}

	.nav-button:hover {
		background: rgba(255, 255, 255, 0.2);
		transform: translateY(-50%) scale(1.1);
	}

	.nav-left {
		left: 1rem;
	}

	.nav-right {
		right: 1rem;
	}

	.modal-footer {
		padding: 1rem;
		text-align: center;
		color: rgba(255, 255, 255, 0.8);
		background: rgba(255, 255, 255, 0.05);
		border-radius: 0 0 12px 12px;
		backdrop-filter: blur(10px);
		z-index: 10;
		position: relative;
	}

	.counter {
		font-weight: 600;
	}

	@media (max-width: 768px) {
		.modal-content {
			height: 100vh;
		}

		.modal-header {
			border-radius: 0;
		}

		.modal-footer {
			border-radius: 0;
		}

		.nav-button {
			width: 40px;
			height: 40px;
		}

		.nav-left {
			left: 0.5rem;
		}

		.nav-right {
			right: 0.5rem;
		}
	}
</style>
