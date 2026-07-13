<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import {
		User as UserIcon,
		Users,
		XCircle,
		CloudUpload,
		ChevronLeft,
		ChevronRight
	} from 'lucide-svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
	import PhotosGrid from '$lib/components/PhotosGrid.svelte';
	import UploadZone from '$lib/components/UploadZone.svelte';
	import { PhotosState } from '$lib/photos.svelte';
	import { handleAlbumUpload } from '$lib/album-operations';
	import { m } from '$lib/paraglide/messages';
	import type { User } from '$lib/types/api';

	const myPhotosState = new PhotosState();
	const allPhotosState = new PhotosState();

	let userRole = $derived((page.data.session?.user as User)?.role || 'user');
	let canManagePhotos = $derived(userRole === 'mitviste' || userRole === 'admin');
	let hasIdPhotos = $derived(!!(page.data.session?.user as User)?.photos_id);
	let currentView = $state<'my' | 'all'>('my');
	let personId = $state<string>('');
	let photosGridContainer = $state<HTMLDivElement | null>(null);

	function scrollToPhotosGrid() {
		if (photosGridContainer) {
			photosGridContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	}

	async function handleUpload(
		files: File[],
		onProgress?: (current: number, total: number) => void,
		onFileResult?: (result: { file: File; isDuplicate: boolean; assetId?: string }) => void,
		onFileStart?: (file: File) => void
	) {
		if (files.length === 0) return [];
		const view = currentView;
		const person = personId;

		const results = await handleAlbumUpload(files, 'photos-cv', allPhotosState, {
			onProgress,
			onFileResult,
			onFileStart,
			isPhotosCV: true,
			onSuccess: async () => {
				if (person) await myPhotosState.loadMyPhotosCV(person);
				if (view === 'all') await allPhotosState.loadAllPhotosCV();
			}
		});
		return results || [];
	}

	function switchView(view: 'my' | 'all') {
		currentView = view;
		if (view === 'all' && !allPhotosState.loading) {
			allPhotosState
				.loadAllPhotosCV()
				.catch((e: unknown) => console.warn('all loadAllPhotosCV error', e));
		}
	}

	onDestroy(() => {
		myPhotosState.cleanup();
		allPhotosState.cleanup();
	});

	onMount(() => {
		const user = page.data.session?.user as User;
		if (!user) {
			goto('/');
			return;
		}

		const hasIdPhotos = !!user.photos_id;
		const isManager = user.role === 'admin' || user.role === 'mitviste';

		if (!hasIdPhotos && !isManager) {
			// No linked face and not a manager: funnel to the profile incitation
			// on /mes-photos instead of a dead-end redirect to home.
			goto('/mes-photos');
			return;
		}

		if (hasIdPhotos) {
			personId = String(user.photos_id ?? '');
			myPhotosState.peopleId = String(user.photos_id ?? '');
			myPhotosState.loadMyPhotosCV(String(user.photos_id ?? ''));
		} else if (isManager) {
			currentView = 'all';
			allPhotosState.loadAllPhotosCV();
		}
	});
</script>

<svelte:head>
	<title>{m.pcv_page_title()}</title>
</svelte:head>

<main class="page-main">
	<BackgroundBlobs />

	<div class="page-container">
		<header class="page-header centered" in:fade={{ duration: 300, delay: 100 }}>
			<div class="header-content">
				<h1>{m.nav_photos_cv()}</h1>
				<p class="subtitle">{m.pcv_subtitle()}</p>
			</div>
		</header>

		<!-- Navigation Tabs -->
		{#if hasIdPhotos && canManagePhotos}
			<div class="tabs-wrapper" in:fade={{ duration: 300, delay: 200 }}>
				<div class="glass-tabs">
					<button
						type="button"
						class="tab-item {currentView === 'my' ? 'active' : ''}"
						onclick={() => switchView('my')}
					>
						<UserIcon size={18} />
						<span>{m.nav_my_photos()}</span>
					</button>
					<button
						type="button"
						class="tab-item {currentView === 'all' ? 'active' : ''}"
						onclick={() => switchView('all')}
					>
						<Users size={18} />
						<span>{m.pcv_tab_all()}</span>
					</button>
					<!-- Sliding indicator for visual effect -->
					<div class="tab-indicator {currentView === 'my' ? 'left' : 'right'}"></div>
				</div>
			</div>
		{/if}

		<div class="content-area">
			<!-- VIEW: MY PHOTOS -->
			{#if currentView === 'my' && hasIdPhotos}
				<div class="view-container" in:fade={{ duration: 300 }}>
					{#if myPhotosState.personName}
						<div class="section-title">
							<h2>{myPhotosState.personName}</h2>
							<span class="badge">{m.pcv_badge_personal()}</span>
						</div>
					{/if}

					{#if myPhotosState.error}
						<div class="state-message error">
							<XCircle size={20} />
							{myPhotosState.error}
						</div>
					{/if}

					{#if myPhotosState.loading}
						<div class="state-message loading">
							<Spinner size={32} /> {m.pcv_loading_my()}
						</div>
					{/if}

					{#if !myPhotosState.loading && !myPhotosState.error}
						<div class="grid-wrapper glass-card p-4">
							<PhotosGrid state={myPhotosState} />
						</div>
					{/if}
				</div>
			{/if}

			<!-- VIEW: ADMIN / ALL USERS -->
			{#if currentView === 'all' && canManagePhotos}
				<div class="view-container" in:fade={{ duration: 300 }}>
					<!-- Upload Card -->
					<div class="glass-card upload-section mb-8">
						<div class="upload-header">
							<div class="icon-box">
								<CloudUpload size={24} />
							</div>
							<div>
								<h3>{m.pcv_upload_title()}</h3>
								<p>{m.pcv_upload_desc()}</p>
							</div>
						</div>
						<div class="upload-content">
							<UploadZone onUpload={handleUpload} />
						</div>
					</div>

					{#if allPhotosState.error}
						<div class="state-message error">
							<XCircle size={20} />
							{allPhotosState.error}
						</div>
					{/if}

					{#if allPhotosState.loading}
						<div class="state-message loading">
							<Spinner size={32} /> {m.pcv_loading_all()}
						</div>
					{/if}

					{#if !allPhotosState.loading && !allPhotosState.error}
						<div bind:this={photosGridContainer} class="grid-wrapper glass-card p-4">
							<PhotosGrid state={allPhotosState} />
						</div>

						<!-- Pagination Bottom -->
						<div class="pagination-container bottom">
							<button
								type="button"
								class="btn-nav"
								onclick={async () => {
									await allPhotosState.loadPrevPagePhotosCV();
									scrollToPhotosGrid();
								}}
								disabled={allPhotosState.photoCVCurrentPage <= 1 || allPhotosState.loading}
							>
								<ChevronLeft size={20} /> {m.common_previous()}
							</button>

							<span class="page-badge">{m.common_page({ page: allPhotosState.photoCVCurrentPage })}</span>

							<button
								type="button"
								class="btn-nav"
								onclick={async () => {
									await allPhotosState.loadNextPagePhotosCV();
									scrollToPhotosGrid();
								}}
								disabled={!allPhotosState.photoCVHasMore || allPhotosState.loading}
							>
								{m.common_next()} <ChevronRight size={20} />
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</main>

<style>
	/* Uses the global theme tokens directly (no per-page mirror variables). */
	.page-main {
		position: relative;
		min-height: 100vh;
		padding: 4rem 0 6rem;
		color: var(--text-primary);
		overflow-x: hidden;
	}

	.page-container {
		position: relative;
		z-index: 1;
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem 1.5rem 6rem;
		border-radius: 1.5rem;
	}

	/* --- HEADER --- */
	.page-header {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1.5rem;
		margin-bottom: 3rem;
		flex-wrap: wrap;
		text-align: center;
	}
	.subtitle {
		color: var(--text-secondary);
		font-size: 1.1rem;
		margin: 0.25rem 0 0;
	}

	/* --- TABS --- */
	.tabs-wrapper {
		display: flex;
		justify-content: center;
		margin-bottom: 3rem;
	}
	.glass-tabs {
		position: relative;
		display: flex;
		gap: 0.5rem;
		padding: 0.4rem;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: 99px;
		backdrop-filter: blur(12px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
	}
	.tab-item {
		position: relative;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 1.5rem;
		border: none;
		background: transparent;
		color: var(--text-secondary);
		font-weight: 600;
		cursor: pointer;
		transition: color 0.3s ease;
		border-radius: 99px;
	}
	.tab-item.active {
		color: white;
	}
	.tab-item:hover:not(.active) {
		color: var(--text-primary);
	}

	.tab-indicator {
		position: absolute;
		top: 0.4rem;
		bottom: 0.4rem;
		z-index: 1;
		background: var(--accent);
		border-radius: 99px;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		width: calc(50% - 0.4rem);
		box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 40%, transparent);
	}
	.tab-indicator.left {
		left: 0.4rem;
		transform: translateX(0);
	}
	.tab-indicator.right {
		left: 0.4rem;
		transform: translateX(100%);
	}

	/* --- CARDS & GRID --- */
	.glass-card {
		background: var(--glass-bg);
		backdrop-filter: blur(20px);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.05);
		margin-bottom: 1.5em;
	}
	.glass-card.p-4 {
		padding: 1.5rem;
	}

	/* Upload Section */
	.upload-section {
		overflow: hidden;
	}
	.upload-header {
		padding: 1.5rem;
		border-bottom: 1px solid var(--border);
		display: flex;
		align-items: center;
		gap: 1rem;
		/* Use theme-aware glass background for better contrast */
		background: var(--glass-bg);
	}
	.icon-box {
		width: 42px;
		height: 42px;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		color: var(--accent);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.upload-header h3 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text-primary);
	}
	.upload-header p {
		margin: 0;
		font-size: 0.9rem;
		color: var(--text-secondary);
	}
	.upload-content {
		padding: 1.5rem;
	}

	/* Section Title */
	.section-title {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
		padding-left: 0.5rem;
	}
	.section-title h2 {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
	}
	.badge {
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		padding: 0.2rem 0.6rem;
		border-radius: 6px;
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		color: var(--accent);
	}

	/* --- PAGINATION --- */
	.pagination-container {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
	}
	.pagination-container.bottom {
		margin-top: 2rem;
	}

	.btn-nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-nav:hover:not(:disabled) {
		background: var(--glass-bg);
		border-color: var(--accent);
		color: var(--accent);
		transform: translateY(-2px);
	}
	.btn-nav:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.page-badge {
		font-family: monospace;
		font-weight: 600;
		color: var(--text-secondary);
	}

	/* --- STATES --- */
	.state-message {
		padding: 3rem;
		text-align: center;
		color: var(--text-secondary);
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 0.75rem;
		background: var(--glass-bg);
		border-radius: var(--radius);
		border: 1px solid var(--border);
		margin-bottom: 2rem;
	}
	.state-message.error {
		color: var(--error);
		border-color: color-mix(in srgb, var(--error) 20%, transparent);
	}

	@media (max-width: 640px) {
		.header-content h1 {
			font-size: 2rem;
		}
	}

	/* Mobile: improve readability of upload areas and glass cards */
	@media (max-width: 768px) {
		.upload-section,
		.glass-card.upload-section,
		.glass-card.upload-section .upload-content {
			/* Make background more opaque on mobile for better contrast */
			background: rgba(255, 255, 255, 0.96) !important;
			border-color: rgba(0, 0, 0, 0.06) !important;
			color: var(--text-primary) !important;
			box-shadow: 0 8px 28px rgba(0, 0, 0, 0.08) !important;
			backdrop-filter: none !important;
		}
		.upload-section .upload-header h3,
		.upload-section .upload-header p {
			color: var(--text-primary) !important;
		}
		/* Add spacing between upload card and grid content on mobile. Use padding-top to avoid margin collapse when grid content renders */
		.upload-section {
			margin-bottom: 1rem !important;
		}
		.grid-wrapper {
			margin-top: 0 !important;
			padding-top: 1rem !important;
		}
	}

	@media (max-width: 768px) and (prefers-color-scheme: dark) {
		.upload-section,
		.glass-card.upload-section,
		.glass-card.upload-section .upload-content {
			background: rgba(10, 12, 16, 0.92) !important;
			border-color: rgba(255, 255, 255, 0.06) !important;
			color: var(--text-primary) !important;
			box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35) !important;
			backdrop-filter: none !important;
		}
		.upload-section .upload-header h3,
		.upload-section .upload-header p {
			color: var(--text-primary) !important;
		}
	}

	/* Mobile light-mode specific tweak for better contrast */
	@media (max-width: 768px) and (prefers-color-scheme: light) {
		.upload-section,
		.glass-card.upload-section,
		.glass-card.upload-section .upload-content {
			background: rgba(255, 255, 255, 0.96) !important;
			border-color: rgba(0, 0, 0, 0.06) !important;
			/* Force explicit readable text color in light mode */
			color: var(--text-primary, #111827) !important;
			box-shadow: 0 8px 28px rgba(0, 0, 0, 0.06) !important;
			backdrop-filter: none !important;
		}
		.upload-section .upload-header h3,
		.upload-section .upload-header p,
		.upload-section .upload-content,
		.upload-section * {
			color: var(--text-primary, #111827) !important;
		}
	}
</style>
