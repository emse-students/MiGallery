/**
 * Layout maths for the photo grid (`PhotosGrid.svelte`): justified rows, grouped by day, and
 * the windowing that keeps only the rows on screen in the DOM.
 *
 * Everything here is PURE: the component feeds it aspect ratios, a container width and a
 * scroll window, and positions what comes back. That is what lets `tests/photo-grid-layout.test.ts`
 * pin the three promises of a justified grid - every full row fills the width exactly, the last
 * row is not stretched, and no photo is cropped out of its aspect ratio - without a browser.
 * The targets are measured against Google Photos on `docs/wiki/ui-redesign.md` (#7, #8, #24).
 */

/** Used when a photo carries no usable dimensions: the commonest camera ratio. */
export const FALLBACK_ASPECT_RATIO = 3 / 2;

/** Row heights and gaps per layout, in CSS px. Google Photos: 304-373 px rows, 4 px gap on desktop. */
export const GRID_METRICS = {
  desktop: { targetRowHeight: 300, gap: 4, dayHeaderHeight: 56 },
  /**
   * Phone: 140 px keeps a Google-like two landscape photos per row on a 393 px screen, and keeps
   * a 3:2 tile inside Immich's 400 px `thumbnail` at DPR 2.75 (140 x 2.75 = 385 device px).
   */
  phone: { targetRowHeight: 140, gap: 2, dayHeaderHeight: 48 },
} as const;

/** The layout switches to the phone metrics at or below this container width. */
export const PHONE_MAX_WIDTH = 768;

export type GridMetrics = (typeof GRID_METRICS)[keyof typeof GRID_METRICS];

/** One photo placed in a row: `index` into the input list, `x` from the row's left edge. */
export interface JustifiedTile {
  index: number;
  x: number;
  width: number;
}

/** One row: its offset from the top of the layout, its height and its tiles. */
export interface JustifiedRow {
  y: number;
  height: number;
  tiles: JustifiedTile[];
}

export interface JustifiedLayout {
  rows: JustifiedRow[];
  /** Total height, gaps between rows included, no trailing gap. */
  height: number;
}

export interface JustifyOptions {
  containerWidth: number;
  targetRowHeight: number;
  /** Space between two tiles of a row, and between two rows. */
  gap: number;
}

/** A ratio the layout can divide by; anything else (0, negative, NaN, Infinity) falls back. */
function usableRatio(ratio: number): number {
  return Number.isFinite(ratio) && ratio > 0 ? ratio : FALLBACK_ASPECT_RATIO;
}

/** The height a row of these ratios must take to fill `width` exactly, gaps included. */
function fillHeight(ratioSum: number, count: number, width: number, gap: number): number {
  return (width - gap * (count - 1)) / ratioSum;
}

/**
 * Places `ratios` (width / height) in justified rows.
 *
 * A row takes photos while its fill height stays above the target, then closes on whichever
 * of "with the next photo" or "without it" lands closer to the target - so a closed row's
 * height stays within a factor of two of the target, and each tile keeps its aspect ratio
 * (width = ratio x row height). The last tile of a full row takes what is left of the width, so
 * the row fills it EXACTLY despite float rounding. The final row, left incomplete, is NOT
 * stretched: it keeps the target height and its natural widths.
 */
export function justifyRows(ratios: readonly number[], options: JustifyOptions): JustifiedLayout {
  const { containerWidth: width, targetRowHeight: target, gap } = options;
  const rows: JustifiedRow[] = [];
  if (width <= 0 || ratios.length === 0) return { rows, height: 0 };

  let y = 0;
  let start = 0;
  let sum = 0;

  const closeRow = (end: number, height: number, fill: boolean) => {
    const tiles: JustifiedTile[] = [];
    let x = 0;
    for (let i = start; i < end; i++) {
      const isLastFilled = fill && i === end - 1;
      const tileWidth = isLastFilled ? width - x : usableRatio(ratios[i]) * height;
      tiles.push({ index: i, x, width: tileWidth });
      x += tileWidth + gap;
    }
    rows.push({ y, height, tiles });
    y += height + gap;
  };

  for (let i = 0; i < ratios.length; i++) {
    const ratio = usableRatio(ratios[i]);
    const count = i - start + 1;
    const withNext = fillHeight(sum + ratio, count, width, gap);
    if (withNext > target) {
      sum += ratio;
      continue;
    }
    // Adding photo i brings the row to or under the target: close it with or without i.
    const withoutNext = count > 1 ? fillHeight(sum, count - 1, width, gap) : Infinity;
    if (withoutNext - target < target - withNext) {
      closeRow(i, withoutNext, true);
      start = i;
      sum = ratio;
    } else {
      closeRow(i + 1, withNext, true);
      start = i + 1;
      sum = 0;
    }
  }
  if (start < ratios.length) {
    // The incomplete last row keeps the target height - unless even that overflows the width
    // (a lone panorama on a phone), in which case it is fitted to the width like any row.
    const fit = fillHeight(sum, ratios.length - start, width, gap);
    if (fit < target) closeRow(ratios.length, fit, true);
    else closeRow(ratios.length, target, false);
  }

  return { rows, height: Math.max(0, y - gap) };
}

/** The dimensions an asset may carry, in the order they are trusted. */
export interface AssetDimensions {
  exifInfo?: { exifImageWidth?: number; exifImageHeight?: number } | null;
  width?: number | null;
  height?: number | null;
  _raw?: {
    exifInfo?: { exifImageWidth?: number; exifImageHeight?: number } | null;
    width?: number | null;
    height?: number | null;
  } | null;
}

/**
 * An asset's width / height ratio: EXIF first (a fully loaded asset), then the slim stream's
 * top-level `width` / `height` (`docs/wiki/bandwidth.md`), else {@link FALLBACK_ASPECT_RATIO}.
 */
export function assetAspectRatio(asset: AssetDimensions): number {
  const candidates = [
    [asset.exifInfo?.exifImageWidth, asset.exifInfo?.exifImageHeight],
    [asset._raw?.exifInfo?.exifImageWidth, asset._raw?.exifInfo?.exifImageHeight],
    [asset._raw?.width, asset._raw?.height],
    [asset.width, asset.height],
  ];
  for (const [w, h] of candidates) {
    if (w && h && w > 0 && h > 0) return w / h;
  }
  return FALLBACK_ASPECT_RATIO;
}

/** A day of photos as the grid receives it: its label and its items, in display order. */
export interface DayGroup<T> {
  label: string;
  items: T[];
}

/** One windowable block of the grid: a day header, or a row of that day. */
export type GridBlock =
  | { kind: 'header'; key: string; day: number; y: number; height: number }
  | { kind: 'row'; key: string; day: number; y: number; height: number; row: JustifiedRow };

/**
 * Stacks the days into absolutely positioned blocks - a header, then that day's justified rows
 * - and returns them with the total height. Row keys are the day plus the first tile's index,
 * so a row that keeps its first photo keeps its DOM node when more photos stream in.
 */
export function buildGridBlocks(
  dayRatios: readonly (readonly number[])[],
  containerWidth: number,
  metrics: GridMetrics
): { blocks: GridBlock[]; height: number } {
  const blocks: GridBlock[] = [];
  let y = 0;
  dayRatios.forEach((ratios, day) => {
    blocks.push({ kind: 'header', key: `h${day}`, day, y, height: metrics.dayHeaderHeight });
    y += metrics.dayHeaderHeight;
    const layout = justifyRows(ratios, {
      containerWidth,
      targetRowHeight: metrics.targetRowHeight,
      gap: metrics.gap,
    });
    for (const row of layout.rows) {
      blocks.push({
        kind: 'row',
        key: `r${day}-${row.tiles[0].index}`,
        day,
        y: y + row.y,
        height: row.height,
        row,
      });
    }
    // One gap under the last row, so the next header does not touch it.
    if (layout.rows.length > 0) y += layout.height + metrics.gap;
  });
  return { blocks, height: y };
}

/**
 * The blocks that intersect the window `[top, bottom]` (px from the top of the grid), found by
 * binary search since blocks are sorted by `y`. Returns a slice `[start, end)`.
 */
export function visibleBlockRange(
  blocks: readonly GridBlock[],
  top: number,
  bottom: number
): { start: number; end: number } {
  let lo = 0;
  let hi = blocks.length;
  // First block whose bottom edge is below `top`.
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].y + blocks[mid].height < top) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;
  let end = start;
  while (end < blocks.length && blocks[end].y <= bottom) end++;
  return { start, end };
}
