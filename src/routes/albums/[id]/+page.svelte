<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import Icon from '$lib/components/Icon.svelte';
  import PhotosGrid from '$lib/components/PhotosGrid.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import EditAlbumModal from '$lib/components/EditAlbumModal.svelte';
  import ConfirmModal from '$lib/components/ConfirmModal.svelte';
  import UploadZone from '$lib/components/UploadZone.svelte';
  import { PhotosState } from '$lib/photos.svelte';
  import { consumeNDJSONStream } from '$lib/streaming';
  import { clientCache } from '$lib/client-cache';

  let loading = $state(false);
  let error = $state<string | null>(null);
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
  let userRole = $derived(($page.data.session?.user as any)?.role || 'user');
  let canManagePhotos = $derived(userRole === 'mitviste' || userRole === 'admin');

  // PhotosState pour gérer les photos de l'album
  let photosState = new PhotosState();

  // Debug: afficher le rôle dans la console
  $effect(() => {
    console.log('User role:', userRole, 'Can manage:', canManagePhotos, 'Full user:', $page.data.session?.user);
  });

  async function fetchAlbum(immichId: string | null, localAlbumName?: string) {
    photosState.loading = true;
    photosState.error = null;
    title = '';
    photosState.assets = [];
    
    try {
      if (!immichId) {
        photosState.error = 'Album non lié à Immich (aucun id Immich)';
        return;
      }

      // Afficher immédiatement le titre
      title = localAlbumName || 'Album';

      // Essayer de charger depuis le cache
      const cachedAssets = await clientCache.get<any[]>('albums', `${immichId}-assets`);
      if (cachedAssets && cachedAssets.length > 0) {
        photosState.assets = cachedAssets;
        photosState.loading = false;
      }

      // Utiliser le streaming pour charger progressivement les assets
      const res = await fetch(`/api/albums/${immichId}/assets-stream`);
      
      const assetsMap = new Map<string, any>();

      await consumeNDJSONStream<{ phase: 'minimal' | 'full'; asset: any }>(
        res,
        ({ phase, asset }) => {
          if (phase === 'minimal') {
            // Phase 1: Installer les skeletons avec dimensions
            assetsMap.set(asset.id, {
              ...asset,
              date: null,
              exifInfo: asset.width && asset.height ? {
                exifImageWidth: asset.width,
                exifImageHeight: asset.height
              } : null
            });
            
            // Dès qu'on reçoit la première photo, masquer le "Chargement"
            if (assetsMap.size === 1) {
              photosState.loading = false;
            }
          } else if (phase === 'full') {
            // Phase 2: Enrichir avec les données complètes
            assetsMap.set(asset.id, {
              ...asset,
              date: asset.fileModifiedAt || asset.createdAt || null
            });
            
            // Mettre à jour le titre si disponible
            if (asset.albumName) {
              title = asset.albumName;
            }
          }
          
          // Mettre à jour la liste affichée
          photosState.assets = Array.from(assetsMap.values());
        }
      );

      // Stocker en cache les assets finaux
      await clientCache.set('albums', `${immichId}-assets`, photosState.assets);

      photosState.loading = false;
    } catch (e) {
      photosState.error = (e as Error).message;
      photosState.loading = false;
    }
  }

  import { fetchArchive, saveBlobAs } from '$lib/immich/download';

  async function downloadAll() {
    if (!confirm(`Télécharger ${photosState.assets.length} image(s) de cet album au format ZIP ?`)) return;
    
    if (photosState.currentDownloadController) {
      try { photosState.currentDownloadController.abort(); } catch (e) {}
      photosState.currentDownloadController = null;
    }
    
    const controller = new AbortController();
    photosState.currentDownloadController = controller;
    photosState.isDownloading = true;
    photosState.downloadProgress = 0;
    
    try {
      const assetIds = photosState.assets.map(a => a.id);
      const blob = await fetchArchive(assetIds, {
        onProgress: (p) => { photosState.downloadProgress = p; },
        signal: controller.signal,
      });
      saveBlobAs(blob, `${title || 'album'}.zip`);
    } catch (e) {
      if ((e as any)?.name === 'AbortError') {
        console.info('Téléchargement annulé');
      } else {
        alert('Erreur lors du téléchargement en ZIP: ' + (e as Error).message);
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
          photosState.assets = photosState.assets.filter(a => a.id !== assetId);
        } catch (e) {
          alert('Erreur lors de la suppression: ' + (e as Error).message);
        }
      }
    };
    showConfirmModal = true;
  }

  async function deleteAlbum() {
    const albumId = $page.params.id as string;
    const albumName = title || albumId;
    
    confirmModalConfig = {
      title: 'Supprimer l\'album',
      message: `Voulez-vous vraiment supprimer l'album "${albumName}" ?\n\nCette action supprimera l'album d'Immich et de la base de données locale. Les photos ne seront pas supprimées.`,
      confirmText: 'Supprimer l\'album',
      onConfirm: async () => {
        showConfirmModal = false;
        try {
          // Supprimer via le nouvel endpoint optimisé
          const res = await fetch(`/api/albums/${albumId}`, {
            method: 'DELETE'
          });

          if (!res.ok && res.status !== 204) {
            const errText = await res.text().catch(() => res.statusText);
            throw new Error(errText || 'Erreur lors de la suppression de l\'album');
          }

          // Supprimer de la BDD locale
          await fetch('/api/db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sql: 'DELETE FROM albums WHERE id = ?',
              params: [albumId]
            })
          });

          // Rediriger vers la liste des albums
          goto('/albums');
        } catch (e) {
          alert('Erreur lors de la suppression: ' + (e as Error).message);
        }
      }
    };
    showConfirmModal = true;
  }

  async function handleUpload(files: File[]) {
    if (files.length === 0) return;

    const albumId = $page.params.id as string;
    
    try {
      // 1. Uploader les fichiers vers Immich
      const formData = new FormData();
      
      // Ajouter chaque fichier au FormData
      files.forEach((file) => {
        formData.append('assetData', file);
      });

      // Upload via l'API Immich
      const uploadRes = await fetch('/api/immich/assets', {
        method: 'POST',
        body: formData
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text().catch(() => uploadRes.statusText);
        throw new Error(`Erreur upload: ${errText}`);
      }

      const uploadResult = await uploadRes.json();
      
      // uploadResult peut être un objet avec { results: [...] } ou directement un tableau
      const uploadedAssets = uploadResult.results || uploadResult;
      
      if (!Array.isArray(uploadedAssets)) {
        throw new Error('Format de réponse inattendu de l\'API Immich');
      }

      // 2. Ajouter les assets uploadés à l'album
      const assetIds = uploadedAssets
        .filter((asset: any) => asset.id || asset.assetId)
        .map((asset: any) => asset.id || asset.assetId);

      if (assetIds.length > 0) {
        const addRes = await fetch(`/api/albums/${albumId}/assets`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: assetIds })
        });

        if (!addRes.ok) {
          const errText = await addRes.text().catch(() => addRes.statusText);
          throw new Error(`Erreur ajout à l'album: ${errText}`);
        }
      }

      // 3. Recharger l'album pour afficher les nouvelles photos
      const res = await fetch(`/api/albums/${albumId}`);
      if (res.ok) {
        const data = await res.json();
        photosState.assets = (data.assets || []).map((a: any) => ({
          ...a,
          date: a.fileModifiedAt || a.createdAt || null
        }));
      }
      
      alert(`${files.length} fichier(s) uploadé(s) et ajouté(s) à l'album avec succès !`);
    } catch (e) {
      console.error('Upload error:', e);
      alert('Erreur lors de l\'upload: ' + (e as Error).message);
    }
  }

  import { onDestroy } from 'svelte';
  onDestroy(() => {
    if (photosState.currentDownloadController) {
      try { photosState.currentDownloadController.abort(); } catch (e) {}
      photosState.currentDownloadController = null;
    }
  });

  $effect(() => {
    const id = $page.params.id as string | undefined;
    const album = ($page.data as any)?.album;
    const immichId = album?.id ?? null;
    if (id) {
      fetchAlbum(immichId, album?.name || undefined);
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
  
  {#if photosState.loading}
    <div class="loading"><Spinner size={20} /> Chargement des photos...</div>
  {/if}
  
  {#if !photosState.loading && !photosState.error}
    {#if canManagePhotos}
      <div class="upload-section">
        <h2>Ajouter des photos à l'album</h2>
        <UploadZone onUpload={handleUpload} />
      </div>
    {/if}
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
      albumId={$page.params.id}
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

  .upload-section {
    margin: 2rem 0;
  }

  .upload-section h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: var(--text-primary, #ffffff);
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
</style>
