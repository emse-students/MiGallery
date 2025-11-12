<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import Icon from '$lib/components/Icon.svelte';
  import LazyImage from '$lib/components/LazyImage.svelte';
  import PhotoModal from '$lib/components/PhotoModal.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import EditAlbumModal from '$lib/components/EditAlbumModal.svelte';
  import ConfirmModal from '$lib/components/ConfirmModal.svelte';
  import UploadZone from '$lib/components/UploadZone.svelte';

  let loading = $state(false);
  let error = $state<string | null>(null);
  let title = $state('');
  let assets = $state<any[]>([]);
  let selectedAssets = $state<string[]>([]);
  let selecting = $state(false);
  let showPhotoModal = $state(false);
  let showEditAlbumModal = $state(false);
  let modalAssetId = $state<string>('');

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

  // Debug: afficher le rôle dans la console
  $effect(() => {
    console.log('User role:', userRole, 'Can manage:', canManagePhotos, 'Full user:', $page.data.session?.user);
  });

  async function fetchAlbum(immichId: string | null, localAlbumName?: string) {
    loading = true; error = null; title = ''; assets = [];
    try {
      if (!immichId) {
        error = 'Album non lié à Immich (aucun id Immich)';
        return;
      }

      // Utiliser le nouvel endpoint optimisé
      const res = await fetch(`/api/albums/${immichId}`);
      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(errText);
      }
      
      const data = await res.json();
      title = data.albumName || localAlbumName || 'Album';
      assets = data.assets || [];
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  import { fetchArchive, saveBlobAs } from '$lib/immich/download';

  let isDownloading = $state(false);
  let downloadProgress = $state(0);
  let currentDownloadController: AbortController | null = null;

  async function downloadAll() {
    if (!confirm(`Télécharger ${assets.length} image(s) de cet album au format ZIP ?`)) return;
    
    if (currentDownloadController) {
      try { currentDownloadController.abort(); } catch (e) {}
      currentDownloadController = null;
    }
    const controller = new AbortController();
    currentDownloadController = controller;
    isDownloading = true;
    downloadProgress = 0;
    try {
      const assetIds = assets.map(a => a.id);
      const blob = await fetchArchive(assetIds, {
        onProgress: (p) => { downloadProgress = p; },
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
      isDownloading = false;
      downloadProgress = 0;
      currentDownloadController = null;
    }
  }

  function toggleSelect(id: string, checked: boolean) {
    if (checked) {
      if (!selectedAssets.includes(id)) {
        selectedAssets = [...selectedAssets, id];
        if (!selecting) selecting = true;
      }
    } else {
      selectedAssets = selectedAssets.filter(x => x !== id);
      if (selectedAssets.length === 0) selecting = false;
    }
  }

  function handlePhotoClick(id: string, event: Event) {
    if (selecting) {
      event.preventDefault();
      const isSelected = selectedAssets.includes(id);
      toggleSelect(id, !isSelected);
    } else {
      // Ouvrir le modal de visualisation plutôt que naviguer
      modalAssetId = id;
      showPhotoModal = true;
    }
  }
  
  function getAspectRatio(asset: any): number {
    // Essayer d'obtenir les dimensions depuis exifInfo
    if (asset.exifInfo?.exifImageWidth && asset.exifInfo?.exifImageHeight) {
      return asset.exifInfo.exifImageWidth / asset.exifInfo.exifImageHeight;
    }
    // Par défaut, ratio 3:2 (paysage)
    return 3 / 2;
  }
  
  function selectAll() {
    selectedAssets = assets.map(a => a.id);
  }
  
  function deselectAll() {
    selectedAssets = [];
    selecting = false;
  }

  async function downloadSingle(id: string) {
    try {
      const asset = assets.find(x => x.id === id);
      const res = await fetch(`/api/immich/assets/${id}/original`);
      if (!res.ok) throw new Error('Erreur téléchargement');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = asset?.originalFileName || id;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Erreur lors du téléchargement: ' + (e as Error).message);
    }
  }

  async function downloadSelected() {
    if (selectedAssets.length === 0) return alert('Aucune image sélectionnée');
    if (!confirm(`Télécharger ${selectedAssets.length} image(s) sous forme d'archive ?`)) return;
    
    if (currentDownloadController) {
      try { currentDownloadController.abort(); } catch (e) {}
      currentDownloadController = null;
    }
    const controller = new AbortController();
    currentDownloadController = controller;
    isDownloading = true;
    downloadProgress = 0;
    try {
      const blob = await fetchArchive(selectedAssets, {
        onProgress: (p) => { downloadProgress = p; },
        signal: controller.signal,
      });
      saveBlobAs(blob, `${title || 'download'}.zip`);
      selectedAssets = [];
      selecting = false;
    } catch (e) {
      if ((e as any)?.name === 'AbortError') {
        console.info('Téléchargement annulé');
      } else {
        alert('Erreur: ' + (e as Error).message);
      }
    } finally {
      isDownloading = false;
      downloadProgress = 0;
      currentDownloadController = null;
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
          assets = assets.filter(a => a.id !== assetId);
        } catch (e) {
          alert('Erreur lors de la suppression: ' + (e as Error).message);
        }
      }
    };
    showConfirmModal = true;
  }

  async function deleteSelectedAssets() {
    if (selectedAssets.length === 0) return;
    
    confirmModalConfig = {
      title: 'Supprimer les photos sélectionnées',
      message: `Voulez-vous vraiment mettre ${selectedAssets.length} photo(s) à la corbeille ?`,
      confirmText: 'Mettre à la corbeille',
      onConfirm: async () => {
        showConfirmModal = false;
        try {
          const res = await fetch(`/api/immich/assets`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: selectedAssets })
          });

          if (!res.ok && res.status !== 204) {
            const errText = await res.text().catch(() => res.statusText);
            throw new Error(errText || 'Erreur lors de la suppression');
          }

          // Retirer les assets de la liste locale
          assets = assets.filter(a => !selectedAssets.includes(a.id));
          selectedAssets = [];
          selecting = false;
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
      files.forEach((file, index) => {
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
        assets = data.assets || [];
      }
      
      alert(`${files.length} fichier(s) uploadé(s) et ajouté(s) à l'album avec succès !`);
    } catch (e) {
      console.error('Upload error:', e);
      alert('Erreur lors de l\'upload: ' + (e as Error).message);
    }
  }

  import { onDestroy } from 'svelte';
  onDestroy(() => {
    if (currentDownloadController) {
      try { currentDownloadController.abort(); } catch (e) {}
      currentDownloadController = null;
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
      {#if canManagePhotos && assets.length > 0}
        <button onclick={() => selecting = !selecting} class="px-3 py-2 rounded-lg {selecting ? 'bg-gray-600 hover:bg-gray-700' : 'bg-blue-600 hover:bg-blue-700'} text-white border-0 cursor-pointer flex items-center gap-2">
          <Icon name={selecting ? 'x' : 'check-square'} size={16} />
          {selecting ? 'Annuler' : 'Sélectionner'}
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
      <button onclick={() => downloadAll()} disabled={isDownloading} class="px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white border-0 cursor-pointer">
        {#if isDownloading}
          {#if downloadProgress >= 0}
            <Icon name="download" size={16} />
            {Math.round(downloadProgress * 100)}%
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
  
  {#if error}
    <div class="error"><Icon name="x-circle" size={20} /> Erreur: {error}</div>
  {/if}
  
  {#if loading}
    <div class="loading"><Spinner size={20} /> Chargement des photos...</div>
  {/if}
  
  {#if !loading && !error}
    {#if canManagePhotos}
      <div class="upload-section">
        <h2>Ajouter des photos à l'album</h2>
        <UploadZone onUpload={handleUpload} />
      </div>
    {/if}
  {/if}
  
  {#if !loading && !error && assets.length === 0}
    <div class="empty-state">
      <Icon name="image" size={48} />
      <p>Aucune photo dans cet album</p>
    </div>
  {/if}
  
  {#if assets.length > 0}
    {#if selecting}
      <div class="selection-toolbar">
        <div class="selection-count">
          <Icon name="check-square" size={18} />
          {selectedAssets.length} sélectionné{selectedAssets.length > 1 ? 's' : ''}
        </div>
        <div class="selection-actions">
          <button onclick={selectAll} class="px-2 py-2">
            <Icon name="check-square" size={16} />
            Tout sélectionner
          </button>
          <button onclick={deselectAll} class="px-2 py-2 bg-gray-400">
            <Icon name="square" size={16} />
            Tout désélectionner
          </button>
          <button onclick={downloadSelected} disabled={isDownloading || selectedAssets.length === 0} class="px-2 py-2 bg-emerald-500">
            {#if isDownloading}
              {#if downloadProgress >= 0}
                <Icon name="download" size={16} />
                {Math.round(downloadProgress * 100)}%
              {:else}
                <Spinner size={16} />
                Téléchargement...
              {/if}
            {:else}
              <Icon name="download" size={16} />
              Télécharger ({selectedAssets.length})
            {/if}
          </button>
          {#if canManagePhotos}
            <button onclick={deleteSelectedAssets} disabled={selectedAssets.length === 0} class="btn-delete-selection px-2 py-2 text-white">
              <Icon name="trash" size={16} />
              Supprimer ({selectedAssets.length})
            </button>
          {/if}
        </div>
      </div>
    {:else}
      <div class="photos-count"><strong>{assets.length}</strong> photo{assets.length > 1 ? 's' : ''} dans cet album</div>
    {/if}

    <div class="photos-grid {selecting ? 'selection-mode' : ''}">
      {#each assets as a}
        {@const aspectRatio = getAspectRatio(a)}
        {@const flexBasis = aspectRatio * 220}
        {@const flexGrow = aspectRatio * 100}
        <div 
          class="photo-card {selectedAssets.includes(a.id) ? 'selected' : ''}" 
          role="button"
          tabindex="0"
          style="flex-basis: {flexBasis}px; flex-grow: {flexGrow};"
          onclick={(e) => handlePhotoClick(a.id, e)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePhotoClick(a.id, e); } }}
        >
          <div class="selection-checkbox {selectedAssets.includes(a.id) ? 'checked' : ''}">
            <input type="checkbox" checked={selectedAssets.includes(a.id)} onchange={(e) => toggleSelect(a.id, (e.target as HTMLInputElement).checked)} onclick={(e) => e.stopPropagation()} />
          </div>
          {#if !selecting}
            <button class="download-btn" title="Télécharger" onclick={(e) => { e.stopPropagation(); downloadSingle(a.id); }}>
              <Icon name="download" size={18} />
            </button>
            {#if canManagePhotos}
              <button class="delete-btn" title="Mettre à la corbeille" onclick={(e) => { e.stopPropagation(); deleteAsset(a.id); }}>
                <Icon name="trash" size={18} />
              </button>
            {/if}
          {/if}
          <LazyImage
            src={`/api/immich/assets/${a.id}/thumbnail?size=thumbnail`}
            alt={a.originalFileName || 'Photo'}
            class="photo-img-wrapper"
            isVideo={a.type === 'VIDEO'}
          />
          <div class="photo-info" title={a.originalFileName}>
            {a.originalFileName}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if showPhotoModal}
    <PhotoModal 
      assetId={modalAssetId} 
      assets={assets} 
      onClose={() => { showPhotoModal = false; }}
      onAssetDeleted={(id) => {
        assets = assets.filter(a => a.id !== id);
      }}
    />
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

  .photos-count {
    margin-bottom: 2rem;
  }

  .photos-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 1.5rem;
  }

  .photo-card {
    position: relative;
    height: 220px;
    cursor: pointer;
    overflow: hidden;
    border-radius: 6px;
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s;
  }

  .photo-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.4);
    z-index: 10;
  }

  .photo-card :global(.lazy-image-container) {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .photo-card :global(.lazy-image) {
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    object-fit: cover;
  }

  .photo-card:hover :global(.lazy-image) {
    transform: scale(1.05);
  }

  .photo-info {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 0.5rem;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent);
    color: white;
    font-size: 0.875rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .photo-card:hover .photo-info {
    opacity: 1;
  }

  .download-btn {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.5rem;
    width: 36px;
    height: 36px;
    cursor: pointer;
    transition: opacity 0.2s, background 0.2s, transform 0.2s;
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    opacity: 0;
    z-index: 10;
  }

  .photo-card:hover .download-btn {
    opacity: 1;
  }

  .download-btn:hover {
    background: rgba(0, 0, 0, 0.9);
    transform: scale(1.1);
  }

  .delete-btn {
    position: absolute;
    bottom: 0.5rem;
    right: 0.5rem;
    background: rgba(220, 38, 38, 0.8);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.5rem;
    width: 36px;
    height: 36px;
    cursor: pointer;
    transition: opacity 0.2s, background 0.2s, transform 0.2s;
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    opacity: 0;
    z-index: 10;
  }

  .photo-card:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    background: rgba(220, 38, 38, 1);
    transform: scale(1.1);
  }

  .selection-checkbox {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    z-index: 5;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .selection-mode .selection-checkbox,
  .photo-card:hover .selection-checkbox {
    opacity: 1;
  }

  .selection-checkbox.checked {
    opacity: 1;
  }

  .selection-checkbox input[type="checkbox"] {
    width: 20px;
    height: 20px;
    cursor: pointer;
    accent-color: var(--accent);
  }

  .photo-card.selected {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
  }

  /* Styles pour les boutons de l'en-tête */
  :global(.btn-delete-album) {
    background: #dc2626 !important;
  }

  :global(.btn-delete-album:hover:not(:disabled)) {
    background: #b91c1c !important;
  }

  :global(.btn-delete-selection) {
    background: #dc2626 !important;
  }

  :global(.btn-delete-selection:hover:not(:disabled)) {
    background: #b91c1c !important;
  }

  @media (max-width: 768px) {
    .photo-card {
      height: 160px;
    }
  }
</style>
