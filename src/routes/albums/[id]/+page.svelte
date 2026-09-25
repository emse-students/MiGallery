<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { fade, fly } from 'svelte/transition';
  import {
    Check,
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
  import { downloadInBatches } from '$lib/immich/download';
  import { activeOperations } from '$lib/operations';
  import { navigationModalStore } from '$lib/navigation-store';
  import { albumsView } from '$lib/albums-view-state.svelte';
  import type { User, Album } from '$lib/types/api';
  import { m } from '$lib/paraglide/messages';

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

  async function downloadAll() {
    const ok = await showConfirm(
      m.albumd_download_confirm({ count: photosState.assets.length }),
      m.albumd_download_zip()
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

    {#if canManagePhotos && photosState.assets.length > 0}
      <button
        type="button"
        onclick={() => (photosState.selecting = !photosState.selecting)}
        class="btn {photosState.selecting ? 'active' : ''}"
        aria-pressed={photosState.selecting}
        title={photosState.selecting ? m.albumd_select_finish() : m.albumd_select()}
      >
        {#if photosState.selecting}
          <Check size={18} />
        {:else}
          <CircleCheckBig size={18} />
        {/if}
        <span class="label">{photosState.selecting ? m.common_ok() : m.albumd_select()}</span>
      </button>
    {/if}

    {#if canManagePhotos}
      <OverflowMenu items={albumMenuItems} variant="bar" triggerClass="btn" iconSize={18} />
    {/if}
  </div>
{/snippet}

<main class="page-main">
  <BackgroundBlobs />

  <div class="page-container">
    <!-- Back navigation -->
    <nav class="top-nav" in:fade={{ duration: 200 }}>
      <button type="button" class="back-btn" onclick={handleBackClick}>
        <ArrowLeft size={20} />
        <span>{m.albumd_back()}</span>
      </button>
    </nav>

    <!-- Album header -->
    <header class="page-header" in:fly={{ y: 20, duration: 400 }}>
      <div class="header-main">
        <div class="title-wrapper">
          <h1>{title}</h1>
          {#if locationInfo}
            <p class="meta"><MapPin size={14} /> {locationInfo}</p>
          {/if}
          <p class="count">
            {m.albumd_photo_count({ count: photosState.assets.length })}
          </p>
        </div>
      </div>

      <div class="header-toolbar">
        {@render actionButtons(false)}
      </div>
    </header>

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

  <!-- Mobile action bar (sticky bottom) -->
  <div class="mobile-bar">
    {@render actionButtons(true)}
  </div>

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
</main>

<style>
  /* Uses the global theme tokens directly (no per-page mirror variables). */
  .page-main {
    position: relative;
    min-height: 100vh;
    color: var(--text-primary);
    overflow-x: hidden;
    padding-bottom: 100px; /* Room for the mobile action bar */
  }

  .page-container {
    position: relative;
    z-index: 1;
    max-width: 1400px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }

  /* --- NAV --- */
  .top-nav {
    margin-bottom: 2rem;
  }
  .back-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-weight: 600;
    cursor: pointer;
    transition: color 0.2s;
    padding: 0;
    font-size: 0.95rem;
  }
  .back-btn:hover {
    color: var(--accent);
  }

  /* --- HEADER --- */
  .header-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 2rem;
    position: relative;
    z-index: 1;
  }
  .title-wrapper h1 {
    margin: 0;
    font-size: 2.5rem;
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -0.02em;
  }
  .title-wrapper .meta {
    margin: 0.25rem 0 0;
    color: var(--text-secondary);
    font-size: 1rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .title-wrapper .count {
    font-size: 0.85rem;
    color: var(--text-secondary);
    opacity: 0.7;
    margin: 0.2rem 0 0;
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
    .actions-group.mobile .btn,
    .actions-group.mobile :global(.overflow-trigger) {
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
    .actions-group.mobile .btn.active {
      color: var(--accent);
      background: var(--accent-light);
    }
    .actions-group.mobile .label {
      white-space: nowrap;
      font-weight: 500;
      font-size: 0.7rem;
    }
    /* The overflow has no label: it takes its icon's width, the labelled actions share the rest. */
    .actions-group.mobile :global(.overflow-trigger) {
      flex: 0 0 auto;
      padding: 0.5rem;
    }

    .page-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }
    .header-main {
      gap: 1rem;
    }
    .title-wrapper h1 {
      font-size: 1.8rem;
    }
  }

  @media (max-width: 768px) {
    .gallery-wrapper {
      padding-top: 1rem;
    }
  }
</style>
