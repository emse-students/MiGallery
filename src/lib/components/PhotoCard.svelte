<script lang="ts">
	import Icon from './Icon.svelte';
	import LazyImage from './LazyImage.svelte';
	import PhotoSkeleton from './PhotoSkeleton.svelte';
	import type { Asset } from '$lib/photos.svelte';

	interface Props {
		asset: Asset;
		isSelected?: boolean;
		isSelecting?: boolean;
		canDelete?: boolean;
		onCardClick?: (assetId: string, event: MouseEvent) => void;
		onDownload?: (assetId: string, event: Event) => void;
		onDelete?: (assetId: string, event: Event) => void;
		onSelectionToggle?: (assetId: string, selected: boolean) => void;
		albumVisibility?: string;
		albumId?: string;
	}

	let {
		asset,
		isSelected = false,
		isSelecting = false,
		canDelete = false,
		onCardClick,
		onDownload,
		onDelete,
		onSelectionToggle,
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

	// Calculer flex-basis et flex-grow pour la hauteur fixe (220px) et largeur variable
	let flexBasis = $derived(aspectRatio * 220);
	let flexGrow = $derived(aspectRatio * 100);

	// Vérifier si l'asset a les données complètes (pas juste les métadonnées minimales)
	let isFullyLoaded = $derived(asset.originalFileName !== undefined && asset.originalFileName !== null);

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

	// Nom du fichier et autres valeurs — réactifs pour suivre les mises à jour streaming
	let fileName = $derived(asset.originalFileName || asset._raw?.originalFileName || asset.id);
	let thumbnailUrl = $derived(
		albumVisibility === 'unlisted' && albumId
			? `/api/albums/${albumId}/asset-thumbnail/${asset.id}/thumbnail?size=thumbnail`
			: `/api/immich/assets/${asset.id}/thumbnail?size=thumbnail`
	);
	let isVideo = $derived(asset.type === 'VIDEO');
</script>

<!-- Photo Card Container -->
	<div
	class="photo-card {isSelected ? 'selected' : ''}"
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
>
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
			alt={fileName}
			class="photo-img-wrapper"
			aspectRatio={aspectRatioString}
			{isVideo}
		/>

		<!-- File Name Info (shown on hover) -->
		<div class="photo-info" title={fileName}>
			{fileName}
		</div>
	{:else}
		<!-- Skeleton pendant le chargement des détails -->
		<PhotoSkeleton aspectRatio={aspectRatio} />
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
		outline: 3px solid var(--accent);
		outline-offset: -3px;
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

	@media (max-width: 768px) {
		.photo-card {
			height: 160px;
		}
	}
</style>
