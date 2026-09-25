/**
 * Selection mode (`src/lib/selection.ts`): the grid's Google Photos-style selection (D9 in
 * `docs/wiki/ui-redesign.md`) and the album ZIP's archive count (`src/lib/immich/download.ts`).
 *
 * Pure functions, no server needed.
 */

import { describe, it, expect } from 'vitest';
import {
  EMPTY_SELECTION,
  MAX_SHARE_FILES,
  enterSelection,
  exitSelection,
  isAllSelected,
  selectionActions,
  setInSelection,
  shareTooLarge,
  toggleAllInSelection,
  toggleInSelection,
  type SelectionActionInput,
} from '$lib/selection';
import { archiveCount } from '$lib/immich/download';

describe('entering and leaving', () => {
  it('enters empty from the button, and with the pressed tile from a long-press', () => {
    expect(enterSelection(EMPTY_SELECTION)).toEqual({ active: true, ids: [] });
    expect(enterSelection(EMPTY_SELECTION, 'a')).toEqual({ active: true, ids: ['a'] });
  });

  it('does not pick a tile twice when a long-press lands on a selected one', () => {
    expect(enterSelection({ active: true, ids: ['a'] }, 'a')).toEqual({ active: true, ids: ['a'] });
  });

  it('clears the selection on exit', () => {
    expect(exitSelection()).toEqual({ active: false, ids: [] });
  });
});

describe('toggling', () => {
  it('picks and un-picks a tile, keeping the pick order', () => {
    let s = enterSelection(EMPTY_SELECTION);
    s = toggleInSelection(s, 'b');
    s = toggleInSelection(s, 'a');
    expect(s.ids).toEqual(['b', 'a']);
    s = toggleInSelection(s, 'b');
    expect(s).toEqual({ active: true, ids: ['a'] });
  });

  it('stays in selection mode when the last tile is un-picked', () => {
    expect(toggleInSelection({ active: true, ids: ['a'] }, 'a')).toEqual({ active: true, ids: [] });
  });

  it('enters the mode when the hover check picks a tile', () => {
    expect(setInSelection(EMPTY_SELECTION, 'a', true)).toEqual({ active: true, ids: ['a'] });
    expect(setInSelection({ active: true, ids: ['a'] }, 'a', true)).toEqual({
      active: true,
      ids: ['a'],
    });
    expect(setInSelection({ active: true, ids: ['a', 'b'] }, 'a', false)).toEqual({
      active: true,
      ids: ['b'],
    });
  });
});

describe('select all', () => {
  const shown = ['a', 'b', 'c'];

  it('selects every shown id, appending the missing ones', () => {
    expect(toggleAllInSelection({ active: true, ids: ['b'] }, shown)).toEqual({
      active: true,
      ids: ['b', 'a', 'c'],
    });
  });

  it('clears the shown ids when all already are, keeping the mode and hidden picks', () => {
    expect(toggleAllInSelection({ active: true, ids: ['x', 'a', 'b', 'c'] }, shown)).toEqual({
      active: true,
      ids: ['x'],
    });
  });

  it('never calls an empty view all selected', () => {
    expect(isAllSelected([], [])).toBe(false);
    expect(isAllSelected(['a', 'b', 'c'], shown)).toBe(true);
    expect(isAllSelected(['a', 'b'], shown)).toBe(false);
  });
});

describe('selectionActions', () => {
  const base: SelectionActionInput = {
    count: 2,
    canManagePhotos: true,
    inAlbum: true,
    canShareFiles: true,
    busy: false,
  };

  it('draws every action disabled, never hidden, at 0 selected', () => {
    const a = selectionActions({ ...base, count: 0 });
    for (const action of [a.share, a.download, a.remove, a.delete]) {
      expect(action).toEqual({ shown: true, enabled: false });
    }
  });

  it('enables every action once something is selected', () => {
    const a = selectionActions(base);
    for (const action of [a.share, a.download, a.remove, a.delete]) {
      expect(action).toEqual({ shown: true, enabled: true });
    }
  });

  it('keeps remove and delete to managers, and remove to albums', () => {
    const viewer = selectionActions({ ...base, canManagePhotos: false });
    expect(viewer.remove.shown).toBe(false);
    expect(viewer.delete.shown).toBe(false);
    expect(viewer.download).toEqual({ shown: true, enabled: true });
    const mesPhotos = selectionActions({ ...base, inAlbum: false });
    expect(mesPhotos.remove.shown).toBe(false);
    expect(mesPhotos.delete.shown).toBe(true);
  });

  it('draws share only where files can be shared, and pauses share and download while busy', () => {
    expect(selectionActions({ ...base, canShareFiles: false }).share.shown).toBe(false);
    const busy = selectionActions({ ...base, busy: true });
    expect(busy.share.enabled).toBe(false);
    expect(busy.download.enabled).toBe(false);
    expect(busy.delete.enabled).toBe(true);
  });

  it('refuses a share past the file cap', () => {
    expect(shareTooLarge(MAX_SHARE_FILES)).toBe(false);
    expect(shareTooLarge(MAX_SHARE_FILES + 1)).toBe(true);
  });
});

describe('archiveCount', () => {
  it('counts the ZIP archives of 200 an album download arrives in', () => {
    expect(archiveCount(0)).toBe(0);
    expect(archiveCount(1)).toBe(1);
    expect(archiveCount(200)).toBe(1);
    expect(archiveCount(201)).toBe(2);
    expect(archiveCount(707)).toBe(4);
  });
});
