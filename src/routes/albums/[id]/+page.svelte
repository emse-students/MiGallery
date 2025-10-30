<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';

  let loading = $state(false);
  let error = $state<string | null>(null);
  let title = $state('');
  type Asset = { id: string; originalFileName?: string };
  let assets = $state<Asset[]>([]);
  let selectedAssets = $state<string[]>([]);
  let selecting = $state(false);

  async function fetchAlbum(immichId: string | null, localAlbumName?: string) {
    loading = true; error = null; title = ''; assets = [];
    try {
      if (!immichId) {
        // album not linked to Immich
        error = 'Album non lié à Immich (aucun id Immich)';
        return;
      }

      const res = await fetch(`/api/immich/albums/${immichId}`);
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
      const data = await res.json();
      title = data.albumName || localAlbumName || 'Album';
      const list: any[] = Array.isArray(data?.assets) ? data.assets : [];
      assets = list.map((a: any) => ({ id: a.id as string, originalFileName: String(a.originalFileName) })).filter(a => !!a.id);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  import { fetchArchive, saveBlobAs } from '$lib/immich/download';

  // local downloading state for this album page (Svelte 5 $state for reactivity)
  let isDownloading = $state(false);
  let downloadProgress = $state(0); // 0..1 or -1 if indeterminate
  // controller to allow aborting the fetch when navigating away
  let currentDownloadController: AbortController | null = null;

  async function downloadAll() {
    if (!confirm(`Télécharger ${assets.length} image(s) de cet album au format ZIP ?`)) return;
    // abort any previous (shouldn't be one, but safe)
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
        // user navigated/aborted
        // optional: silent or notify
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
      if (!selectedAssets.includes(id)) selectedAssets = [...selectedAssets, id];
    } else {
      selectedAssets = selectedAssets.filter(x => x !== id);
    }
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
    // abort previous and create new controller
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

  // if user leaves the page while downloading, abort the fetch
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
    // use album.id as the Immich UUID
    const immichId = album?.id ?? null;
    if (id) {
      fetchAlbum(immichId, album?.name || undefined);
    }
  });
</script>

<svelte:head>
  <title>{title || 'Album'} - MiGallery</title>
  <style>
    * {
      box-sizing: border-box;
    }
  </style>
</svelte:head>

<style>
  main {
    max-width: 1400px;
    margin: 0 auto;
    padding: 20px;
  }

  nav {
    margin-bottom: 30px;
  }

  nav a {
    text-decoration: none;
    color: #3498db;
    font-size: 1.1em;
  }

  nav a:hover {
    text-decoration: underline;
  }

  h1 {
    color: #2c3e50;
    margin-bottom: 30px;
  }

  .loading, .error {
    padding: 20px;
    text-align: center;
    font-size: 1.1em;
    border-radius: 8px;
  }

  .loading {
    color: #3498db;
    background: #ebf5fb;
  }

  .error {
    color: #e74c3c;
    background: #fadbd8;
  }

  .photos-count {
    margin: 20px 0;
    font-size: 1.2em;
    color: #2c3e50;
  }

  .photos-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 20px;
    margin-top: 20px;
  }

  .photo-card {
    background: white;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    transition: transform 0.2s, box-shadow 0.2s;
  }

  .photo-card:hover {
    transform: translateY(-5px);
    box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  }

  .photo-card img {
    width: 100%;
    height: 250px;
    object-fit: cover;
    display: block;
  }

  .photo-info {
    padding: 12px;
    font-size: 0.9em;
    color: #7f8c8d;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* small spinner used for indeterminate download state */
  .spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-right: 6px;
    vertical-align: middle;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .empty-state {
    text-align: center;
    padding: 60px 20px;
    color: #7f8c8d;
  }

  .empty-state p {
    font-size: 1.2em;
    margin: 20px 0;
  }
</style>

<main>
  <nav><a href="/albums">← Retour aux albums</a></nav>
  
    <div style="display:flex;align-items:center;gap:12px;justify-content:space-between;">
    <h1 style="margin:0">📸 {title || 'Album'}</h1>
    <div>
      <button onclick={() => downloadAll()} disabled={isDownloading} style="padding:8px 12px;border-radius:8px;background:#2ecc71;color:white;border:none;cursor:pointer">
        {#if isDownloading}
          {#if downloadProgress >= 0}
            ⏳ {Math.round(downloadProgress * 100)}% Téléchargement...
          {:else}
            <span class="spinner" aria-hidden="true"></span> Téléchargement...
          {/if}
        {:else}
          ⬇️ Télécharger tout
        {/if}
      </button>
    </div>
  </div>
  
  {#if error}
    <div class="error">❌ Erreur: {error}</div>
  {/if}
  
  {#if loading}
    <div class="loading">⏳ Chargement des photos...</div>
  {/if}
  
  {#if !loading && !error && assets.length === 0}
    <div class="empty-state">
      <p>Aucune photo dans cet album</p>
    </div>
  {/if}
  
  {#if assets.length > 0}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
      <div class="photos-count"><strong>{assets.length}</strong> photo{assets.length > 1 ? 's' : ''} dans cet album</div>
      <div style="display:flex;gap:8px;align-items:center;">
          {#if selecting}
            <button onclick={() => downloadSelected()} disabled={isDownloading} style="padding:8px 10px;border-radius:8px;background:#2ecc71;color:white;border:none;cursor:pointer">
              {#if isDownloading}
                {#if downloadProgress >= 0}
                  ⏳ {Math.round(downloadProgress * 100)}% Téléchargement...
                {:else}
                  <span class="spinner" aria-hidden="true"></span> Téléchargement...
                {/if}
              {:else}
                ⬇️ Télécharger sélection ({selectedAssets.length})
              {/if}
            </button>
          <button onclick={() => { selectedAssets = []; selecting = false; }} style="padding:8px 10px;border-radius:8px;background:#95a5a6;color:white;border:none;cursor:pointer">Annuler</button>
        {:else}
            <button onclick={() => { selecting = true; selectedAssets = []; }} style="padding:8px 10px;border-radius:8px;background:#3498db;color:white;border:none;cursor:pointer">Sélectionner</button>
        {/if}
      </div>
    </div>

    <div class="photos-grid">
      {#each assets as a}
        <div class="photo-card" style="position:relative;">
          {#if selecting}
            <label style="position:absolute;left:8px;top:8px;z-index:3;background:rgba(255,255,255,0.9);padding:4px;border-radius:4px;">
              <input type="checkbox" checked={selectedAssets.includes(a.id)} onchange={(e) => toggleSelect(a.id, (e.target as HTMLInputElement).checked)} />
            </label>
          {/if}
          <button title="Télécharger" onclick={() => downloadSingle(a.id)} style="position:absolute;right:8px;top:8px;z-index:3;background:rgba(0,0,0,0.6);color:white;border:none;padding:6px;border-radius:6px;">⬇️</button>
          <img 
            alt={a.originalFileName} 
            src={`/api/immich/assets/${a.id}/thumbnail?size=thumbnail&t=${Date.now()}`} 
          />
          <div class="photo-info" title={a.originalFileName}>
            {a.originalFileName}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</main>
