/**
 * Select-a-whole-day (`src/lib/day-selection.ts`): the check on each day header of the grid.
 *
 * Pure functions, no server needed.
 */

import { describe, it, expect } from 'vitest';
import { daySelectionState, toggleDaySelection } from '$lib/day-selection';

const day = ['a', 'b', 'c'];

describe('daySelectionState', () => {
  it('reads none / some / all from the grid-wide selection', () => {
    expect(daySelectionState(new Set(), day)).toBe('none');
    expect(daySelectionState(new Set(['x', 'y']), day)).toBe('none');
    expect(daySelectionState(new Set(['b', 'x']), day)).toBe('some');
    expect(daySelectionState(new Set(['a', 'b', 'c', 'x']), day)).toBe('all');
  });

  it('calls an empty day none, never all', () => {
    expect(daySelectionState(new Set(['a']), [])).toBe('none');
  });
});

describe('toggleDaySelection', () => {
  it('selects the whole day from nothing, in display order', () => {
    expect(toggleDaySelection([], day)).toEqual(['a', 'b', 'c']);
  });

  it('completes a partly selected day without duplicating what was selected', () => {
    expect(toggleDaySelection(['b'], day)).toEqual(['b', 'a', 'c']);
  });

  it('clears a fully selected day', () => {
    expect(toggleDaySelection(['a', 'b', 'c'], day)).toEqual([]);
  });

  it('leaves the other days selection untouched either way', () => {
    expect(toggleDaySelection(['x', 'b', 'y'], day)).toEqual(['x', 'b', 'y', 'a', 'c']);
    expect(toggleDaySelection(['x', 'a', 'b', 'c', 'y'], day)).toEqual(['x', 'y']);
  });
});
