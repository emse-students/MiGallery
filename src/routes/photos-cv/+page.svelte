<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { onMount, onDestroy } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import PhotosGrid from '$lib/components/PhotosGrid.svelte';
  import UploadZone from '$lib/components/UploadZone.svelte';
  import { PhotosState } from '$lib/photos.svelte';
  import { toast } from '$lib/toast';
  import { handleAlbumUpload } from '$lib/album-operations';
  import type { User } from '$lib/types/api';

  const myPhotosState = new PhotosState();
  const allPhotosState = new PhotosState();

  // Vérifier le rôle de l'utilisateur
  let userRole = $derived(((page.data.session?.user as User)?.role) || 'user');
  let canManagePhotos = $derived(userRole === 'mitviste' || userRole === 'admin');
  let hasIdPhotos = $derived(!!(page.data.session?.user as User)?.id_photos);
  let currentView = $state<'my' | 'all'>('my'); // Vue par défaut : mes photos
  let personId = $state<string>(''); // ID de la personne connectée
  let photosGridContainer = $state<HTMLDivElement | null>(null); // Pour scroller

  /**
   * Scroll vers le haut du conteneur de photos
   */
  function scrollToPhotosGrid() {
    if (photosGridContainer) {
      photosGridContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /**
   * Upload et ajout automatique à l'album PhotoCV
   */
  async function handleUpload(
    files: File[],
    onProgress?: (current: number, total: number) => void,
    onFileResult?: (result: { file: File; isDuplicate: boolean; assetId?: string }) => void
  ) {
    if (files.length === 0) return [];

    // Capturer les valeurs au moment de l'appel pour éviter les problèmes de proxy
    const view = currentView;
    const person = personId;

    const results = await handleAlbumUpload(files, 'photos-cv', allPhotosState, {
      onProgress,
      onFileResult,
      isPhotosCV: true,
      onSuccess: async () => {
        // 3. Recharger les vues
        if (person) {
          await myPhotosState.loadMyPhotosCV(person);
        }

        if (view === 'all') {
          await allPhotosState.loadAllPhotosCV();
        }
      }
    });

    return results || [];
  }

  function switchView(view: 'my' | 'all') {
    currentView = view;
    if (view === 'all' && !allPhotosState.loading) {
      allPhotosState.loadAllPhotosCV().catch((e: unknown) => console.warn('all loadAllPhotosCV error', e));
    }
  }

  onDestroy(() => {
    myPhotosState.cleanup();
    allPhotosState.cleanup();
  });

  onMount(() => {
    const user = page.data.session?.user as User;

    // Admin/mitviste peuvent accéder même sans id_photos (pour gérer les imports)
    if (!user) {
      goto('/');
      return;
    }

    const hasIdPhotos = !!user.id_photos;
    const isManager = user.role === 'admin' || user.role === 'mitviste';

    // Rediriger seulement si ni id_photos ni manager
    if (!hasIdPhotos && !isManager) {
      goto('/');
      return;
    }

    // Si l'utilisateur a un id_photos, charger ses photos personnelles
    if (hasIdPhotos) {
      // Convertir en string pour éviter les Proxy
      personId = String(user.id_photos ?? '');
      myPhotosState.peopleId = String(user.id_photos ?? '');
      myPhotosState.loadMyPhotosCV(String(user.id_photos ?? ''));
    } else if (isManager) {
      // Si manager sans id_photos, basculer directement sur la vue "all"
      currentView = 'all';
      allPhotosState.loadAllPhotosCV();
    }
  });
</script>

<svelte:head>
  <title>Photos CV - MiGallery</title>
</svelte:head>

<main class="photoscv-main">
  <div class="page-background">
    <div class="gradient-blob blob-1"></div>
    <div class="gradient-blob blob-2"></div>
    <div class="gradient-blob blob-3"></div>
  </div>

  <h1 class="page-title">Photos CV</h1>

  <!-- Onglets de navigation -->
  <div class="tabs">
    {#if hasIdPhotos}
      <button
        class="tab {currentView === 'my' ? 'active' : ''}"
        onclick={() => switchView('my')}
      >
        <Icon name="user" size={18} />
        Mes photos CV
      </button>
    {/if}
    {#if canManagePhotos}
      <button
        class="tab {currentView === 'all' ? 'active' : ''}"
        onclick={() => switchView('all')}
      >
        <Icon name="users" size={18} />
        Toutes les photos CV
      </button>
    {/if}
  </div>

  <!-- Vue : Mes photos CV -->
  {#if currentView === 'my' && hasIdPhotos}
    {#if myPhotosState.personName}
      <h2 class="section-title">{myPhotosState.personName}</h2>
    {/if}

    {#if myPhotosState.error}
      <div class="error"><Icon name="x-circle" size={20} /> {myPhotosState.error}</div>
    {/if}

    {#if myPhotosState.loading}
      <div class="loading"><Spinner size={20} /> Chargement de vos photos CV...</div>
    {/if}

    <PhotosGrid state={myPhotosState} />
  {/if}

  <!-- Vue : Toutes les photos CV (mitvistes/admins) -->
  {#if currentView === 'all' && canManagePhotos}
    <div class="upload-section">
      <h2>Ajouter des photos CV</h2>
      <p class="upload-info">Les photos uploadées seront automatiquement ajoutées à l'album Photos CV</p>
      <UploadZone onUpload={handleUpload} />
    </div>

    {#if allPhotosState.error}
      <div class="error"><Icon name="x-circle" size={20} /> {allPhotosState.error}</div>
    {/if}

    {#if allPhotosState.loading}
      <div class="loading"><Spinner size={20} /> Chargement de vos photos CV...</div>
    {/if}

    {#if !allPhotosState.loading && !allPhotosState.error}
      <!-- Pagination en haut -->
      <div class="pagination-bar">
        <button
          class="btn-nav-page"
          onclick={async () => {
            await allPhotosState.loadPrevPagePhotosCV();
            scrollToPhotosGrid();
          }}
          disabled={allPhotosState.photoCVCurrentPage <= 1 || allPhotosState.loading}
          title="Page précédente"
        >
          <Icon name="chevron-left" size={18} />
        </button>

        <div class="pagination-info">
          <span class="page-counter">
            Page {allPhotosState.photoCVCurrentPage}
          </span>
        </div>

        <button
          class="btn-nav-page"
          onclick={async () => {
            await allPhotosState.loadNextPagePhotosCV();
            scrollToPhotosGrid();
          }}
          disabled={!allPhotosState.photoCVHasMore || allPhotosState.loading}
          title="Page suivante"
        >
          <Icon name="chevron-right" size={18} />
        </button>
      </div>

      <!-- Grille de photos -->
      <div bind:this={photosGridContainer}>
        <PhotosGrid state={allPhotosState} />
      </div>

      <!-- Pagination en bas -->
      <div class="pagination-bar">
        <button
          class="btn-nav-page"
          onclick={async () => {
            await allPhotosState.loadPrevPagePhotosCV();
            scrollToPhotosGrid();
          }}
          disabled={allPhotosState.photoCVCurrentPage <= 1 || allPhotosState.loading}
          title="Page précédente"
        >
          <Icon name="chevron-left" size={18} />
        </button>

        <div class="pagination-info">
          <span class="page-counter">
            Page {allPhotosState.photoCVCurrentPage}
          </span>
        </div>

        <button
          class="btn-nav-page"
          onclick={async () => {
            await allPhotosState.loadNextPagePhotosCV();
            scrollToPhotosGrid();
          }}
          disabled={!allPhotosState.photoCVHasMore || allPhotosState.loading}
          title="Page suivante"
        >
          <Icon name="chevron-right" size={18} />
        </button>
      </div>
    {/if}
  {/if}
</main>

<style>
  .photoscv-main {
    position: relative;
    min-height: 100vh;
  }

  .photoscv-main .page-background {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: -1;
    overflow: hidden;
  }

  .photoscv-main .gradient-blob {
    position: absolute;
    border-radius: 50%;
    filter: blur(110px);
    opacity: 0.14;
    animation: float 22s ease-in-out infinite;
  }

  .photoscv-main .blob-1 {
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, rgba(14, 165, 233, 0.6) 0%, transparent 70%);
    top: -200px;
    left: 10%;
    animation-delay: 0s;
  }

  .photoscv-main .blob-2 {
    width: 500px;
    height: 500px;
    background: radial-gradient(circle, rgba(139, 92, 246, 0.5) 0%, transparent 70%);
    top: 30%;
    right: 15%;
    animation-delay: -7s;
  }

  .photoscv-main .blob-3 {
    width: 550px;
    height: 550px;
    background: radial-gradient(circle, rgba(236, 72, 153, 0.5) 0%, transparent 70%);
    bottom: 10%;
    left: 20%;
    animation-delay: -14s;
  }

  @keyframes float {
    0%, 100% {
      transform: translate(0, 0) scale(1);
    }
    33% {
      transform: translate(30px, -30px) scale(1.05);
    }
    66% {
      transform: translate(-20px, 20px) scale(0.95);
    }
  }

  .tabs {
    display: flex;
    gap: 0.5rem;
    margin: 2rem auto;
    max-width: 600px;
    border-bottom: 2px solid rgba(255, 255, 255, 0.1);
  }

  .tab {
    flex: 1;
    padding: 0.75rem 1.5rem;
    background: transparent;
    border: none;
    color: var(--text-secondary, #a0a0a0);
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.3s ease;
    border-bottom: 3px solid transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .tab:hover {
    color: var(--text-primary, #ffffff);
    background: rgba(255, 255, 255, 0.05);
  }

  .tab.active {
    color: rgba(59, 130, 246, 1);
    border-bottom-color: rgba(59, 130, 246, 1);
  }

  .section-title {
    text-align: center;
    font-size: 1.5rem;
    font-weight: 600;
    margin: 1.5rem 0;
    color: var(--text-secondary, #d0d0d0);
  }

  .upload-section {
    margin: 2rem auto;
    max-width: 800px;
  }

  .upload-section h2 {
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: var(--text-primary, #ffffff);
    text-align: center;
  }

  .upload-info {
    text-align: center;
    color: var(--text-secondary, #a0a0a0);
    margin-bottom: 1rem;
    font-size: 0.9375rem;
  }

  .page-title {
    text-align: center;
    font-size: 3rem;
    font-weight: 700;
    margin: 2rem 0 3rem;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
  }

  .pagination-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin: 2rem auto;
    max-width: 800px;
    padding: 1.5rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    flex-wrap: wrap;
  }

  .btn-nav-page {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.625rem 0.875rem;
    background: linear-gradient(90deg, var(--accent, #3b82f6), #8b5cf6);
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    font-size: 0.95rem;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
    min-width: 44px;
    height: 44px;
  }

  .btn-nav-page:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  }

  .btn-nav-page:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .pagination-info {
    text-align: center;
    flex: 1;
    min-width: 200px;
  }

  .page-counter {
    color: var(--text-primary, #ffffff);
    font-weight: 600;
    font-size: 0.95rem;
  }

  @media (max-width: 640px) {
    .page-title {
      font-size: 2rem;
    }
  }
</style>
