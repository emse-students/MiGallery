<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
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
  import type { User, Album } from '$lib/types/api';

  let title = $state('');
  let showAlbumModal = $state(false);

  // État du modal de confirmation
  let showConfirmModal = $state(false);
  let confirmModalConfig = $state<{
    title: string;
    message: string;
    confirmText?: string;
    onConfirm: () => void;
  } | null>(null);

  // Vérifier le rôle de l'utilisateur
  let userRole = $derived(($page.data.session?.user as User)?.role || 'user');
  let canManagePhotos = $derived(userRole === 'mitviste' || userRole === 'admin');

  // PhotosState pour gérer les photos de l'album - instancier directement
  const photosState = new PhotosState();

  async function downloadAll() {
    const ok = await showConfirm(`Télécharger ${photosState.assets.length} image(s) de cet album au format ZIP ?`, 'Télécharger');
    if (!ok) return;

    if (photosState.currentDownloadController) {
      try { photosState.currentDownloadController.abort(); } catch (e: unknown) {}
      photosState.currentDownloadController = null;
    }

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
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        console.info('Téléchargement annulé');
      } else {
        toast.error('Erreur lors du téléchargement en ZIP: ' + (e as Error).message);
      }
    } finally {
      photosState.isDownloading = false;
      photosState.downloadProgress = 0;
      photosState.currentDownloadController = null;
    }
  }

  async function deleteAsset(assetId: string) {
    confirmModalConfig = {
      title: 'Supprimer la photo',
      message: 'Voulez-vous vraiment mettre cette photo à la corbeille ?',
      confirmText: 'Mettre à la corbeille',
      onConfirm: async () => {
        showConfirmModal = false;
        try {
          const res = await fetch(`/api/immich/assets`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [assetId] })
          });

          if (!res.ok && res.status !== 204) {
            const errText = await res.text().catch(() => res.statusText);
            throw new Error(errText || 'Erreur lors de la suppression');
          }

          // Retirer l'asset de la liste locale
          photosState.assets = photosState.assets.filter((a) => a.id !== assetId);
          toast.success('Photo supprimée');
        } catch (e: unknown) {
          toast.error('Erreur lors de la suppression: ' + (e as Error).message);
        }
      }
    };
    showConfirmModal = true;
  }

  async function deleteAlbum() {
    const albumId = window.location.pathname.split('/')[2];
    if (!albumId) {
      toast.error('Album ID manquant');
      return;
    }
    const albumName = title || albumId;

    confirmModalConfig = {
      title: 'Supprimer l\'album',
      message: `Voulez-vous vraiment supprimer l'album "${albumName}" ?\n\nCette action supprimera l'album d'Immich et de la base de données locale. Les photos ne seront pas supprimées.`,
      confirmText: 'Supprimer l\'album',
      onConfirm: async () => {
        showConfirmModal = false;
        try {
          const res = await fetch(`/api/albums/${albumId}`, {
            method: 'DELETE'
          });

          if (!res.ok && res.status !== 204) {
            const errText = await res.text().catch(() => res.statusText);
            throw new Error(errText || 'Erreur lors de la suppression de l\'album');
          }

          toast.success('Album supprimé');
          // Rediriger vers la liste des albums
          goto('/albums');
        } catch (e: unknown) {
          toast.error('Erreur lors de la suppression: ' + (e as Error).message);
        }
      }
    };
    showConfirmModal = true;
  }

  async function shareAlbum() {
    try {
      const url = window.location.href;
      if ((navigator as any).share) {
        await (navigator as any).share({ title: title || 'Album', url });
        toast.success('Album partagé');
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        toast.success('Lien copié dans le presse-papiers');
      } else {
        // Fallback: show the URL so the user can copy it
        // eslint-disable-next-line no-alert
        window.prompt('Copiez ce lien pour partager l\'album', url);
      }
    } catch (e: unknown) {
      toast.error('Impossible de partager: ' + ((e as Error)?.message ?? String(e)));
    }
  }

  async function handleUpload(files: File[], onProgress?: (current: number, total: number) => void) {
    // Capturer albumId au moment de l'appel
    const albumId = String($page.params.id ?? '');
    if (!albumId) {
      toast.error('Album ID manquant');
      throw new Error('Album ID manquant');
    }

    const results = await handleAlbumUpload(files, albumId, photosState, {
      onProgress,
      isPhotosCV: false,
        onSuccess: async () => {
        // Recharger l'album avec les nouvelles photos
        const immichId = String(($page.data as { album?: Album }).album?.id ?? '');
        const name = String(($page.data as { album?: Album }).album?.name ?? '').trim();
        const visibility = String(($page.data as { album?: Album }).album?.visibility ?? '');
        if (immichId) {
          await photosState.loadAlbumWithStreaming(immichId, name || undefined, visibility || undefined);
        }
      }
    });

    return results || [];
  }

  // Temporairement commenté

  import { onDestroy } from 'svelte';

  onDestroy(() => {
    if (photosState.currentDownloadController) {
      try { photosState.currentDownloadController.abort(); } catch (e: unknown) {}
      photosState.currentDownloadController = null;
    }
  });

  let visibility = $state('');

  $effect(() => {
    const id = String($page.params.id ?? '');
    const album = ($page.data as { album?: Album }).album;
    const immichId = String(album?.id ?? '');
    const name = String(album?.name ?? '').trim();
      if (id && immichId) {
      title = name || 'Album';
      visibility = String(album?.visibility ?? '');
      photosState.loadAlbumWithStreaming(immichId, name || undefined, visibility || undefined);
    }
  });

  let albumLocalId = String($page.params.id ?? '');
</script>

<svelte:head>
  <title>{title || 'Album'} - MiGallery</title>
</svelte:head>

{#snippet actionButtons(mobile = false)}
  {#if canManagePhotos && photosState.assets.length > 0}
    <button
      onclick={() => (photosState.selecting = !photosState.selecting)}
      class="action-btn {photosState.selecting ? 'active' : 'primary'}"
      title={photosState.selecting ? 'Annuler la sélection' : 'Sélectionner des photos'}
    >
      <Icon name={photosState.selecting ? 'x' : 'check-square'} size={mobile ? 20 : 16} />
      <span class="btn-label">{photosState.selecting ? 'Annuler' : 'Sélect.'}</span>
    </button>
  {/if}

  {#if canManagePhotos}
    <button
      onclick={() => showAlbumModal = true}
      class="action-btn edit"
      title="Modifier l'album"
    >
      <Icon name="edit" size={mobile ? 20 : 16} />
      <span class="btn-label">{mobile ? 'Modifier' : 'Modifier l\'album'}</span>
    </button>
    <button
      onclick={() => deleteAlbum()}
      class="action-btn delete"
      title="Supprimer l'album"
    >
      <Icon name="trash" size={mobile ? 20 : 16} />
      <span class="btn-label">{mobile ? 'Suppr.' : 'Supprimer l\'album'}</span>
    </button>
  {/if}

  <button
    onclick={() => shareAlbum()}
    class="action-btn share"
    title="Partager l'album"
  >
    <Icon name="share" size={mobile ? 20 : 16} />
    <span class="btn-label">Partager</span>
  </button>

  <button
    onclick={() => downloadAll()}
    disabled={photosState.isDownloading}
    class="action-btn download"
    title="Télécharger tout"
  >
    {#if photosState.isDownloading}
      {#if photosState.downloadProgress >= 0}
        <Icon name="download" size={mobile ? 20 : 16} />
        <span class="btn-label">{Math.round(photosState.downloadProgress * 100)}%</span>
      {:else}
        <Spinner size={mobile ? 20 : 18} />
        <span class="btn-label">...</span>
      {/if}
    {:else}
      <Icon name="download" size={mobile ? 20 : 16} />
      <span class="btn-label">{mobile ? 'Téléch.' : 'Télécharger tout'}</span>
    {/if}
  </button>
{/snippet}

<main class="album-detail">
  <div class="page-background"></div>

  <nav class="top-nav"><a href="/albums"><Icon name="chevron-left" size={16} /> Retour aux albums</a></nav>

  <div class="header-container">
    <div class="header-content">
      <h1 class="m-0">{title || 'Album'}</h1>
      {#if (($page.data as { album?: Album }).album?.location)}
        <p class="location-info">
          <Icon name="map-pin" size={14} />
          {($page.data as { album?: Album }).album?.location}
        </p>
      {/if}
    </div>

    <!-- Desktop Actions -->
    <div class="desktop-actions">
      {@render actionButtons(false)}
    </div>
  </div>

  {#if photosState.error}
      <div class="error"><Icon name="x-circle" size={20} /> Erreur: {photosState.error}</div>
    {/if}

    {#if canManagePhotos}
      <div class="upload-section">
        <h2>Ajouter des photos à cet album</h2>
        <UploadZone onUpload={handleUpload} />
      </div>
    {/if}

    {#if photosState.loading}
      <div class="loading"><Spinner size={20} /> Chargement des photos...</div>
    {/if}

    {#if !photosState.loading && !photosState.error && photosState.assets.length === 0}
      <div class="empty-state">
        <Icon name="image" size={48} />
        <p>Aucune photo dans cet album</p>
      </div>
    {/if}

    {#if photosState.assets.length > 0}
      <!-- Utiliser PhotosGrid pour gérer toute la logique des photos -->
      <PhotosGrid state={photosState} visibility={visibility} albumId={albumLocalId} onModalClose={(hasChanges) => {
        if (!hasChanges) return;

        // Recharger l'album depuis la source après fermeture du modal
        const immichId = String(($page.data as { album?: Album }).album?.id ?? '');
        const name = String(($page.data as { album?: Album }).album?.name ?? '').trim();
        if (immichId) {
          const visibility = String(($page.data as { album?: Album }).album?.visibility ?? '');
          photosState.loadAlbumWithStreaming(immichId, name || undefined, visibility || undefined).catch((e) => {
            console.warn('Erreur reload album après fermeture modal:', e);
          });
        }
      }} />
    {/if}

  {#if showAlbumModal && $page.params.id}
    <AlbumModal
      albumId={String($page.params.id)}
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
      {#snippet children()}
        <p style="white-space: pre-wrap;">{confirmModalConfig!.message}</p>
      {/snippet}
    </Modal>
  {/if}

  <!-- Mobile Bottom Bar -->
  <div class="mobile-bottom-bar">
    {@render actionButtons(true)}
  </div>
</main>

<style>
  .album-detail {
    position: relative;
    min-height: 100vh;
    padding-bottom: 80px; /* Space for bottom bar on mobile */
  }

  .page-background {
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    overflow: hidden;
  }

  .page-background::before,
  .page-background::after {
    content: '';
    position: absolute;
    width: 700px;
    height: 700px;
    border-radius: 50%;
    filter: blur(120px);
    opacity: 0.12;
    animation: float 22s ease-in-out infinite;
  }

  .page-background::before {
    background: radial-gradient(circle, rgba(59, 130, 246, 0.5) 0%, transparent 70%);
    top: -350px;
    left: -350px;
    animation-delay: -6s;
  }

  .page-background::after {
    background: radial-gradient(circle, rgba(236, 72, 153, 0.4) 0%, transparent 70%);
    top: 20%;
    right: -350px;
    animation-delay: -12s;
  }

  @keyframes float {
    0%, 100% {
      transform: translate(0, 0) scale(1);
    }
    33% {
      transform: translate(30px, -50px) scale(1.1);
    }
    66% {
      transform: translate(-20px, 20px) scale(0.9);
    }
  }

  .header-container {
    display: flex;
    align-items: center;
    gap: 1rem;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .header-content {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .location-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.95rem;
    color: var(--text-secondary, #d1d5db);
    margin: 0;
  }

  .desktop-actions {
    display: flex;
    gap: 0.5rem;
  }

  .mobile-bottom-bar {
    display: none;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--bg-secondary, rgba(17, 24, 39, 0.95));
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-top: 1px solid var(--border, rgba(255, 255, 255, 0.1));
    padding: 0.75rem 1rem;
    padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
    justify-content: space-around;
    align-items: center;
    z-index: 100;
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.3);
  }

  /* Action Buttons Styling */
  .action-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: none;
    cursor: pointer;
    color: white;
    font-size: 0.875rem;
    transition: all 0.2s;
  }

  .btn-label {
    white-space: nowrap;
  }

  .action-btn.primary { background-color: #2563eb; }
  .action-btn.primary:hover { background-color: #1d4ed8; }

  .action-btn.active { background-color: #4b5563; }
  .action-btn.active:hover { background-color: #374151; }

  .action-btn.edit { background-color: #9333ea; }
  .action-btn.edit:hover { background-color: #7e22ce; }

  .action-btn.delete { background-color: #dc2626; }
  .action-btn.delete:hover { background-color: #b91c1c; }

  .action-btn.share { background-color: #0284c7; }
  .action-btn.share:hover { background-color: #0369a1; }

  .action-btn.download { background-color: #10b981; }
  .action-btn.download:hover { background-color: #059669; }
  .action-btn.download:disabled { opacity: 0.7; cursor: not-allowed; }

  .upload-section {
    margin: 2rem auto;
    max-width: 800px;
  }

  .upload-section h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: var(--text-primary, #ffffff);
    text-align: center;
  }

  @media (max-width: 1440px) {
    .desktop-actions {
      display: none;
    }

    .mobile-bottom-bar {
      display: flex;
    }

    .action-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      padding: 0.5rem 0.5rem;
      min-width: 50px;
      background-color: transparent !important;
      color: var(--text-muted, #6b7280);
      font-size: 0.625rem;
      font-weight: 500;
    }

    .action-btn:hover, .action-btn:active {
      color: var(--accent, #3b82f6);
    }

    .action-btn.delete { color: #f87171; }
    .action-btn.delete:hover { color: #ef4444; }
    .action-btn.download { color: #6ee7b7; }
    .action-btn.download:hover { color: #34d399; }
    .action-btn.edit { color: #c4b5fd; }
    .action-btn.edit:hover { color: #a78bfa; }
    .action-btn.share { color: #7dd3fc; }
    .action-btn.share:hover { color: #38bdf8; }

    .header-container h1 {
      font-size: 1.5rem;
    }

    .upload-section h2 {
      font-size: 1rem;
    }
  }
</style>
