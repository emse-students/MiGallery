<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import Icon from './Icon.svelte';
	import Modal from './Modal.svelte';
	import { page } from '$app/stores';
	import type { ImmichAsset, User } from '$lib/types/api';
	import type { Asset } from '$lib/photos.svelte';
	import { toast } from '$lib/toast';
	import { setAlbumCover } from '$lib/immich/albums';
	import { clientCache } from '$lib/client-cache';

	interface Props {
		assetId: string;
		assets: Asset[];
		onClose: () => void;
		onAssetDeleted?: (assetId: string) => void;
		albumVisibility?: string;
		albumId?: string;
		showFavorite?: boolean;
		onFavoriteToggle?: (assetId: string) => Promise<void>;
	}

	let { assetId = $bindable(), assets, onClose, onAssetDeleted, albumVisibility, albumId, showFavorite = false, onFavoriteToggle }: Props = $props();
	const dispatch = createEventDispatcher();

	// -- État réactif --
	let currentIndex = $state(0);
	let asset = $state<Asset | null>(null);
	let mediaUrl = $state<string | null>(null);
	let loading = $state(false);
	let isVideo = $state(false);
	let imageLoaded = $state(false);
	let highResLoaded = $state(false);

	// -- État du Zoom --
	let scale = $state(1);
	let minScale = $state(0.1);
	const MAX_SCALE = 5;

	// Variable de suivi pour éviter le reset lors du chargement de la haute résolution
	let lastProcessedAssetId = $state<string | null>(null);

	let userRole = $derived(($page.data.session?.user as User)?.role || 'user');
	let canManagePhotos = $derived(userRole === 'mitviste' || userRole === 'admin');

	let showConfirmModal = $state(false);
	let confirmModalConfig = $state<{
		title: string;
		message: string;
		confirmText?: string;
		onConfirm: () => void;
	} | null>(null);

	function computeMinScale(): number {
		return 0.5;
	}
	let isDragging = $state(false);
	let dragStart = $state({ x: 0, y: 0 });
	let translate = $state({ x: 0, y: 0 });
	let imgElement = $state<HTMLImageElement | null>(null);
	let containerElement = $state<HTMLDivElement | null>(null);

	let portalRoot = $state<HTMLDivElement | null>(null);

	let touchStartDistance = $state(0);
	let touchStartScale = $state(1);
	let isTouchDragging = $state(false);
	let touchDragStart = $state({ x: 0, y: 0 });
	let lastTouchEnd = $state(0);

	let lastLoadedAssetId = $state<string | null>(null);

	$effect(() => {
		const index = assets.findIndex(a => a.id === assetId);
		if (index >= 0) currentIndex = index;
	});

	$effect(() => {
		if (!assetId) return;

		const latest = assets.find(a => a.id === assetId) || null;
		if (latest && latest !== asset) {
			asset = latest;
			isVideo = asset?.type === 'VIDEO';
		}
	});

	async function loadAsset(id: string) {
		if (!id) return;
		loading = true;

		// IMPORTANT : On ne reset l'état chargé que si l'ID a changé.
		// Cela permet de garder l'image "preview" affichée pendant que l'image "original" charge.
		if (id !== lastProcessedAssetId) {
			imageLoaded = false;
		}

		highResLoaded = false;
		asset = null;
		mediaUrl = null;
		isVideo = false;

		try {
			const local = assets.find(a => a.id === id);
			if (local) {
				asset = local;
				isVideo = asset?.type === 'VIDEO';
			} else {
				try {
					const metaRes = await fetch(`/api/immich/assets/${id}`);
					if (metaRes.ok) {
						const rawAsset = (await metaRes.json()) as ImmichAsset;
						asset = {
							id: rawAsset.id,
							originalFileName: rawAsset.originalFileName,
							type: rawAsset.type,
							isFavorite: rawAsset.isFavorite,
							_raw: rawAsset
						};
						isVideo = asset?.type === 'VIDEO';
					}
				} catch (err) { void err; }
			}

			if (isVideo) {
				mediaUrl = `/api/immich/assets/${id}/video/playback`;
				imageLoaded = true;
			} else {
				let size = 'preview';
				if (typeof window !== 'undefined') {
					const isMobileViewport = window.innerWidth <= 768;
					const highDPR = (window.devicePixelRatio || 1) > 1.5;
					if (isMobileViewport || highDPR) size = 'original';
				}

				if (albumVisibility === 'unlisted' && albumId) {
					const proxySize = size === 'original' ? 'preview' : size;
					mediaUrl = `/api/albums/${albumId}/asset-thumbnail/${id}/thumbnail?size=${proxySize}`;
				} else {
					mediaUrl = size === 'original'
						? `/api/immich/assets/${id}/original`
						: `/api/immich/assets/${id}/thumbnail?size=${size}`;
				}
			}
		} catch (e) {
			console.error('Erreur chargement asset:', e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (assetId && assetId !== lastLoadedAssetId) {
			loadAsset(assetId);
			lastLoadedAssetId = assetId;
		}
	});

	function handleWheel(e: WheelEvent) {
		if (!mediaUrl || isVideo || !containerElement) return;
		e.preventDefault();

		const rect = containerElement.getBoundingClientRect();
		const delta = e.deltaY > 0 ? -0.2 : 0.2;
		const oldScale = scale;
		const newScale = Math.min(Math.max(minScale, scale + delta), MAX_SCALE);

		if (newScale !== oldScale) {
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

			if (newScale > 1.3 && !highResLoaded) ensureHighRes();
			setTimeout(() => { translate = constrainTranslate(translate); }, 0);
		}
		if (scale <= 1) translate = { x: 0, y: 0 };
	}

	function handleDoubleClick(e: MouseEvent) {
		if (!mediaUrl || isVideo || !containerElement) return;
		e.preventDefault();

		const rect = containerElement.getBoundingClientRect();
		const oldScale = scale;
		const target = oldScale > 1.1 ? 1 : 2.5;

		const scaleChange = target / oldScale;
		const imgCenterX = rect.width / 2;
		const imgCenterY = rect.height / 2;
		const offsetX = (e.clientX - rect.left) - imgCenterX;
		const offsetY = (e.clientY - rect.top) - imgCenterY;

		translate = {
			x: translate.x * scaleChange + offsetX * (1 - scaleChange),
			y: translate.y * scaleChange + offsetY * (1 - scaleChange)
		};
		scale = target;

		if (scale > 1.3 && !highResLoaded) ensureHighRes();
		setTimeout(() => { translate = constrainTranslate(translate); }, 0);
		if (scale <= 1) translate = { x: 0, y: 0 };
	}

	function handleMouseDown(e: MouseEvent) {
		if (scale <= 1) return;
		isDragging = true;
		dragStart = { x: e.clientX - translate.x, y: e.clientY - translate.y };
	}

	function constrainTranslate(newTranslate: { x: number; y: number }): { x: number; y: number } {
		if (!imgElement || !containerElement || scale <= 1) return { x: 0, y: 0 };

		const containerRect = containerElement.getBoundingClientRect();
		const imgAspect = imgElement.naturalWidth / imgElement.naturalHeight;
		const containerAspect = containerRect.width / containerRect.height;

		let displayedWidth, displayedHeight;
		if (imgAspect > containerAspect) {
			displayedWidth = containerRect.width;
			displayedHeight = containerRect.width / imgAspect;
		} else {
			displayedHeight = containerRect.height;
			displayedWidth = containerRect.height * imgAspect;
		}

		const scaledWidth = displayedWidth * scale;
		const scaledHeight = displayedHeight * scale;
		const maxTranslateX = Math.max(0, (scaledWidth - containerRect.width) / 2);
		const maxTranslateY = Math.max(0, (scaledHeight - containerRect.height) / 2);

		return {
			x: Math.max(-maxTranslateX, Math.min(maxTranslateX, newTranslate.x)),
			y: Math.max(-maxTranslateY, Math.min(maxTranslateY, newTranslate.y))
		};
	}

	function handleMouseMove(e: MouseEvent) {
		if (!isDragging) return;
		translate = constrainTranslate({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
	}

	function handleMouseUp() { isDragging = false; }

	async function ensureHighRes() {
		if (!asset || isVideo || highResLoaded) return;
		try {
			if (albumVisibility === 'unlisted' && albumId) {
				highResLoaded = true;
				return;
			}
			mediaUrl = `/api/immich/assets/${asset.id}/original`;
			highResLoaded = true;
		} catch (e) { console.warn('Échec chargement haute résolution', e); }
	}

	function getTouchDistance(touches: TouchList): number {
		if (touches.length < 2) return 0;
		const dx = touches[0].clientX - touches[1].clientX;
		const dy = touches[0].clientY - touches[1].clientY;
		return Math.sqrt(dx * dx + dy * dy);
	}

	function handleTouchStart(e: TouchEvent) {
		if (e.touches.length === 2) {
			e.preventDefault();
			touchStartDistance = getTouchDistance(e.touches);
			touchStartScale = scale;
			isTouchDragging = false;
		} else if (e.touches.length === 1) {
			const now = Date.now();
			if (now - lastTouchEnd < 300) {
				e.preventDefault();
				if (scale > 1.1) {
					scale = 1;
					translate = { x: 0, y: 0 };
				} else {
					scale = 2.5;
				}
				lastTouchEnd = 0;
			} else if (scale > 1) {
				isTouchDragging = true;
				touchDragStart = { x: e.touches[0].clientX - translate.x, y: e.touches[0].clientY - translate.y };
			}
		}
	}

	function handleTouchMove(e: TouchEvent) {
		if (e.touches.length === 2 && touchStartDistance > 0) {
			e.preventDefault();
			const currentDistance = getTouchDistance(e.touches);
			const scaleChange = currentDistance / touchStartDistance;
			scale = Math.max(minScale, Math.min(MAX_SCALE, touchStartScale * scaleChange));
			if (scale > 1.3 && !highResLoaded) ensureHighRes();
			if (scale <= 1) translate = { x: 0, y: 0 };
		} else if (e.touches.length === 1 && isTouchDragging && scale > 1) {
			e.preventDefault();
			translate = constrainTranslate({
				x: e.touches[0].clientX - touchDragStart.x,
				y: e.touches[0].clientY - touchDragStart.y
			});
		}
	}

	function handleTouchEnd(e: TouchEvent) {
		if (e.touches.length === 0) {
			lastTouchEnd = Date.now();
			touchStartDistance = 0;
			isTouchDragging = false;
			setTimeout(() => { translate = constrainTranslate(translate); }, 0);
			if (scale <= 1) translate = { x: 0, y: 0 };
		}
	}

	function resetZoom() { scale = 1; translate = { x: 0, y: 0 }; }
	function goToPrevious() { if (currentIndex > 0) assetId = assets[currentIndex - 1].id; }
	function goToNext() { if (currentIndex < assets.length - 1) assetId = assets[currentIndex + 1].id; }

	async function downloadAsset() {
		if (!assetId || !asset) return;
		try {
			let downloadUrl = `/api/immich/assets/${assetId}/original`;
			if (albumVisibility === 'unlisted' && albumId) {
				downloadUrl = `/api/albums/${albumId}/asset-original/${assetId}`;
			}
			const res = await fetch(downloadUrl);
			if (res.ok) {
				const blob = await res.blob();
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = asset.originalFileName || `photo-${assetId}.jpg`;
				a.click();
				URL.revokeObjectURL(url);
			}
		} catch (e) { console.error('Erreur téléchargement:', e); }
	}

	async function handleSetCover() {
		if (!albumId || !assetId) return;
		try {
			await setAlbumCover(albumId, assetId);
			toast.success('Couverture mise à jour');
			clientCache.delete('album-covers', albumId);
		} catch (e) { toast.error('Erreur: ' + (e as Error).message); }
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
				if (!res.ok && res.status !== 204) {
					const errText = await res.text().catch(() => res.statusText);
					throw new Error(errText || 'Erreur lors de la suppression');
				}
				const nextIndexSnapshot = currentIndex < assets.length - 1 ? currentIndex + 1 : currentIndex - 1;
				const nextAssetId = (nextIndexSnapshot >= 0 && nextIndexSnapshot < assets.length) ? assets[nextIndexSnapshot].id : null;
				if (onAssetDeleted) onAssetDeleted(assetId);
				dispatch('assetDeleted', assetId);
				if (nextAssetId) assetId = nextAssetId;
				else onClose();
			} catch (e) { toast.error('Erreur suppression: ' + (e as Error).message); }
		};
		if (skipConfirmation) await performDelete();
		else {
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
		else if (e.key === '+' || e.key === '=') scale = Math.min(scale + 0.5, MAX_SCALE);
		else if (e.key === '-' || e.key === '_') scale = Math.max(scale - 0.5, minScale);
		else if (e.key === '0') resetZoom();
		else if (e.key === 'Delete' && canManagePhotos) deleteCurrentAsset(e.shiftKey);
	}

	onMount(() => {
		if (portalRoot && portalRoot.parentNode !== document.body) document.body.appendChild(portalRoot);
		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
		document.body.classList.add('modal-open');
	});

	onDestroy(() => {
		window.removeEventListener('keydown', handleKeydown);
		window.removeEventListener('mousemove', handleMouseMove);
		window.removeEventListener('mouseup', handleMouseUp);
		document.body.classList.remove('modal-open');
		if (portalRoot?.parentNode === document.body) {
			try { document.body.removeChild(portalRoot); } catch {}
		}
	});
</script>

<div bind:this={portalRoot} class="modal-backdrop" onclick={(e) => e.target === e.currentTarget && onClose()} role="button" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && onClose()}>
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
				{#if canManagePhotos && albumId}
					<button class="btn-icon" onclick={handleSetCover} title="Définir comme couverture">
						<Icon name="image" size={20} />
					</button>
				{/if}
				{#if !isVideo && mediaUrl}
					<button class="btn-icon" onclick={() => scale = Math.max(scale - 0.5, minScale)} title="Zoom -" disabled={scale <= minScale}>
						<Icon name="minus" size={20} />
					</button>
					<span class="zoom-level">{Math.round(scale * 100)}%</span>
					<button class="btn-icon" onclick={() => scale = Math.min(scale + 0.5, MAX_SCALE)} title="Zoom +" disabled={scale >= MAX_SCALE}>
						<Icon name="plus" size={20} />
					</button>
					<button class="btn-icon" onclick={resetZoom} title="Reset (100%)" disabled={scale === 1}>
						<Icon name="refresh-cw" size={20} />
					</button>
				{/if}
				{#if showFavorite && asset && onFavoriteToggle}
					<button
						class="btn-icon btn-favorite"
						class:active={asset.isFavorite}
						onclick={async () => {
							try { await onFavoriteToggle!(asset!.id); } catch { toast.error('Erreur favori'); }
						}}
						title={asset.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
					>
						<Icon name={asset.isFavorite ? 'heart-filled' : 'heart'} size={20} />
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

			<div class="media-container" onwheel={handleWheel} role="img" tabindex="-1" bind:this={containerElement}>
				{#if mediaUrl}
					{#if isVideo}
						<video src={mediaUrl} controls class="media loaded"><track kind="captions" /></video>
					{:else}
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<img
							bind:this={imgElement}
							src={mediaUrl}
							alt={asset?.originalFileName || 'Photo'}
							class="media"
							class:loaded={imageLoaded}
							class:zoomed={scale > 1}
							class:no-transition={isDragging || isTouchDragging}
							style="transform: scale({scale}) translate({translate.x / scale}px, {translate.y / scale}px); cursor: {scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'}"
							onload={() => {
								// CONDITION CRUCIALE : On ne reset que si on change de photo (pas si on change de résolution)
								if (asset?.id !== lastProcessedAssetId) {
									minScale = computeMinScale();
									scale = 1;
									translate = { x: 0, y: 0 };
									lastProcessedAssetId = asset?.id ?? null;
								}
								imageLoaded = true;
							}}
							onmousedown={handleMouseDown}
							ondblclick={handleDoubleClick}
							ontouchstart={handleTouchStart}
							ontouchmove={handleTouchMove}
							ontouchend={handleTouchEnd}
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
	<Modal bind:show={showConfirmModal} title={confirmModalConfig.title} type="confirm" confirmText={confirmModalConfig.confirmText} onConfirm={confirmModalConfig.onConfirm} onCancel={() => showConfirmModal = false}>
		<p>{confirmModalConfig.message}</p>
	</Modal>
{/if}

<style>
	.modal-backdrop {
		position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(8px) saturate(120%); z-index: 1000;
		display: flex; align-items: center; justify-content: center; padding: 1rem;
		animation: fadeIn 0.2s ease-out;
	}
	@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

	.modal-content {
		width: 100%; max-width: 1400px; height: 90vh;
		display: flex; flex-direction: column;
		animation: slideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255,255,255,0.06);
		border-radius: 12px; backdrop-filter: blur(10px) saturate(120%);
		box-shadow: 0 20px 60px rgba(2,6,23,0.6);
	}
	@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

	.modal-header {
		display: flex; align-items: center; justify-content: space-between;
		padding: 1rem; background: linear-gradient(to bottom, rgba(255,255,255,0.03), rgba(255,255,255,0.01));
		border-bottom: 1px solid rgba(255,255,255,0.04); z-index: 10; backdrop-filter: blur(6px);
	}
	.modal-title { display: flex; align-items: center; gap: 0.5rem; color: white; font-weight: 600; overflow: hidden; }
	.modal-title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.modal-actions { display: flex; gap: 0.5rem; align-items: center; }
	.zoom-level { color: white; font-size: 0.875rem; font-weight: 600; min-width: 50px; text-align: center; }

	.btn-icon {
		background: rgba(255, 255, 255, 0.1); border: none; color: white;
		padding: 0.5rem; border-radius: 8px; cursor: pointer;
		transition: all 0.2s ease; display: flex; align-items: center; justify-content: center;
	}
	.btn-icon:hover:not(:disabled) { background: rgba(255, 255, 255, 0.2); transform: scale(1.05); }
	.btn-icon:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-delete { background: rgba(220, 38, 38, 0.8); }
	.btn-delete:hover:not(:disabled) { background: rgba(220, 38, 38, 1); }
	.btn-favorite { color: #f87171; }
	.btn-favorite:hover:not(:disabled) { background: rgba(239, 68, 68, 0.2); }
	.btn-favorite.active { background: rgba(239, 68, 68, 0.9); color: white; }

	.modal-body { flex: 1; display: flex; align-items: center; justify-content: center; position: relative; min-height: 0; overflow: hidden; }
	.media-container { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; user-select: none; touch-action: none; }
	.media {
		width: 100%; height: 100%; object-fit: contain; border-radius: 12px; opacity: 0;
		transition: opacity 0.3s ease, transform 160ms cubic-bezier(0.2, 0, 0, 1);
		will-change: transform; transform-origin: center center;
	}
	.media.loaded { opacity: 1; }
	.media.no-transition { transition: none !important; }

	.nav-button {
		position: absolute; top: 50%; transform: translateY(-50%);
		background: rgba(255, 255, 255, 0.1); backdrop-filter: blur(10px);
		border: none; color: white; width: 48px; height: 48px; border-radius: 50%;
		cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; z-index: 10;
	}
	.nav-button:hover { background: rgba(255, 255, 255, 0.2); transform: translateY(-50%) scale(1.1); }
	.nav-left { left: 1rem; } .nav-right { right: 1rem; }

	.modal-footer { padding: 1rem; text-align: center; color: rgba(255, 255, 255, 0.85); background: linear-gradient(to top, rgba(255,255,255,0.02), transparent); border-top: 1px solid rgba(255,255,255,0.03); border-radius: 0 0 12px 12px; backdrop-filter: blur(6px); z-index: 10; position: relative; }
	.counter { font-weight: 600; }

	@media (max-width: 768px) {
		.modal-backdrop { padding: 0; }
		.modal-content { height: 100dvh; max-width: 100%; }
		.modal-header, .modal-footer { border-radius: 0; padding: 0.75rem; }
		.modal-title span { font-size: 0.8125rem; max-width: 200px; }
		.modal-actions { gap: 0.25rem; }
		.zoom-level { font-size: 0.75rem; min-width: 40px; }
		.media { border-radius: 0; }
		.nav-button { width: 40px; height: 40px; }
		.nav-left { left: 0.5rem; } .nav-right { right: 0.5rem; }
	}
</style>
