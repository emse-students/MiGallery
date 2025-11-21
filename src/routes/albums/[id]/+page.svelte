<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import Icon from '$lib/components/Icon.svelte';
  import PhotosGrid from '$lib/components/PhotosGrid.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import UploadZone from '$lib/components/UploadZone.svelte';
  import EditAlbumModal from '$lib/components/EditAlbumModal.svelte';
  import ConfirmModal from '$lib/components/ConfirmModal.svelte';
  import { PhotosState } from '$lib/photos.svelte';
  import { toast } from '$lib/toast';
  import { handleAlbumUpload } from '$lib/album-operations';
  import { fetchArchive, saveBlobAs } from '$lib/immich/download';
  import type { User, Album } from '$lib/types/api';

  let title = $state('');
  let showEditAlbumModal = $state(false);

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
  console.log('✓ [albums/[id]] PhotosState créé directement');

  console.log('✓ [albums/[id]] Script chargé');

  async function downloadAll() {
    if (!confirm(`Télécharger ${photosState.assets.length} image(s) de cet album au format ZIP ?`)) return;

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

  async function handleUpload(files: File[], onProgress?: (current: number, total: number) => void) {
    // Capturer albumId au moment de l'appel
    const albumId = String($page.params.id ?? '');
    if (!albumId) {
      toast.error('Album ID manquant');
      return;
    }

    await handleAlbumUpload(files, albumId, photosState, {
      onProgress,
      isPhotosCV: false,
      onSuccess: async () => {
        // Recharger l'album avec les nouvelles photos
        const immichId = String(($page.data as { album?: Album }).album?.id ?? '');
        const name = String(($page.data as { album?: Album }).album?.name ?? '').trim();
        if (immichId) {
          await photosState.loadAlbumWithStreaming(immichId, name || undefined);
        }
      }
    });
  }

  // Temporairement commenté

  import { onDestroy } from 'svelte';
  console.log('✓ [albums/[id]] onDestroy importé');

  onDestroy(() => {
    if (photosState.currentDownloadController) {
      try { photosState.currentDownloadController.abort(); } catch (e: unknown) {}
      photosState.currentDownloadController = null;
    }
  });

  $effect(() => {
    console.log('⚡ [albums/[id]] $effect appelé');
    const id = String($page.params.id ?? '');
    const album = ($page.data as { album?: Album }).album;
    console.log('  - albumId:', id);
    console.log('  - album:', album);
    const immichId = String(album?.id ?? '');
    const name = String(album?.name ?? '').trim();
    console.log('  - immichId:', immichId);
    console.log('  - name:', name);
    if (id && immichId) {
      console.log('  ✓ Chargement album...');
      title = name || 'Album';
      photosState.loadAlbumWithStreaming(immichId, name || undefined);
    } else {
      console.log('  ✗ Album id ou immichId manquants');
    }
  });
</script>

<svelte:head>
  <title>{title || 'Album'} - MiGallery</title>
</svelte:head>

<main class="album-detail">
  <div class="page-background"></div>

  <nav><a href="/albums"><Icon name="chevron-left" size={16} /> Retour aux albums</a></nav>

  <div class="flex items-center gap-3 justify-between">
    <h1 class="m-0">{title || 'Album'}</h1>
    <div class="flex gap-2">
      {#if canManagePhotos && photosState.assets.length > 0}
        <button onclick={() => (photosState.selecting = !photosState.selecting)} class="px-3 py-2 rounded-lg {photosState.selecting ? 'bg-gray-600 hover:bg-gray-700' : 'bg-blue-600 hover:bg-blue-700'} text-white border-0 cursor-pointer flex items-center gap-2">
          <Icon name={photosState.selecting ? 'x' : 'check-square'} size={16} />
          {photosState.selecting ? 'Annuler' : 'Sélectionner'}
        </button>
      {/if}
      {#if canManagePhotos}
        <button onclick={() => showEditAlbumModal = true} class="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white border-0 cursor-pointer flex items-center gap-2">
          <Icon name="edit" size={16} />
          Modifier l'album
        </button>
        <button onclick={() => deleteAlbum()} class="btn-delete-album px-3 py-2 rounded-lg text-white border-0 cursor-pointer flex items-center gap-2">
          <Icon name="trash" size={16} />
          Supprimer l'album
        </button>
      {/if}
      <button onclick={() => downloadAll()} disabled={photosState.isDownloading} class="px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white border-0 cursor-pointer">
        {#if photosState.isDownloading}
          {#if photosState.downloadProgress >= 0}
            <Icon name="download" size={16} />
            {Math.round(photosState.downloadProgress * 100)}%
          {:else}
            <Spinner size={18} />
            Téléchargement...
          {/if}
        {:else}
          <Icon name="download" size={16} />
          Télécharger tout
        {/if}
      </button>
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
      <PhotosGrid state={photosState} />
    {/if}

  {#if showEditAlbumModal && $page.params.id}
    <EditAlbumModal
      albumId={String($page.params.id)}
      onClose={() => showEditAlbumModal = false}
      onAlbumUpdated={() => window.location.reload()}
    />
  {/if}

  {#if showConfirmModal && confirmModalConfig}
    <ConfirmModal
      title={confirmModalConfig.title}
      message={confirmModalConfig.message}
      confirmText={confirmModalConfig.confirmText}
      onConfirm={confirmModalConfig.onConfirm}
      onCancel={() => showConfirmModal = false}
    />
  {/if}
</main>

<style>
  .album-detail {
    position: relative;
    min-height: 100vh;
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
    top: -250px;
    left: -250px;
    animation-delay: -6s;
  }

  .page-background::after {
    background: radial-gradient(circle, rgba(236, 72, 153, 0.4) 0%, transparent 70%);
    bottom: -300px;
    right: -250px;
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

  /* Styles pour les boutons de l'en-tête */
  :global(.btn-delete-album) {
    background: #dc2626 !important;
  }

  :global(.btn-delete-album:hover:not(:disabled)) {
    background: #b91c1c !important;
  }

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
</style>
