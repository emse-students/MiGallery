/**
 * Touch gesture maths for the photo viewer (`PhotoModal.svelte`).
 *
 * Everything here is PURE: the component feeds it coordinates and timestamps and applies
 * what comes back. That is what lets the classifier, the snap decisions and the zoom maths be
 * pinned by `tests/viewer-gestures.test.ts` without a browser. The reasoning behind every
 * threshold is in `docs/wiki/viewer.md`.
 *
 * Coordinates: pointer positions are client pixels; zoom anchors and translations are pixels
 * relative to the CENTRE of the media container, because the image is centred and scaled
 * around its centre (`transform-origin: center`).
 */

/** A 2D point or offset, in CSS pixels. */
export interface Point {
  x: number;
  y: number;
}

/** A pointer sample: where the finger was, and when (ms, any monotonic clock). */
export interface Sample extends Point {
  t: number;
}

/** The zoom state of the image: a scale around the centre, then a translation. */
export interface ZoomState {
  scale: number;
  translate: Point;
}

/** A width and a height, in CSS pixels. */
export interface Size {
  width: number;
  height: number;
}

/**
 * What a touch sequence is, once it has said enough:
 * - `pending`: still inside the tap slop, nothing decided yet;
 * - `swipe-h`: horizontal drag on an unzoomed photo (previous / next);
 * - `swipe-down`: downward drag on an unzoomed photo (close);
 * - `swipe-up`: upward drag on an unzoomed photo (reserved for an info panel, ignored today);
 * - `pan`: one-finger drag on a zoomed photo;
 * - `pinch`: two fingers or more.
 */
export type GestureKind = 'pending' | 'swipe-h' | 'swipe-down' | 'swipe-up' | 'pan' | 'pinch';

/** Where a released horizontal swipe goes. */
export type SwipeDecision = 'next' | 'previous' | 'stay';

/**
 * Every tunable of the viewer's gestures, in one place.
 * Distances are CSS px, durations ms, velocities px/ms.
 */
export const GESTURE = {
  /** Movement under which a touch is still a tap (Android's touch slop is 8 dp). */
  TAP_SLOP_PX: 10,
  /** A press held longer than this is not a tap. */
  TAP_MAX_MS: 300,
  /**
   * Max gap between two taps for a double-tap, and therefore how long a single tap waits
   * before it is confirmed as single. 250 ms is the usual web figure (Android uses 300).
   */
  DOUBLE_TAP_MS: 250,
  /** Max distance between the two taps of a double-tap. */
  DOUBLE_TAP_SLOP_PX: 50,
  /** Scale a double-tap zooms to. */
  DOUBLE_TAP_SCALE: 2.5,
  /** Above this scale the photo counts as zoomed: one finger pans, swipes are off. */
  ZOOMED_EPSILON: 1.01,
  /** Min and max scale a pinch can reach (below 1 springs back on release). */
  MIN_SCALE: 0.5,
  MAX_SCALE: 5,
  /** A horizontal swipe released past this fraction of the width commits. */
  SWIPE_COMMIT_RATIO: 0.25,
  /** A swipe released faster than this commits whatever its distance (a flick)... */
  FLICK_VELOCITY: 0.4,
  /** ...provided it travelled at least this far (ViewPager's MIN_DISTANCE_FOR_FLING, 25 dp). */
  FLICK_MIN_DISTANCE_PX: 24,
  /** A downward drag released past this fraction of the height closes the viewer. */
  DISMISS_COMMIT_RATIO: 0.2,
  /** The drag distance, as a fraction of the height, at which the backdrop is fully faded. */
  DISMISS_FADE_RATIO: 0.5,
  /** How much the photo shrinks at full dismiss progress (1 - this). */
  DISMISS_SHRINK: 0.25,
  /** Dragging past the first / last photo moves the image this fraction of the finger. */
  EDGE_RESISTANCE: 0.3,
  /** Only samples this recent are used to measure release velocity. */
  VELOCITY_WINDOW_MS: 100,
  /** Duration of every snap / spring-back animation (0 under prefers-reduced-motion). */
  SETTLE_MS: 220,
} as const;

/** Clamps `value` into `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** True when `scale` is far enough above 1 for the photo to count as zoomed. */
export function isZoomed(scale: number): boolean {
  return scale > GESTURE.ZOOMED_EPSILON;
}

/**
 * Classifies a touch sequence from its displacement since the first finger landed.
 * Stays `pending` inside the tap slop; once out of it, the answer is final for the sequence
 * (the caller locks it), so a swipe that curves does not change nature half-way.
 */
export function classifyMove(input: {
  dx: number;
  dy: number;
  zoomed: boolean;
  touches: number;
}): GestureKind {
  const { dx, dy, zoomed, touches } = input;
  if (touches >= 2) return 'pinch';
  if (Math.hypot(dx, dy) < GESTURE.TAP_SLOP_PX) return 'pending';
  if (zoomed) return 'pan';
  if (Math.abs(dx) > Math.abs(dy)) return 'swipe-h';
  return dy > 0 ? 'swipe-down' : 'swipe-up';
}

/** True when a press from `start` to `end` stayed short and still enough to be a tap. */
export function isTap(start: Sample, end: Sample): boolean {
  return (
    end.t - start.t <= GESTURE.TAP_MAX_MS &&
    Math.hypot(end.x - start.x, end.y - start.y) < GESTURE.TAP_SLOP_PX
  );
}

/** True when `tap` completes a double-tap begun by `previous` (close in time and space). */
export function isDoubleTap(previous: Sample | null, tap: Sample): boolean {
  if (!previous) return false;
  return (
    tap.t - previous.t <= GESTURE.DOUBLE_TAP_MS &&
    Math.hypot(tap.x - previous.x, tap.y - previous.y) <= GESTURE.DOUBLE_TAP_SLOP_PX
  );
}

/**
 * Release velocity from the most recent samples (oldest first). Only the last
 * `VELOCITY_WINDOW_MS` count, so a slow drag ended by a flick reads as the flick.
 */
export function releaseVelocity(samples: readonly Sample[]): Point {
  if (samples.length < 2) return { x: 0, y: 0 };
  const last = samples[samples.length - 1];
  let first = samples[samples.length - 2];
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t > GESTURE.VELOCITY_WINDOW_MS) break;
    first = samples[i];
  }
  const dt = last.t - first.t;
  if (dt <= 0) return { x: 0, y: 0 };
  return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
}

/**
 * Where the image sits while a horizontal swipe is being dragged: it follows the finger 1:1
 * towards an existing neighbour, and with resistance past the first or last photo.
 */
export function dragOffset(dx: number, hasPrevious: boolean, hasNext: boolean): number {
  const towardsNeighbour = dx < 0 ? hasNext : hasPrevious;
  return towardsNeighbour ? dx : dx * GESTURE.EDGE_RESISTANCE;
}

/**
 * Decides where a released horizontal swipe goes. A swipe LEFT (`dx < 0`) shows the next
 * photo. It commits past `SWIPE_COMMIT_RATIO` of the width, or on a flick in the SAME
 * direction as the drag (a drag flicked back is a change of mind, and stays).
 */
export function decideSwipe(input: {
  dx: number;
  velocityX: number;
  width: number;
  hasPrevious: boolean;
  hasNext: boolean;
}): SwipeDecision {
  const { dx, velocityX, width, hasPrevious, hasNext } = input;
  const decision: SwipeDecision = dx < 0 ? 'next' : 'previous';
  if (dx === 0) return 'stay';
  if (decision === 'next' ? !hasNext : !hasPrevious) return 'stay';
  const far = Math.abs(dx) >= width * GESTURE.SWIPE_COMMIT_RATIO;
  const flick =
    Math.abs(velocityX) >= GESTURE.FLICK_VELOCITY &&
    Math.sign(velocityX) === Math.sign(dx) &&
    Math.abs(dx) >= GESTURE.FLICK_MIN_DISTANCE_PX;
  return far || flick ? decision : 'stay';
}

/**
 * Decides whether a released downward drag closes the viewer: past `DISMISS_COMMIT_RATIO`
 * of the height, or on a downward flick.
 */
export function decideDismiss(input: { dy: number; velocityY: number; height: number }): boolean {
  const { dy, velocityY, height } = input;
  if (dy <= 0) return false;
  if (dy >= height * GESTURE.DISMISS_COMMIT_RATIO) return true;
  return velocityY >= GESTURE.FLICK_VELOCITY && dy >= GESTURE.FLICK_MIN_DISTANCE_PX;
}

/**
 * How far a downward drag has gone towards closing, in `[0, 1]`. Drives both the backdrop
 * fade (`1 - progress`) and the photo's shrink (`dismissScale`).
 */
export function dismissProgress(dy: number, height: number): number {
  if (height <= 0) return 0;
  return clamp(dy / (height * GESTURE.DISMISS_FADE_RATIO), 0, 1);
}

/** The photo's scale at a given dismiss progress. */
export function dismissScale(progress: number): number {
  return 1 - GESTURE.DISMISS_SHRINK * clamp(progress, 0, 1);
}

/**
 * Zooms to `targetScale` keeping the image point under `anchor` (relative to the container
 * centre) where it is. Multiplicative: the translation is scaled by the same ratio as the
 * image, around the anchor, so repeated zooms compose without drift.
 */
export function zoomAt(state: ZoomState, targetScale: number, anchor: Point): ZoomState {
  const k = targetScale / state.scale;
  return {
    scale: targetScale,
    translate: {
      x: anchor.x + (state.translate.x - anchor.x) * k,
      y: anchor.y + (state.translate.y - anchor.y) * k,
    },
  };
}

/**
 * The double-tap toggle: an unzoomed photo zooms to `DOUBLE_TAP_SCALE` on the tapped point,
 * a zoomed one resets to 1 and recentres.
 */
export function doubleTapZoom(state: ZoomState, anchor: Point): ZoomState {
  if (isZoomed(state.scale)) return { scale: 1, translate: { x: 0, y: 0 } };
  return zoomAt(state, GESTURE.DOUBLE_TAP_SCALE, anchor);
}

/** The first frame of a pinch: the zoom it started from, and where the two fingers were. */
export interface PinchStart {
  zoom: ZoomState;
  /** Midpoint of the two fingers, relative to the container centre. */
  midpoint: Point;
  /** Distance between the two fingers. */
  distance: number;
}

/**
 * The zoom during a pinch. The scale is the start scale times the finger spread ratio,
 * clamped; the image point that was under the starting midpoint follows the CURRENT midpoint,
 * so the pinch is anchored where the fingers are and a two-finger drag pans.
 */
export function pinchZoom(start: PinchStart, midpoint: Point, distance: number): ZoomState {
  if (start.distance <= 0) return start.zoom;
  const scale = clamp(
    start.zoom.scale * (distance / start.distance),
    GESTURE.MIN_SCALE,
    GESTURE.MAX_SCALE
  );
  const k = scale / start.zoom.scale;
  return {
    scale,
    translate: {
      x: midpoint.x + (start.zoom.translate.x - start.midpoint.x) * k,
      y: midpoint.y + (start.zoom.translate.y - start.midpoint.y) * k,
    },
  };
}

/** The size an image of `natural` size takes inside `container` with `object-fit: contain`. */
export function containSize(natural: Size, container: Size): Size {
  if (natural.width <= 0 || natural.height <= 0) return container;
  const imageAspect = natural.width / natural.height;
  const containerAspect = container.width / container.height;
  return imageAspect > containerAspect
    ? { width: container.width, height: container.width / imageAspect }
    : { width: container.height * imageAspect, height: container.height };
}

/**
 * Keeps a zoomed photo covering the container: the translation may not reveal more than the
 * scaled image's overflow on either side. An unzoomed photo is always centred.
 */
export function clampTranslate(
  translate: Point,
  scale: number,
  displayed: Size,
  container: Size
): Point {
  if (scale <= 1) return { x: 0, y: 0 };
  const maxX = Math.max(0, (displayed.width * scale - container.width) / 2);
  const maxY = Math.max(0, (displayed.height * scale - container.height) / 2);
  return { x: clamp(translate.x, -maxX, maxX), y: clamp(translate.y, -maxY, maxY) };
}
