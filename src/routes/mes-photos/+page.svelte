<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { onMount, onDestroy } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import PhotosGrid from '$lib/components/PhotosGrid.svelte';
  import ChangePhotoModal from '$lib/components/ChangePhotoModal.svelte';
  import { PhotosState } from '$lib/photos.svelte';
  import { toast } from '$lib/toast';
  import type { User } from '$lib/types/api';

  const photosState = new PhotosState();

  let showChangePhotoModal = $state(false);
  let targetUserId = $state<string | null>(null); // Store target user ID
  let targetUserName = $state<string | null>(null);

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

    // Mettre à jour la personne côté serveur
    const updateRes = await fetch(`/api/immich/people/${targetIdPhotos}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ featureFaceAssetId: assetId })
    });
    if (!updateRes.ok) {
      const txt = await updateRes.text().catch(() => updateRes.statusText);
      throw new Error(txt || 'Erreur lors de la mise à jour de la photo');
    }

    // Recharger les infos de la personne pour rafraîchir la vignette
    await photosState.loadPerson(targetIdPhotos);
    toast.success('Photo de profil mise à jour !');
  }

  onDestroy(() => photosState.cleanup());

  onMount(() => {
    // Check for userId parameter (from trombinoscope)
    const urlParams = new URLSearchParams(window.location.search);
    const userIdParam = urlParams.get('userId');

    const user = page.data.session?.user as User;

    // If userId is provided, only admins are allowed to view another user's photos
    if (userIdParam) {
      if (!(user?.role === 'admin')) {
        // not allowed
        goto('/');
        return;
      }

      // allowed: admin
      targetUserId = userIdParam;
      // Fetch the target user's id_photos via API users endpoint
      fetch(`/api/users/${encodeURIComponent(userIdParam)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
        return res.json();
      })
      .then(data => {
        const targetUser = data.user as User;
        if (targetUser?.id_photos) {
          photosState.peopleId = targetUser.id_photos;
          // Use local DB name for header
          targetUserName = (targetUser.prenom || '') + (targetUser.nom ? (' ' + targetUser.nom) : '');
          photosState.loadPerson(targetUser.id_photos);
        } else {
          goto('/');
        }
      })
      .catch(() => goto('/'));
      return;
    }

    // Default: load current user's photos
    targetUserId = null;
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
  <div class="page-background">
    <div class="gradient-blob blob-1"></div>
    <div class="gradient-blob blob-2"></div>
    <div class="gradient-blob blob-3"></div>
  </div>

  {#if photosState.personName && photosState.imageUrl}
    <div class="header-section">
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
      <h1 class="page-title">
        {targetUserName ?? photosState.personName}
      </h1>
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

  <PhotosGrid state={photosState} />

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
    position: relative;
  }

  .page-background {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: -1;
    pointer-events: none;
    overflow: hidden;
  }

  .mesphotos-main .gradient-blob {
    position: absolute;
    border-radius: 50%;
    filter: blur(105px);
    opacity: 0.13;
    animation: float 21s ease-in-out infinite;
  }

  .mesphotos-main .blob-1 {
    width: 700px;
    height: 700px;
    background: radial-gradient(circle, rgba(124, 58, 237, 0.6) 0%, transparent 70%);
    top: -150px;
    left: 20%;
    animation-delay: 0s;
  }

  .mesphotos-main .blob-2 {
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, rgba(20, 184, 166, 0.5) 0%, transparent 70%);
    bottom: -100px;
    right: 10%;
    animation-delay: -8s;
  }

  .mesphotos-main .blob-3 {
    width: 550px;
    height: 550px;
    background: radial-gradient(circle, rgba(147, 51, 234, 0.4) 0%, transparent 70%);
    top: 50%;
    left: 50%;
    animation-delay: -15s;
  }

  .header-section {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2rem;
    margin: 2rem 0 3rem;
    flex-wrap: wrap;
  }

  .page-title {
    font-size: 3rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }

  .page-title-center {
    text-align: center;
    font-size: 3rem;
    font-weight: 700;
    margin: 2rem 0 3rem;
    color: var(--text-primary);
  }

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
    opacity: 0;
    transition: opacity 0.3s ease;
    border-radius: 50%;
    color: white;
    backdrop-filter: blur(8px);
  }

  .change-photo-text {
    font-size: 0.875rem;
    font-weight: 600;
    text-align: center;
  }

  .profile-photo-btn:hover .photo-overlay {
    opacity: 1;
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
