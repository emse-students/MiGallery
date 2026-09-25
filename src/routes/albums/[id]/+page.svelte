<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { fade } from 'svelte/transition';
  import { MediaQuery } from 'svelte/reactivity';
  import {
    CircleCheckBig,
    Pencil,
    Trash2,
    Share2,
    Download,
    ArrowLeft,
    MapPin,
    Plus,
    CircleAlert,
    Image as ImageIcon,
  } from '@lucide/svelte';
  import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
  import PhotosGrid from '$lib/components/PhotosGrid.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import UploadZone from '$lib/components/UploadZone.svelte';
  import AlbumModal from '$lib/components/AlbumModal.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import OverflowMenu from '$lib/components/OverflowMenu.svelte';
  import type { OverflowMenuItem } from '$lib/overflow-menu';
  import { PhotosState } from '$lib/photos.svelte';
  import { toast } from '$lib/toast';
  import { showConfirm } from '$lib/confirm';
  import { handleAlbumUpload } from '$lib/album-operations';
  import { archiveCount, downloadInBatches } from '$lib/immich/download';
  import { activeOperations } from '$lib/operations';
  import { navigationModalStore } from '$lib/navigation-store';
  import { albumsView } from '$lib/albums-view-state.svelte';
  import type { User, Album } from '$lib/types/api';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { albumHeroSources, formatAlbumDate } from '$lib/album-hero';
  import { PHONE_MAX_WIDTH } from '$lib/photo-grid-layout';

  const photosState = new PhotosState();
  let title = $state('');
  let locationInfo = $state('');
  let showAlbumModal = $state(false);
  let showConfirmModal = $state(false);
  let confirmModalConfig = $state<{
    title: string;
    message: string;
    confirmText?: string;
    onConfirm: () => void;
  } | null>(null);

  let userRole = $derived((page.data.session?.user as User)?.role || 'user');
  let canManagePhotos = $derived(userRole === 'mitviste' || userRole === 'admin');

  /** The page-level upload (no box in the flow): the "+" action opens its picker (D2). */
  let uploadZone = $state<ReturnType<typeof UploadZone> | null>(null);

  function openUploadPicker() {
    console.debug('[album] "+" action: opening the upload picker');
    uploadZone?.openPicker();
  }

  let hasActiveOps = $state(false);
  const unsubOps = activeOperations.subscribe((ops) => {
    hasActiveOps = ops.size > 0;
  });

  function handleBackClick() {
    if (hasActiveOps) {
      // That branch does a full page load, which wipes the in-memory view
      // state anyway - nothing to restore, so nothing to mark.
      navigationModalStore.set({ show: true, href: '/albums' });
    } else {
      // goto() pushes, so SvelteKit would scroll to top: restore it ourselves.
      albumsView.markReturnTrip();
      goto('/albums');
    }
  }

  $effect(() => {
    const albumData = (page.data as { album?: Album }).album;
    if (albumData?.id) {
      title = albumData.name || m.albumd_default_title();
      locationInfo = albumData.location || '';
      photosState.loadAlbumWithStreaming(
        albumData.id,
        albumData.name,
        albumData.visibility || undefined
      );
    }
  });

  /**
   * The album-level download: every photo, as ZIP archives of 200. The confirmation says how
   * many photos and how many archives in plain words; it cannot say the size, which the grid
   * stream does not carry (one metadata request per photo would be the price, see bandwidth).
   */
  async function downloadAll() {
    const count = photosState.assets.length;
    const archives = archiveCount(count);
    console.debug(`[album] download all: ${count} photo(s) in ${archives} archive(s)`);
    const ok = await showConfirm(
      archives > 1
        ? m.albumd_download_body_archives({ archives })
        : m.albumd_download_body_one_archive(),
      count === 1 ? m.albumd_download_title_one() : m.albumd_download_title({ count }),
      m.common_download()
    );
    if (!ok) return;

    if (photosState.currentDownloadController) photosState.currentDownloadController.abort();
    const controller = new AbortController();
    photosState.currentDownloadController = controller;
    photosState.isDownloading = true;
    photosState.downloadProgress = 0;

    try {
      const assetIds = photosState.assets.map((a) => a.id);
      await downloadInBatches(assetIds, title || 'album', {
        onProgress: (p) => {
          photosState.downloadProgress = p;
        },
        signal: controller.signal,
      });
      toast.success(m.albumd_download_done());
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError')
        toast.error(m.albums_download_error({ error: (e as Error).message }));
    } finally {
      photosState.isDownloading = false;
      photosState.downloadProgress = 0;
      photosState.currentDownloadController = null;
    }
  }

  /**
   * The album's secondary actions, behind the overflow (audit #12): the bar keeps only the
   * labelled share / download / select. Deleting the album sits there too, never one tap from
   * the thumb (decision D4).
   */
  const albumMenuItems: OverflowMenuItem[] = [
    { label: m.common_edit(), icon: Pencil, onSelect: () => (showAlbumModal = true) },
    { label: m.albumd_delete_album(), icon: Trash2, danger: true, onSelect: () => deleteAlbum() },
  ];

  async function deleteAlbum() {
    const albumId = page.params.id;
    if (!albumId) return;

    confirmModalConfig = {
      title: m.albums_delete_title(),
      message: m.albumd_delete_message({ title }),
      confirmText: m.albumd_delete_confirm(),
      onConfirm: async () => {
        showConfirmModal = false;
        try {
          const res = await fetch(`/api/albums/${albumId}`, { method: 'DELETE' });
          if (!res.ok && res.status !== 204) throw new Error(m.albums_delete_failed());
          toast.success(m.albums_deleted());
          goto('/albums');
        } catch (e: unknown) {
          toast.error(m.common_error_detail({ error: (e as Error).message }));
        }
      },
    };
    showConfirmModal = true;
  }

  async function shareAlbum() {
    try {
      const url = window.location.href;
      if (navigator.share) {
        await navigator.share({ title: title || m.albumd_default_title(), url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success(m.albumd_link_copied());
      }
    } catch (e) {
      toast.error(m.albumd_share_error());
    }
  }

  async function onUploadFiles(
    files: File[],
    onProgress?: (c: number, t: number) => void,
    onFileResult?: (res: any) => void,
    onFileStart?: (file: File) => void
  ) {
    const albumId = page.params.id;
    if (!albumId) throw new Error(m.albumd_id_missing());

    return await handleAlbumUpload(files, albumId, photosState, {
      onProgress,
      onFileResult,
      onFileStart,
      isPhotosCV: false,
      onSuccess: async () => {
        photosState.loadAlbumWithStreaming(albumId, title);
      },
    });
  }

  onDestroy(() => {
    unsubOps();
    photosState.cleanup();
  });

  // The link-preview card is built in `+page.server.ts` and rendered by the root layout, so it is
  // identical whether this page ever hydrates - which is the only case that matters, since an
  // unfurler never runs the JavaScript. All that is left here is the document's own title.
  const albumName = $derived(
    (page.data as { album?: Album }).album?.name || m.albumd_default_title()
  );

  // --- The header (ui-redesign D10) and the blurred cover background (D11) ---
  const pageAlbum = $derived((page.data as { album?: Album }).album);
  const heroSources = $derived(
    albumHeroSources({
      albumId: pageAlbum?.id ?? '',
      coverAssetId: pageAlbum?.coverAssetId,
      visibility: pageAlbum?.visibility,
    })
  );
  const dateLabel = $derived(formatAlbumDate(pageAlbum?.date, getLocale()));

  /**
   * The cover photo is drawn only on a phone: Google Photos' web album is title-first, with no
   * hero. Rendered conditionally, not hidden, so a desktop never downloads the preview. The
   * hero's box has its height from CSS alone, so the image arriving after hydration shifts
   * nothing.
   */
  const phoneQuery = new MediaQuery(`max-width: ${PHONE_MAX_WIDTH}px`);
</script>

<svelte:head>
  <title>{title || albumName} - MiGallery</title>
</svelte:head>

<!--
  The album's action bar, the same on both layouts (audit #12): labelled actions in ONE colour -
  add ("+", uploaders only, D2), share, download, select - and the rest in the overflow.
-->
{#snippet actionButtons(mobile = false)}
  <div class="actions-group {mobile ? 'mobile' : 'desktop'}">
    {#if canManagePhotos}
      <button
        type="button"
        onclick={openUploadPicker}
        class="btn"
        title={m.albumd_add_photos()}
        aria-label={m.albumd_add_photos()}
      >
        <Plus size={18} />
        <span class="label">{m.albumd_add()}</span>
      </button>
    {/if}

    <button type="button" onclick={shareAlbum} class="btn" title={m.albumd_share()}>
      <Share2 size={18} />
      <span class="label">{m.albumd_share()}</span>
    </button>

    <button
      type="button"
      onclick={downloadAll}
      disabled={photosState.isDownloading || photosState.assets.length === 0}
      class="btn"
      title={m.albumd_download_all()}
    >
      {#if photosState.isDownloading}
        <Spinner size={18} />
        <span class="label">
          {photosState.downloadProgress >= 0
            ? `${Math.round(photosState.downloadProgress * 100)}%`
            : '...'}
        </span>
      {:else}
        <Download size={18} />
        <span class="label">{m.common_download()}</span>
      {/if}
    </button>

    <!-- Every viewer may select: the selection's own actions carry their rights (D9). -->
    {#if photosState.assets.length > 0}
      <button
        type="button"
        onclick={() => photosState.enterSelection()}
        class="btn"
        title={m.albumd_select()}
      >
        <CircleCheckBig size={18} />
        <span class="label">{m.albumd_select()}</span>
      </button>
    {/if}

    <!-- On a phone the overflow floats over the hero instead (D10). -->
    {#if canManagePhotos && !mobile}
      <OverflowMenu items={albumMenuItems} variant="bar" triggerClass="btn" iconSize={18} />
    {/if}
  </div>
{/snippet}

<!-- A div, not a <main>: the layout's <main> is the page's landmark, and the global `main {}`
     rule would pad this one a second time (ui-redesign #10). -->
<div class="page-main">
  <!-- The album's cover, heavily blurred and darkened, is the page's background (D11); an
       album without a cover keeps the site's blobs. -->
  {#if heroSources.backdrop}
    <div class="cover-backdrop" aria-hidden="true">
      <img src={heroSources.backdrop} alt="" decoding="async" />
    </div>
  {:else}
    <BackgroundBlobs />
  {/if}

  <!--
    Back, and on a phone the overflow: round buttons floating over the hero and, once scrolled,
    over the photos. On a desktop the row also carries the labelled actions. While selecting,
    the selection bar owns the top: the row is inert and invisible (it keeps its room).
  -->
  <div class="float-bar" class:selecting={photosState.selecting} inert={photosState.selecting}>
    <button
      type="button"
      class="round-btn"
      onclick={handleBackClick}
      aria-label={m.albumd_back()}
      title={m.albumd_back()}
    >
      <ArrowLeft size={22} />
    </button>
    <div class="header-toolbar">
      {@render actionButtons(false)}
    </div>
    {#if canManagePhotos}
      <div class="phone-menu">
        <OverflowMenu items={albumMenuItems} variant="bar" iconSize={22} />
      </div>
    {/if}
  </div>

  <!-- The header: the cover hero on a phone, the title alone on a desktop (D10) -->
  <header class="album-hero" class:has-cover={!!heroSources.hero}>
    {#if heroSources.hero && phoneQuery.current}
      <img class="hero-img" src={heroSources.hero} alt="" fetchpriority="high" />
    {/if}
    <div class="hero-text">
      <h1>{title}</h1>
      <p class="hero-meta">
        {#if dateLabel}<span>{dateLabel}</span><span aria-hidden="true"> · </span>{/if}
        <span>{m.albumd_photo_count({ count: photosState.assets.length })}</span>
      </p>
      {#if locationInfo}
        <p class="hero-meta"><MapPin size={14} /> {locationInfo}</p>
      {/if}
    </div>
  </header>

  <div class="page-container">
    {#if photosState.error}
      <div class="surface error-card">
        <CircleAlert size={24} />
        <p>{photosState.error}</p>
      </div>
    {/if}

    <!-- Upload (uploaders only): nothing in the flow until files are queued (audit #2, D2) -->
    {#if canManagePhotos}
      <UploadZone bind:this={uploadZone} variant="page" onUpload={onUploadFiles} />
    {/if}

    <!-- Photos grid -->
    {#if photosState.loading && photosState.assets.length === 0}
      <LoadingState label={m.albumd_loading()} layout="block" />
    {:else if !photosState.loading && photosState.assets.length === 0}
      <EmptyState icon={ImageIcon} title={m.albumd_empty()} />
    {:else}
      <div class="gallery-wrapper" in:fade={{ duration: 300 }}>
        <!-- PhotosGrid handles rendering, selection and the fullscreen modal -->
        <PhotosGrid
          state={photosState}
          albumId={page.params.id}
          showCount={false}
          onModalClose={(hasChanges) => {
            if (hasChanges && page.params.id)
              photosState.loadAlbumWithStreaming(page.params.id, title);
          }}
        />
      </div>
    {/if}
  </div>

  <!-- Mobile action bar (sticky bottom); the selection's own bar replaces it while selecting -->
  {#if !photosState.selecting}
    <div class="mobile-bar">
      {@render actionButtons(true)}
    </div>
  {/if}

  <!-- Modals -->
  {#if showAlbumModal && page.params.id}
    <AlbumModal
      albumId={page.params.id}
      onClose={() => (showAlbumModal = false)}
      onSuccess={() => window.location.reload()}
    />
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
      <p style="white-space: pre-wrap;">{confirmModalConfig.message}</p>
    </Modal>
  {/if}
</div>

<style>
  /* Uses the global theme tokens directly (no per-page mirror variables). */
  .page-main {
    position: relative;
    min-height: 100vh;
    color: var(--text-primary);
    /* No `overflow-x: hidden`: it clipped the phone grid's edge-to-edge breakout to this
       element's inset (ui-redesign #7). The blobs and the backdrop are fixed and clip themselves. */
    padding-bottom: 100px; /* Room for the mobile action bar */
  }

  /*
   * The blurred cover (D11): one 400 px WebP on a fixed layer, oversized so the blur's soft
   * edges stay off screen, then darkened towards the page colour so text keeps its contrast in
   * both themes. Fixed and static: scrolling repaints nothing. A page background, like the
   * blobs - no component is glass.
   */
  .cover-backdrop {
    position: fixed;
    inset: -10vmax;
    z-index: 0;
    pointer-events: none;
  }
  .cover-backdrop img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: blur(48px) saturate(1.2);
  }
  .cover-backdrop::after {
    content: '';
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--bg-primary) 70%, transparent);
  }

  .page-container {
    position: relative;
    z-index: 1;
    max-width: 1400px;
    margin: 0 auto;
    /* The layout's <main> already pads the page: the gutter is its padding alone. */
    padding: 0 0 2rem;
  }

  /* --- The row of back / actions (desktop), floating buttons (phone) --- */
  .float-bar {
    position: relative;
    z-index: 2;
    max-width: 1400px;
    margin: 0 auto;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .float-bar.selecting {
    visibility: hidden;
  }

  .round-btn,
  .phone-menu :global(.overflow-trigger) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-primary);
    cursor: pointer;
  }
  .phone-menu {
    display: none;
  }

  /* --- The header: title first, centred (Google Photos web) --- */
  .album-hero {
    position: relative;
    z-index: 1;
    display: flex;
    justify-content: center;
    /* The action pill sits above it: 2.5rem keeps a long title from crowding it (user, 2026-09-26). */
    padding: 2.5rem 1.5rem 1.5rem;
    text-align: center;
  }
  .hero-text h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(2.5rem, 5vw, 4.5rem);
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: -0.02em;
    overflow-wrap: anywhere;
  }
  .hero-meta {
    margin: 0.5rem 0 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  /* --- ACTIONS TOOLBAR --- */
  .actions-group {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    background: var(--surface);
    padding: 0.5rem;
    border-radius: var(--radius);
    border: 1px solid var(--surface-border);
  }

  /* Buttons use the neutral canonical .btn from app.css - one colour for every action
     (audit #12); only the toolbar layout and the mobile bar overrides live here. */

  /* --- CARDS & CONTENT --- */
  .surface {
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-lg);
  }

  .error-card {
    padding: 1.5rem;
    border-left: 4px solid var(--error);
    color: var(--error);
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 2rem;
  }

  /* --- MOBILE BAR --- */
  .mobile-bar {
    display: none;
  }

  @media (max-width: 768px) {
    .header-toolbar {
      display: none;
    } /* Hide desktop actions */

    /* The buttons float over the hero, and stay reachable over the photos once scrolled. */
    .float-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 60;
      padding: calc(0.5rem + env(safe-area-inset-top)) 0.75rem 0;
      pointer-events: none;
    }
    .float-bar > :global(*) {
      pointer-events: auto;
    }
    .phone-menu {
      display: block;
    }
    /* Over imagery: a flat translucent black, no blur (the viewer's bars use the same). */
    .round-btn,
    .phone-menu :global(.overflow-trigger) {
      background: rgba(0, 0, 0, 0.45);
      color: white;
    }

    /*
     * The cover hero (D10), measured on Google Photos on the same Mi 9T: full bleed from the
     * very top (no site bar on this page), ~54 % of the screen, the title centred on its lower
     * half over a scrim. Without a cover it is a plain header of the same shape.
     */
    .album-hero {
      width: 100vw;
      margin-left: calc(50% - 50vw);
      margin-top: calc(-1 * var(--container-padding));
      height: clamp(320px, 54svh, 600px);
      padding: 0 1.25rem 1.5rem;
      align-items: flex-end;
      overflow: hidden;
    }
    .album-hero.has-cover {
      color: white;
    }
    .hero-img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    /* The one gradient the flat bar allows: a scrim under text over a photo. */
    .album-hero.has-cover::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(to bottom, transparent 35%, rgba(0, 0, 0, 0.72));
    }
    .hero-text {
      position: relative;
      z-index: 1;
      max-width: 100%;
    }
    .hero-text h1 {
      font-size: clamp(2.25rem, 12vw, 3.5rem);
      display: -webkit-box;
      -webkit-line-clamp: 3;
      line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .album-hero.has-cover .hero-meta {
      color: rgba(255, 255, 255, 0.85);
    }

    .page-container {
      padding: 0;
    }

    .mobile-bar {
      display: block;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 100;
      padding: 0.5rem;
      padding-bottom: calc(0.5rem + env(safe-area-inset-bottom));
      background: var(--bg-elevated);
      border-top: 1px solid var(--border);
    }
    .actions-group.mobile {
      justify-content: space-between;
      background: transparent;
      border: none;
      padding: 0;
      gap: 0.25rem;
    }
    .actions-group.mobile .btn {
      flex-direction: column;
      padding: 0.5rem 0;
      gap: 0.25rem;
      font-size: 0.7rem;
      flex: 1 1 0;
      min-width: 0;
      background: transparent;
      border: none;
      color: var(--text-secondary);
      box-shadow: none;
    }
    .actions-group.mobile .label {
      white-space: nowrap;
      font-weight: 500;
      font-size: 0.7rem;
    }
  }
</style>
