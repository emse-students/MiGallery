<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { onMount, onDestroy } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import LazyImage from '$lib/components/LazyImage.svelte';

  type Asset = { id: string; originalFileName?: string; type?: string };

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
      const personRes = await fetch(`/api/immich/people/${id}`);
      if (personRes.ok) {
        const personData = await personRes.json();
        personName = personData.name || 'Sans nom';
      }

      const thumb = await fetch(`/api/immich/people/${id}/thumbnail`);
      if (thumb.ok) {
        const blob = await thumb.blob();
        if (_prevImageUrl) {
          try { URL.revokeObjectURL(_prevImageUrl); } catch (e) {}
          _prevImageUrl = null;
        }
        const url = URL.createObjectURL(blob);
        imageUrl = url;
        _prevImageUrl = url;
      }

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
        date: it.takenAt || it.fileCreatedAt || it.createdAt || it.updatedAt || null,
        type: it.type
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

  import { fetchArchive, saveBlobAs } from '$lib/immich/download';
  let isDownloading = $state(false);
  let downloadProgress = $state(0);
  let currentDownloadController: AbortController | null = null;

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
    const user = page.data.session?.user as any;
    if (!user || !user.id_photos) {
      goto('/');
      return;
    }

    peopleId = user.id_photos;
    loadPerson(peopleId);
  });
</script>

<svelte:head>
  <title>Mes photos - MiGallery</title>
</svelte:head>

<main class="mesphotos-main">

  {#if imageUrl && personName}
    <div class="user-info">
      <img src={imageUrl} alt="Portrait" class="user-portrait" />
      <div class="user-details">
        <h2><Icon name="image" size={24} /> Photos de {personName}</h2>
        <p><strong>Utilisateur:</strong> {(page.data.session?.user as any)?.prenom} {(page.data.session?.user as any)?.nom}</p>
        <p><strong>ID Person:</strong> <code>{peopleId}</code></p>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="error"><Icon name="x-circle" size={20} /> {error}</div>
  {/if}

  {#if loading}
    <div class="loading"><Icon name="loader" size={20} /> Chargement des photos...</div>
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
      <div class="photos-count"><strong>{assets.length}</strong> photo{assets.length > 1 ? 's' : ''} trouvée{assets.length > 1 ? 's' : ''}</div>
    {/if}

    {#each Object.entries(groupByDay(assets)) as [dayLabel, items]}
      <h3 class="mt-4 text-slate-600">{dayLabel}</h3>
      <div class="photos-grid {selecting ? 'selection-mode' : ''}">
        {#each items as a}
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
            <div class="photo-info" title={a.originalFileName || a.id}>
              {a.originalFileName || a.id}
            </div>
          </div>
        {/each}
      </div>
    {/each}
  {:else if !loading && !error}
    <div class="loading">
      <Icon name="image" size={48} />
      <p>Aucune photo trouvée</p>
    </div>
  {/if}
</main>
