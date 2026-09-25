/**
 * What the photo viewer SAYS about a photo: the date-and-time title of its top bar and the
 * lines of its info panel (`PhotoModal.svelte`, theme 6 of `docs/wiki/ui-redesign.md`).
 *
 * Pure functions, no DOM and no Paraglide import: the locale, the clock, the time zone and the
 * two relative labels are passed in, so `tests/viewer-info.test.ts` pins them deterministically.
 */

/** The two localized words that replace a date close to now (Paraglide, passed by the caller). */
export interface RelativeDayLabels {
  today: string;
  yesterday: string;
}

/** The viewer's title: the day on the first line, the time on the second (Google Photos). */
export interface ViewerDateTitle {
  date: string;
  time: string;
}

export interface DateTitleOptions {
  /** BCP 47 locale, the Paraglide one (`getLocale()`). */
  locale: string;
  labels: RelativeDayLabels;
  /** The clock "today" is measured against; injected for the tests. */
  now?: Date;
  /** IANA zone; defaults to the browser's, the zone the grid's day headers use too. */
  timeZone?: string;
}

/** The fields of an asset the title may be read from, in order of preference. */
export interface DatedAsset {
  fileCreatedAt?: string;
  date?: string | null;
  createdAt?: string;
}

const MS_PER_DAY = 86_400_000;

/**
 * The instant a photo is dated by in the viewer. `fileCreatedAt` first, the same field the
 * grid groups its days by (`groupByDay`), so a photo never sits under one day in the grid and
 * shows another in the viewer.
 */
export function viewerDateOf(asset: DatedAsset | null | undefined): string | null {
  if (!asset) return null;
  return asset.fileCreatedAt || asset.date || asset.createdAt || null;
}

/** Days since the Unix epoch of the calendar day `instant` falls on IN `timeZone`. */
function calendarDay(instant: Date, timeZone: string | undefined): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Differences of UTC midnights are whole days, whatever DST did in the zone itself.
  return Math.round(Date.UTC(get('year'), get('month') - 1, get('day')) / MS_PER_DAY);
}

/**
 * The viewer's title for a photo taken at `iso`: "Aujourd'hui" / "Hier" for the two most
 * recent days, then the weekday, day and short month, plus the year only when it is not the
 * current one; the time on its own line. Returns `null` for a missing or unparseable date, so
 * the caller shows its "no date" label instead of "Invalid Date".
 */
export function formatViewerDateTitle(
  iso: string | null | undefined,
  { locale, labels, now = new Date(), timeZone }: DateTitleOptions
): ViewerDateTitle | null {
  if (!iso) return null;
  const taken = new Date(iso);
  if (Number.isNaN(taken.getTime())) return null;

  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(taken);

  const daysAgo = calendarDay(now, timeZone) - calendarDay(taken, timeZone);
  if (daysAgo === 0) return { date: labels.today, time };
  if (daysAgo === 1) return { date: labels.yesterday, time };

  const yearOf = (d: Date) =>
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(d);
  const date = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: yearOf(taken) === yearOf(now) ? undefined : 'numeric',
  }).format(taken);
  return { date, time };
}

/** The full date and time of the info panel, never relative: it is a record, not a title. */
export function formatViewerFullDate(
  iso: string | null | undefined,
  locale: string,
  timeZone?: string
): string | null {
  if (!iso) return null;
  const taken = new Date(iso);
  if (Number.isNaN(taken.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(taken);
}

/** A file size in the locale's own units and separators ("8,4 Mo" in French). */
export function formatFileSize(bytes: number | null | undefined, locale: string): string | null {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return null;
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: units[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
}

/**
 * The camera line: make and model, with the make dropped when the model already names it
 * (EXIF says "Apple" + "iPhone 13" but also "Canon" + "Canon EOS R6"). `null` when EXIF has
 * neither, so the panel leaves the line out rather than printing an empty one.
 */
export function cameraName(make?: string | null, model?: string | null): string | null {
  const mk = make?.trim() ?? '';
  const md = model?.trim() ?? '';
  if (!mk && !md) return null;
  if (!mk) return md;
  if (!md) return mk;
  return md.toLowerCase().startsWith(mk.toLowerCase()) ? md : `${mk} ${md}`;
}
