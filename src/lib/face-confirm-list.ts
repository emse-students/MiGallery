/**
 * The confirmation screen's list operations (faces v2), pure so they are tested on their own:
 * an answered face leaves the list AT ONCE (optimistic), and a refused answer puts it back WHERE IT
 * WAS, so the nearest-first order the server gave is never disturbed by a failure.
 */

/** One face given to the member with a doubt: the photo and which face in it. */
export interface Suggestion {
  asset_id: string;
  face_index: number;
}

/** The member's answer. */
export type Verdict = 'confirm' | 'reject';

/** The key of a face in the list. */
export function answerKey(s: Suggestion): string {
  return `${s.asset_id}:${s.face_index}`;
}

/** The list without the faces named by `keys`. */
export function removeKeys(list: readonly Suggestion[], keys: readonly string[]): Suggestion[] {
  const drop = new Set(keys);
  return list.filter((s) => !drop.has(answerKey(s)));
}

/**
 * The list with `item` back at `index` (or at the end, when the list got shorter meanwhile).
 * A face already in the list is not added twice.
 */
export function restoreAt(
  list: readonly Suggestion[],
  item: Suggestion,
  index: number
): Suggestion[] {
  if (list.some((s) => answerKey(s) === answerKey(item))) {
    return [...list];
  }
  const at = Math.max(0, Math.min(index, list.length));
  return [...list.slice(0, at), item, ...list.slice(at)];
}
