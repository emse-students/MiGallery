/**
 * Select-a-whole-day logic for the photo grid's day headers (`docs/wiki/ui-redesign.md` #14).
 *
 * PURE, so `tests/day-selection.test.ts` pins it: the header's check reads the state of its
 * day, and a tap selects every photo of that day - or, when all of them already are, clears
 * them - leaving every other day's selection untouched.
 */

/** How much of a day is selected; `some` draws the header check as partial. */
export type DaySelectionState = 'none' | 'some' | 'all';

/** The selection state of one day, given the ids selected anywhere in the grid. */
export function daySelectionState(
  selected: ReadonlySet<string>,
  dayIds: readonly string[]
): DaySelectionState {
  if (dayIds.length === 0) return 'none';
  let count = 0;
  for (const id of dayIds) if (selected.has(id)) count++;
  if (count === 0) return 'none';
  return count === dayIds.length ? 'all' : 'some';
}

/**
 * The selection after a tap on a day's check: a fully selected day is cleared, any other day
 * is completed. Order is kept - existing ids first, the day's new ids appended in display order.
 */
export function toggleDaySelection(
  selected: readonly string[],
  dayIds: readonly string[]
): string[] {
  const current = new Set(selected);
  if (daySelectionState(current, dayIds) === 'all') {
    const day = new Set(dayIds);
    return selected.filter((id) => !day.has(id));
  }
  return [...selected, ...dayIds.filter((id) => !current.has(id))];
}
