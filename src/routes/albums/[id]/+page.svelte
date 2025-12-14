<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { fade, fly } from 'svelte/transition';
  import Icon from '$lib/components/Icon.svelte';
  import PhotosGrid from '$lib/components/PhotosGrid.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import UploadZone from '$lib/components/UploadZone.svelte';
  import AlbumModal from '$lib/components/AlbumModal.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import { PhotosState } from '$lib/photos.svelte';
  import { toast } from '$lib/toast';
  import { showConfirm } from '$lib/confirm';
  import { handleAlbumUpload } from '$lib/album-operations';
  import { fetchArchive, saveBlobAs } from '$lib/immich/download';
  import { activeOperations } from '$lib/operations';
  import { navigationModalStore } from '$lib/navigation-store';
  import type { User, Album } from '$lib/types/api';

  // --- LOGIC ---
  const photosState = new PhotosState();
  let title = $state('');
  let locationInfo = $state('');
  let showAlbumModal = $state(false);
  let showConfirmModal = $state(false);
  let confirmModalConfig = $state<{ title: string; message: string; confirmText?: string; onConfirm: () => void } | null>(null);

  // Sécurité & Rôles
  let userRole = $derived(((page.data.session?.user as User)?.role) || 'user');
  let canManagePhotos = $derived(userRole === 'mitviste' || userRole === 'admin');

  // Gestion Navigation / Opérations actives
  let hasActiveOps = $state(false);
  const unsubOps = activeOperations.subscribe((ops) => { hasActiveOps = ops.size > 0; });

  function handleBackClick() {
    if (hasActiveOps) {
      navigationModalStore.set({ show: true, href: '/albums' });
    } else {
      goto('/albums');
    }
  }

  // Chargement des données de l'album
  $effect(() => {
    const albumData = (page.data as { album?: Album }).album;
    if (albumData?.id) {
      title = albumData.name || 'Album';
      locationInfo = albumData.location || '';
      // Chargement initial des photos
      photosState.loadAlbumWithStreaming(albumData.id, albumData.name, albumData.visibility || undefined);
    }
  });

  // Actions
  async function downloadAll() {
    const ok = await showConfirm(`Télécharger ${photosState.assets.length} image(s) ?`, 'Télécharger ZIP');
    if (!ok) return;

    if (photosState.currentDownloadController) photosState.currentDownloadController.abort();
    const controller = new AbortController();
    photosState.currentDownloadController = controller;
    photosState.isDownloading = true;
    photosState.downloadProgress = 0;

    try {
      const assetIds = photosState.assets.map((a) => a.id);
      const blob = await fetchArchive(assetIds, {
        onProgress: (p) => { photosState.downloadProgress = p; },
        signal: controller.signal,
      });
      saveBlobAs(blob, `${title || 'album'}.zip`);
      toast.success('Téléchargement terminé');
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') toast.error('Erreur téléchargement: ' + (e as Error).message);
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
      title: 'Supprimer l\'album',
      message: `Voulez-vous vraiment supprimer "${title}" ?\n\nCela supprimera l'album d'Immich. Les photos resteront dans la bibliothèque globale.`,
      confirmText: 'Supprimer définitivement',
      onConfirm: async () => {
        showConfirmModal = false;
        try {
          const res = await fetch(`/api/albums/${albumId}`, { method: 'DELETE' });
          if (!res.ok && res.status !== 204) throw new Error('Erreur suppression');
          toast.success('Album supprimé');
          goto('/albums');
        } catch (e: unknown) {
          toast.error('Erreur: ' + (e as Error).message);
        }
      }
    };
    showConfirmModal = true;
  }

  async function shareAlbum() {
    try {
      const url = window.location.href;
      if (navigator.share) {
        await navigator.share({ title: title || 'Album', url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success('Lien copié !');
      }
    } catch (e) { toast.error('Erreur partage'); }
  }

  async function onUploadFiles(
    files: File[],
    onProgress?: (c: number, t: number) => void,
    onFileResult?: (res: any) => void
  ) {
    const albumId = page.params.id;
    if (!albumId) throw new Error('ID manquant');

    return await handleAlbumUpload(files, albumId, photosState, {
      onProgress,
      onFileResult,
      isPhotosCV: false,
      onSuccess: async () => {
        // Recharger pour être sûr de la synchro
        photosState.loadAlbumWithStreaming(albumId, title);
      }
    });
  }

  onDestroy(() => {
    unsubOps();
    photosState.cleanup();
  });
</script>

<svelte:head>
  <title>{title || 'Album'} - MiGallery</title>
</svelte:head>

<!-- SNIPPET DES BOUTONS D'ACTION (Mobile & Desktop) -->
{#snippet actionButtons(mobile = false)}
  <div class="actions-group {mobile ? 'mobile' : 'desktop'}">
    <!-- Mode Sélection -->
    {#if canManagePhotos && photosState.assets.length > 0}
      <button
        onclick={() => (photosState.selecting = !photosState.selecting)}
        class="btn-glass {photosState.selecting ? 'active' : ''}"
        title={photosState.selecting ? 'Terminer la sélection' : 'Sélectionner'}
      >
        <Icon name={photosState.selecting ? 'check' : 'check-circle'} size={18} />
        {#if !mobile || photosState.selecting}
            <span class="label">{photosState.selecting ? 'OK' : 'Sélection'}</span>
        {/if}
      </button>
    {/if}

    <!-- Admin Actions -->
    {#if canManagePhotos}
      <button onclick={() => showAlbumModal = true} class="btn-glass edit" title="Modifier">
        <Icon name="edit-2" size={18} />
        {#if !mobile}<span class="label">Éditer</span>{/if}
      </button>
      <button onclick={() => deleteAlbum()} class="btn-glass delete" title="Supprimer">
        <Icon name="trash-2" size={18} />
      </button>
    {/if}

    <!-- Divider -->
    {#if canManagePhotos}<div class="divider"></div>{/if}

    <!-- Public Actions -->
    <button onclick={shareAlbum} class="btn-glass share" title="Partager">
      <Icon name="share-2" size={18} />
      {#if !mobile}<span class="label">Partager</span>{/if}
    </button>

    <button
        onclick={downloadAll}
        disabled={photosState.isDownloading || photosState.assets.length === 0}
        class="btn-glass download"
        title="Télécharger tout"
    >
        {#if photosState.isDownloading}
            <Spinner size={18} />
            {#if !mobile}
                <span class="label">{Math.round(photosState.downloadProgress * 100)}%</span>
            {/if}
        {:else}
            <Icon name="download" size={18} />
            {#if !mobile}<span class="label">Télécharger</span>{/if}
        {/if}
    </button>
  </div>
{/snippet}

<main class="page-main">
  <!-- Fond animé -->
  <div class="page-background">
    <div class="gradient-blob blob-1"></div>
    <div class="gradient-blob blob-2"></div>
    <div class="gradient-blob blob-3"></div>
  </div>

  <div class="page-container">
    <!-- Navigation Retour -->
    <nav class="top-nav" in:fade={{ duration: 200 }}>
        <button class="back-btn" onclick={handleBackClick}>
            <Icon name="arrow-left" size={20} />
            <span>Retour aux albums</span>
        </button>
    </nav>

    <!-- En-tête Album -->
    <header class="page-header" in:fly={{ y: 20, duration: 400 }}>
        <div class="header-main">
            <div class="title-wrapper">
                <h1>{title}</h1>
                {#if locationInfo}
                    <p class="meta"><Icon name="map-pin" size={14} /> {locationInfo}</p>
                {/if}
                <p class="count">{photosState.assets.length} photo{photosState.assets.length > 1 ? 's' : ''}</p>
            </div>
        </div>

        <div class="header-toolbar">
            {@render actionButtons(false)}
        </div>
    </header>

    {#if photosState.error}
        <div class="glass-card error-card">
            <Icon name="alert-circle" size={24} />
            <p>{photosState.error}</p>
        </div>
    {/if}

    <!-- Zone Upload (Admin) -->
    {#if canManagePhotos}
        <div class="upload-container glass-card" in:fade>
            <div class="upload-header">
                <h3>Ajouter des photos</h3>
                <p>Glissez-déposez vos fichiers ici</p>
            </div>
            <UploadZone onUpload={onUploadFiles} />
        </div>
    {/if}

    <!-- Grille Photos -->
    {#if photosState.loading && photosState.assets.length === 0}
        <div class="loading-state">
            <Spinner size={40} />
            <p>Chargement de l'album...</p>
        </div>
    {:else if !photosState.loading && photosState.assets.length === 0}
        <div class="empty-state glass-card">
            <Icon name="image" size={48} />
            <p>Cet album est vide pour le moment.</p>
        </div>
    {:else}
        <div class="gallery-wrapper" in:fade={{ duration: 300 }}>
            <!-- Le composant PhotosGrid gère l'affichage, la sélection et la modale plein écran -->
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

  <!-- Barre d'actions Mobile (Sticky Bottom) -->
  <div class="mobile-bar">
    {@render actionButtons(true)}
  </div>

  <!-- Modals -->
  {#if showAlbumModal && page.params.id}
    <AlbumModal
      albumId={page.params.id}
      onClose={() => showAlbumModal = false}
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
      onCancel={() => showConfirmModal = false}
    >
      <p style="white-space: pre-wrap;">{confirmModalConfig.message}</p>
    </Modal>
  {/if}
</main>

<style>
  /* --- VARIABLES --- */
  .page-main {
    --am-bg: var(--bg-primary, #ffffff);
    --am-text: var(--text-primary, #1f2937);
    --am-text-muted: var(--text-secondary, #6b7280);
    --am-accent: var(--accent, #3b82f6);
    --am-border: var(--border, #e5e7eb);
    /* Do not override glass variables here — rely on global theme variables to avoid flashes */

    position: relative;
    min-height: 100vh;
    color: var(--am-text);
    overflow-x: hidden;
    padding-bottom: 100px; /* Espace pour la barre mobile */
    font-family: system-ui, -apple-system, sans-serif;
  }

  @media (prefers-color-scheme: dark) {
    .page-main {
        --am-bg: var(--bg-primary, #020617);
        --am-text: var(--text-primary, #f3f4f6);
        --am-text-muted: var(--text-secondary, #94a3b8);
        --am-border: rgba(255, 255, 255, 0.08);
        --am-glass-bg: rgba(15, 23, 42, 0.6);
        --am-glass-border: rgba(255, 255, 255, 0.08);
        --am-item-bg: rgba(255, 255, 255, 0.03);
    }
  }
  :global([data-theme='dark']) .page-main {
    --am-bg: var(--bg-primary, #020617);
    --am-text: var(--text-primary, #f3f4f6);
    --am-text-muted: var(--text-secondary, #94a3b8);
    --am-border: rgba(255, 255, 255, 0.08);
    --am-glass-bg: rgba(15, 23, 42, 0.6);
    --am-glass-border: rgba(255, 255, 255, 0.08);
    --am-item-bg: rgba(255, 255, 255, 0.03);
  }

  /* Ensure explicit light theme variables when the app attribute forces light mode */
  :global([data-theme='light']) .page-main {
    --am-bg: var(--bg-primary, #ffffff);
    --am-text: var(--text-primary, #111827);
    --am-text-muted: var(--text-secondary, #6b7280);
    --am-border: var(--border, #e5e7eb);
    --am-glass-bg: rgba(255, 255, 255, 0.7);
    --am-glass-border: rgba(255, 255, 255, 0.08);
    --am-item-bg: rgba(255, 255, 255, 0.5);
  }

  /* --- BACKGROUND --- */
  .page-background { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  .gradient-blob { position: absolute; border-radius: 50%; filter: blur(100px); opacity: 0.15; }
  .blob-1 { width: 600px; height: 600px; background: var(--am-accent); top: -200px; left: 10%; animation: float 25s infinite; }
  .blob-2 { width: 500px; height: 500px; background: #8b5cf6; top: 30%; right: 15%; animation: float 30s infinite reverse; }
  .blob-3 { width: 550px; height: 550px; background: #ec4899; bottom: 10%; left: 20%; animation: float 28s infinite; }
  @keyframes float { 0%, 100% { transform: translate(0,0); } 50% { transform: translate(30px, -30px); } }

  .page-container {
    position: relative; z-index: 1;
    max-width: 1400px; margin: 0 auto;
    padding: 2rem 1.5rem;
  }

  /* --- NAV --- */
  .top-nav { margin-bottom: 2rem; }
  .back-btn {
      display: flex; align-items: center; gap: 0.5rem;
      background: none; border: none; color: var(--am-text-muted);
      font-weight: 600; cursor: pointer; transition: color 0.2s;
      padding: 0; font-size: 0.95rem;
  }
  .back-btn:hover { color: var(--am-accent); }

  /* --- HEADER --- */
  .page-header {
      display: flex; justify-content: space-between; align-items: flex-end;
      margin-bottom: 3rem; flex-wrap: wrap; gap: 2rem;
  }
  .header-main { display: flex; align-items: center; gap: 1.5rem; }

  /* .icon-wrapper removed because it's not used in the markup to avoid unused CSS selector error */

  .title-wrapper h1 { margin: 0; font-size: 2.5rem; font-weight: 800; line-height: 1.1; letter-spacing: -0.02em; }
  .title-wrapper .meta { margin: 0.25rem 0 0; color: var(--am-text-muted); font-size: 1rem; display: flex; align-items: center; gap: 0.4rem; }
  .title-wrapper .count { font-size: 0.85rem; color: var(--am-text-muted); opacity: 0.7; margin: 0.2rem 0 0; }

  /* --- ACTIONS BUTTONS (Colors & Styles) --- */
  .actions-group {
      display: flex; gap: 0.75rem; align-items: center;
      background: var(--am-glass-bg); padding: 0.5rem; border-radius: 16px;
      border: 1px solid var(--am-glass-border); backdrop-filter: blur(12px);
  }
  .divider { width: 1px; height: 24px; background: var(--am-border); margin: 0 0.25rem; }

  .btn-glass {
      display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 1rem;
      border: 1px solid transparent; border-radius: 10px;
      background: var(--am-item-bg); color: var(--am-text);
      font-weight: 600; cursor: pointer; transition: all 0.2s;
      white-space: nowrap;
  }
  /* Base hover */
  .btn-glass:hover {
      background: rgba(255,255,255,0.1); border-color: var(--am-glass-border); transform: translateY(-2px);
  }

  /* Codes couleurs spécifiques au survol */
  .btn-glass.edit:hover { background: #8b5cf6; color: white; border-color: transparent; box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3); }
  .btn-glass.delete:hover { background: #ef4444; color: white; border-color: transparent; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3); }
  .btn-glass.share:hover { background: #0ea5e9; color: white; border-color: transparent; box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3); }

  /* Download est l'action primaire, donc verte par défaut */
  .btn-glass.download {
      background: #10b981; color: white; border-color: transparent;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
  }
  .btn-glass.download:hover { background: #059669; transform: translateY(-2px); }

  /* Active toggle state */
  .btn-glass.active { background: var(--am-text); color: var(--am-bg); }

  .btn-glass:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; filter: grayscale(1); }

  /* --- CARDS & CONTENT --- */
  .glass-card {
      background: var(--am-glass-bg); backdrop-filter: blur(20px);
      border: 1px solid var(--am-glass-border); border-radius: 20px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.05);
  }

  .upload-container { padding: 1.5rem; margin-bottom: 2.5rem; }
  .upload-header { margin-bottom: 1.5rem; text-align: center; }
  .upload-header h3 { margin: 0; font-size: 1.2rem; }
  .upload-header p { margin: 0; color: var(--am-text-muted); font-size: 0.9rem; }

  /* Make upload header use theme glass background for consistency */
  .upload-header { background: var(--am-glass-bg); padding: 1rem; border-radius: 12px; }

  .error-card { padding: 1.5rem; border-left: 4px solid #ef4444; color: #ef4444; display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem; }

  .empty-state {
      padding: 4rem; text-align: center; color: var(--am-text-muted);
      display: flex; flex-direction: column; align-items: center; gap: 1rem;
  }
  .loading-state { text-align: center; padding: 4rem; color: var(--am-text-muted); display: flex; flex-direction: column; align-items: center; gap: 1rem; }

  /* --- MOBILE BAR --- */
  .mobile-bar { display: none; }

  @media (max-width: 768px) {
      .header-toolbar { display: none; } /* Hide desktop actions */

      .mobile-bar {
          display: block; position: fixed; bottom: 0; left: 0; right: 0;
          z-index: 100; padding: 0.75rem 1rem;
          padding-bottom: calc(0.75rem + env(safe-area-inset-bottom));
          background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(16px);
          border-top: 1px solid var(--am-border);
      }
      .actions-group.mobile {
          justify-content: space-between; background: transparent; border: none; padding: 0; gap: 0.5rem;
      }
      .actions-group.mobile .btn-glass {
          flex-direction: column; padding: 0.5rem; gap: 0.25rem; font-size: 0.7rem; flex: 1;
          background: transparent; border: none; color: var(--am-text-muted); box-shadow: none;
      }
      .actions-group.mobile .btn-glass.active { color: var(--am-accent); background: rgba(59,130,246,0.1); }

      /* Mobile Colors */
      .actions-group.mobile .btn-glass.download { color: #10b981; background: transparent; }
      .actions-group.mobile .btn-glass.delete { color: #ef4444; }
      .actions-group.mobile .btn-glass.share { color: #0ea5e9; }
      .actions-group.mobile .btn-glass.edit { color: #8b5cf6; }

      .page-header { flex-direction: column; align-items: flex-start; gap: 1rem; }
      .header-main { gap: 1rem; }
      .title-wrapper h1 { font-size: 1.8rem; }
  }

  /* Mobile: improve spacing and contrast for upload area */
  @media (max-width: 768px) {
    .upload-container { margin-bottom: 1rem !important; }
    /* Use padding-top to guarantee spacing even after the gallery grid renders */
    .gallery-wrapper { margin-top: 0 !important; padding-top: 1rem !important; }
  }

  @media (max-width: 768px) and (prefers-color-scheme: light) {
    .upload-container, .upload-header {
      background: rgba(255,255,255,0.96) !important;
      border-color: rgba(0,0,0,0.06) !important;
      /* Force explicit readable text color in light mode */
      color: var(--text-primary, #111827) !important;
      box-shadow: 0 8px 28px rgba(0,0,0,0.06) !important;
      backdrop-filter: none !important;
    }
    .upload-container *,
    .upload-header h3,
    .upload-header p {
      color: var(--text-primary, #111827) !important;
    }
  }

  /* Mobile: améliorer la lisibilité des zones d'upload et cartes glass */
  @media (max-width: 768px) {
    .upload-container,
    .upload-container .upload-header,
    .glass-card.upload-container,
    .upload-container .upload-header h3,
    .upload-container .upload-header p {
      background: rgba(255,255,255,0.96) !important;
      border-color: rgba(0,0,0,0.06) !important;
      color: var(--am-text) !important;
      box-shadow: 0 8px 28px rgba(0,0,0,0.08) !important;
      backdrop-filter: none !important;
    }
  }

  @media (max-width: 768px) and (prefers-color-scheme: dark) {
    .upload-container,
    .upload-container .upload-header,
    .glass-card.upload-container,
    .upload-container .upload-header h3,
    .upload-container .upload-header p {
      background: rgba(8,10,12,0.92) !important;
      border-color: rgba(255,255,255,0.06) !important;
      color: var(--am-text) !important;
      box-shadow: 0 8px 28px rgba(0,0,0,0.35) !important;
      backdrop-filter: none !important;
    }
  }
</style>
