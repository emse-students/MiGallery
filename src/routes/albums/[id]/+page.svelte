<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import Icon from '$lib/components/Icon.svelte';
  import LazyImage from '$lib/components/LazyImage.svelte';

  let loading = $state(false);
  let error = $state<string | null>(null);
  let title = $state('');
  type Asset = { id: string; originalFileName?: string; type?: string };
  let assets = $state<Asset[]>([]);
  let selectedAssets = $state<string[]>([]);
  let selecting = $state(false);

  async function fetchAlbum(immichId: string | null, localAlbumName?: string) {
    loading = true; error = null; title = ''; assets = [];
    try {
      if (!immichId) {
        error = 'Album non lié à Immich (aucun id Immich)';
        return;
      }

      const res = await fetch(`/api/immich/albums/${immichId}`);
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
      const data = await res.json();
      title = data.albumName || localAlbumName || 'Album';
      const list: any[] = Array.isArray(data?.assets) ? data.assets : [];
      assets = list.map((a: any) => ({ 
        id: a.id as string, 
        originalFileName: String(a.originalFileName),
        type: a.type 
      })).filter(a => !!a.id);
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
      window.location.href = `/asset/${id}`;
    }
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
  <nav><a href="/albums"><Icon name="chevron-left" size={16} /> Retour aux albums</a></nav>
  
    <div class="flex items-center gap-3 justify-between">
    <h1 class="m-0"><Icon name="folder" size={24} /> {title || 'Album'}</h1>
    <div>
      <button onclick={() => downloadAll()} disabled={isDownloading} class="px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white border-0 cursor-pointer">
        {#if isDownloading}
          {#if downloadProgress >= 0}
            <Icon name="download" size={16} />
            {Math.round(downloadProgress * 100)}%
          {:else}
            <span class="spinner" aria-hidden="true"></span>
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
    <div class="loading"><Icon name="loader" size={20} /> Chargement des photos...</div>
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
                <span class="spinner" aria-hidden="true"></span>
                Téléchargement...
              {/if}
            {:else}
              <Icon name="download" size={16} />
              Télécharger ({selectedAssets.length})
            {/if}
          </button>
        </div>
      </div>
    {:else}
      <div class="photos-count"><strong>{assets.length}</strong> photo{assets.length > 1 ? 's' : ''} dans cet album</div>
    {/if}

    <div class="photos-grid {selecting ? 'selection-mode' : ''}">
      {#each assets as a}
        <div 
          class="photo-card {selectedAssets.includes(a.id) ? 'selected' : ''}" 
          role="button"
          tabindex="0"
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
          {/if}
          <LazyImage 
            src={`/api/immich/assets/${a.id}/thumbnail?size=thumbnail`}
            alt={a.originalFileName || 'Photo'}
            aspectRatio="1"
            isVideo={a.type === 'VIDEO'}
          />
          <div class="photo-info" title={a.originalFileName}>
            {a.originalFileName}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</main>
