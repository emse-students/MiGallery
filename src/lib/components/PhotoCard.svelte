<script lang="ts">
  import { Heart, Download, Trash2, SquareCheck } from '@lucide/svelte';
  import LazyImage from './LazyImage.svelte';
  import Skeleton from './Skeleton.svelte';
  import OverflowMenu from './OverflowMenu.svelte';
  import type { Asset } from '$lib/photos.svelte';
  import type { OverflowMenuItem } from '$lib/overflow-menu';
  import { assetAspectRatio } from '$lib/photo-grid-layout';
  import { m } from '$lib/paraglide/messages';

  interface Props {
    asset: Asset;
    isSelected?: boolean;
    isSelecting?: boolean;
    canDelete?: boolean;
    showFavorite?: boolean;
    onCardClick?: (assetId: string, event: MouseEvent) => void;
    onDownload?: (assetId: string) => void;
    onDelete?: (assetId: string) => void;
    onSelectionToggle?: (assetId: string, selected: boolean) => void;
    onFavoriteToggle?: (assetId: string, event: Event) => void;
    albumVisibility?: string;
    albumId?: string;
    /**
     * The tile's box inside its row, in CSS px, computed by the justified layout
     * (`src/lib/photo-grid-layout.ts`): the card no longer sizes itself.
     */
    x: number;
    width: number;
    height: number;
  }

  let {
    asset,
    isSelected = false,
    isSelecting = false,
    canDelete = false,
    showFavorite = false,
    onCardClick,
    onDownload,
    onDelete,
    onSelectionToggle,
    onFavoriteToggle,
    albumVisibility,
    albumId,
    x,
    width,
    height,
  }: Props = $props();

  /** The ratio the skeleton and the image placeholder keep while the thumbnail loads. */
  let aspectRatioString = $derived(`${Math.round(assetAspectRatio(asset) * 100)}/100`);

  let isFullyLoaded = $derived(
    asset.originalFileName !== undefined && asset.originalFileName !== null
  );

  let showMobileActions = $state(false);
  let sheetOpenedAt = 0;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  const LONG_PRESS_DURATION = 500; // ms

  function handleTouchStart(e: TouchEvent) {
    if ((e.target as HTMLElement).closest('button')) return;

    longPressTimer = setTimeout(() => {
      showMobileActions = true;
      sheetOpenedAt = Date.now();
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, LONG_PRESS_DURATION);
  }

  function handleTouchEnd() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function handleTouchMove() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function closeMobileActions() {
    showMobileActions = false;
  }

  function handleCardClick(e: Event) {
    if (onCardClick) {
      onCardClick(asset.id, e as unknown as MouseEvent);
    }
  }

  function handleCheckboxChange(e: Event) {
    e.stopPropagation();
    const checked = (e.target as HTMLInputElement).checked;
    if (onSelectionToggle) {
      onSelectionToggle(asset.id, checked);
    }
  }

  function handleFavoriteClick(e: Event) {
    e.stopPropagation();
    if (onFavoriteToggle) {
      onFavoriteToggle(asset.id, e);
    }
  }

  // --- Mobile bottom-sheet actions ---
  function sheetSelect(e: Event) {
    e.stopPropagation();
    closeMobileActions();
    if (onSelectionToggle) onSelectionToggle(asset.id, true);
  }

  function sheetFavorite(e: Event) {
    e.stopPropagation();
    closeMobileActions();
    if (onFavoriteToggle) onFavoriteToggle(asset.id, e);
  }

  function sheetDownload(e: Event) {
    e.stopPropagation();
    closeMobileActions();
    if (onDownload) onDownload(asset.id);
  }

  function sheetDelete(e: Event) {
    e.stopPropagation();
    closeMobileActions();
    if (onDelete) onDelete(asset.id);
  }

  function handleOverlayClick(e: Event) {
    e.stopPropagation();
    // Ignore the synthetic click that fires right after a long-press release,
    // which would otherwise close the sheet the instant it opens.
    if (Date.now() - sheetOpenedAt < 400) return;
    closeMobileActions();
  }

  let fileName = $derived(asset.originalFileName || asset._raw?.originalFileName || asset.id);
  let isFavorite = $derived(asset.isFavorite ?? false);
  let thumbnailUrl = $derived(
    albumVisibility === 'unlisted' && albumId
      ? `/api/albums/${albumId}/asset-thumbnail/${asset.id}/thumbnail?size=thumbnail`
      : `/api/immich/assets/${asset.id}/thumbnail?size=thumbnail`
  );

  let isVideo = $derived(asset.type === 'VIDEO');

  /**
   * The tile's overflow menu (pointer devices; touch uses the long-press sheet). Delete is
   * never a one-tap corner button (decision D4).
   */
  let menuItems = $derived<OverflowMenuItem[]>([
    { label: m.common_download(), icon: Download, onSelect: () => onDownload?.(asset.id) },
    ...(canDelete
      ? [
          {
            label: m.trash_to_bin(),
            icon: Trash2,
            danger: true,
            onSelect: () => onDelete?.(asset.id),
          },
        ]
      : []),
  ]);
</script>

<!-- Photo Card Container -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="photo-card {isSelected ? 'selected' : ''}"
  style="left: {x}px; width: {width}px; height: {height}px;"
  role="button"
  tabindex="0"
  onclick={handleCardClick}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick(e);
    }
  }}
  ontouchstart={handleTouchStart}
  ontouchend={handleTouchEnd}
  ontouchmove={handleTouchMove}
  ontouchcancel={handleTouchEnd}
>
  <!-- Mobile long-press action sheet -->
  {#if showMobileActions}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="mobile-actions-overlay" onclick={handleOverlayClick}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="action-sheet" onclick={(e) => e.stopPropagation()}>
      <button type="button" class="sheet-item" onclick={sheetSelect}>
        <SquareCheck size={20} />
        {m.pg_action_select()}
      </button>
      {#if showFavorite}
        <button type="button" class="sheet-item" onclick={sheetFavorite}>
          <Heart size={20} fill={isFavorite ? 'currentColor' : 'none'} />
          {isFavorite ? m.pm_fav_remove() : m.pm_fav_add()}
        </button>
      {/if}
      <button type="button" class="sheet-item" onclick={sheetDownload}>
        <Download size={20} />
        {m.common_download()}
      </button>
      {#if canDelete}
        <button type="button" class="sheet-item danger" onclick={sheetDelete}>
          <Trash2 size={20} />
          {m.trash_to_bin()}
        </button>
      {/if}
    </div>
  {/if}

  <!-- Selection Checkbox -->
  <div class="selection-checkbox {isSelected ? 'checked' : ''}">
    <input
      type="checkbox"
      checked={isSelected}
      onclick={(e) => e.stopPropagation()}
      onchange={handleCheckboxChange}
      aria-label={`Select ${fileName}`}
    />
  </div>

  {#if isFullyLoaded}
    <!-- Passive favorite badge: discreet indicator, always visible on mobile -->
    {#if showFavorite && isFavorite && !isSelecting}
      <div class="favorite-badge" aria-hidden="true">
        <Heart size={13} fill="currentColor" />
      </div>
    {/if}

    <!-- Favorite Button (bottom left) -->
    {#if showFavorite && !isSelecting}
      <button
        type="button"
        class="favorite-btn {isFavorite ? 'active' : ''}"
        title={isFavorite ? m.pm_fav_remove() : m.pm_fav_add()}
        onclick={handleFavoriteClick}
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Heart size={18} fill={isFavorite ? 'currentColor' : 'none'} />
      </button>
    {/if}

    <!-- Overflow menu: download, and delete for managers (hidden while selecting) -->
    {#if !isSelecting}
      <div class="tile-menu">
        <OverflowMenu items={menuItems} variant="overlay" iconSize={18} />
      </div>
    {/if}

    <!-- Image/Video Thumbnail -->
    <LazyImage
      src={thumbnailUrl}
      alt={fileName}
      class="photo-img-wrapper"
      aspectRatio={aspectRatioString}
      {isVideo}
    />
  {:else}
    <!-- Skeleton while details load -->
    <Skeleton aspectRatio={aspectRatioString}>
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"
          fill="currentColor"
          opacity="0.3"
        />
      </svg>
    </Skeleton>
  {/if}
</div>

<style>
  /*
   * Placed by the justified layout: absolute inside its row, square corners, no entrance
   * animation - a virtualised row is re-mounted on scroll, and an animation would replay on
   * every one (ui-redesign #8, #24).
   */
  .photo-card {
    position: absolute;
    top: 0;
    background: var(--bg-elevated);
    overflow: hidden;
    cursor: pointer;
    user-select: none;
    /* The global `.photo-card` in app.css (a square, rounded, hover-shadowed card) does not apply. */
    border-radius: 0;
    box-shadow: none;
  }

  /* Selected: the photo shrinks inside a tinted frame, as Google Photos draws it. */
  .photo-card.selected {
    background: var(--accent-light);
    /* The shrink says it; the global outline would frame it twice. */
    outline: none;
  }

  .photo-card.selected :global(.lazy-image-container) {
    inset: 10%;
    width: 80%;
    height: 80%;
    border-radius: var(--radius-xs);
    overflow: hidden;
  }

  /* Ensure checkbox is visible when selected even without hover */
  .photo-card.selected .selection-checkbox {
    opacity: 1;
  }

  .photo-card :global(.lazy-image-container) {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .photo-card :global(.lazy-image) {
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    /* cover fills the card while respecting ratio; avoid letterbox */
    object-fit: cover;
  }

  .selection-checkbox {
    position: absolute;
    top: 0.625rem;
    left: 0.625rem;
    z-index: 5;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .selection-checkbox.checked {
    opacity: 1;
  }

  .selection-checkbox input {
    width: 1.25rem;
    height: 1.25rem;
    cursor: pointer;
    accent-color: var(--accent);
  }

  .favorite-btn {
    position: absolute;
    bottom: 0.625rem;
    left: 0.625rem;
    z-index: 5;
    padding: 0.5rem;
    width: 36px;
    height: 36px;
    background: rgba(0, 0, 0, 0.7);
    border: none;
    border-radius: var(--radius-sm);
    color: white;
    cursor: pointer;
    opacity: 0;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .favorite-btn.active {
    color: white;
    background: var(--error);
  }

  /* Passive favorite indicator: a small heart with no chrome, cheap on space */
  .favorite-badge {
    position: absolute;
    bottom: 0.5rem;
    left: 0.5rem;
    z-index: 5;
    display: flex;
    color: var(--error);
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.7));
    pointer-events: none;
    transition: opacity 0.2s ease;
  }

  .favorite-btn {
    pointer-events: none;
  }

  .tile-menu {
    position: absolute;
    top: 0.625rem;
    right: 0.625rem;
    z-index: 5;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }

  /* Keyboard focus reveals the menu on any device; an open menu keeps its trigger shown. */
  .photo-card:focus-visible .tile-menu,
  .tile-menu:has(:global(:focus-visible)),
  .tile-menu:has(:global([aria-expanded='true'])) {
    opacity: 1;
    pointer-events: auto;
  }

  /*
   * Hover reveals ONLY where a hover is real: a mouse or a trackpad. A touch screen reports a
   * sticky `:hover` on the last tile tapped (the overlay stayed painted after closing the
   * viewer, audit #4), whatever its width - touch actions live in the long-press sheet.
   */
  @media (hover: hover) and (pointer: fine) {
    /* Flat: no lift on hover (the global `.photo-card:hover` adds a shadow). */
    .photo-card:hover {
      box-shadow: none;
    }

    .photo-card:hover .selection-checkbox {
      opacity: 1;
    }

    /* Yield the passive badge to the interactive favorite button */
    .photo-card:hover .favorite-badge {
      opacity: 0;
    }

    .photo-card:hover .favorite-btn,
    .photo-card:hover .tile-menu {
      opacity: 1;
      pointer-events: auto;
    }

    .favorite-btn:hover {
      background: color-mix(in srgb, var(--error) 30%, transparent);
      color: var(--error);
      transform: scale(1.1);
    }
  }

  /* Dimmed overlay behind the long-press action sheet */
  .mobile-actions-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.5);
    animation: overlayFadeIn 0.2s ease-out;
  }

  @keyframes overlayFadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* Long-press bottom sheet: finger-friendly action list */
  .action-sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1001;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    padding: 0.5rem;
    padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
    background: var(--bg-elevated);
    border-top: 1px solid var(--border);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.4);
    animation: sheetUp 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  }

  @keyframes sheetUp {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }

  .sheet-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.875rem 1rem;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 500;
    text-align: left;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .sheet-item:active {
    background: color-mix(in srgb, var(--text-primary) 10%, transparent);
  }

  .sheet-item.danger {
    color: var(--error);
  }
</style>
