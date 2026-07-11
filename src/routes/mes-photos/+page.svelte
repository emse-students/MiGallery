<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { Lock, ArrowLeft, Camera, Eye, XCircle } from 'lucide-svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
	import PhotosGrid from '$lib/components/PhotosGrid.svelte';
	import ChangePhotoModal from '$lib/components/ChangePhotoModal.svelte';
	import { PhotosState } from '$lib/photos.svelte';
	import { toast } from '$lib/toast';
	import { m } from '$lib/paraglide/messages';
	import type { User } from '$lib/types/api';

	const photosState = new PhotosState();

	let showChangePhotoModal = $state(false);
	let targetUserId = $state<string | null>(null); // Store target user ID
	let targetUserName = $state<string | null>(null);
	let isViewingOwnPhotos = $state(true);
	let isAdmin = $state(false);
	let accessDenied = $state(false);

	let canEditProfilePhoto = $derived(isViewingOwnPhotos || isAdmin);

	function openChangePhotoModal() {
		showChangePhotoModal = true;
	}

	function closeChangePhotoModal() {
		showChangePhotoModal = false;
	}

	async function handlePhotoSelected(assetId: string) {
		const targetIdPhotos = photosState.peopleId;
		if (!targetIdPhotos) throw new Error(m.mp_user_not_configured());

		const updateRes = await fetch(`/api/immich/people/${targetIdPhotos}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ featureFaceAssetId: assetId })
		});
		if (!updateRes.ok) {
			const txt = await updateRes.text().catch(() => updateRes.statusText);
			throw new Error(txt || m.mp_photo_update_error());
		}

		toast.success(m.mp_photo_updated());
		window.location.reload();
	}

	onDestroy(() => photosState.cleanup());

	onMount(async () => {
		const urlParams = new URLSearchParams(window.location.search);
		const userIdParam = urlParams.get('userId');

		const user = page.data.session?.user as User;
		isAdmin = user?.role === 'admin';

		if (userIdParam) {
			if (userIdParam === user?.id_user) {
				isViewingOwnPhotos = true;
			} else {
				isViewingOwnPhotos = false;
				try {
					const accessRes = await fetch(`/api/users/${encodeURIComponent(userIdParam)}/photo-access`);
					const accessData = (await accessRes.json()) as {
						success?: boolean;
						hasAccess?: boolean;
						reason?: string;
						user?: {
							id_user: string;
							name: string;
							first_name: string | null;
							last_name: string | null;
							photos_id: string | null;
						};
					};

					if (!accessData.success || !accessData.hasAccess) {
						accessDenied = true;
						return;
					}

					if (accessData.user?.photos_id) {
						targetUserId = userIdParam;
						photosState.peopleId = accessData.user.photos_id;
						targetUserName = accessData.user.name;
						photosState.loadPerson(accessData.user.photos_id);
					} else {
						goto('/');
					}
					return;
				} catch {
					accessDenied = true;
					return;
				}
			}

			targetUserId = userIdParam;
			try {
				const accessRes = await fetch(`/api/users/${encodeURIComponent(userIdParam)}/photo-access`);
				const accessData = (await accessRes.json()) as {
					success?: boolean;
					user?: {
						id_user: string;
						name: string;
						first_name: string | null;
						last_name: string | null;
						photos_id: string | null;
					};
				};

				if (accessData.success && accessData.user?.photos_id) {
					photosState.peopleId = accessData.user.photos_id;
					targetUserName = accessData.user.name;
					photosState.loadPerson(accessData.user.photos_id);
				} else {
					goto('/');
				}
			} catch {
				goto('/');
			}
			return;
		}

		targetUserId = null;
		isViewingOwnPhotos = true;
		if (!user?.photos_id) {
			goto('/');
			return;
		}
		targetUserName = user?.name || null;

		photosState.peopleId = user.photos_id;
		photosState.loadPerson(user.photos_id);
	});
</script>

<svelte:head>
	<title>{m.mp_page_title()}</title>
</svelte:head>

<main class="mesphotos-main">
	<BackgroundBlobs />

	{#if accessDenied}
		<div class="access-denied">
			<Lock size={48} />
			<h2>{m.mp_access_denied_title()}</h2>
			<p>{m.mp_access_denied_body()}</p>
			<p class="hint">
				{m.mp_access_denied_hint()}
			</p>
			<button type="button" class="btn-primary" onclick={() => goto('/')}>
				<ArrowLeft size={18} />
				{m.common_back_home()}
			</button>
		</div>
	{:else}
		{#if photosState.personName && photosState.imageUrl}
			<div class="header-section">
				{#if canEditProfilePhoto}
					<button
						type="button"
						class="profile-photo-btn"
						onclick={openChangePhotoModal}
						title={m.mp_change_profile_photo()}
					>
						<img src={photosState.imageUrl} alt={m.mp_portrait_alt()} class="profile-photo" />
						<div class="photo-overlay">
							<Camera size={32} />
							<span class="change-photo-text">{m.mp_change_photo()}</span>
						</div>
					</button>
				{:else}
					<img src={photosState.imageUrl} alt={m.mp_portrait_alt()} class="profile-photo static" />
				{/if}
				<div class="header-text centered">
					<h1 class="page-title">
						{targetUserName ?? photosState.personName}
					</h1>
					{#if !isViewingOwnPhotos}
						<span class="viewing-badge">
							<Eye size={14} />
							{m.mp_viewing_badge()}
						</span>
					{/if}
				</div>
			</div>
		{:else if photosState.personName}
			<h1 class="page-title-center">
				{targetUserName ?? photosState.personName}
			</h1>
		{/if}

		{#if photosState.error}
			<div class="error"><XCircle size={20} /> {photosState.error}</div>
		{/if}

		{#if photosState.loading}
			<div class="loading"><Spinner size={20} /> {m.mp_loading()}</div>
		{/if}

		<PhotosGrid state={photosState} showFavorites={isViewingOwnPhotos} />
	{/if}

	{#if showChangePhotoModal}
		<ChangePhotoModal
			currentPhotoUrl={photosState.imageUrl || undefined}
			peopleId={photosState.peopleId ?? undefined}
			onPhotoSelected={handlePhotoSelected}
			onClose={closeChangePhotoModal}
		/>
	{/if}
</main>

<style>
	.mesphotos-main {
		min-height: 100vh;
		padding-bottom: 4rem;
		position: relative;
	}

	.header-section {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 2rem;
		margin: 2rem 0 3rem;
		flex-wrap: wrap;
	}

	.header-text {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.viewing-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--accent);
		background: rgba(124, 58, 237, 0.1);
		padding: 0.25rem 0.75rem;
		border-radius: 9999px;
		margin: 0 auto;
	}

	/* Titles: use global header styles (shared in app.css) */

	.profile-photo-btn {
		position: relative;
		border: none;
		background: none;
		cursor: pointer;
		padding: 0;
		border-radius: 50%;
		overflow: hidden;
		transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.profile-photo-btn::before {
		content: '';
		position: absolute;
		inset: -3px;
		background: linear-gradient(135deg, var(--accent), var(--edit), var(--pink));
		border-radius: 50%;
		z-index: -1;
		opacity: 0;
		transition: opacity 0.3s ease;
	}

	.profile-photo-btn:hover::before {
		opacity: 1;
	}

	.profile-photo-btn:hover {
		transform: scale(1.08);
	}

	.profile-photo {
		width: 140px;
		height: 140px;
		object-fit: cover;
		border-radius: 50%;
		border: 5px solid var(--bg-primary);
		transition: border-color 0.3s ease;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
	}

	.photo-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		border-radius: 50%;
		color: white;
		backdrop-filter: blur(8px);
		opacity: 0; /* Hide the overlay by default */
		transition: opacity 0.3s ease; /* Smooth animation */
	}

	.change-photo-text {
		font-size: 0.875rem;
		font-weight: 600;
		text-align: center;
	}

	.profile-photo-btn:hover .photo-overlay {
		opacity: 1;
	}

	.profile-photo.static {
		cursor: default;
	}

	/* Access denied styles */
	.access-denied {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 50vh;
		text-align: center;
		padding: 2rem;
		color: var(--text-primary);
	}

	.access-denied h2 {
		font-size: 1.75rem;
		font-weight: 700;
		margin: 1.5rem 0 0.75rem;
	}

	.access-denied p {
		color: var(--text-secondary);
		margin: 0.5rem 0;
		max-width: 400px;
	}

	.access-denied .hint {
		font-size: 0.875rem;
		opacity: 0.7;
		margin-bottom: 1.5rem;
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--accent);
		color: white;
		padding: 0.75rem 1.5rem;
		border-radius: 0.5rem;
		border: none;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.2s ease;
	}

	.btn-primary:hover {
		background: var(--accent-secondary);
	}

	@media (max-width: 640px) {
		.header-section {
			flex-direction: column;
			gap: 1.5rem;
			margin: 1.5rem 0 2rem;
		}

		.page-title,
		.page-title-center {
			font-size: 2rem;
			text-align: center;
		}

		.profile-photo {
			width: 120px;
			height: 120px;
		}
	}
</style>
