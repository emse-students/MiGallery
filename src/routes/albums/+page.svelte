<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import {
    Plus,
    Image as ImageIcon,
    Search,
    Download,
    Trash2,
    Lock,
    Link as LinkIcon,
    Eye,
    ChevronRight,
  } from 'lucide-svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import LazyImage from '$lib/components/LazyImage.svelte';
  import AlbumModal from '$lib/components/AlbumModal.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import { showConfirm } from '$lib/confirm';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { toast } from '$lib/toast';
  import { fuzzyMatch } from '$lib/fuzzy';
  import { clientCache } from '$lib/client-cache';
  import { albumsView } from '$lib/albums-view-state.svelte';
  import type { User, Album, ImmichAsset } from '$lib/types/api';
  import { downloadInBatches } from '$lib/immich/download';
  import { onDestroy, onMount } from 'svelte';
  import { fade } from 'svelte/transition';

  /**
   * Day of August a school year rolls over on: an album dated on or after
   * 15 August belongs to the year that starts that summer.
   */
  const SCHOOL_YEAR_START_MONTH = 7; // August (0-indexed)
  const SCHOOL_YEAR_START_DAY = 15;

  // Derived, not filled from an $effect: the grid must have its full height on
  // the very first paint, or a restored scroll offset lands on a short page.
  // Deletion reassigns it, which holds until the server data changes.
  let albums = $derived((page.data?.albums as Album[] | undefined) ?? []);
  let showAlbumModal = $state(false);

  // FILTERED, not ranked, and that is the one surface where it is the right answer: the grid
  // buckets by school year and then by month and shows every match, so there is no truncation for
  // a relevance order to rescue - reordering here would only scramble the chronology inside a
  // month. `fuzzyMatch` still carries the typo and word-inversion tolerance; only the sort is
  // declined. Every list that TRUNCATES uses `fuzzySearch` instead (see docs/wiki/search.md).
  let filteredAlbums = $derived(
    albumsView.search.trim()
      ? albums.filter((a) => fuzzyMatch(albumsView.search, `${a.name || ''} ${a.location || ''}`))
      : albums
  );

  let showConfirmModal = $state(false);
  let confirmModalConfig = $state<{
    title: string;
    message: string;
    confirmText?: string;
    onConfirm: () => void;
  } | null>(null);

  let userRole = $derived((page.data.session?.user as User)?.role || 'user');
  let canCreateAlbum = $derived(userRole === 'mitviste' || userRole === 'admin');

  function monthLabelFor(dateStr?: string | null) {
    if (!dateStr) return m.albums_no_date();
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return m.albums_no_date();
    const label = d.toLocaleString(getLocale(), { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  /** Start year of the school year an album belongs to; null when undated. */
  function schoolYearOf(dateStr?: string | null): number | null {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const month = d.getMonth();
    const day = d.getDate();
    const afterRollover =
      month > SCHOOL_YEAR_START_MONTH ||
      (month === SCHOOL_YEAR_START_MONTH && day >= SCHOOL_YEAR_START_DAY);
    return afterRollover ? d.getFullYear() : d.getFullYear() - 1;
  }

  interface SchoolYearGroup {
    key: string;
    label: string;
    count: number;
    months: Array<{ label: string; albums: Album[] }>;
  }

  /**
   * Albums bucketed by school year (newest first, undated last), each keeping
   * the month sub-grouping inside. Only expanded groups are rendered, which is
   * what keeps a 300-album gallery to one short page.
   */
  let schoolYearGroups = $derived.by<SchoolYearGroup[]>(() => {
    const byYear = new Map<number | null, Album[]>();
    for (const a of filteredAlbums) {
      const year = schoolYearOf(a.date);
      const bucket = byYear.get(year);
      if (bucket) {
        bucket.push(a);
      } else {
        byYear.set(year, [a]);
      }
    }

    const years = Array.from(byYear.keys()).sort((a, b) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return b - a;
    });

    return years.map((year) => {
      const list = byYear.get(year) as Album[];
      const months = new Map<string, Album[]>();
      for (const a of list) {
        const label = monthLabelFor(a.date);
        const bucket = months.get(label);
        if (bucket) {
          bucket.push(a);
        } else {
          months.set(label, [a]);
        }
      }
      return {
        key: year === null ? 'undated' : String(year),
        label: year === null ? m.albums_no_date() : `${year}-${year + 1}`,
        count: list.length,
        months: Array.from(months, ([label, albums]) => ({ label, albums })),
      };
    });
  });

  // Only the newest school year opens by default; a search opens everything
  // that matches, otherwise the results would hide behind collapsed headers.
  // The overrides live in albumsView so a return trip finds them unfolded.
  let searching = $derived(albumsView.search.trim().length > 0);

  function isExpanded(key: string, index: number): boolean {
    if (searching) return true;
    return albumsView.expandedYears[key] ?? index === 0;
  }

  function toggleYear(key: string, index: number) {
    albumsView.expandedYears = {
      ...albumsView.expandedYears,
      [key]: !isExpanded(key, index),
    };
  }

  onMount(() => {
    const rememberScroll = () => {
      albumsView.scrollY = window.scrollY;
    };
    window.addEventListener('scroll', rememberScroll, { passive: true });

    // One frame of slack so the restored folding is laid out before we jump.
    if (albumsView.consumeReturnTrip()) {
      const target = albumsView.scrollY;
      requestAnimationFrame(() => window.scrollTo(0, target));
    }

    return () => window.removeEventListener('scroll', rememberScroll);
  });

  /**
   * Stable per-album cover URL. `?v=` is the asset id, so the browser caches
   * the image forever and still picks up a cover change immediately.
   */
  function coverUrl(a: Album): string {
    return a.coverAssetId
      ? `/api/albums/${a.id}/cover?v=${a.coverAssetId}`
      : `/api/albums/${a.id}/cover`;
  }

  // Albums whose cover failed to load (typically an album with no photo yet).
  let coverErrors = $state<Record<string, boolean>>({});

  let downloadingAlbumId = $state<string | null>(null);
  let downloadingProgress = $state<Record<string, number>>({});
  let currentDownloadController: AbortController | null = null;

  function getVisibilityIcon(visibility?: string): string {
    if (!visibility || visibility === 'private') return 'lock';
    if (visibility === 'unlisted') return 'link';
    if (visibility === 'authenticated') return 'eye';
    return 'eye';
  }

  function getVisibilityLabel(visibility?: string): string {
    if (visibility === 'unlisted') return m.albums_visibility_unlisted();
    if (visibility === 'authenticated') return m.albums_visibility_authenticated();
    return m.albums_visibility_private();
  }

  async function downloadAlbumAssets(immichId: string, albumName?: string) {
    const ok = await showConfirm(
      m.albums_download_confirm({ name: albumName || immichId }),
      m.albums_download()
    );
    if (!ok) return;
    downloadingAlbumId = immichId;
    downloadingProgress = { ...downloadingProgress, [immichId]: 0 };

    if (currentDownloadController) {
      try {
        currentDownloadController.abort();
      } catch (e) {}
      currentDownloadController = null;
    }
    const controller = new AbortController();
    currentDownloadController = controller;

    try {
      const res = await fetch(`/api/albums/${immichId}`);
      if (!res.ok) throw new Error(m.albums_assets_error());
      const data = (await res.json()) as { assets: ImmichAsset[] };
      const list: ImmichAsset[] = Array.isArray(data?.assets) ? data.assets : [];
      const assetIds = list.map((x) => x.id).filter(Boolean);
      if (assetIds.length === 0) {
        toast.info(m.albums_download_empty());
        return;
      }
      await downloadInBatches(assetIds, albumName || immichId, {
        onProgress: (p) => {
          downloadingProgress = { ...downloadingProgress, [immichId]: p };
        },
        signal: controller.signal,
      });
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        toast.error(m.albums_download_error({ error: (e as Error).message }));
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
      title: m.albums_delete_title(),
      message: m.albums_delete_message({ name: albumName || immichId }),
      confirmText: m.common_delete(),
      onConfirm: async () => {
        showConfirmModal = false;
        try {
          const res = await fetch(`/api/albums/${immichId}`, { method: 'DELETE' });
          if (!res.ok) throw new Error((await res.text()) || m.albums_delete_failed());
          await clientCache.delete('albums', immichId);
          albums = albums.filter((a) => a.id !== immichId);
          toast.success(m.albums_deleted());
        } catch (e: unknown) {
          toast.error(m.albums_delete_error({ error: (e as Error).message }));
        }
      },
    };
    showConfirmModal = true;
  }

  onDestroy(() => {
    if (currentDownloadController) {
      try {
        currentDownloadController.abort();
      } catch (e) {}
      currentDownloadController = null;
    }
  });

  async function handleAlbumCreated(newAlbumId?: string) {
    if (newAlbumId) {
      try {
        await goto(`/albums/${newAlbumId}`);
      } catch (e) {
        window.location.reload();
      }
    } else {
      window.location.reload();
    }
  }
</script>

<svelte:head>
  <title>{m.albums_page_title()}</title>
</svelte:head>

<main class="albums-main">
  <BackgroundBlobs />

  <div class="albums-container">
    <header class="page-header" in:fade={{ duration: 300, delay: 100 }}>
      <div class="header-content">
        <h1>{m.nav_albums()}</h1>
        <p class="subtitle">{m.albums_subtitle()}</p>
      </div>

      <div class="header-search">
        <input
          class="search-input"
          placeholder={m.albums_search_placeholder()}
          bind:value={albumsView.search}
          aria-label={m.albums_search_aria()}
        />
      </div>

      {#if canCreateAlbum}
        <div class="header-actions">
          <button type="button" class="btn-glass primary" onclick={() => (showAlbumModal = true)}>
            <Plus size={18} />
            <span>{m.albums_create()}</span>
          </button>
        </div>
      {/if}
    </header>

    {#if albums.length === 0}
      <div in:fade>
        <EmptyState icon={ImageIcon} title={m.albums_empty()} />
      </div>
    {:else if filteredAlbums.length === 0}
      <div in:fade>
        <EmptyState icon={Search} title={m.albums_no_match()} />
      </div>
    {:else}
      <div class="albums-timeline">
        {#each schoolYearGroups as group, groupIndex (group.key)}
          {@const expanded = isExpanded(group.key, groupIndex)}
          <section class="year-group">
            <button
              type="button"
              class="year-header"
              aria-expanded={expanded}
              onclick={() => toggleYear(group.key, groupIndex)}
            >
              <span class="year-chevron" class:open={expanded}><ChevronRight size={20} /></span>
              <h2 class="year-title">{group.label}</h2>
              <span class="year-badge">{group.count}</span>
              <div class="divider"></div>
            </button>

            {#if expanded}
              <div class="year-body">
                {#each group.months as month (month.label)}
                  <div class="month-group">
                    <div class="month-header">
                      <h3 class="month-title">{month.label}</h3>
                      <span class="month-badge">{month.albums.length}</span>
                      <div class="divider"></div>
                    </div>

                    <div class="album-grid">
                      {#each month.albums as a (a.id)}
                        <div class="album-item" class:album-hidden={!a.visible && canCreateAlbum}>
                          <a href={`/albums/${a.id}`} class="album-link">
                            <div class="album-cover-wrapper">
                              {#if coverErrors[a.id]}
                                <div class="cover-placeholder"><ImageIcon size={32} /></div>
                              {:else}
                                <LazyImage
                                  src={coverUrl(a)}
                                  alt={a.name}
                                  class="album-cover"
                                  aspectRatio="1"
                                  isVideo={a.coverAssetType === 'VIDEO'}
                                  radius="0"
                                  onError={() => (coverErrors = { ...coverErrors, [a.id]: true })}
                                />
                              {/if}

                              <!-- Overlay -->
                              <div class="album-info-overlay">
                                <div class="overlay-content">
                                  <span class="album-name" title={a.name}>{a.name}</span>
                                  <div class="album-meta">
                                    {#if a.date}
                                      <span class="album-date">
                                        {new Date(a.date).toLocaleDateString(getLocale(), {
                                          day: 'numeric',
                                          month: 'short',
                                          year: 'numeric',
                                        })}
                                      </span>
                                    {/if}
                                    <span
                                      class="visibility-icon"
                                      title={getVisibilityLabel(a.visibility)}
                                    >
                                      {#if getVisibilityIcon(a.visibility) === 'lock'}
                                        <Lock size={12} />
                                      {:else if getVisibilityIcon(a.visibility) === 'link'}
                                        <LinkIcon size={12} />
                                      {:else}
                                        <Eye size={12} />
                                      {/if}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </a>

                          <!-- Actions -->
                          <div class="album-actions">
                            <button
                              type="button"
                              class="action-btn"
                              onclick={(e) => {
                                e.preventDefault();
                                downloadAlbumAssets(a.id, a.name);
                              }}
                              disabled={downloadingAlbumId === a.id}
                              title={m.albums_download_zip()}
                            >
                              {#if downloadingAlbumId === a.id}
                                <Spinner size={14} />
                              {:else}
                                <Download size={20} />
                              {/if}
                            </button>

                            {#if canCreateAlbum}
                              <button
                                type="button"
                                class="action-btn delete"
                                onclick={(e) => {
                                  e.preventDefault();
                                  deleteAlbum(a.id, a.name);
                                }}
                                title={m.common_delete()}
                              >
                                <Trash2 size={20} />
                              </button>
                            {/if}
                          </div>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </section>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Modals -->
  {#if showAlbumModal}
    <AlbumModal onClose={() => (showAlbumModal = false)} onSuccess={handleAlbumCreated} />
  {/if}

  {#if showConfirmModal && confirmModalConfig}
    <Modal
      bind:show={showConfirmModal}
      title={confirmModalConfig.title}
      type="confirm"
      confirmText={confirmModalConfig.confirmText}
      onConfirm={confirmModalConfig.onConfirm}
      onCancel={() => (showConfirmModal = false)}
    >
      <p class="confirm-message">{confirmModalConfig.message}</p>
    </Modal>
  {/if}
</main>

<style>
  /* Uses the global theme tokens directly (no per-page mirror variables). */
  .albums-main {
    position: relative;
    min-height: 100vh;
    color: var(--text-primary);
    overflow-x: hidden;
  }

  /* --- LAYOUT --- */
  .albums-container {
    position: relative;
    z-index: 1;
    max-width: 1400px;
    margin: 0 auto;
    padding: 2rem 1.5rem 6rem;
  }

  /* --- HEADER --- */
  .page-header {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    margin-bottom: 4rem;
    flex-wrap: wrap;
  }
  .header-content h1 {
    font-size: 2rem;
    font-weight: 800;
    margin: 0;
    line-height: 1.1;
    letter-spacing: -0.02em;
  }
  .subtitle {
    color: var(--text-secondary);
    font-size: 1rem;
    margin: 0.25rem 0 0;
  }
  .header-actions {
    margin-left: auto;
  }

  /* --- TIMELINE --- */
  .year-group {
    margin-bottom: 2rem;
  }
  /* The whole header row is the toggle, so it stays a button (keyboard +
	   screen readers) while looking like a section heading. */
  .year-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.5rem 0;
    margin-bottom: 1rem;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .year-header:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
    border-radius: var(--radius-xs);
  }
  .year-chevron {
    display: flex;
    align-items: center;
    color: var(--text-secondary);
    transition: transform 0.25s ease;
  }
  .year-chevron.open {
    transform: rotate(90deg);
  }
  .year-title {
    font-size: 1.6rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    margin: 0;
    white-space: nowrap;
  }
  .year-badge {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--text-primary);
    padding: 0.2rem 0.65rem;
    border-radius: var(--radius-xs);
    font-size: 0.85rem;
    font-weight: 700;
  }
  .year-header:hover .year-title,
  .year-header:hover .year-chevron {
    color: var(--accent);
  }
  .year-body {
    padding-left: 0.25rem;
  }

  .month-group {
    margin-bottom: 3rem;
  }
  .month-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .month-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-primary);
    text-transform: capitalize;
    white-space: nowrap;
    margin: 0;
  }
  .month-badge {
    background: var(--glass-border);
    color: var(--text-primary);
    opacity: 0.7;
    padding: 0.2rem 0.6rem;
    border-radius: var(--radius-xs);
    font-size: 0.8rem;
    font-weight: 700;
  }
  .divider {
    height: 1px;
    flex: 1;
    background: var(--border);
    opacity: 0.5;
  }

  /* --- GRID --- */
  .album-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 1.5rem;
  }

  /* --- CARD (Glassmorphism / Borderless) --- */
  .album-item {
    position: relative;
    border-radius: var(--radius);
    overflow: hidden;
    aspect-ratio: 1;
    -webkit-mask-image: -webkit-radial-gradient(white, black);
    mask-image: radial-gradient(white, black);
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    transition:
      transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1),
      box-shadow 0.3s ease,
      border-color 0.3s;
    z-index: 1;
    transform: translateZ(0);
  }

  .album-item:hover {
    transform: scale(1.02);
    box-shadow: 0 20px 40px -5px rgba(0, 0, 0, 0.2);
    z-index: 10;
    border-color: var(--accent);
  }
  /* Hidden albums are shown greyed-out to privileged users */
  .album-item.album-hidden {
    filter: grayscale(100%);
    opacity: 0.6;
    transition:
      filter 0.25s ease,
      opacity 0.25s ease;
  }
  .album-item.album-hidden:hover {
    /* Slight visual feedback on hover while staying distinct */
    opacity: 0.75;
  }
  .album-link {
    display: block;
    text-decoration: none;
    color: inherit;
    width: 100%;
    height: 100%;
  }

  .album-cover-wrapper {
    position: relative;
    aspect-ratio: 1;
    width: 100%;
    height: 100%;
    display: block;
    background-color: var(--glass-bg);
    margin: 0;
    padding: 0;
  }

  /* Image global style for LazyImage content */
  :global(.album-cover) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    background: transparent;
    border-radius: 0 !important;
    margin: 0;
    padding: 0;
    transition: transform 0.5s ease;
  }
  .album-item:hover :global(.album-cover) {
    transform: scale(1.05);
  }

  /* OVERLAY */
  .album-info-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: linear-gradient(
      to top,
      rgba(0, 0, 0, 0.9) 0%,
      rgba(0, 0, 0, 0.6) 50%,
      transparent 100%
    );
    padding: 4rem 1.25rem 1.25rem;
    pointer-events: none;
  }
  .overlay-content {
    transform: translateY(5px);
    transition: transform 0.3s ease;
  }
  .album-item:hover .overlay-content {
    transform: translateY(0);
  }

  .album-name {
    display: block;
    font-weight: 700;
    font-size: 1.15rem;
    color: white;
    margin-bottom: 0.25rem;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .album-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.9);
    font-weight: 500;
  }

  /* --- COVER FALLBACK (album with no photo yet) --- */
  .cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    opacity: 0.3;
  }

  /* --- ACTIONS --- */
  .album-actions {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    gap: 8px;
    opacity: 0;
    transition: opacity 0.2s ease;
    pointer-events: none;
  }
  .album-item:hover .album-actions {
    opacity: 1;
    pointer-events: auto;
  }

  .action-btn {
    width: 36px;
    height: 36px;
    padding: 0;
    border-radius: var(--radius-sm);
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: white;
    background-color: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
    transition: all 0.2s;
  }
  .action-btn:hover {
    background-color: var(--accent);
    transform: scale(1.1);
  }
  .action-btn.delete:hover {
    background-color: var(--error, #ef4444);
  }

  .confirm-message {
    white-space: pre-wrap;
  }

  @media (max-width: 640px) {
    .page-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }
    .header-actions {
      width: 100%;
      margin-top: 1rem;
    }
    .btn-glass.primary {
      width: 100%;
      justify-content: center;
    }

    .albums-container {
      padding: 1rem 1rem 6rem;
    }
    .album-grid {
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 1rem;
    }
    .album-actions {
      opacity: 1;
      pointer-events: auto;
    }
    .album-info-overlay {
      padding-top: 2rem;
    }
  }

  .header-search {
    width: 100%;
    max-width: 420px;
    margin-left: 1rem;
  }
  .search-input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--glass-bg);
    color: var(--text-primary);
    font-size: 0.95rem;
  }
  .search-input:focus {
    outline: none;
    box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 12%, transparent);
    border-color: var(--accent);
  }
</style>
