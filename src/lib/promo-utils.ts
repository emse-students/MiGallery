/**
 * Promotions and school years - the ONE rule, shared by the album modal and by
 * the sharing-options endpoint.
 *
 * A promo is named after the year its class ARRIVED, and a class arrives on
 * August 15: from 2026-08-15 to 2027-08-14 the newest promo is 2026, and promo
 * 2027 does not exist yet. Two copies of this used to disagree - one placed the
 * boundary on August 25, the other on September 1 AND returned year + 1, which
 * is why an album dated 2026-08-31 was offered "Promo 2027" on 2026-09-02.
 */

/** Month (1-12) and day the school year flips on. */
const SCHOOL_YEAR_START_MONTH = 8;
const SCHOOL_YEAR_START_DAY = 15;

/** How many promos an album is shared with by default: the newest and the 3 before it. */
const DEFAULT_PROMO_COUNT = 4;

/**
 * The newest promo that exists on a given date.
 * @param date - Date to analyze
 * @returns The arrival year of the newest promo (e.g. 2026 for 2026-08-15 .. 2027-08-14)
 */
export function getSchoolYear(date: Date): number {
  const month = date.getMonth() + 1; // 1-12
  const year = date.getFullYear();

  if (
    month < SCHOOL_YEAR_START_MONTH ||
    (month === SCHOOL_YEAR_START_MONTH && date.getDate() < SCHOOL_YEAR_START_DAY)
  ) {
    return year - 1;
  }

  return year;
}

/**
 * Default promos for an album date: the promos on campus, oldest first.
 * @param date - Album date
 * @returns Ascending promo years (e.g. [2023, 2024, 2025, 2026] for 2026-08-31)
 */
export function getDefaultPromos(date: Date): number[] {
  const schoolYear = getSchoolYear(date);
  return Array.from(
    { length: DEFAULT_PROMO_COUNT },
    (_, i) => schoolYear - (DEFAULT_PROMO_COUNT - 1 - i)
  );
}

/**
 * Parses an album date input value ('YYYY-MM-DD') into a Date, falling back to today.
 * @param dateValue - Value of a `type="date"` input
 */
export function parseAlbumDate(dateValue: string): Date {
  const parsed = new Date(`${dateValue}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
