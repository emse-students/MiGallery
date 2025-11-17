<script lang="ts">
	import Icon from './Icon.svelte';
	import LazyImage from './LazyImage.svelte';

	interface Props {
		asset: any; // Asset object from Immich
		isSelected?: boolean;
		isSelecting?: boolean;
		canDelete?: boolean;
		onCardClick?: (assetId: string, event: MouseEvent) => void;
		onDownload?: (assetId: string, event: Event) => void;
		onDelete?: (assetId: string, event: Event) => void;
		onSelectionToggle?: (assetId: string, selected: boolean) => void;
	}

	let {
		asset,
		isSelected = false,
		isSelecting = false,
		canDelete = false,
		onCardClick,
		onDownload,
		onDelete,
		onSelectionToggle
	}: Props = $props();

	// Déterminer le ratio d'aspect de l'image
	function getAspectRatioString(): string {
		// Essayer d'obtenir les dimensions depuis exifInfo
		if (asset.exifInfo?.exifImageWidth && asset.exifInfo?.exifImageHeight) {
			const w = Math.round(asset.exifInfo.exifImageWidth);
			const h = Math.round(asset.exifInfo.exifImageHeight) || 1;
			return `${w}/${h}`;
		}

		// Essayer _raw.exifInfo
		if (asset._raw?.exifInfo?.exifImageWidth && asset._raw?.exifInfo?.exifImageHeight) {
			const w = Math.round(asset._raw.exifInfo.exifImageWidth);
			const h = Math.round(asset._raw.exifInfo.exifImageHeight) || 1;
			return `${w}/${h}`;
		}

		// Essayer width/height direct dans _raw
		if (asset._raw?.width && asset._raw?.height) {
			const w = Math.round(asset._raw.width);
			const h = Math.round(asset._raw.height) || 1;
			return `${w}/${h}`;
		}

		// Par défaut, ratio 3:2 (paysage)
		return '3/2';
	}

	function handleCardClick(e: MouseEvent) {
		if (onCardClick) {
			onCardClick(asset.id, e);
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

	const fileName = asset.originalFileName || asset.id;
	const thumbnailUrl = `/api/immich/assets/${asset.id}/thumbnail?size=thumbnail`;
	const isVideo = asset.type === 'VIDEO';
</script>

<!-- Photo Card Container -->
<div
	class="photo-card {isSelected ? 'selected' : ''}"
	style="aspect-ratio: {getAspectRatioString()};"
	role="button"
	tabindex="0"
	onclick={handleCardClick}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handleCardClick(e as any);
		}
	}}
>
	<!-- Selection Checkbox -->
	<div class="selection-checkbox {isSelected ? 'checked' : ''}">
		<input
			type="checkbox"
			checked={isSelected}
			onchange={handleCheckboxChange}
			aria-label="Select {fileName}"
		/>
	</div>

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
		{isVideo}
	/>

	<!-- File Name Info (shown on hover) -->
	<div class="photo-info" title={fileName}>
		{fileName}
	</div>
</div>

<style>
	.photo-card {
		position: relative;
		background: var(--bg-elevated);;
		border-radius: var(--radius-xs);
		overflow: hidden;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		cursor: pointer;
		user-select: none;
		border: 5px solid transparent;
		will-change: transform;
		opacity: 0;
        height: 210px;
		animation: photoFadeIn 0.5s ease-out forwards;
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
		transform: translateY(-6px) scale(1.02);
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7), 
		            0 10px 25px rgba(0, 0, 0, 0.5);
		border-color: rgba(255, 255, 255, 0.5);
		z-index: 10;
	}

	.photo-card.selected {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3),
		            0 8px 25px rgba(59, 130, 246, 0.2);
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
		object-fit: contain;
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
</style>
