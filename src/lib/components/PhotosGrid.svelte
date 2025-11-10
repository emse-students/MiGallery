<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import LazyImage from '$lib/components/LazyImage.svelte';
  import PhotoModal from '$lib/components/PhotoModal.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import type { Asset, PhotosState } from '$lib/photos.svelte';
  import { groupByDay } from '$lib/photos.svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { toast } from '$lib/toast';
  import { activeOperations } from '$lib/operations';

  interface Props {
    state: PhotosState;
  }

  let { state: photosState }: Props = $props();

  // Vérifier le rôle de l'utilisateur
  let userRole = $derived(($page.data.session?.user as any)?.role || 'user');
  let canManagePhotos = $derived(userRole === 'mitviste' || userRole === 'admin');

  // État du modal
  let showModal = $state(false);
  let modalAssetId = $state<string>('');

  // État du modal de confirmation de suppression
  let showDeleteModal = $state(false);
  let assetToDelete = $state<string | null>(null);

  // Cache des dimensions chargées dynamiquement
  let loadedDimensions = $state<Map<string, { width: number; height: number }>>(new Map());

  onMount(() => {
    // Charger les dimensions des images qui n'ont pas de métadonnées EXIF
    // On charge uniquement les 50 premières pour optimiser le temps de chargement
    const assetsWithoutDims = photosState.assets.filter(a => !getAssetDimensions(a));
    const assetsToLoad = assetsWithoutDims.slice(0, 50);
    
    if (assetsToLoad.length > 0) {
      console.log(`Chargement des dimensions pour ${assetsToLoad.length} assets`);
      
      // Charger en parallèle mais limiter à 5 à la fois
      let index = 0;
      const batchSize = 5;
      
      function loadNextBatch() {
        const batch = assetsToLoad.slice(index, index + batchSize);
        if (batch.length === 0) return;
        
        batch.forEach(asset => {
          const img = new Image();
          // Utiliser thumbnail au lieu de preview pour être plus rapide
          img.src = `/api/immich/assets/${asset.id}/thumbnail?size=thumbnail`;
          img.onload = () => {
            loadedDimensions.set(asset.id, { width: img.naturalWidth, height: img.naturalHeight });
            loadedDimensions = new Map(loadedDimensions);
          };
          img.onerror = () => {
            // En cas d'erreur, supposer un format paysage 3:2
            loadedDimensions.set(asset.id, { width: 3000, height: 2000 });
            loadedDimensions = new Map(loadedDimensions);
          };
        });
        
        index += batchSize;
        if (index < assetsToLoad.length) {
          setTimeout(loadNextBatch, 100); // Petit délai entre les batches
        }
      }
      
      loadNextBatch();
    }
  });

  // Récupérer les dimensions de l'asset depuis exifInfo ou _raw ou cache
  function getAssetDimensions(asset: any): { width: number; height: number } | null {
    // D'abord vérifier le cache des dimensions chargées
    const cached = loadedDimensions.get(asset.id);
    if (cached) return cached;
    
    // Essayer _raw.exifInfo en premier (le plus fiable)
    if (asset._raw?.exifInfo?.exifImageWidth && asset._raw?.exifInfo?.exifImageHeight) {
      return {
        width: asset._raw.exifInfo.exifImageWidth,
        height: asset._raw.exifInfo.exifImageHeight
      };
    }
    
    // Essayer exifInfo direct
    if (asset.exifInfo?.exifImageWidth && asset.exifInfo?.exifImageHeight) {
      return {
        width: asset.exifInfo.exifImageWidth,
        height: asset.exifInfo.exifImageHeight
      };
    }
    
    // Essayer directement width/height dans _raw
    if (asset._raw) {
      if (asset._raw.width && asset._raw.height) {
        return { width: asset._raw.width, height: asset._raw.height };
      }
      // Essayer originalPath metadata
      if (asset._raw.metadata?.width && asset._raw.metadata?.height) {
        return { width: asset._raw.metadata.width, height: asset._raw.metadata.height };
      }
    }
    
    return null;
  }

  function getFlexBasis(asset: any): string {
    const dims = getAssetDimensions(asset);
    if (dims) {
      const aspectRatio = dims.width / dims.height;
      const baseHeight = 220; // Hauteur de ligne plus grande
      return `${aspectRatio * baseHeight}px`;
    }
    // Par défaut : format paysage 3:2
    return `${(3/2) * 220}px`; // = 330px
  }

  function getFlexGrow(asset: any): number {
    const dims = getAssetDimensions(asset);
    if (dims) {
      const aspectRatio = dims.width / dims.height;
      return aspectRatio * 100;
    }
    return 150; // Par défaut : format paysage
  }

  async function handleDownloadSingle(id: string, e: Event) {
    e.stopPropagation();
    const operationId = `download-${id}-${Date.now()}`;
    activeOperations.start(operationId);
    
    try {
      await photosState.downloadSingle(id);
      toast.success('Photo téléchargée !');
    } catch (e) {
      toast.error('Erreur lors du téléchargement: ' + (e as Error).message);
    } finally {
      activeOperations.end(operationId);
    }
  }

  async function handleDeleteAsset(assetId: string, e: Event) {
    e.stopPropagation();
    assetToDelete = assetId;
    showDeleteModal = true;
  }

  async function confirmDelete() {
    if (!assetToDelete) return;
    
    const operationId = `delete-${assetToDelete}-${Date.now()}`;
    activeOperations.start(operationId);
    
    try {
      const res = await fetch(`/api/immich/assets`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [assetToDelete] })
      });

      if (!res.ok && res.status !== 204) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(errText || 'Erreur lors de la suppression');
      }

      // Retirer l'asset de la liste locale
      photosState.assets = photosState.assets.filter(a => a.id !== assetToDelete);
      toast.success('Photo mise à la corbeille !');
    } catch (e) {
      toast.error('Erreur lors de la suppression: ' + (e as Error).message);
    } finally {
      activeOperations.end(operationId);
      assetToDelete = null;
    }
  }

  function openPhotoModal(assetId: string) {
    modalAssetId = assetId;
    showModal = true;
  }

  function closePhotoModal() {
    showModal = false;
  }

  function handlePhotoClickWrapper(id: string, e: Event) {
    if (photosState.selecting) {
      photosState.handlePhotoClick(id, e);
    } else {
      openPhotoModal(id);
    }
  }
</script>

{#if photosState.assets.length > 0}
  {#if photosState.selecting}
    <div class="selection-toolbar">
      <div class="selection-count">
        <Icon name="check-square" size={18} />
        {photosState.selectedAssets.length} sélectionné{photosState.selectedAssets.length > 1 ? 's' : ''}
      </div>
      <div class="selection-actions">
        <button onclick={() => photosState.selectAll()} class="btn-secondary">
          <Icon name="check-square" size={16} />
          Tout sélectionner
        </button>
        <button onclick={() => photosState.deselectAll()} class="btn-secondary">
          <Icon name="square" size={16} />
          Tout désélectionner
        </button>
        <button onclick={() => photosState.downloadSelected()} disabled={photosState.isDownloading || photosState.selectedAssets.length === 0} class="btn-primary">
          {#if photosState.isDownloading}
            {#if photosState.downloadProgress >= 0}
              <Icon name="download" size={16} />
              {Math.round(photosState.downloadProgress * 100)}%
            {:else}
              <Spinner size={16} />
              Téléchargement...
            {/if}
          {:else}
            <Icon name="download" size={16} />
            Télécharger ({photosState.selectedAssets.length})
          {/if}
        </button>
      </div>
    </div>
  {:else}
    <div class="photos-count"><strong>{photosState.assets.length}</strong> photo{photosState.assets.length > 1 ? 's' : ''} trouvée{photosState.assets.length > 1 ? 's' : ''}</div>
  {/if}

  {#each Object.entries(groupByDay(photosState.assets)) as [dayLabel, items]}
    <h3 class="day-label">{dayLabel}</h3>
    <div class="photos-flex {photosState.selecting ? 'selection-mode' : ''}">
      {#each items as a}
        <div 
          class="photo-card {photosState.selectedAssets.includes(a.id) ? 'selected' : ''}" 
          style="flex-basis: {getFlexBasis(a)}; flex-grow: {getFlexGrow(a)};"
          role="button"
          tabindex="0"
          onclick={(e) => handlePhotoClickWrapper(a.id, e)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePhotoClickWrapper(a.id, e); } }}
        >
          <div class="selection-checkbox {photosState.selectedAssets.includes(a.id) ? 'checked' : ''}">
            <input type="checkbox" checked={photosState.selectedAssets.includes(a.id)} onchange={(e) => photosState.toggleSelect(a.id, (e.target as HTMLInputElement).checked)} onclick={(e) => e.stopPropagation()} />
          </div>
          {#if !photosState.selecting}
            <button class="download-btn" title="Télécharger" onclick={(e) => handleDownloadSingle(a.id, e)}>
              <Icon name="download" size={18} />
            </button>
            {#if canManagePhotos}
              <button class="delete-btn" title="Mettre à la corbeille" onclick={(e) => handleDeleteAsset(a.id, e)}>
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
          <div class="photo-info" title={a.originalFileName || a.id}>
            {a.originalFileName || a.id}
          </div>
        </div>
      {/each}
      <!-- Spacer pour remplir la dernière ligne -->
      <div class="flex-spacer"></div>
      <div class="flex-spacer"></div>
      <div class="flex-spacer"></div>
    </div>
  {/each}
{:else if !photosState.loading && !photosState.error}
  <div class="empty-state">
    <Icon name="image" size={48} />
    <p>Aucune photo trouvée</p>
  </div>
{/if}

{#if showModal}
  <PhotoModal 
    assetId={modalAssetId} 
    assets={photosState.assets} 
    onClose={closePhotoModal}
    onAssetDeleted={(id) => {
      photosState.assets = photosState.assets.filter(a => a.id !== id);
    }}
  />
{/if}

<Modal
  bind:show={showDeleteModal}
  title="Supprimer la photo"
  type="confirm"
  confirmText="Mettre à la corbeille"
  cancelText="Annuler"
  onConfirm={confirmDelete}
>
  {#snippet children()}
    <p>Voulez-vous vraiment mettre cette photo à la corbeille ?</p>
  {/snippet}
</Modal>

<style>
  .selection-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    margin-bottom: 2rem;
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
  }

  .selection-count {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .selection-actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .selection-actions button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    border: none;
    border-radius: var(--radius-sm);
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .selection-actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .selection-checkbox {
    position: absolute;
    top: 0.625rem;
    left: 0.625rem;
    z-index: 5;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .selection-mode .selection-checkbox,
  .photo-card:hover .selection-checkbox {
    opacity: 1;
  }

  .selection-checkbox input {
    width: 1.25rem;
    height: 1.25rem;
    cursor: pointer;
    accent-color: var(--accent);
  }

  .selection-checkbox.checked {
    opacity: 1;
  }

  .download-btn {
    position: absolute;
    top: 0.625rem;
    right: 0.625rem;
    z-index: 5;
    padding: 0.5rem;
    width: 36px;
    height: 36px;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(8px);
    border: none;
    border-radius: var(--radius-sm);
    color: white;
    cursor: pointer;
    opacity: 0;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
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
    bottom: 0.625rem;
    right: 0.625rem;
    z-index: 5;
    padding: 0.5rem;
    width: 36px;
    height: 36px;
    background: rgba(220, 38, 38, 0.8);
    backdrop-filter: blur(8px);
    border: none;
    border-radius: var(--radius-sm);
    color: white;
    cursor: pointer;
    opacity: 0;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .photo-card:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    background: rgba(220, 38, 38, 1);
    transform: scale(1.1);
  }

  .photos-count {
    margin-bottom: 2rem;
    color: var(--text-secondary);
    font-size: 0.9375rem;
  }

  .day-label {
    margin-top: 3rem;
    margin-bottom: 1.5rem;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    opacity: 0.6;
  }

  .day-label:first-of-type {
    margin-top: 0;
  }

  /* Flexbox masonry à la Google Images */
  .photos-flex {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 2rem;
  }

  .photos-flex::after {
    content: '';
    flex-grow: 999999999;
  }

  .flex-spacer {
    content: '';
    flex-grow: 999999999;
    margin: 0;
    padding: 0;
    height: 0;
  }

  .photo-card {
    position: relative;
    margin: 2px;
    background: var(--bg-secondary);
    border-radius: var(--radius-xs);
    overflow: hidden;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    cursor: pointer;
    user-select: none;
    border: 2px solid transparent;
    will-change: transform;
    height: 220px;
    opacity: 0;
    animation: photoFadeIn 0.5s ease-out forwards;
  }

  @keyframes photoFadeIn {
    from {
      opacity: 0;
      transform: scale(0.95) translateY(10px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .photo-card:hover {
    transform: translateY(-6px) scale(1.02);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7), 
                0 10px 25px rgba(0, 0, 0, 0.5);
    border-color: rgba(255, 255, 255, 0.1);
    z-index: 10;
  }

  .photo-card.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3),
                0 8px 25px rgba(59, 130, 246, 0.2);
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
    padding: 0.75rem;
    font-size: 0.75rem;
    color: white;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent);
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    opacity: 0;
    transition: opacity 0.3s ease;
    pointer-events: none;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  }

  .photo-card:hover .photo-info {
    opacity: 1;
  }

  .btn-primary {
    background: var(--accent);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn-secondary {
    background: var(--bg-elevated);
    color: var(--text-primary);
  }

  .btn-secondary:hover {
    background: var(--bg-tertiary);
  }

  .empty-state {
    text-align: center;
    padding: 4rem 2rem;
    color: var(--text-muted);
  }

  .empty-state p {
    margin-top: 1rem;
    font-size: 1.125rem;
  }

  /* Responsive - revenir au grid simple sur mobile */
  @media (max-width: 768px) {
    .photos-flex {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 0.75rem;
    }

    .photo-card {
      margin: 0;
      height: 160px; /* Hauteur réduite sur mobile */
    }

    .flex-spacer {
      display: none;
    }
  }

  @media (max-width: 480px) {
    .photos-flex {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
