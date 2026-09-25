<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import {
    Image as ImageIcon,
    ArrowLeft,
    Heart,
    Download,
    Info,
    Share2,
    Trash2,
    X,
    ZoomIn,
    ZoomOut,
    ChevronLeft,
    ChevronRight,
    Calendar,
    Aperture,
    MapPin,
  } from '@lucide/svelte';
  import type { IconComponent } from '$lib/icons';
  import Modal from './Modal.svelte';
  import OverflowMenu from './OverflowMenu.svelte';
  import { page } from '$app/state';
  import type { ImmichAsset, User } from '$lib/types/api';
  import type { Asset } from '$lib/photos.svelte';
  import type { OverflowMenuItem } from '$lib/overflow-menu';
  import { toast } from '$lib/toast';
  import { setAlbumCover } from '$lib/immich/albums';
  import { FileSharer, fetchOriginal, originalFileName, probeFileSharing } from '$lib/share-files';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import {
    cameraName,
    dimensionsLine,
    exposureLine,
    placeLine,
    formatFileSize,
    formatViewerDateTitle,
    formatViewerFullDate,
    viewerDateOf,
  } from '$lib/viewer-info';
  import {
    GESTURE,
    clamp,
    classifyMove,
    clampTranslate,
    containSize,
    decideDismiss,
    decideSwipe,
    dismissProgress,
    dismissScale,
    doubleTapZoom,
    dragOffset,
    isDoubleTap,
    isTap,
    isZoomed,
    pinchZoom,
    releaseVelocity,
    zoomAt,
    type GestureKind,
    type PinchStart,
    type Point,
    type Sample,
    type Size,
    type ZoomState,
  } from '$lib/viewer-gestures';

  interface Props {
    assetId: string;
    assets: Asset[];
    onClose: () => void;
    onAssetDeleted?: (assetId: string) => void;
    albumVisibility?: string;
    albumId?: string;
    showFavorite?: boolean;
    onFavoriteToggle?: (assetId: string) => Promise<void>;
  }

  let {
    assetId = $bindable(),
    assets,
    onClose,
    onAssetDeleted,
    albumVisibility,
    albumId,
    showFavorite = false,
    onFavoriteToggle,
  }: Props = $props();

  /** Zooming past this scale upgrades the preview to the original (docs/wiki/bandwidth.md). */
  const HIGH_RES_SCALE = 1.3;
  /** Space between two photos while they slide past each other. */
  const SLIDE_GAP_PX = 24;

  // -- The asset on screen, and its neighbours --
  /** Metadata of an asset opened by id without being in `assets` (fetched once). */
  let fetchedAsset = $state<Asset | null>(null);
  let currentIndex = $derived(assets.findIndex((a) => a.id === assetId));
  let asset = $derived<Asset | null>(
    currentIndex >= 0 ? assets[currentIndex] : fetchedAsset?.id === assetId ? fetchedAsset : null
  );
  let isVideo = $derived(asset?.type === 'VIDEO');
  let hasPrevious = $derived(currentIndex > 0);
  let hasNext = $derived(currentIndex >= 0 && currentIndex < assets.length - 1);

  /**
   * The slides of the carousel: the current asset and its two neighbours, keyed by id so the
   * neighbour a swipe brings in IS the element that becomes current - its already-loaded
   * preview stays on screen instead of being reloaded.
   */
  let slides = $derived.by(() => {
    if (currentIndex < 0) return assetId ? [{ id: assetId, offset: 0 }] : [];
    const out: { id: string; offset: number }[] = [];
    for (let offset = -1; offset <= 1; offset++) {
      const neighbour = assets[currentIndex + offset];
      if (neighbour) out.push({ id: neighbour.id, offset });
    }
    return out;
  });

  // -- Media URLs --
  /** The asset whose ORIGINAL was requested by zooming; any other asset shows its preview. */
  let highResAssetId = $state<string | null>(null);
  let highResLoaded = $derived(highResAssetId === assetId);
  /** Every URL that finished loading: an image fades in once, never again. */
  const loadedSrcs = new SvelteSet<string>();

  /**
   * The preview URL of an asset (~0.5 MB). The viewer always opens on it: an original weighs
   * ~8 MB on a lossy uplink (docs/wiki/bandwidth.md). The two neighbours load it too, so a
   * swipe slides in a photo that is already there.
   */
  function previewUrl(id: string): string {
    return albumVisibility === 'unlisted' && albumId
      ? `/api/albums/${albumId}/asset-thumbnail/${id}/thumbnail?size=preview`
      : `/api/immich/assets/${id}/thumbnail?size=preview`;
  }

  let mediaUrl = $derived.by(() => {
    if (!assetId || !asset) return null;
    if (isVideo) return `/api/immich/assets/${assetId}/video/playback`;
    // An unlisted album's visitor has no route to the original: the preview is the ceiling.
    const originalAllowed = !(albumVisibility === 'unlisted' && albumId);
    return highResLoaded && originalAllowed
      ? `/api/immich/assets/${assetId}/original`
      : previewUrl(assetId);
  });

  // -- Zoom state --
  let scale = $state(1);
  let translate = $state<Point>({ x: 0, y: 0 });

  let userRole = $derived((page.data.session?.user as User)?.role || 'user');
  let canManagePhotos = $derived(userRole === 'mitviste' || userRole === 'admin');

  let showConfirmModal = $state(false);
  let confirmModalConfig = $state<{
    title: string;
    message: string;
    confirmText?: string;
    onConfirm: () => void;
  } | null>(null);

  // -- Mouse pan (desktop) --
  let isDragging = $state(false);
  let dragStart = { x: 0, y: 0 };

  let containerElement = $state<HTMLDivElement | null>(null);
  let trackElement = $state<HTMLDivElement | null>(null);
  let portalRoot = $state<HTMLDivElement | null>(null);

  // -- Touch gestures (the maths live in $lib/viewer-gestures) --
  /** Where the current touch sequence stands; `ignored` waits for every finger to lift. */
  type TouchPhase = GestureKind | 'idle' | 'ignored' | 'pinch-end';
  let phase: TouchPhase = 'idle';
  let touchStart: Sample | null = null;
  let samples: Sample[] = [];
  let panOrigin: Point = { x: 0, y: 0 };
  let pinchStart: PinchStart | null = null;
  let lastTap: Sample | null = null;
  let singleTapTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while a snap / spring-back animation runs: a new touch waits for it. */
  let settling = false;

  /** A finger drives the image: CSS transitions are off so it follows 1:1. */
  let gestureActive = $state(false);
  /** Horizontal offset of the carousel track while swiping. */
  let swipeX = $state(0);
  /** Offset of the current photo while it is dragged down to close. */
  let dismissOffset = $state<Point>({ x: 0, y: 0 });
  /** A downward drag is live: the neighbours hide so the shrinking photo stands alone. */
  let dismissing = $state(false);
  /** Immersive view: a single tap hides the toolbars and blackens the frame. */
  let chromeHidden = $state(false);
  let viewport = $state<Size>({ width: 1, height: 1 });
  let dismissAmount = $derived(dismissProgress(dismissOffset.y, viewport.height));

  // Metadata of an asset that is not in the list (opened by id): fetched, never guessed.
  $effect(() => {
    const id = assetId;
    if (!id || assets.some((a) => a.id === id)) return;
    void fetchAssetMeta(id);
  });

  // Every photo opens unzoomed, whichever way it was reached.
  $effect(() => {
    void assetId;
    untrack(() => {
      scale = 1;
      translate = { x: 0, y: 0 };
    });
  });

  async function fetchAssetMeta(id: string) {
    try {
      const res = await fetch(`/api/immich/assets/${id}`);
      if (!res.ok) {
        console.warn(`Asset metadata load failed for ${id}: HTTP ${res.status}`);
        return;
      }
      const rawAsset = (await res.json()) as ImmichAsset;
      fetchedAsset = {
        id: rawAsset.id,
        originalFileName: rawAsset.originalFileName,
        type: rawAsset.type,
        fileCreatedAt: rawAsset.fileCreatedAt,
        createdAt: rawAsset.createdAt,
        isFavorite: rawAsset.isFavorite,
        _raw: rawAsset,
      };
    } catch (e) {
      console.error('Asset metadata load error:', e);
    }
  }

  function containerSize(): Size {
    if (!containerElement) return { width: 1, height: 1 };
    const rect = containerElement.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  function currentImage(): HTMLImageElement | null {
    return containerElement?.querySelector<HTMLImageElement>('.slide.current img.media') ?? null;
  }

  function currentSlide(): HTMLElement | null {
    return containerElement?.querySelector<HTMLElement>('.slide.current') ?? null;
  }

  /** A client point as an offset from the container centre, the frame the zoom maths use. */
  function anchorOf(clientX: number, clientY: number): Point {
    if (!containerElement) return { x: 0, y: 0 };
    const rect = containerElement.getBoundingClientRect();
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  }

  /** Keeps a zoomed photo covering the container. */
  function constrain(next: Point, atScale = scale): Point {
    const img = currentImage();
    if (!img || !img.naturalWidth) return { x: 0, y: 0 };
    const container = containerSize();
    const displayed = containSize(
      { width: img.naturalWidth, height: img.naturalHeight },
      container
    );
    return clampTranslate(next, atScale, displayed, container);
  }

  /** Applies a zoom state (clamped), and upgrades to the original once it is worth it. */
  function applyZoom(next: ZoomState) {
    if (!mediaUrl || isVideo) return;
    scale = next.scale;
    translate = next.scale <= 1 ? { x: 0, y: 0 } : constrain(next.translate, next.scale);
    if (scale > HIGH_RES_SCALE) ensureHighRes();
  }

  /** Zooms by a fixed step around the centre (toolbar buttons and the +/- keys). */
  function stepZoom(delta: number) {
    const target = clamp(scale + delta, GESTURE.MIN_SCALE, GESTURE.MAX_SCALE);
    applyZoom(zoomAt({ scale, translate }, target, { x: 0, y: 0 }));
  }

  function handleWheel(e: WheelEvent) {
    if (!mediaUrl || isVideo || !containerElement) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.2 : 0.2;
    const target = clamp(scale + delta, GESTURE.MIN_SCALE, GESTURE.MAX_SCALE);
    if (target === scale) return;
    applyZoom(zoomAt({ scale, translate }, target, anchorOf(e.clientX, e.clientY)));
  }

  function handleDoubleClick(e: MouseEvent) {
    if (!mediaUrl || isVideo || !containerElement) return;
    e.preventDefault();
    applyZoom(doubleTapZoom({ scale, translate }, anchorOf(e.clientX, e.clientY)));
  }

  function handleMouseDown(e: MouseEvent) {
    if (scale <= 1) return;
    isDragging = true;
    dragStart = { x: e.clientX - translate.x, y: e.clientY - translate.y };
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    translate = constrain({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }

  function handleMouseUp() {
    isDragging = false;
  }

  function ensureHighRes() {
    if (!asset || isVideo || highResLoaded) return;
    highResAssetId = asset.id;
  }

  function prefersReducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Sets the final state with `apply`, and animates `element` there from `keyframes[0]`.
   * The Web Animations API rather than a CSS transition, because its `finished` promise
   * resolves even when the end state equals the start, where `transitionend` never fires.
   */
  async function settle(element: HTMLElement | null, keyframes: Keyframe[], apply: () => void) {
    apply();
    const duration = prefersReducedMotion() ? 0 : GESTURE.SETTLE_MS;
    if (!element || duration === 0) return;
    try {
      await element.animate(keyframes, { duration, easing: 'cubic-bezier(0.2, 0, 0, 1)' }).finished;
    } catch (e) {
      // Cancelled because the element left the DOM (the viewer closed mid-animation).
      console.debug('Viewer settle animation cancelled:', e);
    }
  }

  function trackTransform(x: number): string {
    return `translate3d(${x}px, 0, 0)`;
  }

  function dismissTransform(offset: Point): string {
    const shrink = dismissScale(dismissProgress(offset.y, viewport.height));
    return `translate(${offset.x}px, ${offset.y}px) scale(${shrink})`;
  }

  function slideStyle(offset: number): string {
    return offset === 0
      ? `transform: ${dismissTransform(dismissOffset)};`
      : `transform: translateX(calc(${offset} * (100% + ${SLIDE_GAP_PX}px)));`;
  }

  /** Springs a swipe or a dismiss drag back to rest (released short, or cancelled). */
  async function releaseToRest() {
    settling = true;
    const trackFrom = trackTransform(swipeX);
    const slideFrom = dismissTransform(dismissOffset);
    await Promise.all([
      settle(trackElement, [{ transform: trackFrom }, { transform: trackTransform(0) }], () => {
        swipeX = 0;
      }),
      settle(
        currentSlide(),
        [{ transform: slideFrom }, { transform: dismissTransform({ x: 0, y: 0 }) }],
        () => {
          dismissOffset = { x: 0, y: 0 };
        }
      ),
    ]);
    dismissing = false;
    settling = false;
  }

  /** A released horizontal swipe: slide to the neighbour, or back. */
  async function finishSwipe(dx: number) {
    const velocity = releaseVelocity(samples);
    const decision = decideSwipe({
      dx,
      velocityX: velocity.x,
      width: viewport.width,
      hasPrevious,
      hasNext,
    });
    if (decision === 'stay') {
      await releaseToRest();
      return;
    }
    const neighbour = assets[currentIndex + (decision === 'next' ? 1 : -1)];
    const stride = viewport.width + SLIDE_GAP_PX;
    const target = decision === 'next' ? -stride : stride;
    settling = true;
    await settle(
      trackElement,
      [{ transform: trackTransform(swipeX) }, { transform: trackTransform(target) }],
      () => {
        swipeX = target;
      }
    );
    // The neighbour slide is keyed by id: switching the asset and re-centring the track in
    // the same flush leaves the very same pixels on screen.
    if (neighbour) assetId = neighbour.id;
    swipeX = 0;
    settling = false;
  }

  /** A released downward drag: close past the threshold, spring back otherwise. */
  async function finishDismiss() {
    const velocity = releaseVelocity(samples);
    if (!decideDismiss({ dy: dismissOffset.y, velocityY: velocity.y, height: viewport.height })) {
      await releaseToRest();
      return;
    }
    settling = true;
    const from = dismissTransform(dismissOffset);
    const gone = { x: dismissOffset.x, y: viewport.height };
    await settle(
      currentSlide(),
      [{ transform: from }, { transform: dismissTransform(gone) }],
      () => {
        dismissOffset = gone;
      }
    );
    onClose();
  }

  function cancelSingleTap() {
    if (singleTapTimer) clearTimeout(singleTapTimer);
    singleTapTimer = null;
  }

  /**
   * A tap. The second tap of a double-tap zooms on its point; a lone tap toggles the toolbars
   * only once `DOUBLE_TAP_MS` has passed without a second one - the standard confirmation
   * window, the price of having both gestures on one surface.
   */
  function handleTap(tap: Sample) {
    // A video's native controls own the taps on it.
    if (isVideo) return;
    if (isDoubleTap(lastTap, tap)) {
      cancelSingleTap();
      lastTap = null;
      applyZoom(doubleTapZoom({ scale, translate }, anchorOf(tap.x, tap.y)));
      return;
    }
    lastTap = tap;
    cancelSingleTap();
    singleTapTimer = setTimeout(() => {
      singleTapTimer = null;
      lastTap = null;
      chromeHidden = !chromeHidden;
    }, GESTURE.DOUBLE_TAP_MS);
  }

  function fingerSpread(touches: TouchList): { midpoint: Point; distance: number } {
    const a = touches[0];
    const b = touches[1];
    return {
      midpoint: anchorOf((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2),
      distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
    };
  }

  function startPinch(e: TouchEvent) {
    e.preventDefault();
    cancelSingleTap();
    lastTap = null;
    if (phase === 'swipe-h' || phase === 'swipe-down') void releaseToRest();
    if (isVideo) {
      phase = 'ignored';
      return;
    }
    const { midpoint, distance } = fingerSpread(e.touches);
    pinchStart = { zoom: { scale, translate: { ...translate } }, midpoint, distance };
    phase = 'pinch';
    gestureActive = true;
  }

  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length >= 2) {
      if (phase !== 'ignored') startPinch(e);
      return;
    }
    if (e.touches.length !== 1) return;
    if (settling) {
      phase = 'ignored';
      return;
    }
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY, t: e.timeStamp };
    samples = [touchStart];
    panOrigin = { ...translate };
    viewport = containerSize();
    phase = 'pending';
  }

  function handleTouchMove(e: TouchEvent) {
    if (phase === 'pinch') {
      e.preventDefault();
      if (pinchStart && e.touches.length >= 2) {
        const { midpoint, distance } = fingerSpread(e.touches);
        const next = pinchZoom(pinchStart, midpoint, distance);
        // Below 1x the photo stays centred; it springs back to 1x on release.
        scale = next.scale;
        translate = next.scale <= 1 ? { x: 0, y: 0 } : constrain(next.translate, next.scale);
        if (scale > HIGH_RES_SCALE) ensureHighRes();
      }
      return;
    }
    if (!touchStart || e.touches.length !== 1) return;
    if (phase !== 'pending' && phase !== 'pan' && phase !== 'swipe-h' && phase !== 'swipe-down')
      return;

    const t = e.touches[0];
    const sample = { x: t.clientX, y: t.clientY, t: e.timeStamp };
    samples.push(sample);
    if (samples.length > 32) samples.shift();
    const dx = sample.x - touchStart.x;
    const dy = sample.y - touchStart.y;

    if (phase === 'pending') {
      const kind = classifyMove({ dx, dy, zoomed: isZoomed(scale), touches: 1 });
      if (kind === 'pending') return;
      phase = kind;
      // An upward swipe opens the info panel on release; nothing follows the finger.
      if (kind === 'swipe-up') return;
      gestureActive = true;
      if (kind === 'swipe-down') dismissing = true;
    }

    e.preventDefault();
    if (phase === 'pan') translate = constrain({ x: panOrigin.x + dx, y: panOrigin.y + dy });
    else if (phase === 'swipe-h') swipeX = dragOffset(dx, hasPrevious, hasNext);
    else if (phase === 'swipe-down') dismissOffset = { x: dx, y: Math.max(0, dy) };
  }

  function handleTouchEnd(e: TouchEvent) {
    if (e.touches.length > 0) {
      // One finger of a pinch lifted: what the other one does next is not a new gesture.
      if (phase === 'pinch') phase = 'pinch-end';
      return;
    }
    const ended = phase;
    const start = touchStart;
    phase = 'idle';
    touchStart = null;
    gestureActive = false;
    pinchStart = null;

    if (ended === 'pinch' || ended === 'pinch-end') {
      if (scale < 1) resetZoom();
      else translate = constrain(translate);
    } else if (ended === 'pan') {
      translate = constrain(translate);
    } else if (ended === 'pending' && start) {
      const t = e.changedTouches[0];
      const tap = { x: t.clientX, y: t.clientY, t: e.timeStamp };
      if (isTap(start, tap)) {
        // Suppresses the emulated mouse events, so a double-tap is not ALSO a dblclick.
        e.preventDefault();
        handleTap(tap);
      }
    } else if (ended === 'swipe-h' && start) {
      const last = samples[samples.length - 1];
      void finishSwipe(last.x - start.x);
    } else if (ended === 'swipe-down') {
      void finishDismiss();
    } else if (ended === 'swipe-up') {
      console.debug('Viewer: swipe up opens the info panel');
      infoOpen = true;
    }
  }

  function handleTouchCancel() {
    const ended = phase;
    phase = 'idle';
    touchStart = null;
    gestureActive = false;
    pinchStart = null;
    if (ended === 'swipe-h' || ended === 'swipe-down') void releaseToRest();
    else if (scale < 1) resetZoom();
  }

  // Touch listeners are attached by hand: Svelte registers `ontouchstart` / `ontouchmove` as
  // PASSIVE listeners, where `preventDefault()` is ignored.
  $effect(() => {
    const el = containerElement;
    if (!el) return;
    const options = { passive: false };
    el.addEventListener('touchstart', handleTouchStart, options);
    el.addEventListener('touchmove', handleTouchMove, options);
    el.addEventListener('touchend', handleTouchEnd, options);
    el.addEventListener('touchcancel', handleTouchCancel, options);
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchCancel);
    };
  });

  /** The one desktop zoom icon: 2.5x on the centre, or back to 1x (the double-tap maths). */
  function toggleZoom() {
    applyZoom(doubleTapZoom({ scale, translate }, { x: 0, y: 0 }));
  }

  function resetZoom() {
    scale = 1;
    translate = { x: 0, y: 0 };
  }
  function goToPrevious() {
    if (hasPrevious) assetId = assets[currentIndex - 1].id;
  }
  function goToNext() {
    if (hasNext) assetId = assets[currentIndex + 1].id;
  }

  let isDownloading = $state(false);
  let isSettingCover = $state(false);

  /** Where the originals come from (`$lib/share-files`, shared with the grid's selection). */
  let originalSource = $derived({ albumVisibility, albumId });

  async function downloadAsset() {
    if (!asset || isDownloading) return;
    const target = asset;
    isDownloading = true;
    try {
      const blob = await fetchOriginal(target.id, originalSource);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = originalFileName(target);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(`Viewer download failed for ${target.id}:`, e);
      toast.error(m.common_error_detail({ error: (e as Error).message }));
    } finally {
      isDownloading = false;
    }
  }

  /**
   * Whether this browser can hand a photo FILE to the system share sheet (Web Share level 2):
   * when it cannot, the share action is not drawn at all.
   */
  let canShareFiles = $state(false);
  let isSharing = $state(false);
  /** The ONE share implementation, which keeps a fetched file across a lapsed activation. */
  const sharer = new FileSharer();

  /** Shares the ORIGINAL file, as Google Photos does (`$lib/share-files`). */
  async function shareAsset() {
    if (!asset || isSharing) return;
    isSharing = true;
    try {
      await sharer.share([asset], originalSource, 'Viewer');
    } finally {
      isSharing = false;
    }
  }

  // -- The title and the info panel --
  let dateTitle = $derived(
    formatViewerDateTitle(viewerDateOf(asset), {
      locale: getLocale(),
      labels: { today: m.photos_today(), yesterday: m.photos_yesterday() },
    })
  );
  let infoOpen = $state(false);
  /** Full metadata (EXIF) of the asset the panel shows; the grid streams carry none. */
  let infoDetails = $state<{ id: string; raw: ImmichAsset | null } | null>(null);
  let infoRaw = $derived(infoDetails?.id === assetId ? infoDetails.raw : null);
  /**
   * One row per fact, an icon and a main line with its detail under it - the Google Photos panel:
   * the file carries its size and pixels, the camera its exposure. A row EXIF cannot fill is left
   * out rather than printed empty.
   */
  let infoLines = $derived.by(() => {
    const lines: { label: string; icon: IconComponent; value: string; detail?: string }[] = [];
    if (!asset) return lines;
    const locale = getLocale();
    const exif = infoRaw?.exifInfo ?? {};
    const date = formatViewerFullDate(viewerDateOf(asset), locale);
    if (date) lines.push({ label: m.pm_info_date(), icon: Calendar, value: date });
    const fileDetail = [
      formatFileSize(exif.fileSizeInByte, locale),
      dimensionsLine(exif.exifImageWidth, exif.exifImageHeight, locale),
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push({
      label: m.pm_info_file(),
      icon: ImageIcon,
      value: originalFileName(asset),
      detail: fileDetail || undefined,
    });
    const camera = cameraName(exif.make, exif.model);
    const exposure = exposureLine(exif, locale);
    if (camera || exposure) {
      lines.push({
        label: m.pm_info_camera(),
        icon: Aperture,
        value: camera ?? exposure ?? '',
        detail: camera
          ? [exif.lensModel?.trim(), exposure].filter(Boolean).join(' · ') || undefined
          : undefined,
      });
    }
    const place = placeLine(exif.city, exif.state, exif.country);
    if (place) lines.push({ label: m.pm_info_place(), icon: MapPin, value: place });
    return lines;
  });

  // The panel follows the photo on screen: each asset's EXIF is fetched once, when shown.
  $effect(() => {
    const id = assetId;
    if (!infoOpen || !id) return;
    untrack(() => {
      if (infoDetails?.id !== id) void fetchInfo(id);
    });
  });

  async function fetchInfo(id: string) {
    infoDetails = { id, raw: null };
    try {
      const res = await fetch(`/api/immich/assets/${id}`);
      if (!res.ok) {
        // An unlisted album's visitor has no route to the metadata: the panel keeps the
        // date and the file name it already knows.
        console.warn(`Viewer info load failed for ${id}: HTTP ${res.status}`);
        return;
      }
      const raw = (await res.json()) as ImmichAsset;
      if (infoDetails?.id === id) infoDetails = { id, raw };
    } catch (e) {
      console.error(`Viewer info load error for ${id}:`, e);
    }
  }

  function toggleInfo() {
    infoOpen = !infoOpen;
  }

  async function handleSetCover() {
    if (!albumId || !assetId || isSettingCover) return;
    isSettingCover = true;
    try {
      await setAlbumCover(albumId, assetId);
      toast.success(m.pm_cover_updated());
    } catch (e) {
      toast.error(m.common_error_detail({ error: (e as Error).message }));
    } finally {
      isSettingCover = false;
    }
  }

  async function deleteCurrentAsset(skipConfirmation = false) {
    if (!canManagePhotos || !assetId) return;
    const performDelete = async () => {
      showConfirmModal = false;
      try {
        const res = await fetch(`/api/immich/assets`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [assetId] }),
        });
        if (!res.ok && res.status !== 204) {
          const errText = await res.text().catch(() => res.statusText);
          throw new Error(errText || m.albums_delete_failed());
        }
        const nextIndexSnapshot =
          currentIndex < assets.length - 1 ? currentIndex + 1 : currentIndex - 1;
        const nextAssetId =
          nextIndexSnapshot >= 0 && nextIndexSnapshot < assets.length
            ? assets[nextIndexSnapshot].id
            : null;
        if (onAssetDeleted) onAssetDeleted(assetId);
        if (nextAssetId) assetId = nextAssetId;
        else onClose();
      } catch (e) {
        toast.error(m.albums_delete_error({ error: (e as Error).message }));
      }
    };
    if (skipConfirmation) await performDelete();
    else {
      confirmModalConfig = {
        title: m.photo_delete_title(),
        message: m.photo_trash_confirm(),
        confirmText: m.trash_to_bin(),
        onConfirm: performDelete,
      };
      showConfirmModal = true;
    }
  }

  /**
   * The overflow: info, download, cover, and delete - which lives here, never one tap away
   * (decision D4).
   */
  let overflowItems = $derived.by<OverflowMenuItem[]>(() => {
    const items: OverflowMenuItem[] = [
      { label: m.pm_info(), icon: Info, disabled: !asset, onSelect: toggleInfo },
      {
        label: m.common_download(),
        icon: Download,
        disabled: !asset || isDownloading,
        onSelect: () => void downloadAsset(),
      },
    ];
    if (canManagePhotos && albumId) {
      items.push({
        label: m.pm_set_cover(),
        icon: ImageIcon,
        disabled: !asset || isSettingCover,
        onSelect: () => void handleSetCover(),
      });
    }
    if (canManagePhotos) {
      items.push({
        label: m.trash_to_bin(),
        icon: Trash2,
        danger: true,
        disabled: !asset,
        onSelect: () => deleteCurrentAsset(false),
      });
    }
    return items;
  });

  function handleKeydown(e: KeyboardEvent) {
    // A key an open overflow menu consumed (Escape, the arrows) is not the viewer's.
    if (e.defaultPrevented) return;
    // Escape closes the info panel first, then the viewer.
    if (e.key === 'Escape' && infoOpen) infoOpen = false;
    else if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowLeft') goToPrevious();
    else if (e.key === 'ArrowRight') goToNext();
    else if (e.key === '+' || e.key === '=') stepZoom(0.5);
    else if (e.key === '-' || e.key === '_') stepZoom(-0.5);
    else if (e.key === '0') resetZoom();
    // Delete always goes through the confirm modal (no accidental Shift+Delete bypass).
    else if (e.key === 'Delete' && canManagePhotos) deleteCurrentAsset();
  }

  onMount(() => {
    canShareFiles = probeFileSharing();
    console.debug(`Viewer: file sharing ${canShareFiles ? 'available' : 'unavailable'}`);
    if (portalRoot && portalRoot.parentNode !== document.body)
      document.body.appendChild(portalRoot);
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    document.body.classList.add('modal-open');
  });

  onDestroy(() => {
    cancelSingleTap();
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    document.body.classList.remove('modal-open');
    if (portalRoot?.parentNode === document.body) {
      try {
        document.body.removeChild(portalRoot);
      } catch {}
    }
  });
</script>

<div
  bind:this={portalRoot}
  class="viewer"
  class:immersive={chromeHidden}
  class:gesture-active={gestureActive}
  class:video={isVideo}
  style="--dismiss: {dismissAmount};"
  role="dialog"
  aria-modal="true"
  aria-label={asset?.originalFileName || m.common_photo()}
  tabindex="-1"
>
  <div
    class="media-container"
    onwheel={handleWheel}
    role="img"
    aria-label={asset?.originalFileName || m.common_photo()}
    tabindex="-1"
    bind:this={containerElement}
  >
    <div class="track" bind:this={trackElement} style="transform: {trackTransform(swipeX)};">
      {#each slides as slide (slide.id)}
        {@const current = slide.offset === 0}
        {@const src = current && mediaUrl ? mediaUrl : previewUrl(slide.id)}
        <div
          class="slide"
          class:current
          class:hidden={dismissing && !current}
          style={slideStyle(slide.offset)}
        >
          {#if current && isVideo}
            {#if mediaUrl}
              <video src={mediaUrl} controls class="media loaded"><track kind="captions" /></video>
            {/if}
          {:else}
            <!-- The same element serves as neighbour then as current photo (keyed by id),
                 so a swipe never reloads what is already on screen. -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <img
              {src}
              alt={current ? asset?.originalFileName || m.common_photo() : ''}
              aria-hidden={current ? undefined : 'true'}
              class="media"
              class:loaded={loadedSrcs.has(src) || loadedSrcs.has(previewUrl(slide.id))}
              class:zoomed={current && scale > 1}
              class:no-transition={isDragging || gestureActive}
              style={current
                ? `transform: scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px); cursor: ${scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'}`
                : undefined}
              onload={() => loadedSrcs.add(src)}
              onmousedown={current ? handleMouseDown : undefined}
              ondblclick={current ? handleDoubleClick : undefined}
              draggable="false"
              decoding="async"
            />
          {/if}
        </div>
      {/each}
    </div>
  </div>

  {#if hasPrevious}
    <button
      type="button"
      class="nav-button nav-left chrome"
      inert={chromeHidden}
      onclick={goToPrevious}
      title={m.photo_previous()}
      aria-label={m.photo_previous()}
    >
      <ChevronLeft size={28} />
    </button>
  {/if}
  {#if hasNext}
    <button
      type="button"
      class="nav-button nav-right chrome"
      inert={chromeHidden}
      onclick={goToNext}
      title={m.photo_next()}
      aria-label={m.photo_next()}
    >
      <ChevronRight size={28} />
    </button>
  {/if}

  <div class="top-bar chrome" inert={chromeHidden}>
    <button
      type="button"
      class="bar-icon"
      onclick={onClose}
      title={m.pm_back()}
      aria-label={m.pm_back()}
    >
      <ArrowLeft size={24} />
    </button>
    <button
      type="button"
      class="title"
      onclick={toggleInfo}
      disabled={!asset}
      aria-expanded={infoOpen}
      title={m.pm_info()}
    >
      {#if !asset}
        <span class="title-date">{m.common_loading()}</span>
      {:else if dateTitle}
        <span class="title-date">{dateTitle.date}</span>
        <span class="title-time">{dateTitle.time}</span>
      {:else}
        <span class="title-date">{m.albums_no_date()}</span>
      {/if}
    </button>
    <div class="bar-actions">
      {#if !isVideo && mediaUrl}
        <button
          type="button"
          class="bar-icon zoom-toggle"
          onclick={toggleZoom}
          title={isZoomed(scale) ? m.pm_zoom_out() : m.pm_zoom_in()}
          aria-label={isZoomed(scale) ? m.pm_zoom_out() : m.pm_zoom_in()}
        >
          {#if isZoomed(scale)}
            <ZoomOut size={22} />
          {:else}
            <ZoomIn size={22} />
          {/if}
        </button>
      {/if}
      {#if showFavorite && asset && onFavoriteToggle}
        <button
          type="button"
          class="bar-icon"
          class:favorite={asset.isFavorite}
          onclick={async () => {
            try {
              await onFavoriteToggle!(asset!.id);
            } catch (e) {
              console.error('Viewer favourite toggle failed:', e);
              toast.error(m.pm_favorite_error());
            }
          }}
          title={asset.isFavorite ? m.pm_fav_remove() : m.pm_fav_add()}
          aria-label={asset.isFavorite ? m.pm_fav_remove() : m.pm_fav_add()}
          aria-pressed={asset.isFavorite}
        >
          <Heart size={22} fill={asset.isFavorite ? 'currentColor' : 'none'} />
        </button>
      {/if}
      <OverflowMenu items={overflowItems} variant="toolbar" iconSize={22} />
    </div>
  </div>

  <div class="bottom-bar chrome" inert={chromeHidden}>
    {#if canShareFiles}
      <button type="button" class="bar-action" onclick={shareAsset} disabled={!asset || isSharing}>
        <Share2 size={22} />
        <span>{m.pm_share()}</span>
      </button>
    {/if}
    <button
      type="button"
      class="bar-action"
      onclick={downloadAsset}
      disabled={!asset || isDownloading}
    >
      <Download size={22} />
      <span>{m.common_download()}</span>
    </button>
  </div>

  {#if infoOpen && asset}
    <aside class="info-panel" aria-label={m.pm_info()}>
      <div class="info-header">
        <h2>{m.pm_info()}</h2>
        <button
          type="button"
          class="bar-icon"
          onclick={toggleInfo}
          title={m.common_close()}
          aria-label={m.common_close()}
        >
          <X size={22} />
        </button>
      </div>
      <ul class="info-rows">
        {#each infoLines as line (line.label)}
          <li aria-label={line.label}>
            <line.icon size={22} />
            <div>
              <p class="info-value">{line.value}</p>
              {#if line.detail}<p class="info-detail">{line.detail}</p>{/if}
            </div>
          </li>
        {/each}
      </ul>
    </aside>
  {/if}
</div>

{#if showConfirmModal && confirmModalConfig}
  <Modal
    bind:show={showConfirmModal}
    title={confirmModalConfig.title}
    type="confirm"
    confirmText={confirmModalConfig.confirmText}
    onConfirm={confirmModalConfig.onConfirm}
    onCancel={() => (showConfirmModal = false)}
  >
    <p>{confirmModalConfig.message}</p>
  </Modal>
{/if}

<style>
  /* Full-screen black, edge to edge, no frame (Google Photos). `--dismiss` (0..1) is how far a
     swipe-down has gone: the black and the bars fade with it, revealing the grid underneath. */
  .viewer {
    --bar-height: 3.5rem;
    --bottom-bar-height: 4.25rem;
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgb(0 0 0 / calc(1 - var(--dismiss, 0)));
    color: white;
    overflow: hidden;
    animation: fadeIn 0.2s ease-out;
  }
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* The bars float over the photo and fade in and out with the tap. */
  .chrome {
    opacity: calc(1 - var(--dismiss, 0));
    transition: opacity 0.2s ease;
  }
  .immersive .chrome {
    opacity: 0;
    pointer-events: none;
  }
  /* A finger drives the fade: no easing lag behind it. */
  .gesture-active,
  .gesture-active .chrome {
    transition: none;
  }

  /* On a computer the bar breathes: its title used to hug the screen's corner (user, 2026-09-26). */
  @media (min-width: 769px) {
    .viewer {
      --bar-height: 4.5rem;
    }
    /* `.viewer .top-bar`: the base rule below sets the padding shorthand and would win a tie. */
    .viewer .top-bar {
      padding-left: 1rem;
      padding-right: 1rem;
      gap: 0.75rem;
    }
  }

  .top-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-height: var(--bar-height);
    padding: env(safe-area-inset-top) 0.25rem 0;
    background: rgb(0 0 0 / 0.4);
  }
  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 0.25rem 0.5rem;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .title:hover:not(:disabled) {
    background: rgb(255 255 255 / 0.08);
  }
  .title-date,
  .title-time {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title-date {
    font-size: 1rem;
    font-weight: 500;
    line-height: 1.3;
  }
  /* "dim. 13 sept." starts the title: only its first letter is raised, not every word's. */
  .title-date::first-letter {
    text-transform: uppercase;
  }
  .title-time {
    font-size: 0.8125rem;
    line-height: 1.3;
    color: rgb(255 255 255 / 0.75);
  }
  .bar-actions {
    display: flex;
    align-items: center;
    gap: 0.125rem;
  }
  .bar-icon {
    width: 2.75rem;
    height: 2.75rem;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }
  .bar-icon:hover {
    background: rgb(255 255 255 / 0.1);
  }
  .bar-icon.favorite {
    color: var(--error);
  }

  .bottom-bar {
    display: none;
  }
  .bar-action {
    flex: 1;
    max-width: 7rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .bar-action:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .media-container {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    user-select: none;
    touch-action: none;
  }
  /* The carousel: the current photo and its two neighbours side by side. */
  .track {
    position: absolute;
    inset: 0;
    will-change: transform;
  }
  .slide {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .slide.hidden {
    visibility: hidden;
  }
  .media {
    width: 100%;
    height: 100%;
    object-fit: contain;
    opacity: 0;
    transition:
      opacity 0.3s ease,
      transform 160ms cubic-bezier(0.2, 0, 0, 1);
    will-change: transform;
    transform-origin: center center;
  }
  .media.loaded {
    opacity: 1;
  }
  .media.no-transition {
    transition: none !important;
  }

  .nav-button {
    position: absolute;
    top: 50%;
    z-index: 10;
    width: 3rem;
    height: 3rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: rgb(0 0 0 / 0.5);
    color: white;
    cursor: pointer;
    transform: translateY(-50%);
    transition:
      opacity 0.2s ease,
      background-color 0.15s ease;
  }
  .nav-button:hover {
    background: rgb(0 0 0 / 0.75);
  }
  .nav-left {
    left: 1rem;
  }
  .nav-right {
    right: 1rem;
  }

  .info-panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    width: min(22rem, 100%);
    padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom);
    overflow-y: auto;
    background: var(--bg-elevated);
    color: var(--text-primary);
    border-left: 1px solid var(--border);
    /* It slides in from the side it lives on (a bottom sheet on a phone, below). */
    animation: info-in-side 0.22s cubic-bezier(0.2, 0, 0, 1);
  }
  @keyframes info-in-side {
    from {
      transform: translateX(100%);
    }
  }
  @keyframes info-in-up {
    from {
      transform: translateY(100%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .info-panel {
      animation: none !important;
    }
  }
  .info-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: var(--bar-height);
    padding: 0 0.25rem 0 1rem;
  }
  .info-header h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }
  .info-rows {
    list-style: none;
    margin: 0;
    padding: 0.5rem 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .info-rows li {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    color: var(--text-secondary);
  }
  .info-rows li > div {
    min-width: 0;
  }
  .info-value {
    margin: 0;
    color: var(--text-primary);
    font-size: 0.9375rem;
    overflow-wrap: anywhere;
  }
  .info-detail {
    margin: 0.125rem 0 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }

  /* A touch screen swipes between photos: no arrows, and no zoom icon (pinch, double-tap). */
  @media (hover: none) {
    .nav-button,
    .zoom-toggle {
      display: none;
    }
  }

  @media (max-width: 768px) {
    .bottom-bar {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 10;
      display: flex;
      justify-content: space-around;
      min-height: var(--bottom-bar-height);
      padding: 0.25rem 0.5rem env(safe-area-inset-bottom);
      background: rgb(0 0 0 / 0.4);
    }
    /* A video's native controls sit at its bottom edge: keep them clear of the bar. */
    .video .media-container {
      bottom: calc(var(--bottom-bar-height) + env(safe-area-inset-bottom));
    }
    /* The info panel is a bottom sheet on a phone, over the lower part of the photo. */
    .info-panel {
      top: auto;
      left: 0;
      width: 100%;
      max-height: 60%;
      padding-top: 0;
      border-left: none;
      border-top: 1px solid var(--border);
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      animation-name: info-in-up;
    }
  }
</style>
