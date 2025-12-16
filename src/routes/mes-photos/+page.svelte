<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { onMount, onDestroy } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
  import PhotosGrid from '$lib/components/PhotosGrid.svelte';
  import ChangePhotoModal from '$lib/components/ChangePhotoModal.svelte';
  import { PhotosState } from '$lib/photos.svelte';
  import { toast } from '$lib/toast';
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
    // Use the target user's id_photos (from photosState)
    const targetIdPhotos = photosState.peopleId;
    if (!targetIdPhotos) throw new Error('Utilisateur non configuré');

    const updateRes = await fetch(`/api/immich/people/${targetIdPhotos}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ featureFaceAssetId: assetId })
    });
    if (!updateRes.ok) {
      const txt = await updateRes.text().catch(() => updateRes.statusText);
      throw new Error(txt || 'Erreur lors de la mise à jour de la photo');
    }

    toast.success('Photo de profil mise à jour !');
    // Recharger la page pour mettre à jour tous les affichages (header, vignette, etc.)
    window.location.reload();
  }

  onDestroy(() => photosState.cleanup());

  onMount(async () => {
    // Check for userId parameter (from trombinoscope or direct link)
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
          const accessData = await accessRes.json() as {
            success?: boolean;
            hasAccess?: boolean;
            reason?: string;
            user?: { id_user: string; prenom: string; nom: string; id_photos: string | null };
          };

          if (!accessData.success || !accessData.hasAccess) {
            accessDenied = true;
            return;
          }

          // Access granted - use the user info from the response
          if (accessData.user?.id_photos) {
            targetUserId = userIdParam;
            photosState.peopleId = accessData.user.id_photos;
            targetUserName = (accessData.user.prenom || '') + (accessData.user.nom ? (' ' + accessData.user.nom) : '');
            photosState.loadPerson(accessData.user.id_photos);
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
      // Fetch the target user's id_photos via API users endpoint (own photos case)
      try {
        const accessRes = await fetch(`/api/users/${encodeURIComponent(userIdParam)}/photo-access`);
        const accessData = await accessRes.json() as {
          success?: boolean;
          user?: { id_user: string; prenom: string; nom: string; id_photos: string | null };
        };

        if (accessData.success && accessData.user?.id_photos) {
          photosState.peopleId = accessData.user.id_photos;
          targetUserName = (accessData.user.prenom || '') + (accessData.user.nom ? (' ' + accessData.user.nom) : '');
          photosState.loadPerson(accessData.user.id_photos);
        } else {
          goto('/');
        }
      } catch {
        goto('/');
      }
      return;
    }

    // Default: load current user's photos
    targetUserId = null;
    isViewingOwnPhotos = true;
    if (!user?.id_photos) {
      goto('/');
      return;
    }
    // Use local DB name for current user header
    targetUserName = (user?.prenom || '') + (user?.nom ? (' ' + user.nom) : '');

    photosState.peopleId = user.id_photos;
    photosState.loadPerson(user.id_photos);
  });
</script>

<svelte:head>
  <title>Mes photos - MiGallery</title>
</svelte:head>

<main class="mesphotos-main">
  <BackgroundBlobs />

  {#if accessDenied}
    <div class="access-denied">
      <Icon name="lock" size={48} />
      <h2>Accès non autorisé</h2>
      <p>Vous n'avez pas l'autorisation de voir les photos de cet utilisateur.</p>
      <p class="hint">L'utilisateur doit vous autoriser depuis ses paramètres pour que vous puissiez accéder à ses photos.</p>
      <button class="btn-primary" onclick={() => goto('/')}>
        <Icon name="arrow-left" size={18} />
        Retour à l'accueil
      </button>
    </div>
  {:else}
    {#if photosState.personName && photosState.imageUrl}
      <div class="header-section">
        {#if canEditProfilePhoto}
          <button
            class="profile-photo-btn"
            onclick={openChangePhotoModal}
            title="Changer la photo de profil"
          >
            <img src={photosState.imageUrl} alt="Portrait utilisateur" class="profile-photo" />
            <div class="photo-overlay">
              <Icon name="camera" size={32} />
              <span class="change-photo-text">Changer de photo</span>
            </div>
          </button>
        {:else}
          <img src={photosState.imageUrl} alt="Portrait utilisateur" class="profile-photo static" />
        {/if}
          <div class="header-text centered">
            <h1 class="page-title">
              {targetUserName ?? photosState.personName}
            </h1>
            {#if !isViewingOwnPhotos}
              <span class="viewing-badge">
                <Icon name="eye" size={14} />
                Consultation autorisée
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
      <div class="error"><Icon name="x-circle" size={20} /> {photosState.error}</div>
    {/if}

    {#if photosState.loading}
      <div class="loading"><Spinner size={20} /> Chargement des photos...</div>
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
    background: linear-gradient(135deg, var(--accent), #8b5cf6, #ec4899);
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
	opacity: 0; /* Cache l'overlay par défaut */
    transition: opacity 0.3s ease; /* Animation fluide */
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
