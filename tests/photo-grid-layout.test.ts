/**
 * The photo grid's layout maths (`src/lib/photo-grid-layout.ts`).
 *
 * Pure functions, no server needed. What this pins is what a screenshot cannot prove at every
 * width: each full row fills the container EXACTLY, the last row is not stretched, and no photo
 * leaves its aspect ratio - plus the windowing that keeps only on-screen rows in the DOM.
 */

import { describe, it, expect } from 'vitest';
import {
  FALLBACK_ASPECT_RATIO,
  GRID_METRICS,
  assetAspectRatio,
  buildGridBlocks,
  justifyRows,
  visibleBlockRange,
  type JustifiedRow,
} from '$lib/photo-grid-layout';

const EPS = 1e-6;

/** Right edge of a row: last tile's x + width. */
function rowRight(row: JustifiedRow): number {
  const last = row.tiles[row.tiles.length - 1];
  return last.x + last.width;
}

/** A deterministic mix of landscape, portrait, square and panorama ratios. */
function mixedRatios(count: number): number[] {
  const pool = [3 / 2, 2 / 3, 1, 4 / 3, 3 / 4, 16 / 9, 3 / 2, 3 / 2, 2 / 3, 3];
  return Array.from({ length: count }, (_, i) => pool[(i * 7) % pool.length]);
}

describe('justifyRows', () => {
  const widths = [361, 393, 768, 1200, 1352];
  const cases = [
    { name: 'desktop', ...GRID_METRICS.desktop },
    { name: 'phone', ...GRID_METRICS.phone },
  ];

  for (const { name, targetRowHeight, gap } of cases) {
    for (const containerWidth of widths) {
      it(`${name} @${containerWidth}px: every full row fills the width exactly`, () => {
        const ratios = mixedRatios(97);
        const { rows } = justifyRows(ratios, { containerWidth, targetRowHeight, gap });
        for (const row of rows.slice(0, -1)) {
          expect(Math.abs(rowRight(row) - containerWidth)).toBeLessThan(EPS);
        }
      });

      it(`${name} @${containerWidth}px: tiles keep their aspect ratio and never overlap`, () => {
        const ratios = mixedRatios(97);
        const { rows } = justifyRows(ratios, { containerWidth, targetRowHeight, gap });
        for (const row of rows) {
          row.tiles.forEach((tile, k) => {
            // The last tile absorbs float rounding only: well under a pixel.
            expect(Math.abs(tile.width - ratios[tile.index] * row.height)).toBeLessThan(0.01);
            if (k > 0) {
              const prev = row.tiles[k - 1];
              expect(tile.x - (prev.x + prev.width)).toBeCloseTo(gap, 6);
            }
          });
        }
      });
    }
  }

  it('places every photo once, in order', () => {
    const ratios = mixedRatios(250);
    const { rows } = justifyRows(ratios, { containerWidth: 1200, targetRowHeight: 300, gap: 4 });
    const indices = rows.flatMap((r) => r.tiles.map((t) => t.index));
    expect(indices).toEqual(ratios.map((_, i) => i));
  });

  it('keeps closed rows near the target height (within a factor of two)', () => {
    const { rows } = justifyRows(mixedRatios(400), {
      containerWidth: 1352,
      targetRowHeight: 300,
      gap: 4,
    });
    for (const row of rows.slice(0, -1)) {
      expect(row.height).toBeGreaterThan(150);
      expect(row.height).toBeLessThan(600);
    }
  });

  it('does not stretch the last row: it keeps the target height and natural widths', () => {
    // Three landscapes on 1200 px at 300 px would be 3 x 450 = 1350: two fill a row, one is left.
    const ratios = [3 / 2, 3 / 2, 3 / 2, 3 / 2, 3 / 2];
    const { rows } = justifyRows(ratios, { containerWidth: 1200, targetRowHeight: 300, gap: 4 });
    const last = rows[rows.length - 1];
    expect(last.height).toBe(300);
    expect(last.tiles.every((t) => Math.abs(t.width - 450) < EPS)).toBe(true);
    expect(rowRight(last)).toBeLessThan(1200);
  });

  it('fits a last row to the width when even the target height would overflow it', () => {
    // A lone 5:1 panorama on a phone: 5 x 140 = 700 px > 393 px.
    const { rows } = justifyRows([5], { containerWidth: 393, targetRowHeight: 140, gap: 2 });
    expect(rows).toHaveLength(1);
    expect(rowRight(rows[0])).toBeCloseTo(393, 6);
    expect(rows[0].height).toBeCloseTo(393 / 5, 6);
  });

  it('stacks rows with one gap between them and reports the total height', () => {
    const layout = justifyRows(mixedRatios(60), {
      containerWidth: 800,
      targetRowHeight: 200,
      gap: 4,
    });
    layout.rows.forEach((row, i) => {
      if (i > 0) {
        const prev = layout.rows[i - 1];
        expect(row.y).toBeCloseTo(prev.y + prev.height + 4, 6);
      }
    });
    const last = layout.rows[layout.rows.length - 1];
    expect(layout.height).toBeCloseTo(last.y + last.height, 6);
  });

  it('treats an unusable ratio as the fallback instead of breaking the row', () => {
    const { rows } = justifyRows([0, Number.NaN, Infinity, -2], {
      containerWidth: 1200,
      targetRowHeight: 300,
      gap: 4,
    });
    const tiles = rows.flatMap((r) => r.tiles.map((t) => ({ t, h: r.height })));
    for (const { t, h } of tiles) {
      expect(t.width / h).toBeCloseTo(FALLBACK_ASPECT_RATIO, 2);
    }
  });

  it('returns nothing for an empty list or an unmeasured container', () => {
    expect(justifyRows([], { containerWidth: 800, targetRowHeight: 300, gap: 4 }).rows).toEqual([]);
    expect(justifyRows([1.5], { containerWidth: 0, targetRowHeight: 300, gap: 4 }).rows).toEqual(
      []
    );
  });
});

describe('assetAspectRatio', () => {
  it('trusts EXIF first, then the raw EXIF, then the stream dimensions', () => {
    expect(assetAspectRatio({ exifInfo: { exifImageWidth: 400, exifImageHeight: 600 } })).toBe(
      400 / 600
    );
    expect(
      assetAspectRatio({ _raw: { exifInfo: { exifImageWidth: 300, exifImageHeight: 100 } } })
    ).toBe(3);
    expect(assetAspectRatio({ _raw: { width: 1600, height: 900 } })).toBe(16 / 9);
    expect(assetAspectRatio({ width: 1000, height: 1000 })).toBe(1);
  });

  it('falls back when no dimension is usable', () => {
    expect(assetAspectRatio({})).toBe(FALLBACK_ASPECT_RATIO);
    expect(assetAspectRatio({ width: 0, height: 100 })).toBe(FALLBACK_ASPECT_RATIO);
  });
});

describe('buildGridBlocks + visibleBlockRange', () => {
  const metrics = GRID_METRICS.desktop;
  const days = [mixedRatios(40), mixedRatios(7), mixedRatios(120)];

  it('puts a header before each day and stacks every block without overlap', () => {
    const { blocks, height } = buildGridBlocks(days, 1200, metrics);
    expect(blocks.filter((b) => b.kind === 'header').map((b) => b.day)).toEqual([0, 1, 2]);
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i].y).toBeGreaterThanOrEqual(blocks[i - 1].y + blocks[i - 1].height - EPS);
    }
    const last = blocks[blocks.length - 1];
    expect(height).toBeCloseTo(last.y + last.height + metrics.gap, 6);
    const placed = blocks.reduce((n, b) => n + (b.kind === 'row' ? b.row.tiles.length : 0), 0);
    expect(placed).toBe(167);
  });

  it('keeps unique keys, so the DOM can reuse a row across renders', () => {
    const { blocks } = buildGridBlocks(days, 1200, metrics);
    expect(new Set(blocks.map((b) => b.key)).size).toBe(blocks.length);
  });

  it('windows exactly the blocks that intersect the scroll window', () => {
    const { blocks, height } = buildGridBlocks(days, 1200, metrics);
    for (const top of [0, 500, 3000, height - 900]) {
      const bottom = top + 900;
      const { start, end } = visibleBlockRange(blocks, top, bottom);
      const expected = blocks
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => b.y + b.height >= top && b.y <= bottom)
        .map(({ i }) => i);
      expect(Array.from({ length: end - start }, (_, k) => start + k)).toEqual(expected);
    }
  });

  it('renders a small fraction of a large album', () => {
    const { blocks } = buildGridBlocks([mixedRatios(707)], 1352, metrics);
    const { start, end } = visibleBlockRange(blocks, 10_000 - 900, 10_000 + 1800);
    const tiles = blocks
      .slice(start, end)
      .reduce((n, b) => n + (b.kind === 'row' ? b.row.tiles.length : 0), 0);
    expect(tiles).toBeLessThan(60);
  });
});
