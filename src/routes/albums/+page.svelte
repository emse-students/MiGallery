<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import {
    Plus,
    Image as ImageIcon,
    Search,
    X,
    Lock,
    Link as LinkIcon,
    ChevronRight,
  } from '@lucide/svelte';
  import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import LazyImage from '$lib/components/LazyImage.svelte';
  import AlbumModal from '$lib/components/AlbumModal.svelte';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { fuzzyMatch } from '$lib/fuzzy';
  import { albumsView } from '$lib/albums-view-state.svelte';
  import type { User, Album } from '$lib/types/api';
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';

  /**
   * Day of August a school year rolls over on: an album dated on or after
   * 15 August belongs to the year that starts that summer.
   */
  const SCHOOL_YEAR_START_MONTH = 7; // August (0-indexed)
  const SCHOOL_YEAR_START_DAY = 15;

  // Derived, not filled from an $effect: the grid must have its full height on
  // the very first paint, or a restored scroll offset lands on a short page.
  const albums = $derived((page.data?.albums as Album[] | undefined) ?? []);
  let showAlbumModal = $state(false);

  // FILTERED, not ranked, and that is the one surface where it is the right answer: the grid
  // buckets by school year and shows every match, so there is no truncation for a relevance order
  // to rescue - reordering here would only scramble the chronology inside a year. `fuzzyMatch` still carries the typo and word-inversion tolerance; only the sort is
  // declined. Every list that TRUNCATES uses `fuzzySearch` instead (see docs/wiki/search.md).
  let filteredAlbums = $derived(
    albumsView.search.trim()
      ? albums.filter((a) => fuzzyMatch(albumsView.search, `${a.name || ''} ${a.location || ''}`))
      : albums
  );

  let userRole = $derived((page.data.session?.user as User)?.role || 'user');
  let canCreateAlbum = $derived(userRole === 'mitviste' || userRole === 'admin');

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
    albums: Album[];
  }

  /**
   * Albums bucketed by school year (newest first, undated last). Only expanded groups are rendered,
   * which is what keeps a 300-album gallery to one short page. There is no month level under it any
   * more: Google Photos puts no heading between album tiles at all, and a month heading over two or
   * three tiles was most of what made the page read as a document rather than a gallery.
   */
  let schoolYearGroups = $derived.by<SchoolYearGroup[]>(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
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

    return years.map((year) => ({
      key: year === null ? 'undated' : String(year),
      label: year === null ? m.albums_no_date() : `${year}-${year + 1}`,
      albums: byYear.get(year) as Album[],
    }));
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

  /**
   * The one visibility worth a mark on a card: the exceptions, to the people who set them. Every
   * member sees `authenticated` albums, so marking those put a lock-ish glyph on every card - Google
   * Photos marks nothing on a card, and download and delete live inside the album (its menu).
   */
  function visibilityMark(a: Album): 'private' | 'unlisted' | null {
    if (!canCreateAlbum) return null;
    if (a.visibility === 'private' || a.visibility === 'unlisted') return a.visibility;
    return null;
  }

  // The search is a magnifier in the header, opened on demand (Google Photos), not a standing field;
  // a return trip with a query finds it open.
  let searchOpen = $state(albumsView.search.trim().length > 0);
  let searchInput = $state<HTMLInputElement | null>(null);

  function openSearch() {
    searchOpen = true;
    requestAnimationFrame(() => searchInput?.focus());
  }

  function closeSearch() {
    albumsView.search = '';
    searchOpen = false;
  }

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

<!-- A div, not a <main>: the layout's <main> is the page's landmark, and the global `main {}`
     rule would pad this one a second time (ui-redesign #10). -->
<div class="albums-main">
  <BackgroundBlobs />

  <div class="albums-container">
    <!-- Measured on Google Photos (Mi 9T app, web): the title and two icon buttons on ONE row - no
         standing search field, no filled "create" button. -->
    <header class="page-header" in:fade={{ duration: 300, delay: 100 }}>
      <h1>{m.nav_albums()}</h1>
      <div class="header-actions">
        <button
          type="button"
          class="header-icon"
          class:active={searchOpen}
          onclick={() => (searchOpen ? closeSearch() : openSearch())}
          aria-label={m.albums_search_aria()}
          aria-expanded={searchOpen}
          title={m.albums_search_aria()}
        >
          <Search size={22} />
        </button>
        {#if canCreateAlbum}
          <button
            type="button"
            class="header-icon"
            onclick={() => (showAlbumModal = true)}
            aria-label={m.albums_create()}
            title={m.albums_create()}
          >
            <Plus size={24} />
          </button>
        {/if}
      </div>
    </header>

    {#if searchOpen}
      <div class="search-row" transition:fade={{ duration: 150 }}>
        <Search size={18} />
        <input
          bind:this={searchInput}
          class="search-input"
          placeholder={m.albums_search_placeholder()}
          bind:value={albumsView.search}
          aria-label={m.albums_search_aria()}
          onkeydown={(e) => e.key === 'Escape' && closeSearch()}
        />
        <button
          type="button"
          class="search-clear"
          onclick={closeSearch}
          aria-label={m.albums_search_close()}
          title={m.albums_search_close()}
        >
          <X size={18} />
        </button>
      </div>
    {/if}

    {#if albums.length === 0}
      <div in:fade>
        <EmptyState icon={ImageIcon} title={m.albums_empty()} />
      </div>
    {:else if filteredAlbums.length === 0}
      <div in:fade>
        <EmptyState icon={Search} title={m.albums_no_match()} />
      </div>
    {:else}
      {#each schoolYearGroups as group, groupIndex (group.key)}
        {@const expanded = isExpanded(group.key, groupIndex)}
        <section class="year-group">
          <button
            type="button"
            class="year-header"
            aria-expanded={expanded}
            onclick={() => toggleYear(group.key, groupIndex)}
          >
            <h2 class="year-title">{group.label}</h2>
            <span class="year-count">{group.albums.length}</span>
            <span class="year-chevron" class:open={expanded}><ChevronRight size={18} /></span>
          </button>

          {#if expanded}
            <div class="album-grid">
              {#each group.albums as a (a.id)}
                {@const mark = visibilityMark(a)}
                <a
                  href={`/albums/${a.id}`}
                  class="album-item"
                  class:album-hidden={!a.visible && canCreateAlbum}
                >
                  <div class="album-cover-wrapper">
                    {#if coverErrors[a.id]}
                      <div class="cover-placeholder"><ImageIcon size={32} /></div>
                    {:else}
                      <LazyImage
                        src={coverUrl(a)}
                        alt=""
                        class="album-cover"
                        aspectRatio="1"
                        isVideo={a.coverAssetType === 'VIDEO'}
                        radius="0"
                        onError={() => (coverErrors = { ...coverErrors, [a.id]: true })}
                      />
                    {/if}
                  </div>
                  <span class="album-name">{a.name}</span>
                  <span class="album-meta">
                    {#if mark === 'private'}
                      <span class="mark" title={m.albums_visibility_private()}
                        ><Lock size={12} /></span
                      >
                    {:else if mark === 'unlisted'}
                      <span class="mark" title={m.albums_visibility_unlisted()}
                        ><LinkIcon size={12} /></span
                      >
                    {/if}
                    {#if a.date}
                      {new Date(a.date).toLocaleDateString(getLocale(), {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    {/if}
                  </span>
                </a>
              {/each}
            </div>
          {/if}
        </section>
      {/each}
    {/if}
  </div>

  {#if showAlbumModal}
    <AlbumModal onClose={() => (showAlbumModal = false)} onSuccess={handleAlbumCreated} />
  {/if}
</div>

<style>
  .albums-main {
    position: relative;
    min-height: 100vh;
    color: var(--text-primary);
    overflow-x: hidden;
  }

  /* Google Photos web: 24-32px gutters around ~254px tiles; the app: 16dp. */
  .albums-container {
    position: relative;
    z-index: 1;
    max-width: 1400px;
    margin: 0 auto;
    padding: 0.5rem 1rem 6rem;
  }

  .page-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .page-header h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0;
    line-height: 1.2;
  }
  .header-actions {
    margin-left: auto;
    display: flex;
    gap: 0.25rem;
  }
  /* Stated in full: the global `button` rule would give these a filled background. */
  .header-icon,
  .search-clear {
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
  }
  .header-icon {
    width: 44px;
    height: 44px;
    color: var(--text-primary);
  }
  .header-icon:hover,
  .header-icon.active {
    background: color-mix(in srgb, var(--text-primary) 10%, transparent);
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: 48px;
    margin-bottom: 1.5rem;
    padding: 0 0.375rem 0 1rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text-primary) 8%, transparent);
    color: var(--text-secondary);
  }
  .search-input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 1rem;
    outline: none;
  }
  .search-clear {
    width: 36px;
    height: 36px;
    color: var(--text-secondary);
  }

  /* A plain small heading that folds, not a banner: title, count, chevron. */
  .year-group {
    margin-bottom: 1.5rem;
  }
  .year-header {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0;
    margin-bottom: 0.75rem;
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
  .year-title {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }
  .year-count {
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
  .year-chevron {
    display: flex;
    color: var(--text-secondary);
    transition: transform 0.2s ease;
  }
  .year-chevron.open {
    transform: rotate(90deg);
  }

  .album-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1.5rem 2rem;
  }

  /* A tile is a square cover with its caption BELOW it (Google Photos), not a caption on a gradient
     over the photo - which cut every long title to one line. */
  .album-item {
    display: flex;
    flex-direction: column;
    min-width: 0;
    text-decoration: none;
    color: inherit;
  }
  .album-item.album-hidden {
    filter: grayscale(100%);
    opacity: 0.6;
  }
  .album-cover-wrapper {
    position: relative;
    aspect-ratio: 1;
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface);
    transition: filter 0.15s ease;
  }
  :global(.album-cover) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border-radius: 0 !important;
  }
  .album-item:hover .album-cover-wrapper {
    filter: brightness(0.9);
  }
  .album-item:focus-visible {
    outline: none;
  }
  .album-item:focus-visible .album-cover-wrapper {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .album-name {
    margin-top: 0.6rem;
    font-size: 1rem;
    font-weight: 500;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .album-meta {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    margin-top: 0.15rem;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }
  .mark {
    display: flex;
  }

  .cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    opacity: 0.3;
  }

  /* The app: two columns, 16dp margins and gap, ~24dp between rows. */
  @media (max-width: 640px) {
    /* The layout's <main> already gives the 16dp margin. */
    .albums-container {
      padding: 0 0 6rem;
    }
    .page-header {
      margin-bottom: 0.75rem;
    }
    .page-header h1 {
      font-size: 1.5rem;
    }
    .album-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1.25rem 1rem;
    }
  }
</style>
