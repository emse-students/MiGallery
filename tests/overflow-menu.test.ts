/**
 * Keyboard focus movement of the overflow menu (`src/lib/overflow-menu.ts`).
 *
 * Pure function, no server needed. Pins the WAI-ARIA menu behaviour the component relies on:
 * the arrows wrap, disabled entries are skipped, and Home / End land on the first / last
 * enabled entry.
 */

import { describe, it, expect } from 'vitest';
import { nextMenuIndex } from '$lib/overflow-menu';

describe('nextMenuIndex', () => {
  const none = [false, false, false];

  it('moves by one and wraps around at both ends', () => {
    expect(nextMenuIndex(0, 1, none)).toBe(1);
    expect(nextMenuIndex(2, 1, none)).toBe(0);
    expect(nextMenuIndex(0, -1, none)).toBe(2);
  });

  it('implements Home and End through the out-of-range starting points', () => {
    expect(nextMenuIndex(-1, 1, none)).toBe(0);
    expect(nextMenuIndex(none.length, -1, none)).toBe(2);
  });

  it('skips disabled entries', () => {
    const middleDisabled = [false, true, false];
    expect(nextMenuIndex(0, 1, middleDisabled)).toBe(2);
    expect(nextMenuIndex(2, -1, middleDisabled)).toBe(0);
    expect(nextMenuIndex(-1, 1, [true, false, false])).toBe(1);
  });

  it('answers -1 when nothing can take focus', () => {
    expect(nextMenuIndex(-1, 1, [true, true])).toBe(-1);
    expect(nextMenuIndex(-1, 1, [])).toBe(-1);
  });
});
