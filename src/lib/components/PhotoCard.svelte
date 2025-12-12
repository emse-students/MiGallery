<script lang="ts">
	import Icon from './Icon.svelte';
	import LazyImage from './LazyImage.svelte';
	import Skeleton from './Skeleton.svelte';
	import type { Asset } from '$lib/photos.svelte';

	interface Props {
		asset: Asset;
		isSelected?: boolean;
		isSelecting?: boolean;
		canDelete?: boolean;
		showFavorite?: boolean;
		onCardClick?: (assetId: string, event: MouseEvent) => void;
		onDownload?: (assetId: string, event: Event) => void;
		onDelete?: (assetId: string, event: Event) => void;
		onSelectionToggle?: (assetId: string, selected: boolean) => void;
		onFavoriteToggle?: (assetId: string, event: Event) => void;
		albumVisibility?: string;
		albumId?: string;
	}

	let {
		asset,
		isSelected = false,
		isSelecting = false,
		canDelete = false,
		showFavorite = false,
		onCardClick,
		onDownload,
		onDelete,
		onSelectionToggle,
		onFavoriteToggle,
		albumVisibility,
		albumId
	}: Props = $props();

	// Déterminer le ratio d'aspect de l'image
	function getAspectRatio(): number {
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

	function getAspectRatioString(): string {
		const ratio = getAspectRatio();
		// Convertir en fraction approximative pour CSS
		const width = Math.round(ratio * 100);
		const height = 100;
		return `${width}/${height}`;
	}

	// Exposer un ratio utilisable par LazyImage (même format string "W/H")
	let aspectRatio = $derived(getAspectRatio());
	let aspectRatioString = $derived(getAspectRatioString());

	// Calculer flex-basis et flex-grow pour la hauteur fixe (220px desktop, 120px mobile) et largeur variable
	// On utilise une hauteur de base de 220px pour desktop
	let flexBasis = $derived(aspectRatio * 220);
	let flexGrow = $derived(aspectRatio * 100);

	// Vérifier si l'asset a les données complètes (pas juste les métadonnées minimales)
	let isFullyLoaded = $derived(asset.originalFileName !== undefined && asset.originalFileName !== null);

	// État pour l'appui long sur mobile (affiche les boutons d'action)
	let showMobileActions = $state(false);
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	const LONG_PRESS_DURATION = 500; // ms

	function handleTouchStart(e: TouchEvent) {
		// Ne pas déclencher si on touche un bouton
		if ((e.target as HTMLElement).closest('button')) return;

		longPressTimer = setTimeout(() => {
			showMobileActions = true;
			// Vibration haptique si disponible
			if (navigator.vibrate) {
				navigator.vibrate(50);
			}
		}, LONG_PRESS_DURATION);
	}

	function handleTouchEnd() {
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	}

	function handleTouchMove() {
		// Annuler l'appui long si l'utilisateur bouge le doigt
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	}

	function closeMobileActions() {
		showMobileActions = false;
	}

	function handleCardClick(e: Event) {
		if (onCardClick) {
			onCardClick(asset.id, e as unknown as MouseEvent);
		}
	}

	function handleDownloadClick(e: Event) {
		e.stopPropagation();
		if (onDownload) {
			onDownload(asset.id, e);
		}
	}

	function handleDeleteClick(e: Event) {
		e.stopPropagation();
		if (onDelete) {
			onDelete(asset.id, e);
		}
	}

	function handleCheckboxChange(e: Event) {
		e.stopPropagation();
		const checked = (e.target as HTMLInputElement).checked;
		if (onSelectionToggle) {
			onSelectionToggle(asset.id, checked);
		}
	}

	function handleFavoriteClick(e: Event) {
		e.stopPropagation();
		if (onFavoriteToggle) {
			onFavoriteToggle(asset.id, e);
		}
	}

	// Nom du fichier et autres valeurs — réactifs pour suivre les mises à jour streaming
	let fileName = $derived(asset.originalFileName || asset._raw?.originalFileName || asset.id);
	// Ne PAS utiliser asset._raw?.isFavorite car c'est la valeur d'Immich (partagée entre utilisateurs)
	// On utilise uniquement asset.isFavorite qui est chargé depuis notre base locale
	let isFavorite = $derived(asset.isFavorite ?? false);
	let thumbnailUrl = $derived(
		albumVisibility === 'unlisted' && albumId
			? `/api/albums/${albumId}/asset-thumbnail/${asset.id}/thumbnail?size=preview`
			: `/api/immich/assets/${asset.id}/thumbnail?size=preview`
	);

	let highResUrl = $derived(
		albumVisibility === 'unlisted' && albumId
			? undefined
			: `/api/immich/assets/${asset.id}/original`
	);
	let isVideo = $derived(asset.type === 'VIDEO');
</script>

<!-- Photo Card Container -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
	class="photo-card {isSelected ? 'selected' : ''} {showMobileActions ? 'mobile-actions-visible' : ''}"
	style="flex-basis: {flexBasis}px; flex-grow: {flexGrow};"
	role="button"
	tabindex="0"
	onclick={handleCardClick}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handleCardClick(e);
		}
	}}
	ontouchstart={handleTouchStart}
	ontouchend={handleTouchEnd}
	ontouchmove={handleTouchMove}
	ontouchcancel={handleTouchEnd}
>
	<!-- Overlay pour fermer les actions mobiles -->
	{#if showMobileActions}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="mobile-actions-overlay" onclick={(e) => { e.stopPropagation(); closeMobileActions(); }}></div>
	{/if}

	<!-- Selection Checkbox -->
	<div class="selection-checkbox {isSelected ? 'checked' : ''}">
		<input
			type="checkbox"
			checked={isSelected}
			onclick={(e) => e.stopPropagation()}
			onchange={handleCheckboxChange}
			aria-label={`Select ${fileName}`}
		/>
	</div>

	{#if isFullyLoaded}
		<!-- Favorite Button (bottom left) -->
		{#if showFavorite && !isSelecting}
			<button
				class="favorite-btn {isFavorite ? 'active' : ''}"
				title={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
				onclick={handleFavoriteClick}
				aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
			>
				<Icon name={isFavorite ? 'heart-filled' : 'heart'} size={18} />
			</button>
		{/if}

		<!-- Download Button (visible when not selecting and not hovered unless in selection mode) -->
		{#if !isSelecting}
			<button
				class="download-btn"
				title="Télécharger"
				onclick={handleDownloadClick}
				aria-label="Download {fileName}"
			>
				<Icon name="download" size={18} />
			</button>

			<!-- Delete Button (only if user can delete) -->
			{#if canDelete}
				<button
					class="delete-btn"
					title="Mettre à la corbeille"
					onclick={handleDeleteClick}
					aria-label="Delete {fileName}"
				>
					<Icon name="trash" size={18} />
				</button>
			{/if}
		{/if}

		<!-- Image/Video Thumbnail -->
		<LazyImage
			 src={thumbnailUrl}
			 highRes={highResUrl}
			 alt={fileName}
			 class="photo-img-wrapper"
			 aspectRatio={aspectRatioString}
			 {isVideo}
		/>
	{:else}
		<!-- Skeleton pendant le chargement des détails -->
		<Skeleton aspectRatio={aspectRatioString}>
			<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
				<path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" fill="currentColor" opacity="0.3"/>
			</svg>
		</Skeleton>
	{/if}
</div>

<style>
	.photo-card {
		position: relative;
		height: 220px;
		background: var(--bg-elevated);
		border-radius: 6px;
		overflow: hidden;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		cursor: pointer;
		user-select: none;
		will-change: transform;
		opacity: 0;
		animation: photoFadeIn 0.5s ease-out forwards;
		max-width: 400px;
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

	.photo-card:hover {
		transform: translateY(-2px);
		box-shadow: 0 12px 24px rgba(0, 0, 0, 0.4);
		z-index: 10;
	}

	.photo-card.selected {
		/* Make selection persistent and clearly visible */
		outline: none;
		box-shadow: 0 0 0 3px rgba(59,130,246,0.95); /* fallback accent color */
		/* Keep the selected card above siblings so the frame is visible */
		z-index: 20;
		transform: translateY(-2px);
	}

	/* Ensure checkbox is visible when selected even without hover */
	.photo-card.selected .selection-checkbox {
		opacity: 1;
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
		/* cover permet de remplir la carte en respectant le ratio; avoid letterbox */
		object-fit: cover;
	}

	.photo-card:hover :global(.lazy-image) {
		transform: scale(1.05);
	}

	.selection-checkbox {
		position: absolute;
		top: 0.625rem;
		left: 0.625rem;
		z-index: 5;
		opacity: 0;
		transition: opacity 0.2s ease;
	}

	/* Visible au hover OU en mode sélection */
	.photo-card:hover .selection-checkbox {
		opacity: 1;
	}

	.selection-checkbox.checked {
		opacity: 1;
	}

	.selection-checkbox input {
		width: 1.25rem;
		height: 1.25rem;
		cursor: pointer;
		accent-color: var(--accent);
	}

	.favorite-btn {
		position: absolute;
		bottom: 0.625rem;
		left: 0.625rem;
		z-index: 5;
		padding: 0.5rem;
		width: 36px;
		height: 36px;
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(8px);
		border: none;
		border-radius: var(--radius-sm);
		color: white;
		cursor: pointer;
		opacity: 0;
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.favorite-btn.active {
		opacity: 1;
		color: white;
		background: #ef4444;
	}

	.photo-card:hover .favorite-btn {
		opacity: 1;
	}

	.favorite-btn:hover {
		background: rgba(239, 68, 68, 0.3);
		color: #ef4444;
		transform: scale(1.1);
	}

	.download-btn {
		position: absolute;
		top: 0.625rem;
		right: 0.625rem;
		z-index: 5;
		padding: 0.5rem;
		width: 36px;
		height: 36px;
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(8px);
		border: none;
		border-radius: var(--radius-sm);
		color: white;
		cursor: pointer;
		opacity: 0;
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.photo-card:hover .download-btn {
		opacity: 1;
	}

	.download-btn:hover {
		background: rgba(0, 0, 0, 0.9);
		transform: scale(1.1);
	}

	.delete-btn {
		position: absolute;
		bottom: 0.625rem;
		right: 0.625rem;
		z-index: 5;
		padding: 0.5rem;
		width: 36px;
		height: 36px;
		background: rgba(220, 38, 38, 0.8);
		backdrop-filter: blur(8px);
		border: none;
		border-radius: var(--radius-sm);
		color: white;
		cursor: pointer;
		opacity: 0;
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.photo-card:hover .delete-btn {
		opacity: 1;
	}

	.delete-btn:hover {
		background: rgba(220, 38, 38, 1);
		transform: scale(1.1);
	}

	@media (max-width: 768px) {
		.photo-card {
			height: auto;
			aspect-ratio: 1;
			/* 4 photos par ligne sur mobile: 100% / 4 = 25%, moins les gaps */
			flex-basis: calc(25% - 3px) !important;
			flex-grow: 0 !important;
			max-width: calc(25% - 3px);
		}

		/* Cacher les boutons par défaut sur mobile (pas de hover) */
		.download-btn,
		.delete-btn,
		.favorite-btn:not(.active) {
			opacity: 0;
			pointer-events: none;
		}

		/* Afficher les boutons après appui long */
		.photo-card.mobile-actions-visible .download-btn,
		.photo-card.mobile-actions-visible .delete-btn,
		.photo-card.mobile-actions-visible .favorite-btn {
			opacity: 1;
			pointer-events: auto;
		}

		/* Favoris actifs toujours visibles sur mobile */
		.favorite-btn.active {
			opacity: 1;
			pointer-events: auto;
		}
	}

	/* Overlay pour fermer les actions mobiles */
	.mobile-actions-overlay {
		position: fixed;
		inset: 0;
		z-index: 4;
		background: transparent;
	}

	@media (max-width: 480px) {
		.photo-card {
			/* 4 photos par ligne: plus compact */
			flex-basis: calc(25% - 2px) !important;
			max-width: calc(25% - 2px);
		}
	}
</style>
