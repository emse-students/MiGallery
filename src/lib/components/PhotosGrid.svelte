<script lang="ts">
  import {
    SquareCheck,
    Square,
    Download,
    Trash2,
    Image as ImageIcon,
    CircleMinus,
    CircleCheck,
    Heart,
  } from '@lucide/svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import PhotoCard from '$lib/components/PhotoCard.svelte';
  import PhotoModal from '$lib/components/PhotoModal.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import type { PhotosState } from '$lib/photos.svelte';
  import { groupByDay } from '$lib/photos.svelte';
  import type { User } from '$lib/types/api';
  import { page } from '$app/state';
  import { toast } from '$lib/toast';
  import { activeOperations } from '$lib/operations';
  import { m } from '$lib/paraglide/messages';
  import {
    GRID_METRICS,
    PHONE_MAX_WIDTH,
    assetAspectRatio,
    buildGridBlocks,
    visibleBlockRange,
  } from '$lib/photo-grid-layout';
  import { daySelectionState, toggleDaySelection } from '$lib/day-selection';

  interface Props {
    state: PhotosState;
    onModalClose?: (hasChanges: boolean) => void;
    visibility?: string;
    albumId?: string;
    showFavorites?: boolean;
    /**
     * Shows the photo count above the grid. A host whose header already carries it (the album
     * page) turns it off, so the count is said once (audit #13).
     */
    showCount?: boolean;
  }

  let {
    state: photosState,
    onModalClose,
    visibility,
    albumId,
    showFavorites = false,
    showCount = true,
  }: Props = $props();

  let userRole = $derived((page.data.session?.user as User)?.role || 'user');
  let canManagePhotos = $derived(userRole === 'mitviste' || userRole === 'admin');

  let showModal = $state(false);
  let modalAssetId = $state<string>('');
  let hasChanges = $state(false);

  let showDeleteModal = $state(false);
  let assetToDelete = $state<string | null>(null);

  let showDeleteSelectedModal = $state(false);
  let idsToDelete = $state<string[] | null>(null);

  let showRemoveFromAlbumModal = $state(false);

  let showDownloadSelectedModal = $state(false);

  async function handleDownloadSingle(id: string) {
    const operationId = `download-${id}-${Date.now()}`;
    activeOperations.start(operationId);

    try {
      await photosState.downloadSingle(id);
      toast.success(m.pg_photo_downloaded());
    } catch (e: unknown) {
      toast.error(m.download_error_long({ error: (e as Error).message }));
    } finally {
      activeOperations.end(operationId);
    }
  }

  async function handleDeleteAsset(assetId: string) {
    assetToDelete = assetId;
    showDeleteModal = true;
  }

  async function handleDeleteSelected() {
    if (photosState.selectedAssets.length === 0) return;
    idsToDelete = [...photosState.selectedAssets];
    showDeleteSelectedModal = true;
  }

  async function handleRemoveFromAlbum() {
    if (photosState.selectedAssets.length === 0) return;
    showRemoveFromAlbumModal = true;
  }

  async function confirmRemoveFromAlbum() {
    if (!albumId || photosState.selectedAssets.length === 0) return;
    const ids = photosState.selectedAssets;
    const count = ids.length;
    showRemoveFromAlbumModal = false;

    const operationId = `remove-from-album-${Date.now()}`;
    activeOperations.start(operationId);

    try {
      const res = await fetch(`/api/albums/${albumId}/assets`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(errText || 'Failed to remove from album');
      }

      // Local update: remove assets from view
      photosState.assets = photosState.assets.filter((a) => !ids.includes(a.id));
      photosState.assets = [...photosState.assets];
      photosState.selectedAssets = [];
      photosState.selecting = false;
      toast.success(m.pg_removed_count({ count }));
    } catch (e: unknown) {
      toast.error(m.pg_remove_error({ error: (e as Error).message }));
    } finally {
      activeOperations.end(operationId);
    }
  }

  async function confirmDeleteSelected() {
    if (!idsToDelete || idsToDelete.length === 0) return;
    const ids = idsToDelete;
    const count = ids.length;
    idsToDelete = null;
    showDeleteSelectedModal = false;

    const operationId = `delete-multiple-${Date.now()}`;
    activeOperations.start(operationId);
    try {
      const res = await fetch(`/api/immich/assets`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });

      if (!res.ok && res.status !== 204) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(errText || m.albums_delete_failed());
      }

      photosState.assets = photosState.assets.filter((a) => !ids.includes(a.id));
      photosState.assets = [...photosState.assets];
      photosState.selectedAssets = [];
      photosState.selecting = false;
      toast.success(m.pg_trashed_count({ count }));
    } catch (e: unknown) {
      toast.error(m.delete_error_long({ error: (e as Error).message }));
    } finally {
      activeOperations.end(operationId);
    }
  }

  function handleDownloadSelectedClick() {
    if (photosState.selectedAssets.length === 0) return;
    showDownloadSelectedModal = true;
  }

  async function confirmDownloadSelected() {
    showDownloadSelectedModal = false;
    try {
      await photosState.downloadSelected(true);
    } catch (e: unknown) {
      toast.error(m.download_error_long({ error: (e as Error).message }));
    }
  }

  async function confirmDelete() {
    if (!assetToDelete) return;

    const operationId = `delete-${assetToDelete}-${Date.now()}`;
    activeOperations.start(operationId);

    try {
      const res = await fetch(`/api/immich/assets`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [assetToDelete] }),
      });

      if (!res.ok && res.status !== 204) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(errText || m.albums_delete_failed());
      }

      photosState.assets = photosState.assets.filter((a) => a.id !== assetToDelete);
      photosState.assets = [...photosState.assets];
      toast.success(m.pg_photo_trashed());
    } catch (e: unknown) {
      toast.error(m.delete_error_long({ error: (e as Error).message }));
    } finally {
      activeOperations.end(operationId);
      assetToDelete = null;
    }
  }

  function closeModal() {
    showModal = false;
    photosState.assets = [...photosState.assets];
    if (onModalClose) {
      setTimeout(() => {
        try {
          onModalClose(hasChanges);
        } catch (e) {}
      }, 0);
    }
  }

  $effect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (showModal) {
        closeModal();
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  });

  function handlePhotoCardClick(id: string) {
    if (photosState.selecting) {
      photosState.handlePhotoClick(id, new Event('click'));
    } else {
      modalAssetId = id;
      hasChanges = false;
      history.pushState({ modalOpen: true }, '');
      showModal = true;
    }
  }

  async function handleFavoriteToggle(assetId: string) {
    try {
      const newValue = await photosState.toggleFavorite(assetId);
      toast.success(newValue ? m.pg_fav_added() : m.pg_fav_removed());
    } catch (e: unknown) {
      toast.error(m.common_error_detail({ error: (e as Error).message }));
    }
  }

  // Favorites are shown in-place (chronological) with a badge; an optional filter
  // narrows the view to favorites only. The modal navigates the DISPLAYED list in
  // its natural chronological order, so toggling a favorite never reshuffles the
  // browsing position (no more "catapult to the top").
  let favoritesFilter = $state(false);

  let favoriteCount = $derived(
    showFavorites ? photosState.assets.filter((a) => a.isFavorite).length : 0
  );

  // Reset the filter if the last favorite is removed, so we never get stuck on an
  // empty filtered view with no way back.
  $effect(() => {
    if (favoriteCount === 0 && favoritesFilter) favoritesFilter = false;
  });

  let displayedAssets = $derived(
    showFavorites && favoritesFilter
      ? photosState.assets.filter((a) => a.isFavorite)
      : photosState.assets
  );

  // --- Justified, virtualised grid (ui-redesign #7, #8, #24) ---
  // The layout is pure (`src/lib/photo-grid-layout.ts`): days of justified rows, stacked as
  // absolutely positioned blocks. Only the blocks within one screen of the viewport are in the
  // DOM, so a 700-photo album renders a few dozen tiles instead of all of them.

  const phoneQuery = new MediaQuery(`max-width: ${PHONE_MAX_WIDTH}px`);
  let metrics = $derived(phoneQuery.current ? GRID_METRICS.phone : GRID_METRICS.desktop);

  let gridElement = $state<HTMLDivElement | null>(null);
  let gridWidth = $state(0);

  let days = $derived(
    Object.entries(groupByDay(displayedAssets)).map(([label, items]) => ({
      label,
      items,
      ids: items.map((a) => a.id),
    }))
  );

  let layout = $derived(
    buildGridBlocks(
      days.map((d) => d.items.map(assetAspectRatio)),
      gridWidth,
      metrics
    )
  );

  let range = $state({ start: 0, end: 0 });
  let visibleBlocks = $derived(layout.blocks.slice(range.start, range.end));
  let selectedSet = $derived(new Set(photosState.selectedAssets));

  /** Re-windows the blocks against the viewport, one screen of overscan above and below. */
  function updateRange() {
    if (!gridElement) return;
    const top = -gridElement.getBoundingClientRect().top;
    const overscan = window.innerHeight;
    const next = visibleBlockRange(
      layout.blocks,
      top - overscan,
      top + window.innerHeight + overscan
    );
    if (next.start !== range.start || next.end !== range.end) range = next;
  }

  // A new layout (streamed photos, a resize, the favourites filter) re-windows at once.
  $effect(() => {
    void layout;
    updateRange();
  });

  $effect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updateRange();
      });
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  });

  /** The day header's check: selects the whole day, or clears it when it is all selected (#14). */
  function toggleDay(dayIndex: number) {
    const day = days[dayIndex];
    if (!day) return;
    const next = toggleDaySelection(photosState.selectedAssets, day.ids);
    console.debug(
      `[PhotosGrid] day "${day.label}": ${day.ids.length} photo(s), selection ${photosState.selectedAssets.length} -> ${next.length}`
    );
    photosState.selectedAssets = next;
    photosState.selecting = next.length > 0;
  }
</script>

<!-- Main view -->
{#if photosState.assets.length > 0}
  <!-- Selection toolbar -->
  {#if photosState.selecting}
    <div class="selection-toolbar">
      <div class="selection-count">
        <SquareCheck size={18} />
        {m.pg_selected_count({ count: photosState.selectedAssets.length })}
      </div>
      <div class="selection-actions">
        <button type="button" onclick={() => photosState.selectAll()} class="btn">
          <SquareCheck size={16} />
          {m.pg_select_all()}
        </button>
        <button type="button" onclick={() => photosState.deselectAll()} class="btn">
          <Square size={16} />
          {m.pg_deselect_all()}
        </button>
        <button
          type="button"
          onclick={handleDownloadSelectedClick}
          disabled={photosState.selectedAssets.length === 0}
          class="btn primary"
        >
          {#if photosState.isDownloading}
            {#if photosState.downloadProgress >= 0}
              <Download size={16} />
              {Math.round(photosState.downloadProgress * 100)}%
            {:else}
              <Spinner size={16} />
              {m.pg_downloading()}
            {/if}
          {:else}
            <Download size={16} />
            {m.pg_download_count({ count: photosState.selectedAssets.length })}
          {/if}
        </button>
        {#if canManagePhotos && albumId}
          <button
            type="button"
            onclick={() => handleRemoveFromAlbum()}
            disabled={photosState.selectedAssets.length === 0}
            class="btn"
            title={m.pg_remove_from_album_title()}
          >
            <CircleMinus size={16} />
            {m.pg_remove_count({ count: photosState.selectedAssets.length })}
          </button>
        {/if}
        {#if canManagePhotos}
          <button
            type="button"
            onclick={() => handleDeleteSelected()}
            disabled={photosState.selectedAssets.length === 0}
            class="btn danger"
          >
            <Trash2 size={16} />
            {m.pg_delete_count({ count: photosState.selectedAssets.length })}
          </button>
        {/if}
      </div>
    </div>
  {:else if showCount || (showFavorites && favoriteCount > 0)}
    <div class="photos-header">
      {#if showCount}
        <div class="photos-count">{m.pg_photo_count({ count: displayedAssets.length })}</div>
      {/if}
      {#if showFavorites && favoriteCount > 0}
        <div class="favorites-filter" role="group" aria-label={m.pg_filter_favorites()}>
          <button
            type="button"
            class="filter-chip {favoritesFilter ? '' : 'active'}"
            aria-pressed={!favoritesFilter}
            onclick={() => (favoritesFilter = false)}
          >
            {m.pg_filter_all()}
          </button>
          <button
            type="button"
            class="filter-chip {favoritesFilter ? 'active' : ''}"
            aria-pressed={favoritesFilter}
            onclick={() => (favoritesFilter = true)}
          >
            <Heart size={14} fill={favoritesFilter ? 'currentColor' : 'none'} />
            {m.pg_filter_favorites()}
            <span class="chip-count">{favoriteCount}</span>
          </button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Photo grid: days of justified rows, only the on-screen blocks rendered -->
  <div
    class="photos-grid"
    bind:this={gridElement}
    bind:clientWidth={gridWidth}
    style="height: {layout.height}px"
  >
    {#each visibleBlocks as block (block.key)}
      {@const day = days[block.day]}
      {#if block.kind === 'header'}
        {@const dayState = daySelectionState(selectedSet, day.ids)}
        {@const dayAction =
          dayState === 'all'
            ? m.pg_deselect_day({ day: day.label })
            : m.pg_select_day({ day: day.label })}
        <div
          class="day-header {photosState.selecting || dayState !== 'none' ? 'show-check' : ''}"
          style="top: {block.y}px; height: {block.height}px"
        >
          <button
            type="button"
            class="day-check {dayState}"
            aria-pressed={dayState === 'all'}
            aria-label={dayAction}
            title={dayAction}
            onclick={() => toggleDay(block.day)}
          >
            <CircleCheck size={20} />
          </button>
          <h3 class="day-label">{day.label}</h3>
        </div>
      {:else}
        <div class="grid-row" style="top: {block.y}px; height: {block.height}px">
          {#each block.row.tiles as tile (day.ids[tile.index])}
            {@const a = day.items[tile.index]}
            <PhotoCard
              asset={a}
              x={tile.x}
              width={tile.width}
              height={block.height}
              isSelected={selectedSet.has(a.id)}
              isSelecting={photosState.selecting}
              canDelete={canManagePhotos}
              albumVisibility={visibility}
              {albumId}
              showFavorite={showFavorites}
              onFavoriteToggle={() => handleFavoriteToggle(a.id)}
              onCardClick={() => handlePhotoCardClick(a.id)}
              onDownload={() => handleDownloadSingle(a.id)}
              onDelete={() => handleDeleteAsset(a.id)}
              onSelectionToggle={(id, selected) => photosState.toggleSelect(id, selected)}
            />
          {/each}
        </div>
      {/if}
    {/each}
  </div>
{:else if !photosState.loading && !photosState.error}
  <!-- Empty state -->
  <EmptyState icon={ImageIcon} title={m.pg_empty()} />
{/if}

<!-- Photo viewer modal -->
{#if showModal}
  <PhotoModal
    bind:assetId={modalAssetId}
    assets={displayedAssets}
    albumVisibility={visibility}
    {albumId}
    showFavorite={showFavorites}
    onFavoriteToggle={handleFavoriteToggle}
    onClose={() => {
      if (history.state?.modalOpen) {
        history.back();
      } else {
        closeModal();
      }
    }}
    onAssetDeleted={(id) => {
      photosState.assets = photosState.assets.filter((a) => a.id !== id);
      hasChanges = true;
    }}
  />
{/if}

<!-- Delete confirmation modal -->
<Modal
  bind:show={showDeleteModal}
  title={m.photo_delete_title()}
  type="confirm"
  confirmText={m.trash_to_bin()}
  cancelText={m.common_cancel()}
  onConfirm={confirmDelete}
>
  <p>{m.photo_trash_confirm()}</p>
</Modal>

<!-- Bulk-delete modal -->
<Modal
  bind:show={showDeleteSelectedModal}
  title={m.pg_delete_selected_title()}
  type="confirm"
  confirmText={m.trash_to_bin()}
  cancelText={m.common_cancel()}
  onConfirm={confirmDeleteSelected}
>
  <p>
    {m.pg_delete_selected_body({ count: photosState.selectedAssets.length })}
  </p>
  <p class="text-muted text-sm" style="margin-top: 0.5rem;">
    {m.pg_delete_selected_warn()}
  </p>
</Modal>

<!-- Remove-from-album modal -->
<Modal
  bind:show={showRemoveFromAlbumModal}
  title={m.pg_remove_from_album()}
  type="confirm"
  confirmText={m.pg_remove_from_album()}
  cancelText={m.common_cancel()}
  onConfirm={confirmRemoveFromAlbum}
>
  <p>
    {m.pg_remove_body({ count: photosState.selectedAssets.length })}
  </p>
  <p class="text-muted text-sm" style="margin-top: 0.5rem;">
    {m.pg_remove_warn()}
  </p>
</Modal>

<!-- Bulk download modal -->
<Modal
  bind:show={showDownloadSelectedModal}
  title={m.pg_download_selected_title()}
  type="confirm"
  confirmText={m.common_download()}
  cancelText={m.common_cancel()}
  onConfirm={confirmDownloadSelected}
>
  <p>
    {m.pg_download_body({ count: photosState.selectedAssets.length })}
  </p>
</Modal>

<style>
  .selection-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    margin-bottom: 2rem;
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
  }

  .selection-count {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .selection-actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .photos-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 2rem;
    flex-wrap: wrap;
  }

  .photos-count {
    color: var(--text-secondary);
    font-size: 0.9375rem;
  }

  .favorites-filter {
    display: inline-flex;
    gap: 0.25rem;
    padding: 0.25rem;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.75rem;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 600;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .filter-chip:hover {
    color: var(--text-primary);
  }

  .filter-chip.active {
    background: var(--accent);
    color: white;
  }

  .chip-count {
    font-size: 0.6875rem;
    font-weight: 700;
    padding: 0 0.3125rem;
    border-radius: 9999px;
    background: color-mix(in srgb, currentColor 22%, transparent);
  }

  /* The grid's height is the layout's; every block inside is absolutely positioned. */
  .photos-grid {
    position: relative;
    /* Not the global `.photos-grid` of app.css (a CSS grid with a 1rem gap). */
    display: block;
    margin-top: 0;
    margin-bottom: 2rem;
  }

  .grid-row {
    position: absolute;
    left: 0;
    right: 0;
  }

  .day-header {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .day-label {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  /*
   * The day check (#14): shown while selecting or once part of the day is selected; a pointer
   * device also reveals it on hover, as Google Photos does. Hidden, it takes no width, so the
   * label stays aligned with the page.
   */
  .day-check {
    display: none;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    margin-left: -0.625rem;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .day-check.some,
  .day-check.all {
    color: var(--accent);
  }

  .day-check.all :global(svg) {
    fill: currentColor;
    stroke: var(--bg-primary);
  }

  .day-header.show-check .day-check,
  .day-check:focus-visible {
    display: inline-flex;
  }

  @media (hover: hover) and (pointer: fine) {
    .day-header:hover .day-check {
      display: inline-flex;
    }

    .day-check:hover {
      background: color-mix(in srgb, var(--text-primary) 8%, transparent);
    }
  }

  @media (max-width: 768px) {
    /* Edge to edge (#7): the grid escapes every container gutter to the viewport's width. */
    .photos-grid {
      width: 100vw;
      margin-left: calc(50% - 50vw);
    }

    .day-header {
      padding: 0 1rem;
    }

    .selection-toolbar {
      flex-direction: column;
      gap: 0.75rem;
      padding: 0.75rem;
    }

    .selection-actions {
      width: 100%;
      justify-content: center;
    }

    .selection-actions .btn {
      padding: 0.5rem 0.75rem;
      font-size: 0.75rem;
    }

    .day-label {
      font-size: 0.875rem;
    }

    .photos-header {
      margin-bottom: 1rem;
    }

    .photos-count {
      font-size: 0.8125rem;
    }
  }
</style>
