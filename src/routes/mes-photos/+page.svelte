<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { onMount, onDestroy } from 'svelte';

  type Asset = { id: string; originalFileName?: string };

  let assets = $state<Asset[]>([]);
  let selectedAssets = $state<string[]>([]);
  let selecting = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let imageUrl = $state<string | null>(null);
  let _prevImageUrl = $state<string | null>(null);
  let personName = $state<string>('');
  let peopleId = $state<string>('');

  async function loadPerson(id: string) {
    if (!id) {
      error = "Aucun id_photos configuré pour cet utilisateur";
      return;
    }
    
    loading = true; error = null; assets = []; imageUrl = null; personName = '';
    
    try {
      // Récupérer les infos de la personne
      const personRes = await fetch(`/api/immich/people/${id}`);
      if (personRes.ok) {
        const personData = await personRes.json();
        personName = personData.name || 'Sans nom';
      }

      // Récupérer la miniature de la personne
      const thumb = await fetch(`/api/immich/people/${id}/thumbnail`);
      if (thumb.ok) {
        const blob = await thumb.blob();
        // revoke previous blob URL if any
        if (_prevImageUrl) {
          try { URL.revokeObjectURL(_prevImageUrl); } catch (e) {}
          _prevImageUrl = null;
        }
        const url = URL.createObjectURL(blob);
        imageUrl = url;
        _prevImageUrl = url;
      }

      // Récupérer toutes les photos de cette personne
      const res = await fetch('/api/immich/search/metadata', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ personIds: [id], type: 'IMAGE', page: 1, size: 1000 })
      });
      
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        try {
          const parsed = JSON.parse(text);
          throw new Error(parsed?.error || parsed?.message || String(text));
        } catch {
          throw new Error(text || res.statusText);
        }
      }
      
      const data = await res.json();
      const items = (data && data.assets && Array.isArray(data.assets.items)) 
        ? data.assets.items 
        : (Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []));
      
      assets = items.map((it: any) => ({
        id: it.id,
        originalFileName: it.originalFileName,
        // prefer takenAt or fileCreatedAt if present
        date: it.takenAt || it.fileCreatedAt || it.createdAt || it.updatedAt || null
  })).filter((a: any) => !!a.id);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  function formatDayLabel(dateStr: string | null) {
    if (!dateStr) return 'Sans date';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Sans date';
    const today = new Date();
    const diff = Math.floor((+today - +d) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Aujourd\'hui';
    if (diff === 1) return 'Hier';
    return d.toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
  }

  function groupByDay(list: any[]) {
    const out: Record<string, any[]> = {};
    for (const a of list) {
      const key = formatDayLabel(a.date || null);
      if (!out[key]) out[key] = [];
      out[key].push(a);
    }
    return out;
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

  import { fetchArchive, saveBlobAs } from '$lib/immich/download';
  let isDownloading = $state(false);
  let downloadProgress = $state(0);
  let currentDownloadController: AbortController | null = null;

  // override downloadSelected to use helper so we show loading
  async function downloadSelected() {
    if (selectedAssets.length === 0) return alert('Aucune image sélectionnée');
    if (!confirm(`Télécharger ${selectedAssets.length} image(s) sous forme d'archive ?`)) return;
    // prepare abort controller
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
      saveBlobAs(blob, `mes-photos.zip`);
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

  onDestroy(() => {
    if (currentDownloadController) {
      try { currentDownloadController.abort(); } catch (e) {}
      currentDownloadController = null;
    }
  });

  onDestroy(() => {
    if (_prevImageUrl) {
      try { URL.revokeObjectURL(_prevImageUrl); } catch (e) {}
      _prevImageUrl = null;
    }
  });

  onMount(() => {
    // Vérifier si l'utilisateur a un id_photos configuré
    const user = page.data.session?.user as any;
    if (!user || !user.id_photos) {
      // Rediriger vers la page d'accueil si pas d'id_photos
      goto('/');
      return;
    }

    peopleId = user.id_photos;
    loadPerson(peopleId);
  });
</script>

<svelte:head>
  <title>Mes photos - MiGallery</title>
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

  /* nav link removed from template; styles omitted */

  .user-info {
    background: #f8f9fa;
    padding: 20px;
    border-radius: 10px;
    margin-bottom: 30px;
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .user-portrait {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    object-fit: cover;
    border: 3px solid #3498db;
  }

  .user-details h2 {
    margin: 0 0 10px 0;
    color: #2c3e50;
  }

  .user-details p {
    margin: 5px 0;
    color: #7f8c8d;
  }

  .loading, .error {
    padding: 20px;
    text-align: center;
    font-size: 1.1em;
  }

  .loading {
    color: #3498db;
  }

  .error {
    color: #e74c3c;
    background: #fadbd8;
    border-radius: 8px;
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
</style>

<main>
  <!-- back link removed - not needed (albums already links to top-level) -->

  {#if imageUrl && personName}
    <div class="user-info">
      <img src={imageUrl} alt="Portrait" class="user-portrait" />
      <div class="user-details">
        <h2>📸 Photos de {personName}</h2>
        <p><strong>Utilisateur:</strong> {(page.data.session?.user as any)?.prenom} {(page.data.session?.user as any)?.nom}</p>
        <p><strong>ID Person:</strong> <code>{peopleId}</code></p>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="error">❌ {error}</div>
  {/if}

  {#if loading}
    <div class="loading">⏳ Chargement des photos...</div>
  {/if}

  {#if assets.length > 0}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
      <div class="photos-count"><strong>{assets.length}</strong> photo{assets.length > 1 ? 's' : ''} trouvée{assets.length > 1 ? 's' : ''}</div>
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

    <!-- Group by day -->
    {#each Object.entries(groupByDay(assets)) as [dayLabel, items]}
      <h3 style="margin-top:18px;color:#556">{dayLabel}</h3>
      <div class="photos-grid">
        {#each items as a}
          <div class="photo-card" style="position:relative;">
            {#if selecting}
              <label style="position:absolute;left:8px;top:8px;z-index:3;background:rgba(255,255,255,0.9);padding:4px;border-radius:4px;">
                <input type="checkbox" checked={selectedAssets.includes(a.id)} onchange={(e) => toggleSelect(a.id, (e.target as HTMLInputElement).checked)} />
              </label>
            {/if}
            <button title="Télécharger" onclick={() => downloadSingle(a.id)} style="position:absolute;right:8px;top:8px;z-index:3;background:rgba(0,0,0,0.6);color:white;border:none;padding:6px;border-radius:6px;">⬇️</button>
            <img 
              alt={a.originalFileName || a.id} 
              src={`/api/immich/assets/${a.id}/thumbnail?size=thumbnail&t=${Date.now()}`} 
            />
            <div class="photo-info" title={a.originalFileName || a.id}>
              {a.originalFileName || a.id}
            </div>
          </div>
        {/each}
      </div>
    {/each}
  {:else if !loading && !error}
    <div class="loading">Aucune photo trouvée</div>
  {/if}
</main>
