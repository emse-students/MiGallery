/**
 * The school-year rule (`src/lib/promo-utils.ts`).
 *
 * Pure functions, no server needed. What this pins is the August 15 boundary
 * and the fact that a promo is named after its ARRIVAL year: the two copies
 * this file replaced disagreed by up to two years, and the visible symptom was
 * an album dated 2026-08-31 offered to a promo that does not exist yet.
 */

import { describe, it, expect } from 'vitest';
import { getDefaultPromos, getSchoolYear, parseAlbumDate } from '$lib/promo-utils';

const at = (iso: string) => new Date(`${iso}T12:00:00`);

describe('getSchoolYear', () => {
  it('flips on August 15, not on August 25 nor on September 1', () => {
    expect(getSchoolYear(at('2026-08-14'))).toBe(2025);
    expect(getSchoolYear(at('2026-08-15'))).toBe(2026);
    expect(getSchoolYear(at('2026-08-24'))).toBe(2026);
    expect(getSchoolYear(at('2026-09-01'))).toBe(2026);
  });

  it('never runs ahead of the calendar year', () => {
    // The bug: September used to answer year + 1, so promo 2027 existed in 2026.
    expect(getSchoolYear(at('2026-09-02'))).toBe(2026);
    expect(getSchoolYear(at('2026-12-31'))).toBe(2026);
    expect(getSchoolYear(at('2027-08-14'))).toBe(2026);
    expect(getSchoolYear(at('2027-08-15'))).toBe(2027);
  });
});

describe('getDefaultPromos', () => {
  it('gives the newest promo and the three before it, ascending', () => {
    expect(getDefaultPromos(at('2026-08-31'))).toEqual([2023, 2024, 2025, 2026]);
    expect(getDefaultPromos(at('2026-08-14'))).toEqual([2022, 2023, 2024, 2025]);
  });

  it('follows the album date, not the day the album is created', () => {
    expect(getDefaultPromos(at('2024-11-10'))).toEqual([2021, 2022, 2023, 2024]);
  });
});

describe('parseAlbumDate', () => {
  it('reads a date input value as a local day', () => {
    const parsed = parseAlbumDate('2026-08-31');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth() + 1).toBe(8);
    expect(parsed.getDate()).toBe(31);
  });

  it('falls back to today on an empty or malformed value', () => {
    const today = new Date();
    for (const value of ['', 'not-a-date']) {
      expect(parseAlbumDate(value).getFullYear()).toBe(today.getFullYear());
    }
  });
});
