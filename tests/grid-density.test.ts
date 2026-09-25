/**
 * Phone grid density (`src/lib/grid-density.ts`): the pinch steps, their memory, and the row
 * counts each step gives on the Mi 9T's 393 px screen.
 *
 * Pure functions, no server needed.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PHONE_DENSITY,
  DENSITY_STORAGE_KEY,
  PHONE_DENSITY_STEPS,
  PINCH_STEP_RATIO,
  clampDensity,
  densityAfterPinch,
  loadDensity,
  saveDensity,
} from '$lib/grid-density';
import { GRID_METRICS, justifyRows } from '$lib/photo-grid-layout';

describe('the steps on a 393 px phone', () => {
  const landscapes = Array.from({ length: 24 }, () => 3 / 2);
  const perRow = (targetRowHeight: number) =>
    justifyRows(landscapes, {
      containerWidth: 393,
      targetRowHeight,
      gap: GRID_METRICS.phone.gap,
    }).rows[0].tiles.length;

  it('holds 2, 3 and 4 landscape photos a row', () => {
    expect(PHONE_DENSITY_STEPS.map((s) => perRow(s.targetRowHeight))).toEqual([2, 3, 4]);
  });

  it('starts on three a row, and the phone metrics are that step', () => {
    expect(perRow(PHONE_DENSITY_STEPS[DEFAULT_PHONE_DENSITY].targetRowHeight)).toBe(3);
    expect(GRID_METRICS.phone.targetRowHeight).toBe(
      PHONE_DENSITY_STEPS[DEFAULT_PHONE_DENSITY].targetRowHeight
    );
  });
});

describe('densityAfterPinch', () => {
  it('spreading zooms in (fewer a row), pinching zooms out (more a row)', () => {
    expect(densityAfterPinch(1, PINCH_STEP_RATIO)).toBe(0);
    expect(densityAfterPinch(1, 1 / PINCH_STEP_RATIO)).toBe(2);
  });

  it('ignores a small movement', () => {
    expect(densityAfterPinch(1, 1.1)).toBe(1);
    expect(densityAfterPinch(1, 0.9)).toBe(1);
  });

  it('holds at both ends and survives garbage', () => {
    expect(densityAfterPinch(0, 3)).toBe(0);
    expect(densityAfterPinch(2, 0.2)).toBe(2);
    expect(densityAfterPinch(1, Number.NaN)).toBe(1);
    expect(densityAfterPinch(7, 1)).toBe(DEFAULT_PHONE_DENSITY);
  });
});

describe('the remembered density', () => {
  it('round-trips through storage', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(loadDensity(storage)).toBe(DEFAULT_PHONE_DENSITY);
    saveDensity(storage, 2);
    expect(store.get(DENSITY_STORAGE_KEY)).toBe('2');
    expect(loadDensity(storage)).toBe(2);
  });

  it('reads a foreign value as the default', () => {
    expect(loadDensity({ getItem: () => 'dense' })).toBe(DEFAULT_PHONE_DENSITY);
    expect(clampDensity(-1)).toBe(DEFAULT_PHONE_DENSITY);
  });

  it('never throws when storage refuses', () => {
    const refusing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(loadDensity(refusing)).toBe(DEFAULT_PHONE_DENSITY);
    expect(() => saveDensity(refusing, 0)).not.toThrow();
    expect(loadDensity(undefined)).toBe(DEFAULT_PHONE_DENSITY);
  });
});
