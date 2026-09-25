/**
 * The viewer's date title and info-panel lines (`src/lib/viewer-info.ts`).
 *
 * Pure functions, no server needed. The clock and the zone are pinned (Europe/Paris, 2026-09-25
 * at 12:00 local) so "today" / "yesterday" and the dropped year are deterministic; the day
 * boundary is the one in Paris, not in UTC.
 */

import { describe, it, expect } from 'vitest';
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

const labels = { today: "Aujourd'hui", yesterday: 'Hier' };
const fr = {
  locale: 'fr',
  labels,
  now: new Date('2026-09-25T10:00:00Z'),
  timeZone: 'Europe/Paris',
};

describe('formatViewerDateTitle', () => {
  it('names today and yesterday, with the time on its own line', () => {
    expect(formatViewerDateTitle('2026-09-25T12:03:00Z', fr)).toEqual({
      date: "Aujourd'hui",
      time: '14:03',
    });
    expect(formatViewerDateTitle('2026-09-24T21:59:00Z', fr)).toEqual({
      date: 'Hier',
      time: '23:59',
    });
  });

  it('draws the day boundary in the photo zone, not in UTC', () => {
    // 22:30 UTC on the 24th is 00:30 on the 25th in Paris.
    expect(formatViewerDateTitle('2026-09-24T22:30:00Z', fr)).toEqual({
      date: "Aujourd'hui",
      time: '00:30',
    });
  });

  it('writes an older date in French, and the year only when it is not the current one', () => {
    expect(formatViewerDateTitle('2026-09-18T12:03:00Z', fr)).toEqual({
      date: 'ven. 18 sept.',
      time: '14:03',
    });
    expect(formatViewerDateTitle('2025-02-03T08:05:00Z', fr)).toEqual({
      date: 'lun. 3 févr. 2025',
      time: '09:05',
    });
  });

  it('follows the locale it is given', () => {
    const en = formatViewerDateTitle('2026-09-18T12:03:00Z', { ...fr, locale: 'en' });
    expect(en?.date).toBe('Fri, Sep 18');
    expect(en?.time).toMatch(/^02:03\sPM$/);
  });

  it('returns null for a missing or unparseable date instead of "Invalid Date"', () => {
    expect(formatViewerDateTitle(null, fr)).toBeNull();
    expect(formatViewerDateTitle('', fr)).toBeNull();
    expect(formatViewerDateTitle('not a date', fr)).toBeNull();
  });
});

describe('viewerDateOf', () => {
  it('prefers fileCreatedAt, the field the grid groups its days by', () => {
    expect(viewerDateOf({ fileCreatedAt: 'a', date: 'b', createdAt: 'c' })).toBe('a');
    expect(viewerDateOf({ date: 'b', createdAt: 'c' })).toBe('b');
    expect(viewerDateOf({ createdAt: 'c' })).toBe('c');
    expect(viewerDateOf({})).toBeNull();
    expect(viewerDateOf(null)).toBeNull();
  });
});

describe('formatViewerFullDate', () => {
  it('is never relative', () => {
    expect(formatViewerFullDate('2025-02-03T08:05:00Z', 'fr', 'Europe/Paris')).toBe(
      'lundi 3 février 2025 à 09:05'
    );
    expect(formatViewerFullDate('bad', 'fr', 'Europe/Paris')).toBeNull();
  });
});

describe('formatFileSize', () => {
  // ICU separates a French number from its unit with a narrow no-break space.
  const plain = (s: string | null) => s?.replace(/\s/g, ' ');

  it('uses the locale units and decimal separator', () => {
    expect(plain(formatFileSize(8_400_000, 'fr'))).toBe('8,4 Mo');
    expect(plain(formatFileSize(512, 'fr'))).toBe('512 o');
    expect(plain(formatFileSize(2_500_000_000, 'fr'))).toBe('2,5 Go');
    expect(plain(formatFileSize(1234, 'en'))).toBe('1.2 kB');
  });

  it('returns null for an unknown size', () => {
    expect(formatFileSize(undefined, 'fr')).toBeNull();
    expect(formatFileSize(null, 'fr')).toBeNull();
    expect(formatFileSize(-1, 'fr')).toBeNull();
  });
});

describe('cameraName', () => {
  it('drops the make when the model already carries it', () => {
    expect(cameraName('Canon', 'Canon EOS R6')).toBe('Canon EOS R6');
    expect(cameraName('Apple', 'iPhone 13')).toBe('Apple iPhone 13');
  });

  it('keeps whichever half exists, and null when neither does', () => {
    expect(cameraName(null, 'Pixel 8')).toBe('Pixel 8');
    expect(cameraName('Sony', '')).toBe('Sony');
    expect(cameraName(undefined, undefined)).toBeNull();
    expect(cameraName('  ', ' ')).toBeNull();
  });
});

describe('exposureLine', () => {
  it('prints each part EXIF carries, in the Google Photos order', () => {
    expect(
      exposureLine({ fNumber: 1.8, exposureTime: '1/60', focalLength: 4.2, iso: 100 }, 'en')
    ).toBe('ƒ/1.8 · 1/60 · 4.2 mm · ISO 100');
  });

  it('leaves out what is missing, and is null when nothing is there', () => {
    expect(exposureLine({ iso: 400 }, 'en')).toBe('ISO 400');
    expect(exposureLine({}, 'en')).toBeNull();
  });

  it('uses the locale decimal separator', () => {
    expect(exposureLine({ fNumber: 2.8 }, 'fr')).toBe('ƒ/2,8');
  });
});

describe('dimensionsLine', () => {
  it('gives the pixel size and the megapixels', () => {
    expect(dimensionsLine(4032, 3024, 'en')).toBe('4032 × 3024 · 12.2 MP');
  });

  it('is null when a side is unknown', () => {
    expect(dimensionsLine(4032, undefined, 'en')).toBeNull();
  });
});

describe('placeLine', () => {
  it('joins the parts, skipping blanks and repeats', () => {
    expect(placeLine('Saint-Étienne', ' ', 'France')).toBe('Saint-Étienne, France');
    expect(placeLine('Monaco', 'Monaco', 'Monaco')).toBe('Monaco');
    expect(placeLine()).toBeNull();
  });
});
