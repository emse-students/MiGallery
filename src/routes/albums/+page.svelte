<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		Plus,
		XCircle,
		Image as ImageIcon,
		Search,
		Download,
		Trash2,
		Lock,
		Link as LinkIcon,
		Eye
	} from 'lucide-svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import LazyImage from '$lib/components/LazyImage.svelte';
	import AlbumModal from '$lib/components/AlbumModal.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { consumeNDJSONStream } from '$lib/streaming';
	import { showConfirm } from '$lib/confirm';
	import { m } from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { toast } from '$lib/toast';
	import { fuzzyMatch } from '$lib/fuzzy';
	import { clientCache } from '$lib/client-cache';
	import type { User, Album, ImmichAsset } from '$lib/types/api';
	import { downloadInBatches } from '$lib/immich/download';
	import { onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';

	let loading = $state(true);
	let error = $state<string | null>(null);
	let albums = $state<Album[]>([]);
	let showAlbumModal = $state(false);
	let searchQuery = $state<string>('');
	let filteredAlbums = $state<Album[]>([]);
	let pageLimit = $state(20);
	let displayedAlbums = $derived(filteredAlbums.slice(0, pageLimit));

	$effect(() => {
		pageLimit = 20; // Reset pagination on search change or albums update
		if (!searchQuery.trim()) {
			filteredAlbums = albums.slice();
			return;
		}
		filteredAlbums = albums.filter((a) =>
			fuzzyMatch(searchQuery, `${a.name || ''} ${a.location || ''}`)
		);
	});

	let showConfirmModal = $state(false);
	let confirmModalConfig = $state<{
		title: string;
		message: string;
		confirmText?: string;
		onConfirm: () => void;
	} | null>(null);

	let userRole = $derived((page.data.session?.user as User)?.role || 'user');
	let canCreateAlbum = $derived(userRole === 'mitviste' || userRole === 'admin');

	$effect(() => {
		if (typeof page.data !== 'undefined') {
			if (page.data?.albums) {
				albums = page.data.albums as Album[];
			} else {
				albums = [];
			}
			loading = false;
		}
	});

	function monthLabelFor(dateStr?: string | null) {
		if (!dateStr) return m.albums_no_date();
		const d = new Date(dateStr);
		if (isNaN(d.getTime())) return m.albums_no_date();
		const label = d.toLocaleString(getLocale(), { month: 'long', year: 'numeric' });
		return label.charAt(0).toUpperCase() + label.slice(1);
	}

	function groupAlbumsByMonth(list: Album[]) {
		const out: Record<string, Album[]> = {};
		for (const a of list) {
			const key = monthLabelFor(a.date);
			if (!out[key]) out[key] = [];
			out[key].push(a);
		}
		return out;
	}

	let downloadingAlbumId = $state<string | null>(null);
	let downloadingProgress = $state<Record<string, number>>({});
	let albumCovers = $state<Record<string, { id: string; type?: string }>>({});
	let currentDownloadController: AbortController | null = null;

	async function loadCoversFor(list: Album[]) {
		const albumIds = list.map((a) => a.id);
		const missing: string[] = [];
		const cachedCovers: Record<string, { id: string; type?: string }> = {};

		for (const albumId of albumIds) {
			if (albumCovers[albumId]) continue;

			const cached = await clientCache.get<{ id: string; type?: string }>('album-covers', albumId);
			if (cached) {
				cachedCovers[albumId] = cached;
			} else {
				missing.push(albumId);
			}
		}

		if (Object.keys(cachedCovers).length > 0) {
			albumCovers = { ...albumCovers, ...cachedCovers };
		}

		if (missing.length === 0) return;

		try {
			const res = await fetch('/api/albums/covers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ albumIds: missing })
			});

			await consumeNDJSONStream<{ albumId: string; cover: { assetId: string; type: string } }>(
				res,
				({ albumId, cover }) => {
					if (cover && typeof cover === 'object' && 'assetId' in cover) {
						const coverData = { id: cover.assetId, type: cover.type };
						albumCovers[albumId] = coverData;
						clientCache.set('album-covers', albumId, coverData);
					}
				}
			);
		} catch (e: unknown) {
			console.warn('Error loading album covers', e);
		}
	}

	$effect(() => {
		if (displayedAlbums.length > 0) {
			void loadCoversFor(displayedAlbums);
		}
	});

	let loadMoreElement: HTMLDivElement | null = $state(null);
	$effect(() => {
		if (!loadMoreElement) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting && pageLimit < filteredAlbums.length) {
					pageLimit += 20;
				}
			},
			{ rootMargin: '400px' }
		);
		observer.observe(loadMoreElement);
		return () => observer.disconnect();
	});

	function getVisibilityIcon(visibility?: string): string {
		if (!visibility || visibility === 'private') return 'lock';
		if (visibility === 'unlisted') return 'link';
		if (visibility === 'authenticated') return 'eye';
		return 'eye';
	}

	function getVisibilityLabel(visibility?: string): string {
		if (visibility === 'unlisted') return m.albums_visibility_unlisted();
		if (visibility === 'authenticated') return m.albums_visibility_authenticated();
		return m.albums_visibility_private();
	}

	async function downloadAlbumAssets(immichId: string, albumName?: string) {
		const ok = await showConfirm(
			m.albums_download_confirm({ name: albumName || immichId }),
			m.albums_download()
		);
		if (!ok) return;
		downloadingAlbumId = immichId;
		downloadingProgress = { ...downloadingProgress, [immichId]: 0 };

		if (currentDownloadController) {
			try {
				currentDownloadController.abort();
			} catch (e) {}
			currentDownloadController = null;
		}
		const controller = new AbortController();
		currentDownloadController = controller;

		try {
			const res = await fetch(`/api/albums/${immichId}`);
			if (!res.ok) throw new Error(m.albums_assets_error());
			const data = (await res.json()) as { assets: ImmichAsset[] };
			const list: ImmichAsset[] = Array.isArray(data?.assets) ? data.assets : [];
			const assetIds = list.map((x) => x.id).filter(Boolean);
			if (assetIds.length === 0) {
				toast.info(m.albums_download_empty());
				return;
			}
			await downloadInBatches(assetIds, albumName || immichId, {
				onProgress: (p) => {
					downloadingProgress = { ...downloadingProgress, [immichId]: p };
				},
				signal: controller.signal
			});
		} catch (e: unknown) {
			if ((e as Error).name !== 'AbortError') {
				toast.error(m.albums_download_error({ error: (e as Error).message }));
			}
		} finally {
			const copy = { ...downloadingProgress };
			delete copy[immichId];
			downloadingProgress = copy;
			downloadingAlbumId = null;
			if (currentDownloadController === controller) currentDownloadController = null;
		}
	}

	async function deleteAlbum(immichId: string, albumName?: string) {
		confirmModalConfig = {
			title: m.albums_delete_title(),
			message: m.albums_delete_message({ name: albumName || immichId }),
			confirmText: m.common_delete(),
			onConfirm: async () => {
				showConfirmModal = false;
				try {
					const res = await fetch(`/api/albums/${immichId}`, { method: 'DELETE' });
					if (!res.ok) throw new Error((await res.text()) || m.albums_delete_failed());
					await clientCache.delete('album-covers', immichId);
					await clientCache.delete('albums', immichId);
					albums = albums.filter((a) => a.id !== immichId);
					toast.success(m.albums_deleted());
				} catch (e: unknown) {
					toast.error(m.albums_delete_error({ error: (e as Error).message }));
				}
			}
		};
		showConfirmModal = true;
	}

	onDestroy(() => {
		if (currentDownloadController) {
			try {
				currentDownloadController.abort();
			} catch (e) {}
			currentDownloadController = null;
		}
	});

	async function handleAlbumCreated(newAlbumId?: string) {
		if (newAlbumId) {
			try {
				await goto(`/albums/${newAlbumId}`);
			} catch (e) {
				window.location.reload();
			}
		} else {
			window.location.reload();
		}
	}
</script>

<svelte:head>
	<title>{m.albums_page_title()}</title>
</svelte:head>

<main class="albums-main">
	<BackgroundBlobs />

	<div class="albums-container">
		<header class="page-header" in:fade={{ duration: 300, delay: 100 }}>
			<div class="header-content">
				<h1>{m.nav_albums()}</h1>
				<p class="subtitle">{m.albums_subtitle()}</p>
			</div>

			<div class="header-search">
				<input
					class="search-input"
					placeholder={m.albums_search_placeholder()}
					bind:value={searchQuery}
					oninput={(e) => {
						searchQuery = (e.target as HTMLInputElement).value;
					}}
					aria-label={m.albums_search_aria()}
				/>
			</div>

			{#if canCreateAlbum}
				<div class="header-actions">
					<button type="button" class="btn-glass primary" onclick={() => (showAlbumModal = true)}>
						<Plus size={18} />
						<span>{m.albums_create()}</span>
					</button>
				</div>
			{/if}
		</header>

		{#if error}
			<div class="state-message error" in:fade>
				<XCircle size={20} /> {m.common_error()}: {error}
			</div>
		{/if}

		{#if loading}
			<div class="state-message loading" in:fade>
				<Spinner size={20} /> {m.albums_loading()}
			</div>
		{/if}

		{#if !loading && !error && albums.length === 0}
			<div in:fade>
				<EmptyState icon={ImageIcon} title={m.albums_empty()} />
			</div>
		{/if}

		{#if !loading && albums.length > 0}
			{#if filteredAlbums.length === 0}
				<div in:fade>
					<EmptyState icon={Search} title={m.albums_no_match()} />
				</div>
			{:else}
				<div class="albums-timeline">
					{#each Object.entries(groupAlbumsByMonth(displayedAlbums)) as [month, items], i}
						<div class="month-group" in:fade={{ delay: i * 100, duration: 400 }}>
							<div class="month-header">
								<h3 class="month-title">{month}</h3>
								<span class="month-badge">{items.length}</span>
								<div class="divider"></div>
							</div>

							<div class="album-grid">
								{#each items as a}
									<div class="album-item" class:album-hidden={!a.visible && canCreateAlbum}>
										<a
											href={`/albums/${a.id}`}
											class="album-link"
											onclick={(e) => {
												if (downloadingAlbumId) {
													e.preventDefault();
												}
											}}
										>
											<div class="album-cover-wrapper">
												{#if albumCovers[a.id]}
													<LazyImage
														src={`/api/albums/${a.id}/cover/${albumCovers[a.id].id}`}
														alt={a.name}
														class="album-cover"
														aspectRatio="1"
														isVideo={albumCovers[a.id].type === 'VIDEO'}
														radius="0"
													/>
												{:else}
													<div class="skeleton-wrapper">
														<Skeleton aspectRatio="1" radius="0">
															<div class="skeleton-icon"><ImageIcon size={32} /></div>
														</Skeleton>
													</div>
												{/if}

												<!-- Overlay -->
												<div class="album-info-overlay">
													<div class="overlay-content">
														<span class="album-name" title={a.name}>{a.name}</span>
														<div class="album-meta">
															{#if a.date}
																<span class="album-date">
																	{new Date(a.date).toLocaleDateString(getLocale(), {
																		day: 'numeric',
																		month: 'short',
																		year: 'numeric'
																	})}
																</span>
															{/if}
															<span class="visibility-icon" title={getVisibilityLabel(a.visibility)}>
																{#if getVisibilityIcon(a.visibility) === 'lock'}
																	<Lock size={12} />
																{:else if getVisibilityIcon(a.visibility) === 'link'}
																	<LinkIcon size={12} />
																{:else}
																	<Eye size={12} />
																{/if}
															</span>
														</div>
													</div>
												</div>
											</div>
										</a>

										<!-- Actions -->
										<div class="album-actions">
											<button
												type="button"
												class="action-btn"
												onclick={(e) => {
													e.preventDefault();
													downloadAlbumAssets(a.id, a.name);
												}}
												disabled={downloadingAlbumId === a.id}
												title={m.albums_download_zip()}
											>
												{#if downloadingAlbumId === a.id}
													<Spinner size={14} />
												{:else}
													<Download />
												{/if}
											</button>

											{#if canCreateAlbum}
												<button
													type="button"
													class="action-btn delete"
													onclick={(e) => {
														e.preventDefault();
														deleteAlbum(a.id, a.name);
													}}
													title={m.common_delete()}
												>
													<Trash2 />
												</button>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/each}

					{#if pageLimit < filteredAlbums.length}
						<div class="load-more-sentinel" bind:this={loadMoreElement}>
							<Spinner size={32} />
						</div>
					{/if}
				</div>
			{/if}
		{/if}
	</div>

	<!-- Modals -->
	{#if showAlbumModal}
		<AlbumModal onClose={() => (showAlbumModal = false)} onSuccess={handleAlbumCreated} />
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
			<p class="confirm-message">{confirmModalConfig.message}</p>
		</Modal>
	{/if}
</main>

<style>
	/* Uses the global theme tokens directly (no per-page mirror variables). */
	.albums-main {
		position: relative;
		min-height: 100vh;
		color: var(--text-primary);
		overflow-x: hidden;
	}

	/* --- LAYOUT --- */
	.albums-container {
		position: relative;
		z-index: 1;
		max-width: 1400px;
		margin: 0 auto;
		padding: 2rem 1.5rem 6rem;
	}

	/* --- HEADER --- */
	.page-header {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		margin-bottom: 4rem;
		flex-wrap: wrap;
	}
	.header-content h1 {
		font-size: 2rem;
		font-weight: 800;
		margin: 0;
		line-height: 1.1;
		letter-spacing: -0.02em;
	}
	.subtitle {
		color: var(--text-secondary);
		font-size: 1rem;
		margin: 0.25rem 0 0;
	}
	.header-actions {
		margin-left: auto;
	}

	/* --- TIMELINE --- */
	.month-group {
		margin-bottom: 3rem;
	}
	.month-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}
	.month-title {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--text-primary);
		text-transform: capitalize;
		white-space: nowrap;
		margin: 0;
	}
	.month-badge {
		background: var(--glass-border);
		color: var(--text-primary);
		opacity: 0.7;
		padding: 0.2rem 0.6rem;
		border-radius: var(--radius-xs);
		font-size: 0.8rem;
		font-weight: 700;
	}
	.divider {
		height: 1px;
		flex: 1;
		background: var(--border);
		opacity: 0.5;
	}

	/* --- GRID --- */
	.album-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 1.5rem;
	}

	/* --- CARD (Glassmorphism / Borderless) --- */
	.album-item {
		position: relative;
		border-radius: var(--radius);
		overflow: hidden;
		aspect-ratio: 1;
		-webkit-mask-image: -webkit-radial-gradient(white, black);
		mask-image: radial-gradient(white, black);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
		transition:
			transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1),
			box-shadow 0.3s ease,
			border-color 0.3s;
		z-index: 1;
		transform: translateZ(0);
	}

	.album-item:hover {
		transform: scale(1.02);
		box-shadow: 0 20px 40px -5px rgba(0, 0, 0, 0.2);
		z-index: 10;
		border-color: var(--accent);
	}
	/* Hidden albums are shown greyed-out to privileged users */
	.album-item.album-hidden {
		filter: grayscale(100%);
		opacity: 0.6;
		transition:
			filter 0.25s ease,
			opacity 0.25s ease;
	}
	.album-item.album-hidden:hover {
		/* Slight visual feedback on hover while staying distinct */
		opacity: 0.75;
	}
	.album-link {
		display: block;
		text-decoration: none;
		color: inherit;
		width: 100%;
		height: 100%;
	}

	.album-cover-wrapper {
		position: relative;
		aspect-ratio: 1;
		width: 100%;
		height: 100%;
		display: block;
		background-color: var(--glass-bg);
		margin: 0;
		padding: 0;
	}

	/* Image global style for LazyImage content */
	:global(.album-cover) {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		background: transparent;
		border-radius: 0 !important;
		margin: 0;
		padding: 0;
		transition: transform 0.5s ease;
	}
	.album-item:hover :global(.album-cover) {
		transform: scale(1.05);
	}

	/* OVERLAY */
	.album-info-overlay {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		background: linear-gradient(
			to top,
			rgba(0, 0, 0, 0.9) 0%,
			rgba(0, 0, 0, 0.6) 50%,
			transparent 100%
		);
		padding: 4rem 1.25rem 1.25rem;
		pointer-events: none;
	}
	.overlay-content {
		transform: translateY(5px);
		transition: transform 0.3s ease;
	}
	.album-item:hover .overlay-content {
		transform: translateY(0);
	}

	.album-name {
		display: block;
		font-weight: 700;
		font-size: 1.15rem;
		color: white;
		margin-bottom: 0.25rem;
		text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.album-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.9);
		font-weight: 500;
	}

	/* --- SKELETON --- */
	.skeleton-wrapper {
		width: 100%;
		height: 100%;
	}
	.skeleton-icon {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
		opacity: 0.3;
	}

	/* --- ACTIONS --- */
	.album-actions {
		position: absolute;
		top: 12px;
		right: 12px;
		display: flex;
		gap: 8px;
		opacity: 0;
		transition: opacity 0.2s ease;
		pointer-events: none;
	}
	.album-item:hover .album-actions {
		opacity: 1;
		pointer-events: auto;
	}

	.action-btn {
		width: 36px;
		height: 36px;
		border-radius: var(--radius-sm);
		border: none;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		color: white;
		background-color: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(8px);
		transition: all 0.2s;
	}
	.action-btn :global(svg) {
		width: 20px !important;
		height: 20px !important;
		min-width: 20px !important;
		min-height: 20px !important;
	}
	.action-btn:hover {
		background-color: var(--accent);
		transform: scale(1.1);
	}
	.action-btn.delete:hover {
		background-color: var(--error, #ef4444);
	}

	/* --- STATES --- */
	.state-message {
		text-align: center;
		padding: 4rem;
		color: var(--text-secondary);
		display: flex;
		justify-content: center;
		gap: 0.5rem;
		background: var(--glass-bg);
		border-radius: var(--radius);
		border: 1px solid var(--border);
	}
	.state-message.error {
		color: var(--error, #ef4444);
		border-color: color-mix(in srgb, var(--error, #ef4444) 20%, transparent);
	}

	.load-more-sentinel {
		height: 50px;
		width: 100%;
		margin-top: 2rem;
		display: flex;
		justify-content: center;
		align-items: center;
	}

	.confirm-message {
		white-space: pre-wrap;
	}

	@media (max-width: 640px) {
		.page-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 1rem;
		}
		.header-actions {
			width: 100%;
			margin-top: 1rem;
		}
		.btn-glass.primary {
			width: 100%;
			justify-content: center;
		}

		.albums-container {
			padding: 1rem 1rem 6rem;
		}
		.album-grid {
			grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
			gap: 1rem;
		}
		.album-actions {
			opacity: 1;
			pointer-events: auto;
		}
		.album-info-overlay {
			padding-top: 2rem;
		}
	}

	.header-search {
		width: 100%;
		max-width: 420px;
		margin-left: 1rem;
	}
	.search-input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--glass-bg);
		color: var(--text-primary);
		font-size: 0.95rem;
	}
	.search-input:focus {
		outline: none;
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 12%, transparent);
		border-color: var(--accent);
	}
</style>
