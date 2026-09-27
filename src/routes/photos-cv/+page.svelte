<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import { CircleX, Plus, ChevronLeft, ChevronRight } from '@lucide/svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import BackgroundBlobs from '$lib/components/BackgroundBlobs.svelte';
  import PhotosGrid from '$lib/components/PhotosGrid.svelte';
  import UploadZone from '$lib/components/UploadZone.svelte';
  import { PhotosState } from '$lib/photos.svelte';
  import { handleAlbumUpload } from '$lib/album-operations';
  import { m } from '$lib/paraglide/messages';
  import type { User } from '$lib/types/api';

  const myPhotosState = new PhotosState();
  const allPhotosState = new PhotosState();

  let userRole = $derived((page.data.session?.user as User)?.role || 'user');
  let canManagePhotos = $derived(userRole === 'mitviste' || userRole === 'admin');
  let hasIdPhotos = $derived(!!(page.data.session?.user as User)?.photos_id);
  let currentView = $state<'my' | 'all'>('my');
  let personId = $state<string>('');
  let photosGridContainer = $state<HTMLDivElement | null>(null);

  /**
   * The page-level upload, as on the album page (#330): no box in the flow - the "+" opens the
   * picker, a drop anywhere on the window works, and the progress panel appears only once files
   * are queued. The upload card used to fill the admin tab's whole first screen.
   */
  let uploadZone = $state<ReturnType<typeof UploadZone> | null>(null);

  function openUploadPicker() {
    console.debug('[photos-cv] "+" action: opening the upload picker');
    uploadZone?.openPicker();
  }

  function scrollToPhotosGrid() {
    if (photosGridContainer) {
      photosGridContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async function handleUpload(
    files: File[],
    onProgress?: (current: number, total: number) => void,
    onFileResult?: (result: { file: File; isDuplicate: boolean; assetId?: string }) => void,
    onFileStart?: (file: File) => void
  ) {
    if (files.length === 0) return [];
    const view = currentView;
    const person = personId;

    const results = await handleAlbumUpload(files, 'photos-cv', allPhotosState, {
      onProgress,
      onFileResult,
      onFileStart,
      isPhotosCV: true,
      onSuccess: async () => {
        if (person) await myPhotosState.loadMyPhotosCV(person);
        if (view === 'all') await allPhotosState.loadAllPhotosCV();
      },
    });
    return results || [];
  }

  function switchView(view: 'my' | 'all') {
    currentView = view;
    if (view === 'all' && !allPhotosState.loading) {
      allPhotosState
        .loadAllPhotosCV()
        .catch((e: unknown) => console.warn('all loadAllPhotosCV error', e));
    }
  }

  onDestroy(() => {
    myPhotosState.cleanup();
    allPhotosState.cleanup();
  });

  onMount(() => {
    const user = page.data.session?.user as User;
    if (!user) {
      goto('/');
      return;
    }

    const hasIdPhotos = !!user.photos_id;
    const isManager = user.role === 'admin' || user.role === 'mitviste';

    if (!hasIdPhotos && !isManager) {
      // No linked face and not a manager: funnel to the profile incitation
      // on /mes-photos instead of a dead-end redirect to home.
      goto('/mes-photos');
      return;
    }

    if (hasIdPhotos) {
      personId = String(user.photos_id ?? '');
      myPhotosState.peopleId = String(user.photos_id ?? '');
      myPhotosState.loadMyPhotosCV(String(user.photos_id ?? ''));
    } else if (isManager) {
      currentView = 'all';
      allPhotosState.loadAllPhotosCV();
    }
  });
</script>

<svelte:head>
  <title>{m.pcv_page_title()}</title>
</svelte:head>

<!-- A div, not a <main>: the layout's <main> is the page's landmark, and the global `main {}`
     rule would pad this one a second time (ui-redesign #10). -->
<div class="page-main">
  <BackgroundBlobs />

  <div class="page-container">
    <!-- The albums list's header (Google Photos): the title, and the one action as an icon. -->
    <PageHeader title={m.nav_photos_cv()} subtitle={m.pcv_subtitle()}>
      {#snippet actions()}
        {#if currentView === 'all' && canManagePhotos}
          <IconButton label={m.pcv_upload_title()} onclick={openUploadPicker}>
            <Plus size={24} />
          </IconButton>
        {/if}
      {/snippet}
    </PageHeader>

    <!-- Chips, not a sliding segmented control: Google Photos' filter row. -->
    {#if hasIdPhotos && canManagePhotos}
      <div class="chips" role="tablist">
        <button
          type="button"
          role="tab"
          class="chip"
          class:active={currentView === 'my'}
          aria-selected={currentView === 'my'}
          onclick={() => switchView('my')}
        >
          {m.nav_my_photos()}
        </button>
        <button
          type="button"
          role="tab"
          class="chip"
          class:active={currentView === 'all'}
          aria-selected={currentView === 'all'}
          onclick={() => switchView('all')}
        >
          {m.pcv_tab_all()}
        </button>
      </div>
    {/if}

    {#if currentView === 'my' && hasIdPhotos}
      {#if myPhotosState.error}
        <div class="state-message error"><CircleX size={20} /> {myPhotosState.error}</div>
      {:else if myPhotosState.loading}
        <div class="state-message"><Spinner size={28} /> {m.pcv_loading_my()}</div>
      {:else}
        <!-- No card around the grid: it runs edge to edge, as on the album page (#17) -->
        <PhotosGrid state={myPhotosState} showCount={false} />
      {/if}
    {/if}

    {#if currentView === 'all' && canManagePhotos}
      <UploadZone bind:this={uploadZone} variant="page" onUpload={handleUpload} />

      {#if allPhotosState.error}
        <div class="state-message error"><CircleX size={20} /> {allPhotosState.error}</div>
      {:else if allPhotosState.loading}
        <div class="state-message"><Spinner size={28} /> {m.pcv_loading_all()}</div>
      {:else}
        <div bind:this={photosGridContainer} class="grid-anchor">
          <PhotosGrid state={allPhotosState} showCount={false} />
        </div>

        <nav class="pagination">
          <IconButton
            label={m.common_previous()}
            onclick={async () => {
              await allPhotosState.loadPrevPagePhotosCV();
              scrollToPhotosGrid();
            }}
            disabled={allPhotosState.photoCVCurrentPage <= 1 || allPhotosState.loading}
          >
            <ChevronLeft size={22} />
          </IconButton>
          <span class="page-label"
            >{m.common_page({ page: allPhotosState.photoCVCurrentPage })}</span
          >
          <IconButton
            label={m.common_next()}
            onclick={async () => {
              await allPhotosState.loadNextPagePhotosCV();
              scrollToPhotosGrid();
            }}
            disabled={!allPhotosState.photoCVHasMore || allPhotosState.loading}
          >
            <ChevronRight size={22} />
          </IconButton>
        </nav>
      {/if}
    {/if}
  </div>
</div>

<style>
  .page-main {
    position: relative;
    min-height: 100vh;
    color: var(--text-primary);
    /* No `overflow-x: hidden`: it would clip the phone grid's edge-to-edge breakout to this
       element's inset (photo-grid.md, Traps). The blobs are fixed and clip themselves. */
  }

  /* The layout's <main> already pads the page, so the gutter is its padding alone and the grid
     starts at the same left edge as on the album page and the albums list. */
  .page-container {
    position: relative;
    z-index: 1;
    max-width: 1400px;
    margin: 0 auto;
    padding: 0.5rem 0 6rem;
  }

  .chips {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.25rem;
  }
  .chip {
    height: 2.25rem;
    padding: 0 1rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: var(--text-primary);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
  }
  .chip.active {
    border-color: transparent;
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    margin-top: 1.5rem;
  }
  .page-label {
    color: var(--text-secondary);
    font-size: 0.9rem;
    font-variant-numeric: tabular-nums;
  }

  .state-message {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 3rem 1rem;
    color: var(--text-secondary);
  }
  .state-message.error {
    color: var(--error);
  }
</style>
