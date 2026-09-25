/**
 * The phone grid's density: how many photos a justified row holds, changed by a pinch
 * (`docs/wiki/photo-grid.md#density-and-the-pinch`).
 *
 * The step logic is PURE (pinned by `tests/grid-density.test.ts`); the two storage helpers take
 * the `Storage` they use, so the tests hand them a fake and the component hands them
 * `localStorage`.
 */

/**
 * Target row heights on a phone, densest last. On a 393 px screen with 2 px gaps a row of 3:2
 * photos is 130 px tall with 2 of them, 86 px with 3 and 64 px with 4; each target sits where
 * the row maths (which close a row on the height nearest the target) land on that count.
 */
export const PHONE_DENSITY_STEPS = [
  { name: 'large', targetRowHeight: 140 },
  { name: 'default', targetRowHeight: 90 },
  { name: 'dense', targetRowHeight: 62 },
] as const;

/** The step a viewer starts on: three landscape photos a row, Google Photos' phone default. */
export const DEFAULT_PHONE_DENSITY = 1;

/** A pinch changes density once its finger distance has grown or shrunk by this factor. */
export const PINCH_STEP_RATIO = 1.25;

/** Where the chosen step is remembered, per browser. */
export const DENSITY_STORAGE_KEY = 'migallery.grid.phoneDensity';

/** A valid step index, or the default. */
export function clampDensity(index: number): number {
  return Number.isInteger(index) && index >= 0 && index < PHONE_DENSITY_STEPS.length
    ? index
    : DEFAULT_PHONE_DENSITY;
}

/**
 * The step after a pinch whose finger distance is `scale` times its start. Spreading the
 * fingers (`scale >= PINCH_STEP_RATIO`) zooms IN: bigger tiles, fewer a row. Pinching them
 * (`scale <= 1 / PINCH_STEP_RATIO`) zooms OUT. Anything between changes nothing, and the ends
 * of the scale hold.
 */
export function densityAfterPinch(index: number, scale: number): number {
  const current = clampDensity(index);
  if (!Number.isFinite(scale) || scale <= 0) return current;
  if (scale >= PINCH_STEP_RATIO) return Math.max(0, current - 1);
  if (scale <= 1 / PINCH_STEP_RATIO) return Math.min(PHONE_DENSITY_STEPS.length - 1, current + 1);
  return current;
}

/** The remembered step; a missing, foreign or unreadable value (private mode) is the default. */
export function loadDensity(storage: Pick<Storage, 'getItem'> | undefined): number {
  try {
    const raw = storage?.getItem(DENSITY_STORAGE_KEY);
    return raw == null ? DEFAULT_PHONE_DENSITY : clampDensity(Number(raw));
  } catch (e) {
    console.warn('[grid-density] could not read the remembered density:', e);
    return DEFAULT_PHONE_DENSITY;
  }
}

/** Remembers the step; a storage that refuses (private mode, quota) only loses the memory. */
export function saveDensity(storage: Pick<Storage, 'setItem'> | undefined, index: number): void {
  try {
    storage?.setItem(DENSITY_STORAGE_KEY, String(clampDensity(index)));
  } catch (e) {
    console.warn('[grid-density] could not remember the density:', e);
  }
}
