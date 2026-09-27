/**
 * Placement of a portalled popover (`src/lib/popover-position.ts`), used by the overflow menu and
 * the sharing card's profile picker. Pure function, no server needed.
 */

import { describe, it, expect } from 'vitest';
import { placePopover } from '$lib/popover-position';

describe('placePopover', () => {
  it('opens below when the content fits there', () => {
    expect(placePopover({ top: 100, bottom: 140 }, 200, 900)).toEqual({
      top: 144,
      maxHeight: 900 - 8 - 144,
      above: false,
    });
  });

  it('flips above near the bottom of the viewport', () => {
    const p = placePopover({ top: 800, bottom: 840 }, 200, 900);
    expect(p.above).toBe(true);
    expect(p.top).toBe(800 - 4 - 200);
    expect(p.maxHeight).toBe(800 - 4 - 8);
  });

  it('stays below, scrolling, when below is still the roomier side', () => {
    const p = placePopover({ top: 300, bottom: 340 }, 800, 851);
    expect(p).toEqual({ top: 344, maxHeight: 851 - 8 - 344, above: false });
  });

  it('caps an upward popover to the space above and keeps it inside the margin', () => {
    const p = placePopover({ top: 400, bottom: 440 }, 1000, 460);
    expect(p.above).toBe(true);
    expect(p.top).toBe(8);
    expect(p.maxHeight).toBe(388);
  });
});
