<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
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
    onFileResult?: (result: { file: File; isDuplicate: boolean; assetId?: string }) => void
  ) {
    if (files.length === 0) return [];
    const view = currentView;
    const person = personId;

    const results = await handleAlbumUpload(files, 'photos-cv', allPhotosState, {
      onProgress,
      onFileResult,
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
      allPhotosState.loadAllPhotosCV().catch((e: unknown) => console.warn('all loadAllPhotosCV error', e));
    }
  }

  onDestroy(() => {
    myPhotosState.cleanup();
    allPhotosState.cleanup();
  });

  onMount(() => {
    const user = page.data.session?.user as User;
    if (!user) { goto('/'); return; }

    const hasIdPhotos = !!user.id_photos;
    const isManager = user.role === 'admin' || user.role === 'mitviste';

    if (!hasIdPhotos && !isManager) { goto('/'); return; }

    if (hasIdPhotos) {
      personId = String(user.id_photos ?? '');
      myPhotosState.peopleId = String(user.id_photos ?? '');
      myPhotosState.loadMyPhotosCV(String(user.id_photos ?? ''));
    } else if (isManager) {
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

  <div class="photoscv-container">

    <header class="page-header">
        <h1 class="page-title">Photos CV</h1>
        <p class="subtitle">Gérez vos portraits professionnels</p>
    </header>

    <div class="tabs-container">
      {#if hasIdPhotos}
        <button
          class="tab-pill {currentView === 'my' ? 'active' : ''}"
          onclick={() => switchView('my')}
        >
          <Icon name="user" size={18} />
          <span>Mes photos</span>
        </button>
      {/if}
      {#if canManagePhotos}
        <button
          class="tab-pill {currentView === 'all' ? 'active' : ''}"
          onclick={() => switchView('all')}
        >
          <Icon name="users" size={18} />
          <span>Tout le monde</span>
        </button>
      {/if}
    </div>

    <div class="content-area">
        {#if currentView === 'my' && hasIdPhotos}
        <div in:fade={{ duration: 200 }}>
            {#if myPhotosState.personName}
                <div class="section-header">
                    <h2>{myPhotosState.personName}</h2>
                </div>
            {/if}

            {#if myPhotosState.error}
                <div class="state-message error"><Icon name="x-circle" size={20} /> {myPhotosState.error}</div>
            {/if}

            {#if myPhotosState.loading}
                <div class="state-message loading"><Spinner size={24} /> Chargement de vos photos...</div>
            {/if}

            <div class="grid-wrapper">
                <PhotosGrid state={myPhotosState} />
            </div>
        </div>
        {/if}

        {#if currentView === 'all' && canManagePhotos}
        <div in:fade={{ duration: 200 }}>

            <div class="upload-card">
                <div class="upload-header">
                    <div class="icon-box">
                        <Icon name="upload-cloud" size={24} />
                    </div>
                    <div>
                        <h3>Ajouter des portraits</h3>
                        <p>Ajout automatique à l'album "Photos CV"</p>
                    </div>
                </div>
                <div class="upload-body">
                    <UploadZone onUpload={handleUpload} />
                </div>
            </div>

            {#if allPhotosState.error}
                <div class="state-message error"><Icon name="x-circle" size={20} /> {allPhotosState.error}</div>
            {/if}

            {#if allPhotosState.loading}
                <div class="state-message loading"><Spinner size={24} /> Chargement de la base...</div>
            {/if}

            {#if !allPhotosState.loading && !allPhotosState.error}
                <div class="pagination-bar top">
                    <button
                        class="btn-nav"
                        onclick={async () => { await allPhotosState.loadPrevPagePhotosCV(); scrollToPhotosGrid(); }}
                        disabled={allPhotosState.photoCVCurrentPage <= 1 || allPhotosState.loading}
                    >
                        <Icon name="chevron-left" size={18} /> Précédent
                    </button>

                    <span class="page-info">Page {allPhotosState.photoCVCurrentPage}</span>

                    <button
                        class="btn-nav"
                        onclick={async () => { await allPhotosState.loadNextPagePhotosCV(); scrollToPhotosGrid(); }}
                        disabled={!allPhotosState.photoCVHasMore || allPhotosState.loading}
                    >
                        Suivant <Icon name="chevron-right" size={18} />
                    </button>
                </div>

                <div bind:this={photosGridContainer} class="grid-wrapper">
                    <PhotosGrid state={allPhotosState} />
                </div>

                <div class="pagination-bar bottom">
                    <button
                        class="btn-nav"
                        onclick={async () => { await allPhotosState.loadPrevPagePhotosCV(); scrollToPhotosGrid(); }}
                        disabled={allPhotosState.photoCVCurrentPage <= 1 || allPhotosState.loading}
                    >
                        <Icon name="chevron-left" size={18} />
                    </button>

                    <span class="page-info">Page {allPhotosState.photoCVCurrentPage}</span>

                    <button
                        class="btn-nav"
                        onclick={async () => { await allPhotosState.loadNextPagePhotosCV(); scrollToPhotosGrid(); }}
                        disabled={!allPhotosState.photoCVHasMore || allPhotosState.loading}
                    >
                        <Icon name="chevron-right" size={18} />
                    </button>
                </div>
            {/if}
        </div>
        {/if}
    </div>
  </div>
</main>

<style>
  /* --- VARIABLES (Local Scope) --- */
  .photoscv-main {
    --pcv-bg: var(--bg-primary, #ffffff);
    --pcv-card-bg: var(--bg-secondary, #ffffff);
    --pcv-text: var(--text-primary, #1f2937);
    --pcv-text-muted: var(--text-secondary, #6b7280);
    --pcv-border: var(--border, #e5e7eb);
    --pcv-accent: var(--accent, #3b82f6);

    position: relative;
    min-height: 100vh;
    color: var(--pcv-text);
    background-color: var(--pcv-bg);
    overflow-x: hidden;
  }

  @media (prefers-color-scheme: dark) {
    .photoscv-main {
        --pcv-bg: var(--bg-primary, #0f172a);
        --pcv-card-bg: var(--bg-secondary, #1e293b);
        --pcv-text: var(--text-primary, #f3f4f6);
        --pcv-text-muted: var(--text-secondary, #9ca3af);
        --pcv-border: var(--border, #334155);
    }
  }

  /* --- BACKGROUND --- */
  .page-background { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  .gradient-blob { position: absolute; border-radius: 50%; filter: blur(100px); opacity: 0.15; }
  .blob-1 { width: 600px; height: 600px; background: #0ea5e9; top: -200px; left: 10%; animation: float 25s infinite; }
  .blob-2 { width: 500px; height: 500px; background: #8b5cf6; top: 30%; right: 15%; animation: float 30s infinite reverse; }
  .blob-3 { width: 550px; height: 550px; background: #ec4899; bottom: 10%; left: 20%; animation: float 28s infinite; }
  @keyframes float { 0%, 100% { transform: translate(0,0); } 50% { transform: translate(30px, -30px); } }

  /* --- CONTAINER --- */
  .photoscv-container {
    position: relative;
    z-index: 1;
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem 1.5rem 6rem;
  }

  /* --- HEADER --- */
  .page-header { text-align: center; margin-bottom: 2.5rem; }
  .page-title {
    font-size: 3rem; font-weight: 800; margin: 0;
    background: linear-gradient(135deg, var(--pcv-text), var(--pcv-accent));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
  }
  .subtitle { color: var(--pcv-text-muted); font-size: 1.1rem; margin-top: 0.5rem; }

  /* --- TABS (PILLS) --- */
  .tabs-container {
    display: flex; justify-content: center; gap: 0.5rem;
    margin-bottom: 3rem;
    background: var(--pcv-card-bg);
    padding: 0.5rem;
    border-radius: 99px;
    border: 1px solid var(--pcv-border);
    width: fit-content;
    margin-left: auto; margin-right: auto;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
  }

  .tab-pill {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.5rem 1.5rem;
    border-radius: 99px;
    border: none;
    background: transparent;
    color: var(--pcv-text-muted);
    font-weight: 600; font-size: 0.95rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .tab-pill:hover { color: var(--pcv-text); background: rgba(0,0,0,0.05); }
  .tab-pill.active {
    background: var(--pcv-accent);
    color: white;
    box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3);
  }

  /* --- CONTENT SECTIONS --- */
  .section-header { text-align: center; margin-bottom: 2rem; }
  .section-header h2 { font-size: 1.5rem; color: var(--pcv-text); opacity: 0.8; }

  /* --- UPLOAD CARD --- */
  .upload-card {
    background: var(--pcv-card-bg);
    border: 1px solid var(--pcv-border);
    border-radius: 1.5rem;
    overflow: hidden;
    margin-bottom: 3rem;
    box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05);
  }

  .upload-header {
    padding: 1.5rem;
    border-bottom: 1px solid var(--pcv-border);
    display: flex; align-items: center; gap: 1rem;
    background: rgba(59, 130, 246, 0.03);
  }

  .icon-box {
    width: 48px; height: 48px;
    border-radius: 12px;
    background: linear-gradient(135deg, var(--pcv-accent), #8b5cf6);
    color: white;
    display: flex; align-items: center; justify-content: center;
  }

  .upload-header h3 { margin: 0; font-size: 1.2rem; font-weight: 700; color: var(--pcv-text); }
  .upload-header p { margin: 0.25rem 0 0; color: var(--pcv-text-muted); font-size: 0.9rem; }
  .upload-body { padding: 2rem; }

  /* --- PAGINATION --- */
  .pagination-bar {
    display: flex; align-items: center; justify-content: center; gap: 1rem;
    padding: 1rem;
    background: var(--pcv-card-bg);
    border: 1px solid var(--pcv-border);
    border-radius: 1rem;
    width: fit-content;
    margin: 0 auto;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
  }

  .pagination-bar.top { margin-bottom: 2rem; }
  .pagination-bar.bottom { margin-top: 2rem; }

  .page-info {
    font-weight: 600; color: var(--pcv-text); min-width: 80px; text-align: center;
  }

  .btn-nav {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: transparent;
    border: 1px solid var(--pcv-border);
    border-radius: 0.5rem;
    color: var(--pcv-text);
    font-weight: 500; cursor: pointer;
    transition: all 0.2s;
  }

  .btn-nav:hover:not(:disabled) {
    border-color: var(--pcv-accent); color: var(--pcv-accent);
    background: rgba(59, 130, 246, 0.05);
  }
  .btn-nav:disabled { opacity: 0.5; cursor: not-allowed; }

  /* --- UTILS --- */
  .grid-wrapper { margin-top: 1rem; }

  .state-message {
    display: flex; align-items: center; justify-content: center; gap: 0.75rem;
    padding: 2rem; color: var(--pcv-text-muted);
  }
  .state-message.error { color: #ef4444; }

  @media (max-width: 640px) {
    .page-title { font-size: 2rem; }
    .pagination-bar { width: 100%; justify-content: space-between; }
    .btn-nav { padding: 0.5rem; }
  }
</style>
