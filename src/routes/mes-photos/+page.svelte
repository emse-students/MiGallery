<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { Lock, ArrowLeft, Camera, Eye } from '@lucide/svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
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
  let showProfileIncitation = $state(false);

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
      body: JSON.stringify({ featureFaceAssetId: assetId }),
    });
    if (!updateRes.ok) {
      const txt = await updateRes.text().catch(() => updateRes.statusText);
      throw new Error(txt || m.mp_photo_update_error());
    }

    // Persist the backing asset id so /api/users/{id}/avatar serves our own
    // square crop instead of Immich's. Best-effort: a failure just means the
    // avatar falls back to the Immich thumbnail we just set above.
    try {
      const faceBody: { person_id: string; photos_asset_id: string; user_id?: string } = {
        person_id: targetIdPhotos,
        photos_asset_id: assetId,
      };
      if (targetUserId) faceBody.user_id = targetUserId;
      await fetch('/api/users/me/face', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(faceBody),
      });
    } catch (e) {
      console.warn('Failed to persist profile asset id', e);
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
          const accessRes = await fetch(
            `/api/users/${encodeURIComponent(userIdParam)}/photo-access`
          );
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
              photos_asset_id?: string | null;
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
            photosState.loadPerson(accessData.user.photos_id, {
              userId: accessData.user.id_user,
              version: accessData.user.photos_asset_id,
            });
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
            photos_asset_id?: string | null;
          };
        };

        if (accessData.success && accessData.user?.photos_id) {
          photosState.peopleId = accessData.user.photos_id;
          targetUserName = accessData.user.name;
          photosState.loadPerson(accessData.user.photos_id, {
            userId: accessData.user.id_user,
            version: accessData.user.photos_asset_id,
          });
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
      // No linked face yet: prompt the user to complete their profile
      // instead of bouncing them back to the home page.
      showProfileIncitation = true;
      return;
    }
    targetUserName = user?.name || null;

    photosState.peopleId = user.photos_id;
    photosState.loadPerson(user.photos_id, {
      userId: user.id_user,
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
      <PageHeader title={targetUserName ?? photosState.personName}>
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

    {#if photosState.error}
      <ErrorState
        title={photosState.error}
        onRetry={() => {
          if (photosState.peopleId != null) photosState.loadPerson(photosState.peopleId);
        }}
      />
    {/if}

    {#if photosState.loading}
      <LoadingState label={m.mp_loading()} />
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
</div>

<style>
  .mesphotos-main {
    min-height: 100vh;
    padding-bottom: 4rem;
    position: relative;
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
