<script lang="ts">
  import { Heart, Download, Trash2, Check } from '@lucide/svelte';
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
    /** A long-press on a touch screen: enters selection mode with this tile picked (D9). */
    onLongPress?: (assetId: string) => void;
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
    onLongPress,
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

  /**
   * Long-press (touch only) enters selection mode with this tile picked, as Google Photos does
   * (D9 in `docs/wiki/ui-redesign.md`). 500 ms matches Android's long-press timeout; a move
   * past the browser's slop fires `touchmove` and cancels it, so a scroll never selects.
   */
  const LONG_PRESS_DURATION = 500;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set once the long-press fired, until its finger lifts: that release must not also tap. */
  let longPressFired = false;

  function handleTouchStart(e: TouchEvent) {
    // A second finger is a pinch (the grid's density), never a long-press.
    if (e.touches.length > 1) {
      handleTouchCancel();
      return;
    }
    if ((e.target as HTMLElement).closest('button')) return;
    longPressFired = false;
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      longPressFired = true;
      console.debug(`[PhotoCard] long-press on ${asset.id}: entering selection`);
      if (navigator.vibrate) navigator.vibrate(50);
      onLongPress?.(asset.id);
    }, LONG_PRESS_DURATION);
  }

  function cancelLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    cancelLongPress();
    if (longPressFired) {
      // The release of a long-press would also be a click, which toggles the tile back off.
      e.preventDefault();
      longPressFired = false;
    }
  }

  function handleTouchCancel() {
    cancelLongPress();
    longPressFired = false;
  }

  /** Chrome Android opens the image's context menu on a long-press; ours already answered. */
  function handleContextMenu(e: MouseEvent) {
    if (longPressTimer || longPressFired) e.preventDefault();
  }

  function handleCardClick(e: Event) {
    if (onCardClick) {
      onCardClick(asset.id, e as unknown as MouseEvent);
    }
  }

  /** The desktop hover check: picks this tile and enters selection mode. */
  function handleCheckClick(e: Event) {
    e.stopPropagation();
    onSelectionToggle?.(asset.id, true);
  }

  function handleFavoriteClick(e: Event) {
    e.stopPropagation();
    if (onFavoriteToggle) {
      onFavoriteToggle(asset.id, e);
    }
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
   * The tile's overflow menu (pointer devices; touch long-presses into selection). Delete is
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
  aria-pressed={isSelecting ? isSelected : undefined}
  onclick={handleCardClick}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick(e);
    }
  }}
  ontouchstart={handleTouchStart}
  ontouchend={handleTouchEnd}
  ontouchmove={cancelLongPress}
  ontouchcancel={handleTouchCancel}
  oncontextmenu={handleContextMenu}
>
  <!--
    The selection circle (D9): on every tile while selecting, filled with a check once picked;
    the tile itself carries `aria-pressed`, so the circle is decoration. Outside selection mode
    a pointer device reveals it on hover as a real button that picks the tile; a touch screen
    never draws it (`display: none` keeps it out of the accessibility tree) and long-presses.
  -->
  {#if isSelecting}
    <span class="select-circle {isSelected ? 'checked' : ''}" aria-hidden="true">
      {#if isSelected}<Check size={14} strokeWidth={3} />{/if}
    </span>
  {:else}
    <button
      type="button"
      class="select-circle hover-check"
      aria-label={m.pg_select_photo({ name: fileName })}
      title={m.pg_select_photo({ name: fileName })}
      onclick={handleCheckClick}
    ></button>
  {/if}

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
    /* iOS's own long-press callout would compete with the selection long-press. */
    -webkit-touch-callout: none;
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
    inset: 8%;
    width: 84%;
    height: 84%;
    border-radius: var(--radius-xs);
    overflow: hidden;
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

  /* The selection circle: an empty ring over the photo, filled with the accent once picked. */
  .select-circle {
    position: absolute;
    top: 0.375rem;
    left: 0.375rem;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.375rem;
    height: 1.375rem;
    padding: 0;
    border: 2px solid white;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.25);
    color: white;
    pointer-events: none;
  }

  .select-circle.checked {
    border-color: var(--accent);
    background: var(--accent);
  }

  /* Outside selection mode the ring is a hover control of pointer devices only (below). */
  .select-circle.hover-check {
    display: none;
    cursor: pointer;
    pointer-events: auto;
  }

  .photo-card:focus-visible .select-circle.hover-check,
  .select-circle.hover-check:focus-visible {
    display: flex;
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
   * viewer, audit #4), whatever its width - touch long-presses into selection mode instead.
   */
  @media (hover: hover) and (pointer: fine) {
    /* Flat: no lift on hover (the global `.photo-card:hover` adds a shadow). */
    .photo-card:hover {
      box-shadow: none;
    }

    .photo-card:hover .select-circle.hover-check {
      display: flex;
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
</style>
