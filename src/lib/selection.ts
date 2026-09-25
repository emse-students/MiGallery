/**
 * The photo grid's selection mode, Google Photos style (`docs/wiki/ui-redesign.md`, D9).
 *
 * PURE, so `tests/selection.test.ts` pins it. `PhotosState` holds the two fields (`selecting`,
 * `selectedAssets`) and delegates every transition here; `PhotosGrid` reads `selectionActions`
 * to decide what the selection bars draw and enable.
 *
 * The mode is explicit: it is entered (the "Sélectionner" button, a long-press on a tile, a
 * day header's check) and left (the close cross, Escape, or an action that consumed the
 * selection). Deselecting the last photo does NOT leave it - the mode entered from the button
 * starts empty, and its actions are drawn disabled, never hidden, until something is picked.
 */

/** The two fields of a grid's selection. */
export interface Selection {
  /** Whether the grid is in selection mode: a tap toggles a tile instead of opening it. */
  active: boolean;
  /** Selected asset ids, in the order they were picked. */
  ids: string[];
}

/** No selection mode, nothing selected: the state every exit returns to. */
export const EMPTY_SELECTION: Readonly<Selection> = Object.freeze({ active: false, ids: [] });

/** Enters selection mode, optionally with one tile already picked (a long-press). */
export function enterSelection(current: Selection, id?: string): Selection {
  if (!id || current.ids.includes(id)) return { active: true, ids: [...current.ids] };
  return { active: true, ids: [...current.ids, id] };
}

/** Leaving the mode clears the selection: nothing selected survives an exit. */
export function exitSelection(): Selection {
  return { active: false, ids: [] };
}

/** A tap on a tile in selection mode: picks it, or un-picks it. The mode stays on. */
export function toggleInSelection(current: Selection, id: string): Selection {
  return current.ids.includes(id)
    ? { active: true, ids: current.ids.filter((x) => x !== id) }
    : { active: true, ids: [...current.ids, id] };
}

/** Sets one tile's state explicitly (a checkbox), entering the mode when it picks one. */
export function setInSelection(current: Selection, id: string, selected: boolean): Selection {
  const has = current.ids.includes(id);
  if (selected)
    return has ? { active: true, ids: [...current.ids] } : toggleInSelection(current, id);
  return has ? { active: current.active, ids: current.ids.filter((x) => x !== id) } : current;
}

/** Whether every id shown is selected: "Tout sélectionner" then reads "Tout désélectionner". */
export function isAllSelected(selected: readonly string[], shown: readonly string[]): boolean {
  if (shown.length === 0) return false;
  const set = new Set(selected);
  return shown.every((id) => set.has(id));
}

/**
 * The "Tout sélectionner" text action: selects every id SHOWN (a filtered view selects what it
 * shows), or clears them when they all already are. The mode stays on either way.
 */
export function toggleAllInSelection(current: Selection, shown: readonly string[]): Selection {
  if (isAllSelected(current.ids, shown)) {
    const hidden = new Set(shown);
    return { active: true, ids: current.ids.filter((id) => !hidden.has(id)) };
  }
  const set = new Set(current.ids);
  return { active: true, ids: [...current.ids, ...shown.filter((id) => !set.has(id))] };
}

/**
 * The most files one share hands to the system sheet. Every original is fetched into memory
 * first (Web Share takes `File` objects), and a phone holding 25 originals of ~8 MB is already
 * ~200 MB; beyond that the ZIP download is the right tool, and the share says so.
 */
export const MAX_SHARE_FILES = 25;

/** What the selection bars need to know to draw their actions. */
export interface SelectionActionInput {
  count: number;
  /** `mitviste` or `admin` - the same test the grid applied before selection mode existed. */
  canManagePhotos: boolean;
  /** The grid shows an album (remove-from-album needs one). */
  inAlbum: boolean;
  /** `navigator.canShare({ files })` answered true once. */
  canShareFiles: boolean;
  /** A download or a share is already running. */
  busy: boolean;
}

/** One action of the selection bars: drawn or not, and enabled or not. */
export interface SelectionAction {
  shown: boolean;
  enabled: boolean;
}

export interface SelectionActions {
  share: SelectionAction;
  download: SelectionAction;
  remove: SelectionAction;
  delete: SelectionAction;
}

/**
 * The selection's actions. Rights decide whether an action is DRAWN (remove and delete exactly
 * as before: managers, and remove only inside an album; share only where files can be shared);
 * the count decides whether it is ENABLED - at 0 every action is drawn disabled.
 */
export function selectionActions(input: SelectionActionInput): SelectionActions {
  const any = input.count > 0;
  return {
    share: { shown: input.canShareFiles, enabled: any && !input.busy },
    download: { shown: true, enabled: any && !input.busy },
    remove: { shown: input.canManagePhotos && input.inAlbum, enabled: any },
    delete: { shown: input.canManagePhotos, enabled: any },
  };
}

/** Whether a share of `count` files goes past `MAX_SHARE_FILES` and must be refused. */
export function shareTooLarge(count: number): boolean {
  return count > MAX_SHARE_FILES;
}
