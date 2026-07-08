<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import {
		Check,
		CheckCircle,
		Pencil,
		Trash2,
		Share2,
		Download,
		ArrowLeft,
		MapPin,
		AlertCircle,
		Image as ImageIcon
	} from 'lucide-svelte';
	import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
	import PhotosGrid from '$lib/components/PhotosGrid.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import UploadZone from '$lib/components/UploadZone.svelte';
	import AlbumModal from '$lib/components/AlbumModal.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { PhotosState } from '$lib/photos.svelte';
	import { toast } from '$lib/toast';
	import { showConfirm } from '$lib/confirm';
	import { handleAlbumUpload } from '$lib/album-operations';
	import { downloadInBatches } from '$lib/immich/download';
	import { activeOperations } from '$lib/operations';
	import { navigationModalStore } from '$lib/navigation-store';
	import type { User, Album } from '$lib/types/api';
	import { m } from '$lib/paraglide/messages';

	const photosState = new PhotosState();
	let title = $state('');
	let locationInfo = $state('');
	let showAlbumModal = $state(false);
	let showConfirmModal = $state(false);
	let confirmModalConfig = $state<{
		title: string;
		message: string;
		confirmText?: string;
		onConfirm: () => void;
	} | null>(null);

	let userRole = $derived((page.data.session?.user as User)?.role || 'user');
	let canManagePhotos = $derived(userRole === 'mitviste' || userRole === 'admin');

	let hasActiveOps = $state(false);
	const unsubOps = activeOperations.subscribe((ops) => {
		hasActiveOps = ops.size > 0;
	});

	function handleBackClick() {
		if (hasActiveOps) {
			navigationModalStore.set({ show: true, href: '/albums' });
		} else {
			goto('/albums');
		}
	}

	$effect(() => {
		const albumData = (page.data as { album?: Album }).album;
		if (albumData?.id) {
			title = albumData.name || m.albumd_default_title();
			locationInfo = albumData.location || '';
			photosState.loadAlbumWithStreaming(
				albumData.id,
				albumData.name,
				albumData.visibility || undefined
			);
		}
	});

	async function downloadAll() {
		const ok = await showConfirm(
			m.albumd_download_confirm({ count: photosState.assets.length }),
			m.albumd_download_zip()
		);
		if (!ok) return;

		if (photosState.currentDownloadController) photosState.currentDownloadController.abort();
		const controller = new AbortController();
		photosState.currentDownloadController = controller;
		photosState.isDownloading = true;
		photosState.downloadProgress = 0;

		try {
			const assetIds = photosState.assets.map((a) => a.id);
			await downloadInBatches(assetIds, title || 'album', {
				onProgress: (p) => {
					photosState.downloadProgress = p;
				},
				signal: controller.signal
			});
			toast.success(m.albumd_download_done());
		} catch (e: unknown) {
			if ((e as Error).name !== 'AbortError')
				toast.error(m.albums_download_error({ error: (e as Error).message }));
		} finally {
			photosState.isDownloading = false;
			photosState.downloadProgress = 0;
			photosState.currentDownloadController = null;
		}
	}

	async function deleteAlbum() {
		const albumId = page.params.id;
		if (!albumId) return;

		confirmModalConfig = {
			title: m.albums_delete_title(),
			message: m.albumd_delete_message({ title }),
			confirmText: m.albumd_delete_confirm(),
			onConfirm: async () => {
				showConfirmModal = false;
				try {
					const res = await fetch(`/api/albums/${albumId}`, { method: 'DELETE' });
					if (!res.ok && res.status !== 204) throw new Error(m.albums_delete_failed());
					toast.success(m.albums_deleted());
					goto('/albums');
				} catch (e: unknown) {
					toast.error(m.common_error_detail({ error: (e as Error).message }));
				}
			}
		};
		showConfirmModal = true;
	}

	async function shareAlbum() {
		try {
			const url = window.location.href;
			if (navigator.share) {
				await navigator.share({ title: title || m.albumd_default_title(), url });
			} else {
				await navigator.clipboard.writeText(url);
				toast.success(m.albumd_link_copied());
			}
		} catch (e) {
			toast.error(m.albumd_share_error());
		}
	}

	async function onUploadFiles(
		files: File[],
		onProgress?: (c: number, t: number) => void,
		onFileResult?: (res: any) => void
	) {
		const albumId = page.params.id;
		if (!albumId) throw new Error(m.albumd_id_missing());

		return await handleAlbumUpload(files, albumId, photosState, {
			onProgress,
			onFileResult,
			isPhotosCV: false,
			onSuccess: async () => {
				photosState.loadAlbumWithStreaming(albumId, title);
			}
		});
	}

	onDestroy(() => {
		unsubOps();
		photosState.cleanup();
	});

	// Open Graph data for external link previews (e.g. Canari)
	const ogAlbumName = $derived(
		((page.data as { album?: Album }).album?.name) || m.albumd_default_title()
	);
	const ogDescription = $derived(
		((page.data as { ogDescription?: string }).ogDescription) || ''
	);
	const ogCoverUrl = $derived(
		((page.data as { ogCoverUrl?: string | null }).ogCoverUrl) || null
	);
</script>

<svelte:head>
	<title>{title || ogAlbumName} - MiGallery</title>
	<meta property="og:title" content={ogAlbumName} />
	<meta property="og:site_name" content="MiGallery" />
	<meta property="og:type" content="website" />
	{#if ogDescription}
		<meta property="og:description" content={ogDescription} />
	{/if}
	{#if ogCoverUrl}
		<meta property="og:image" content={ogCoverUrl} />
		<meta property="og:image:width" content="1200" />
		<meta property="og:image:height" content="630" />
		<meta property="og:image:type" content="image/webp" />
	{/if}
</svelte:head>

<!-- Action buttons snippet (mobile & desktop) -->
{#snippet actionButtons(mobile = false)}
	<div class="actions-group {mobile ? 'mobile' : 'desktop'}">
		<!-- Selection mode -->
		{#if canManagePhotos && photosState.assets.length > 0}
			<button
				onclick={() => (photosState.selecting = !photosState.selecting)}
				class="btn-glass {photosState.selecting ? 'active' : ''}"
				title={photosState.selecting ? m.albumd_select_finish() : m.albumd_select()}
			>
				{#if photosState.selecting}
					<Check size={18} />
				{:else}
					<CheckCircle size={18} />
				{/if}
				{#if !mobile || photosState.selecting}
					<span class="label">{photosState.selecting ? m.common_ok() : m.albumd_selection()}</span>
				{/if}
			</button>
		{/if}

		<!-- Admin actions -->
		{#if canManagePhotos}
			<button onclick={() => (showAlbumModal = true)} class="btn-glass edit" title={m.common_edit()}>
				<Pencil size={18} />
				{#if !mobile}<span class="label">{m.common_edit()}</span>{/if}
			</button>
			<button onclick={() => deleteAlbum()} class="btn-glass danger" title={m.common_delete()}>
				<Trash2 size={18} />
			</button>
		{/if}

		<!-- Divider -->
		{#if canManagePhotos}<div class="divider"></div>{/if}

		<!-- Public actions -->
		<button onclick={shareAlbum} class="btn-glass info" title={m.albumd_share()}>
			<Share2 size={18} />
			{#if !mobile}<span class="label">{m.albumd_share()}</span>{/if}
		</button>

		<button
			onclick={downloadAll}
			disabled={photosState.isDownloading || photosState.assets.length === 0}
			class="btn-glass success"
			title={m.albumd_download_all()}
		>
			{#if photosState.isDownloading}
				<Spinner size={18} />
				{#if !mobile}
					{#if photosState.downloadProgress >= 0}
						<span class="label">{Math.round(photosState.downloadProgress * 100)}%</span>
					{:else}
						<span class="label">...</span>
					{/if}
				{/if}
			{:else}
				<Download size={18} />
				{#if !mobile}<span class="label">{m.common_download()}</span>{/if}
			{/if}
		</button>
	</div>
{/snippet}

<main class="page-main">
	<BackgroundBlobs />

	<div class="page-container">
		<!-- Back navigation -->
		<nav class="top-nav" in:fade={{ duration: 200 }}>
			<button class="back-btn" onclick={handleBackClick}>
				<ArrowLeft size={20} />
				<span>{m.albumd_back()}</span>
			</button>
		</nav>

		<!-- Album header -->
		<header class="page-header" in:fly={{ y: 20, duration: 400 }}>
			<div class="header-main">
				<div class="title-wrapper">
					<h1>{title}</h1>
					{#if locationInfo}
						<p class="meta"><MapPin size={14} /> {locationInfo}</p>
					{/if}
					<p class="count">
						{m.albumd_photo_count({ count: photosState.assets.length })}
					</p>
				</div>
			</div>

			<div class="header-toolbar">
				{@render actionButtons(false)}
			</div>
		</header>

		{#if photosState.error}
			<div class="glass-card error-card">
				<AlertCircle size={24} />
				<p>{photosState.error}</p>
			</div>
		{/if}

		<!-- Upload zone (admin) -->
		{#if canManagePhotos}
			<div class="upload-container glass-card" in:fade>
				<div class="upload-header">
					<h3>{m.albumd_add_photos()}</h3>
					<p>{m.albumd_drop_here()}</p>
				</div>
				<UploadZone onUpload={onUploadFiles} />
			</div>
		{/if}

		<!-- Photos grid -->
		{#if photosState.loading && photosState.assets.length === 0}
			<div class="loading-state">
				<Spinner size={40} />
				<p>{m.albumd_loading()}</p>
			</div>
		{:else if !photosState.loading && photosState.assets.length === 0}
			<div class="empty-state glass-card">
				<ImageIcon size={48} />
				<p>{m.albumd_empty()}</p>
			</div>
		{:else}
			<div class="gallery-wrapper" in:fade={{ duration: 300 }}>
				<!-- PhotosGrid handles rendering, selection and the fullscreen modal -->
				<PhotosGrid
					state={photosState}
					albumId={page.params.id}
					onModalClose={(hasChanges) => {
						if (hasChanges && page.params.id) photosState.loadAlbumWithStreaming(page.params.id, title);
					}}
				/>
			</div>
		{/if}
	</div>

	<!-- Mobile action bar (sticky bottom) -->
	<div class="mobile-bar">
		{@render actionButtons(true)}
	</div>

	<!-- Modals -->
	{#if showAlbumModal && page.params.id}
		<AlbumModal
			albumId={page.params.id}
			onClose={() => (showAlbumModal = false)}
			onSuccess={() => window.location.reload()}
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
	/* Uses the global theme tokens directly (no per-page mirror variables). */
	.page-main {
		position: relative;
		min-height: 100vh;
		color: var(--text-primary);
		overflow-x: hidden;
		padding-bottom: 100px; /* Room for the mobile action bar */
	}

	.page-container {
		position: relative;
		z-index: 1;
		max-width: 1400px;
		margin: 0 auto;
		padding: 2rem 1.5rem;
	}

	/* --- NAV --- */
	.top-nav {
		margin-bottom: 2rem;
	}
	.back-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: none;
		border: none;
		color: var(--text-secondary);
		font-weight: 600;
		cursor: pointer;
		transition: color 0.2s;
		padding: 0;
		font-size: 0.95rem;
	}
	.back-btn:hover {
		color: var(--accent);
	}

	/* --- HEADER --- */
	.header-toolbar {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		margin-bottom: 2rem;
		position: relative;
		z-index: 1;
	}
	.title-wrapper h1 {
		margin: 0;
		font-size: 2.5rem;
		font-weight: 800;
		line-height: 1.1;
		letter-spacing: -0.02em;
	}
	.title-wrapper .meta {
		margin: 0.25rem 0 0;
		color: var(--text-secondary);
		font-size: 1rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.title-wrapper .count {
		font-size: 0.85rem;
		color: var(--text-secondary);
		opacity: 0.7;
		margin: 0.2rem 0 0;
	}

	/* --- ACTIONS TOOLBAR --- */
	.actions-group {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		background: var(--glass-bg);
		padding: 0.5rem;
		border-radius: var(--radius);
		border: 1px solid var(--glass-border);
		backdrop-filter: blur(12px);
	}
	.divider {
		width: 1px;
		height: 24px;
		background: var(--border);
		margin: 0 0.25rem;
	}

	/* Buttons use the canonical .btn-glass system from app.css (base + primary/
	   success/danger/info/edit/active/icon modifiers). Only the toolbar layout
	   and the mobile bar overrides live here. */

	/* --- CARDS & CONTENT --- */
	.glass-card {
		background: var(--glass-bg);
		backdrop-filter: blur(20px);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.05);
	}

	.upload-container {
		padding: 1.5rem;
		margin-bottom: 2.5rem;
	}
	.upload-header {
		margin-bottom: 1.5rem;
		text-align: center;
	}
	.upload-header h3 {
		margin: 0;
		font-size: 1.2rem;
	}
	.upload-header p {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.9rem;
	}

	/* Make upload header use theme glass background for consistency */
	.upload-header {
		background: var(--glass-bg);
		padding: 1rem;
		border-radius: var(--radius-md);
	}

	.error-card {
		padding: 1.5rem;
		border-left: 4px solid var(--error);
		color: var(--error);
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.empty-state {
		padding: 4rem;
		text-align: center;
		color: var(--text-secondary);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.loading-state {
		text-align: center;
		padding: 4rem;
		color: var(--text-secondary);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	/* --- MOBILE BAR --- */
	.mobile-bar {
		display: none;
	}

	@media (max-width: 768px) {
		.header-toolbar {
			display: none;
		} /* Hide desktop actions */

		.mobile-bar {
			display: block;
			position: fixed;
			bottom: 0;
			left: 0;
			right: 0;
			z-index: 100;
			padding: 0.75rem 1rem;
			padding-bottom: calc(0.75rem + env(safe-area-inset-bottom));
			background: var(--bg-elevated);
			backdrop-filter: blur(16px);
			border-top: 1px solid var(--border);
		}
		.actions-group.mobile {
			justify-content: space-between;
			background: transparent;
			border: none;
			padding: 0;
			gap: 0.5rem;
		}
		.actions-group.mobile .btn-glass {
			flex-direction: column;
			padding: 0.5rem;
			gap: 0.25rem;
			font-size: 0.7rem;
			flex: 1;
			background: transparent;
			border: none;
			color: var(--text-secondary);
			box-shadow: none;
		}
		.actions-group.mobile .btn-glass.active {
			color: var(--accent);
			background: var(--accent-light);
		}

		/* Mobile: flatten the semantic buttons to colored text on a transparent bar */
		.actions-group.mobile .btn-glass.success {
			color: var(--success);
			background: transparent;
		}
		.actions-group.mobile .btn-glass.danger {
			color: var(--error);
		}
		.actions-group.mobile .btn-glass.info {
			color: var(--info);
		}
		.actions-group.mobile .btn-glass.edit {
			color: var(--edit);
		}

		.page-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 1rem;
		}
		.header-main {
			gap: 1rem;
		}
		.title-wrapper h1 {
			font-size: 1.8rem;
		}
	}

	/* Mobile: improve spacing and contrast for upload area */
	@media (max-width: 768px) {
		.upload-container {
			margin-bottom: 1rem !important;
		}
		/* Use padding-top to guarantee spacing even after the gallery grid renders */
		.gallery-wrapper {
			margin-top: 0 !important;
			padding-top: 1rem !important;
		}
	}

	/* Mobile: improve readability of upload areas and glass cards */
	@media (max-width: 768px) {
		.upload-container,
		.upload-container .upload-header,
		.glass-card.upload-container {
			background: var(--bg-elevated) !important;
			border-color: var(--border) !important;
			color: var(--text-primary) !important;
			box-shadow: var(--shadow-lg) !important;
			backdrop-filter: none !important;
		}

		.upload-container .upload-header h3,
		.upload-container .upload-header p {
			color: var(--text-primary) !important;
		}
	}
</style>
