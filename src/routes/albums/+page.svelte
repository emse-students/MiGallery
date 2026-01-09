<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import Icon from '$lib/components/Icon.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
  import LazyImage from '$lib/components/LazyImage.svelte';
  import AlbumModal from '$lib/components/AlbumModal.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import { consumeNDJSONStream } from '$lib/streaming';
  import { showConfirm } from '$lib/confirm';
  import { toast } from '$lib/toast';
  import { clientCache } from '$lib/client-cache';
  import type { User, Album, ImmichAsset } from '$lib/types/api';
  import { fetchArchive, saveBlobAs } from '$lib/immich/download';
  import { onDestroy } from 'svelte';
  import { fade, fly } from 'svelte/transition';

  let loading = $state(true);
  let error = $state<string | null>(null);
  let albums = $state<Album[]>([]);
  let showAlbumModal = $state(false);
  let searchQuery = $state<string>('');
  let filteredAlbums = $state<Album[]>([]);
  let pageLimit = $state(20);
  let displayedAlbums = $derived(filteredAlbums.slice(0, pageLimit));

  $effect(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    pageLimit = 20; // Reset pagination on search change or albums update
    if (!q) {
      filteredAlbums = albums.slice();
      return;
    }
    filteredAlbums = albums.filter((a) => {
      const hay = `${a.name || ''} ${a.location || ''}`.toLowerCase();
      return hay.includes(q);
    });
  });

  let showConfirmModal = $state(false);
  let confirmModalConfig = $state<{
    title: string;
    message: string;
    confirmText?: string;
    onConfirm: () => void;
  } | null>(null);

  let userRole = $derived(($page.data.session?.user as User)?.role || 'user');
  let canCreateAlbum = $derived(userRole === 'mitviste' || userRole === 'admin');

  $effect(() => {
    if (typeof $page.data !== 'undefined') {
      if ($page.data?.albums) {
        albums = ($page.data.albums as Album[]);
      } else {
        albums = [];
      }
      loading = false;
    }
  });

  function monthLabelFor(dateStr?: string | null) {
    if (!dateStr) return 'Sans date';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Sans date';
    const label = d.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function groupAlbumsByMonth(list: Album[]) {
    const out: Record<string, Album[]> = {};
    for (const a of list) {
      const key = monthLabelFor(a.date);
      if (!out[key]) out[key] = [];
      out[key].push(a);
    }
    return out;
  }

  let downloadingAlbumId = $state<string | null>(null);
  let downloadingProgress = $state<Record<string, number>>({});
  let albumCovers = $state<Record<string, { id: string; type?: string }>>({});
  let currentDownloadController: AbortController | null = null;

  async function loadCoversFor(list: Album[]) {
      const albumIds = list.map((a) => a.id);
      const missing: string[] = [];
      const cachedCovers: Record<string, { id: string; type?: string }> = {};

      for (const albumId of albumIds) {
        if (albumCovers[albumId]) continue;

        const cached = await clientCache.get<{ id: string; type?: string }>('album-covers', albumId);
        if (cached) {
          cachedCovers[albumId] = cached;
        } else {
          missing.push(albumId);
        }
      }

      if (Object.keys(cachedCovers).length > 0) {
        albumCovers = { ...albumCovers, ...cachedCovers };
      }

      if (missing.length === 0) return;

      try {
      const res = await fetch('/api/albums/covers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ albumIds: missing })
      });

      await consumeNDJSONStream<{ albumId: string; cover: { assetId: string; type: string } }>(
        res,
        ({ albumId, cover }) => {
          if (cover && typeof cover === 'object' && 'assetId' in cover) {
            const coverData = { id: cover.assetId, type: cover.type };
            albumCovers[albumId] = coverData;
            clientCache.set('album-covers', albumId, coverData);
          }
        }
      );
    } catch (e: unknown) {
      console.warn('Error loading album covers', e);
    }
  }

  $effect(() => {
    if (displayedAlbums.length > 0) {
      void loadCoversFor(displayedAlbums);
    }
  });

  let loadMoreElement: HTMLDivElement | null = $state(null);
  $effect(() => {
      if (!loadMoreElement) return;
      const observer = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting && pageLimit < filteredAlbums.length) {
              pageLimit += 20;
          }
      }, { rootMargin: '400px' });
      observer.observe(loadMoreElement);
      return () => observer.disconnect();
  });

  function getVisibilityIcon(visibility?: string): string {
    if (!visibility || visibility === 'private') return 'lock';
    if (visibility === 'unlisted') return 'link';
    if (visibility === 'authenticated') return 'eye';
    return 'eye';
  }

  async function downloadAlbumAssets(immichId: string, albumName?: string) {
    const ok = await showConfirm(`Télécharger "${albumName || immichId}" au format ZIP ?`, 'Télécharger');
    if (!ok) return;
    downloadingAlbumId = immichId;
    downloadingProgress = { ...downloadingProgress, [immichId]: 0 };

    if (currentDownloadController) {
      try { currentDownloadController.abort(); } catch (e) {}
      currentDownloadController = null;
    }
    const controller = new AbortController();
    currentDownloadController = controller;

    try {
      const res = await fetch(`/api/albums/${immichId}`);
      if (!res.ok) throw new Error('Erreur récupération assets');
      const data = (await res.json()) as { assets: ImmichAsset[] };
      const list: ImmichAsset[] = Array.isArray(data?.assets) ? data.assets : [];
      const assetIds = list.map(x => x.id).filter(Boolean);
      if (assetIds.length === 0) {
        toast.info('Aucun asset à télécharger');
        return;
      }
      const blob = await fetchArchive(assetIds, {
        onProgress: (p) => { downloadingProgress = { ...downloadingProgress, [immichId]: p }; },
        signal: controller.signal,
      });
      saveBlobAs(blob, `${albumName || immichId}.zip`);
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        toast.error('Erreur téléchargement: ' + (e as Error).message);
      }
    } finally {
      const copy = { ...downloadingProgress };
      delete copy[immichId];
      downloadingProgress = copy;
      downloadingAlbumId = null;
      if (currentDownloadController === controller) currentDownloadController = null;
    }
  }

  async function deleteAlbum(immichId: string, albumName?: string) {
    confirmModalConfig = {
      title: 'Supprimer l\'album',
      message: `Voulez-vous vraiment supprimer l'album "${albumName || immichId}" ?\n\nCette action supprimera l'album d'Immich et de la base de données locale.`,
      confirmText: 'Supprimer',
      onConfirm: async () => {
        showConfirmModal = false;
        try {
          const res = await fetch(`/api/albums/${immichId}`, { method: 'DELETE' });
          if (!res.ok) throw new Error(await res.text() || 'Erreur suppression');
          await clientCache.delete('album-covers', immichId);
          await clientCache.delete('albums', immichId);
          albums = albums.filter(a => a.id !== immichId);
          toast.success('Album supprimé');
        } catch (e: unknown) {
          toast.error('Erreur suppression: ' + (e as Error).message);
        }
      }
    };
    showConfirmModal = true;
  }

  onDestroy(() => {
    if (currentDownloadController) {
      try { currentDownloadController.abort(); } catch (e) {}
      currentDownloadController = null;
    }
  });

  async function handleAlbumCreated(newAlbumId?: string) {
    if (newAlbumId) {
      try { await goto(`/albums/${newAlbumId}`); }
      catch (e) { window.location.reload(); }
    } else {
      window.location.reload();
    }
  }

</script>

<svelte:head>
  <title>Albums - MiGallery</title>
</svelte:head>

<main class="albums-main">
  <BackgroundBlobs />

  <div class="albums-container">
    <header class="page-header" in:fade={{ duration: 300, delay: 100 }}>
                <div class="header-content">
            <h1>Albums</h1>
            <p class="subtitle">Vos souvenirs et événements</p>
        </div>

        <div class="header-search">
            <input
              class="search-input"
              placeholder="Rechercher un album..."
              bind:value={searchQuery}
              oninput={(e) => { searchQuery = (e.target as HTMLInputElement).value; }}
              aria-label="Rechercher des albums"
            />
        </div>

        {#if canCreateAlbum}
            <div class="header-actions">
                <button class="btn-glass primary" onclick={() => showAlbumModal = true}>
                    <Icon name="plus" size={18} />
                    <span>Créer un album</span>
                </button>
            </div>
        {/if}
    </header>

    {#if error}
        <div class="state-message error" in:fade>
            <Icon name="x-circle" size={20} /> Erreur: {error}
        </div>
    {/if}

    {#if loading}
        <div class="state-message loading" in:fade>
            <Spinner size={20} /> Chargement des albums...
        </div>
    {/if}

    {#if !loading && !error && albums.length === 0}
        <div class="empty-state" in:fade>
            <div class="empty-icon"><Icon name="image" size={48} /></div>
            <p>Aucun album trouvé</p>
        </div>
    {/if}

    {#if !loading && albums.length > 0}
      {#if filteredAlbums.length === 0}
        <div class="empty-state" in:fade>
          <div class="empty-icon"><Icon name="search" size={48} /></div>
          <p>Aucun album ne correspond à votre recherche</p>
        </div>
      {:else}
      <div class="albums-timeline">
        {#each Object.entries(groupAlbumsByMonth(displayedAlbums)) as [month, items], i}
                <div class="month-group" in:fade={{ delay: i * 100, duration: 400 }}>
                    <div class="month-header">
                        <h3 class="month-title">{month}</h3>
                        <span class="month-badge">{items.length}</span>
                        <div class="divider"></div>
                    </div>

                    <div class="album-grid">
                        {#each items as a}
                            <div class="album-item" class:album-hidden={!a.visible && canCreateAlbum}>
                                <a
                                    href={`/albums/${a.id}`}
                                    class="album-link"
                                    onclick={(e) => { if (downloadingAlbumId) { e.preventDefault(); } }}
                                >
                                    <div class="album-cover-wrapper">
                                        {#if albumCovers[a.id]}
                                            <LazyImage
                                              src={
												`/api/albums/${a.id}/cover/${albumCovers[a.id].id}`
                                              }
                                              alt={a.name}
                                              class="album-cover"
                                              aspectRatio="1"
                                              isVideo={albumCovers[a.id].type === 'VIDEO'}
                                              radius="0"
                                            />
                                        {:else}
                                            <div class="skeleton-wrapper">
                                                <Skeleton aspectRatio="1" radius="0">
                                                    <div class="skeleton-icon"><Icon name="image" size={32} /></div>
                                                </Skeleton>
                                            </div>
                                        {/if}

                                        <!-- Overlay -->
                                        <div class="album-info-overlay">
                                            <div class="overlay-content">
                                                <span class="album-name" title={a.name}>{a.name}</span>
                                                <div class="album-meta">
                                                    {#if a.date}
                                                        <span class="album-date">
                                                            {new Date(a.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                        </span>
                                                    {/if}
                                                    <span class="visibility-icon" title="Visibilité: {a.visibility}">
                                                        <Icon name={getVisibilityIcon(a.visibility)} size={12} />
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </a>

                                <!-- Actions -->
                                <div class="album-actions">
                                    <button
                                        class="action-btn"
                                        onclick={(e) => { e.preventDefault(); downloadAlbumAssets(a.id, a.name); }}
                                        disabled={downloadingAlbumId === a.id}
                                        title="Télécharger (ZIP)"
                                    >
                                        {#if downloadingAlbumId === a.id}
                                            <Spinner size={14} />
                                        {:else}
                                            <Icon name="download" size={16} />
                                        {/if}
                                    </button>

                                    {#if canCreateAlbum}
                                        <button
                                            class="action-btn delete"
                                            onclick={(e) => { e.preventDefault(); deleteAlbum(a.id, a.name); }}
                                            title="Supprimer"
                                        >
                                            <Icon name="trash" size={16} />
                                        </button>
                                    {/if}
                                </div>
                            </div>
                        {/each}
                    </div>
                </div>
            {/each}

            {#if pageLimit < filteredAlbums.length}
               <div style="height: 50px; display: flex; justify-content: center; align-items: center; width: 100%; margin-top: 2rem;" bind:this={loadMoreElement}>
                   <Spinner size={32} />
               </div>
            {/if}
        </div>
        {/if}
    {/if}
  </div>

  <!-- Modals -->
  {#if showAlbumModal}
    <AlbumModal onClose={() => showAlbumModal = false} onSuccess={handleAlbumCreated} />
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
  /* --- THEME VARIABLES --- */
  .albums-main {
    --alb-bg: var(--bg-primary, #ffffff);
    --alb-text: var(--text-primary, #1f2937);
    --alb-text-muted: var(--text-secondary, #6b7280);
    --alb-accent: var(--accent, #3b82f6);
    --alb-border: var(--border, #e5e7eb);
    --alb-glass-bg: rgba(255, 255, 255, 0.7);
    --alb-glass-border: rgba(255, 255, 255, 0.5);
    --alb-item-bg: rgba(255, 255, 255, 0.5);
    --alb-item-hover: rgba(255, 255, 255, 0.8);

    position: relative;
    min-height: 100vh;
    color: var(--alb-text);
    overflow-x: hidden;
    font-family: system-ui, -apple-system, sans-serif;
  }

  :global([data-theme='dark']) .albums-main {
    --alb-bg: var(--bg-primary, #020617);
    --alb-text: var(--text-primary, #f3f4f6);
    --alb-text-muted: var(--text-secondary, #94a3b8);
    --alb-border: rgba(255, 255, 255, 0.08);
    --alb-glass-bg: rgba(15, 23, 42, 0.6);
    --alb-glass-border: rgba(255, 255, 255, 0.08);
    --alb-item-bg: rgba(255, 255, 255, 0.03);
    --alb-item-hover: rgba(255, 255, 255, 0.08);
  }

  /* --- BACKGROUND --- */
  /* Removed */

  /* --- LAYOUT --- */
  .albums-container {
    position: relative; z-index: 1;
    max-width: 1400px; margin: 0 auto;
    padding: 2rem 1.5rem 6rem;
  }

  /* --- HEADER --- */
  .page-header {
    display: flex; align-items: center; gap: 1.5rem; margin-bottom: 4rem; flex-wrap: wrap;
  }
  .header-content h1 { font-size: 2rem; font-weight: 800; margin: 0; line-height: 1.1; letter-spacing: -0.02em; }
  .subtitle { color: var(--alb-text-muted); font-size: 1rem; margin: 0.25rem 0 0; }
  .header-actions { margin-left: auto; }

  /* --- BUTTONS --- */
  .btn-glass {
    display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.6rem 1.2rem;
    background: var(--alb-item-bg); border: 1px solid var(--alb-glass-border);
    border-radius: 10px; color: var(--alb-text); font-weight: 600;
    transition: all 0.2s; cursor: pointer; backdrop-filter: blur(4px);
  }
  .btn-glass:hover { transform: translateY(-2px); background: var(--alb-item-hover); border-color: var(--alb-accent); color: var(--alb-accent); }

  .btn-glass.primary { background: var(--alb-accent); color: white; border-color: transparent; box-shadow: 0 4px 12px color-mix(in srgb, var(--alb-accent) 30%, transparent); }
  .btn-glass.primary:hover { background: color-mix(in srgb, var(--alb-accent) 90%, black); color: white; transform: translateY(-2px); }

  /* --- TIMELINE --- */
  .month-group { margin-bottom: 3rem; }
  .month-header {
      display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem;
  }
  .month-title {
    font-size: 1.25rem; font-weight: 700; color: var(--alb-text);
    text-transform: capitalize; white-space: nowrap; margin: 0;
  }
  .month-badge {
      background: var(--alb-glass-border); color: var(--alb-text); opacity: 0.7;
      padding: 0.2rem 0.6rem; border-radius: 8px; font-size: 0.8rem; font-weight: 700;
  }
  .divider { height: 1px; flex: 1; background: var(--alb-border); opacity: 0.5; }

  /* --- GRID --- */
  .album-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 1.5rem;
  }

  /* --- CARD (Glassmorphism / Borderless) --- */
  .album-item {
    position: relative; border-radius: 16px; overflow: hidden; aspect-ratio: 1;
    -webkit-mask-image: -webkit-radial-gradient(white, black);
    mask-image: radial-gradient(white, black);
    background: var(--alb-item-bg);
    border: 1px solid var(--alb-glass-border);
    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), box-shadow 0.3s ease, border-color 0.3s;
    z-index: 1; transform: translateZ(0);
  }

  .album-item:hover {
    transform: scale(1.02);
    box-shadow: 0 20px 40px -5px rgba(0,0,0,0.2);
    z-index: 10;
    border-color: var(--alb-accent);
  }
  /* Affichage des albums invisibles pour les utilisateurs privilégiés */
  .album-item.album-hidden {
    filter: grayscale(100%);
    opacity: 0.6;
    transition: filter 0.25s ease, opacity 0.25s ease;
  }
  .album-item.album-hidden:hover {
    /* léger retour visuel au survol tout en restant distinct */
    opacity: 0.75;
  }
  .album-link { display: block; text-decoration: none; color: inherit; width: 100%; height: 100%; }

  .album-cover-wrapper {
    position: relative; aspect-ratio: 1;
    width: 100%; height: 100%; display: block;
    background-color: var(--alb-item-bg);
    margin: 0; padding: 0;
  }

  /* Image global style for LazyImage content */
  :global(.album-cover) {
    width: 100%; height: 100%; object-fit: cover;
    display: block; background: transparent;
    border-radius: 0 !important;
    margin: 0; padding: 0; transition: transform 0.5s ease;
  }
  .album-item:hover :global(.album-cover) { transform: scale(1.05); }

  /* OVERLAY */
  .album-info-overlay {
    position: absolute; bottom: 0; left: 0; right: 0;
    background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.6) 50%, transparent 100%);
    padding: 4rem 1.25rem 1.25rem;
    pointer-events: none;
  }
  .overlay-content { transform: translateY(5px); transition: transform 0.3s ease; }
  .album-item:hover .overlay-content { transform: translateY(0); }

  .album-name {
    display: block; font-weight: 700; font-size: 1.15rem;
    color: white; margin-bottom: 0.25rem;
    text-shadow: 0 2px 4px rgba(0,0,0,0.5);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .album-meta {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 0.85rem; color: rgba(255, 255, 255, 0.9); font-weight: 500;
  }

  /* --- SKELETON --- */
  .skeleton-wrapper { width: 100%; height: 100%; }
  .skeleton-icon {
    width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
    color: var(--alb-text-muted); opacity: 0.3;
  }

  /* --- ACTIONS --- */
  .album-actions {
    position: absolute; top: 12px; right: 12px;
    display: flex; gap: 8px; opacity: 0;
    transition: opacity 0.2s ease; pointer-events: none;
  }
  .album-item:hover .album-actions { opacity: 1; pointer-events: auto; }

  .action-btn {
    width: 36px; height: 36px; border-radius: 10px; border: none;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: white;
    background-color: rgba(0,0,0,0.4); backdrop-filter: blur(8px);
    transition: all 0.2s;
  }
  .action-btn:hover { background-color: var(--alb-accent); transform: scale(1.1); }
  .action-btn.delete:hover { background-color: var(--error, #ef4444); }

  /* --- ETATS --- */
  .state-message {
    text-align: center; padding: 4rem; color: var(--alb-text-muted);
    display: flex; justify-content: center; gap: 0.5rem;
    background: var(--alb-glass-bg); border-radius: 1rem; border: 1px solid var(--alb-border);
  }
  .state-message.error { color: var(--error, #ef4444); border-color: color-mix(in srgb, var(--error, #ef4444) 20%, transparent); }

  .empty-state {
    text-align: center; padding: 4rem; color: var(--alb-text-muted);
    display: flex; flex-direction: column; align-items: center; gap: 1rem;
    opacity: 0.7;
  }

  @media (max-width: 640px) {
    .page-header { flex-direction: column; align-items: flex-start; gap: 1rem; }
    .header-actions { width: 100%; margin-top: 1rem; }
    .btn-glass.primary { width: 100%; justify-content: center; }

    .albums-container { padding: 1rem 1rem 6rem; }
    .album-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; }
    .album-actions { opacity: 1; pointer-events: auto; }
    .album-info-overlay { padding-top: 2rem; }
  }

  .header-search { width: 100%; max-width: 420px; margin-left: 1rem; }
  .search-input {
    width: 100%; padding: 0.5rem 0.75rem; border-radius: 10px; border: 1px solid var(--alb-border);
    background: var(--alb-item-bg); color: var(--alb-text); font-size: 0.95rem;
  }
  .search-input:focus { outline: none; box-shadow: 0 4px 12px rgba(59,130,246,0.12); border-color: var(--alb-accent); }
</style>
