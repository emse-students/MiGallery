/** The confirmation screen's face type and key (the session logic is face-confirm-session.ts). */

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
