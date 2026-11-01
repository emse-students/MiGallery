<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { Lock, ArrowLeft, Camera, Eye, ChevronRight, ScanFace } from '@lucide/svelte';
  import LoadingState from '#lib/components/LoadingState.svelte';
  import ErrorState from '#lib/components/ErrorState.svelte';
  import BackgroundBlobs from '#lib/components/BackgroundBlobs.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import PhotosGrid from '#lib/components/PhotosGrid.svelte';
  import ChangePhotoModal from '#lib/components/ChangePhotoModal.svelte';
  import { PhotosState } from '#lib/photos.svelte.ts';
  import { toast } from '#lib/toast.ts';
  import { removeFromMyPhotos } from '#lib/face-not-me.ts';
  import { m } from '#lib/paraglide/messages.js';
  import type { User } from '#lib/types/api.ts';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const photosState = new PhotosState();

  let showChangePhotoModal = $state(false);
  /** The member whose photos are shown: the viewer, or the one named by `?userId=`. */
  let memberId = $state<string | null>(null);
  let isViewingOwnPhotos = $state(true);
  let isAdmin = $state(false);
  let accessDenied = $state(false);
  let showProfileIncitation = $state(false);

  let canEditProfilePhoto = $derived(isViewingOwnPhotos || isAdmin);
  /** How many photos wait for the viewer's yes or no (their own view only). */
  let toConfirm = $derived(isViewingOwnPhotos ? (data.ownFace?.toConfirm ?? 0) : 0);

  function openChangePhotoModal() {
    showChangePhotoModal = true;
  }

  function closeChangePhotoModal() {
    showChangePhotoModal = false;
  }

  /** The profile photo, chosen among the member's own photos (lot A6). */
  async function handlePhotoSelected(assetId: string) {
    if (!memberId) throw new Error(m.mp_user_not_configured());
    const res = await fetch('/api/users/me/profile-photo', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        isViewingOwnPhotos ? { asset_id: assetId } : { asset_id: assetId, user_id: memberId }
      ),
    });
    if (!res.ok) {
      console.warn('[mes-photos] profile photo refused', res.status);
      throw new Error(m.mp_photo_update_error());
    }
    toast.success(m.mp_photo_updated());
    window.location.reload();
  }

  /** The other member's page: shown only when they authorised the viewer (or to an admin). */
  async function openOtherMember(userId: string) {
    try {
      const accessRes = await fetch(`/api/users/${encodeURIComponent(userId)}/photo-access`);
      const accessData = (await accessRes.json()) as {
        success?: boolean;
        hasAccess?: boolean;
        user?: { id_user: string; name: string; photos_asset_id?: string | null } | null;
      };
      if (!accessData.success || !accessData.hasAccess) {
        accessDenied = true;
        return;
      }
      if (!accessData.user) {
        goto('/');
        return;
      }
      memberId = accessData.user.id_user;
      photosState.loadMember(accessData.user.id_user, {
        name: accessData.user.name,
        version: accessData.user.photos_asset_id,
      });
    } catch (e) {
      console.warn('[mes-photos] access check failed', e);
      accessDenied = true;
    }
  }

  onDestroy(() => photosState.cleanup());

  onMount(async () => {
    const userIdParam = new URLSearchParams(window.location.search).get('userId');
    const user = page.data.session?.user as User;
    isAdmin = user?.role === 'admin';

    if (userIdParam && userIdParam !== user?.id_user) {
      isViewingOwnPhotos = false;
      await openOtherMember(userIdParam);
      return;
    }

    isViewingOwnPhotos = true;
    if (!data.ownFace?.enrolled) {
      // Face matching is off for them: say how to turn it on instead of an empty grid.
      showProfileIncitation = true;
      return;
    }
    memberId = user.id_user;
    photosState.loadMember(user.id_user, {
      name: user.name,
      version: user.photos_asset_id,
    });
  });
</script>

<svelte:head>
  <title>{m.mp_page_title()}</title>
</svelte:head>

<!-- A div, not a <main>: the layout's <main> is the page's landmark, and the global `main {}`
     rule would pad this one a second time (ui-redesign #10). -->
<div class="mesphotos-main">
  <BackgroundBlobs />

  {#if accessDenied}
    <div class="access-denied">
      <Lock size={48} />
      <h2>{m.mp_access_denied_title()}</h2>
      <p>{m.mp_access_denied_body()}</p>
      <p class="hint">
        {m.mp_access_denied_hint()}
      </p>
      <button type="button" class="btn primary" onclick={() => goto('/')}>
        <ArrowLeft size={18} />
        {m.common_back_home()}
      </button>
    </div>
  {:else if showProfileIncitation}
    <div class="profile-incitation">
      <div class="incite-icon"><Camera size={40} /></div>
      <h2>{m.mp_incite_title()}</h2>
      <p>{m.mp_incite_body()}</p>
      <a href="/parametres#face-recognition" class="btn primary">
        <Camera size={18} />
        {m.mp_incite_cta()}
      </a>
    </div>
  {:else}
    {#if photosState.personName}
      <!-- Google Photos' person page: a small face beside the name, not half a screen of portrait. -->
      <PageHeader title={photosState.personName}>
        {#snippet leading()}
          {#if photosState.imageUrl}
            {#if canEditProfilePhoto}
              <button
                type="button"
                class="face"
                onclick={openChangePhotoModal}
                aria-label={m.mp_change_profile_photo()}
                title={m.mp_change_profile_photo()}
              >
                <img src={photosState.imageUrl} alt={m.mp_portrait_alt()} />
                <span class="face-badge"><Camera size={12} /></span>
              </button>
            {:else}
              <span class="face"><img src={photosState.imageUrl} alt={m.mp_portrait_alt()} /></span>
            {/if}
          {/if}
        {/snippet}
        {#snippet below()}
          {#if !isViewingOwnPhotos}
            <span class="viewing-badge">
              <Eye size={14} />
              {m.mp_viewing_badge()}
            </span>
          {/if}
        {/snippet}
      </PageHeader>
    {/if}

    {#if toConfirm > 0}
      <a href="/mes-photos/confirmer" class="confirm-banner">
        <span class="confirm-icon"><ScanFace size={20} /></span>
        <span class="confirm-text">{m.mp_confirm_banner({ count: toConfirm })}</span>
        <ChevronRight size={18} />
      </a>
    {/if}

    {#if photosState.error}
      <ErrorState
        title={photosState.error}
        onRetry={() => {
          if (photosState.memberId) photosState.loadMember(photosState.memberId);
        }}
      />
    {/if}

    {#if photosState.loading}
      <LoadingState label={m.mp_loading()} />
    {/if}

    <!-- "Ce n'est pas moi" on every photo, their own view only: an automatic match is never
         detached by a later scan, so the member's answer is the way out of a mistake. -->
    <PhotosGrid
      state={photosState}
      showFavorites={isViewingOwnPhotos}
      onNotMe={isViewingOwnPhotos ? removeFromMyPhotos : undefined}
    />
  {/if}

  {#if showChangePhotoModal}
    <ChangePhotoModal
      currentPhotoUrl={photosState.imageUrl || undefined}
      memberId={memberId ?? undefined}
      ownFace={isViewingOwnPhotos}
      onPhotoSelected={handlePhotoSelected}
      onClose={closeChangePhotoModal}
    />
  {/if}
</div>

<style>
  .mesphotos-main {
    min-height: 100vh;
    padding-bottom: 4rem;
    position: relative;
  }

  /* The photos waiting for the member's answer: one flat row above the grid. */
  .confirm-banner {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0 0 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    color: var(--text-primary);
    text-decoration: none;
  }

  .confirm-banner:hover {
    background: var(--bg-tertiary);
  }

  .confirm-icon {
    display: flex;
    color: var(--accent);
  }

  .confirm-text {
    flex: 1;
    font-size: 0.875rem;
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
  }

  /* The face: 56 px, a camera badge when tapping it changes the profile photo. */
  .face {
    position: relative;
    display: block;
    flex-shrink: 0;
    width: 56px;
    height: 56px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
  }

  button.face {
    cursor: pointer;
  }

  .face img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .face-badge {
    position: absolute;
    right: -2px;
    bottom: -2px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 2px solid var(--bg-primary);
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
  }

  button.face:hover img {
    filter: brightness(0.9);
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

  /* Profile incitation (shown when the user has no linked face yet) */
  .profile-incitation {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 50vh;
    text-align: center;
    padding: 2rem;
    color: var(--text-primary);
  }

  .incite-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 88px;
    height: 88px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }

  .profile-incitation h2 {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 1.5rem 0 0.75rem;
  }

  .profile-incitation p {
    color: var(--text-secondary);
    margin: 0 0 1.5rem;
    max-width: 400px;
  }
</style>
