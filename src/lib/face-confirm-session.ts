/**
 * The one-face-at-a-time confirmation session (owner, 2026-11-10), pure so it is tested alone.
 *
 * ONE LEVEL OF UNDO WITHOUT A SERVER CHANGE: the LAST answer is HELD here and only sent when the
 * member answers the next card, reaches the end, or leaves the page. "Annuler" drops the held
 * answer and brings its card back. Never a timer: the held answer leaves on a gesture of the
 * member. A server-side undo would have to revert a learned reference, a renewal's deleted victim
 * and the background re-match's sticky `auto` rows: a journal and a migration for a misclick.
 *
 * "Je ne sais pas" writes nothing: the face is left for later (it is not offered again this
 * session) and can be undone like an answer. The faces the engine settles by itself
 * (`promoted`/`released`, answered by the server after a recorded answer) are not announced during
 * the flow: they leave the queue and are counted for the end screen.
 */

import { answerKey, type Suggestion, type Verdict } from '#lib/face-confirm-list.ts';

/** What the member chose for a card. */
export type Choice = Verdict | 'skip';

/** The last choice, kept so it can be undone (a verdict is also what is not yet sent). */
export interface Held {
  item: Suggestion;
  choice: Choice;
}

/** What the server said about a sent answer. */
export type SendOutcome =
  /** Recorded; the faces the engine settled by itself came with it. */
  | { kind: 'recorded'; promoted: Suggestion[]; released: Suggestion[] }
  /** 404: the face was settled elsewhere meanwhile; it is dropped silently. */
  | { kind: 'gone' }
  /** Refused or unreachable: the card comes back. */
  | { kind: 'failed' };

export interface Session {
  /** The cards still to show; the first is the current one. */
  queue: Suggestion[];
  /** How many cards the session started with (the "sur N" of the counter). */
  total: number;
  /** The last choice, undoable and, for a verdict, not sent yet. */
  last: Held | null;
  confirmed: number;
  rejected: number;
  /** Left for later this session. */
  skipped: Suggestion[];
  /** Faces the engine added to the member's photos by itself (the server's word, not an answer). */
  added: number;
  /** Faces the engine set aside by itself. */
  setAside: number;
  /** Faces that answered 404 with no word of the engine's on them: settled elsewhere. */
  alreadySettled: number;
  /**
   * Faces the engine announced while the member's own answer for them is HELD: the answer still
   * goes out (and counts as theirs if the server takes it); only if its send answers 404 does the
   * face count, once, under what the engine said.
   */
  heldSettled: Record<string, 'added' | 'setAside'>;
}

/** A new session over the server's list, in the server's order (nearest first). */
export function startSession(list: readonly Suggestion[]): Session {
  return {
    queue: [...list],
    total: list.length,
    last: null,
    confirmed: 0,
    rejected: 0,
    skipped: [],
    added: 0,
    setAside: 0,
    alreadySettled: 0,
    heldSettled: {},
  };
}

/** The card to show, or null at the end. */
export function currentCard(s: Session): Suggestion | null {
  return s.queue[0] ?? null;
}

/** Whether no card is left to show (the held answer may still have to be sent). */
export function isFinished(s: Session): boolean {
  return s.queue.length === 0;
}

/** The 1-based position of the current card in "3 sur 12": cards handled so far, plus one. */
export function position(s: Session): number {
  const handled = s.total - s.queue.length;
  return Math.min(s.total, Math.max(1, handled + 1));
}

const bump = (s: Session, choice: Verdict, by: 1 | -1): Session =>
  choice === 'confirm'
    ? { ...s, confirmed: s.confirmed + by }
    : { ...s, rejected: s.rejected + by };

/**
 * The member chose for the card they SAW, named by `seenKey`. The card leaves the queue and becomes
 * the held choice; the choice held before it (a verdict) is returned as `send`: it is sent NOW and
 * not before. A choice for a card that is no longer the current one (a double tap, a dialog opened
 * on a card the engine settled meanwhile) is refused: `accepted` is false and nothing changes.
 */
export function choose(
  s: Session,
  choice: Choice,
  seenKey: string
): { session: Session; send: Held | null; accepted: boolean } {
  const item = currentCard(s);
  if (!item || answerKey(item) !== seenKey) return { session: s, send: null, accepted: false };
  const send = s.last && s.last.choice !== 'skip' ? s.last : null;
  let next: Session = { ...s, queue: s.queue.slice(1), last: { item, choice } };
  next = choice === 'skip' ? { ...next, skipped: [...next.skipped, item] } : bump(next, choice, 1);
  return { session: next, send, accepted: true };
}

/** Whether there is a choice to undo. */
export function canUndo(s: Session): boolean {
  return s.last !== null;
}

/** Drop the last choice and bring its card back to the front. Nothing was sent for it. */
export function undo(s: Session): Session {
  if (!s.last) return s;
  const { item, choice } = s.last;
  let next: Session = { ...s, queue: [item, ...s.queue], last: null };
  if (choice === 'skip') {
    const key = answerKey(item);
    next = { ...next, skipped: next.skipped.filter((k) => answerKey(k) !== key) };
  } else {
    next = bump(next, choice, -1);
  }
  return next;
}

/**
 * The end of the flow (queue empty) or the page being left: the held verdict, if any, must be
 * sent now. Null when nothing is held or the held choice is a skip (nothing to write).
 */
export function pendingSend(s: Session): Held | null {
  return s.last && s.last.choice !== 'skip' ? s.last : null;
}

/** After a flush the last choice is no longer undoable (it left for the server). */
export function clearLast(s: Session): Session {
  return { ...s, last: null };
}

/**
 * Fold the server's answer to a sent verdict into the session. The summary counts SERVER outcomes:
 * - the faces the engine settled leave the queue and the skipped list silently and are counted
 *   (`added` for `promoted`, `setAside` for `released`);
 * - except a face whose own VERDICT is held right now: it stays held, its answer still applies when
 *   sent, and it is counted only if that send answers 404 (see `heldSettled`);
 * - a 404 for the sent face drops it and takes its answer's count back; it is counted once, as the
 *   engine said it if known, else as `alreadySettled`;
 * - a failure puts the card back at the front and takes its count back.
 */
export function settleSend(s: Session, sent: Held, outcome: SendOutcome): Session {
  const choice = sent.choice;
  if (choice === 'skip') return s;
  const sentKey = answerKey(sent.item);
  const { [sentKey]: said, ...heldSettled } = s.heldSettled;
  if (outcome.kind === 'failed') {
    // Still owed: the face stays where the member can answer it again.
    return bump({ ...s, queue: [sent.item, ...s.queue] }, choice, -1);
  }
  if (outcome.kind === 'gone') {
    const next = bump({ ...s, heldSettled }, choice, -1);
    if (said === 'added') return { ...next, added: next.added + 1 };
    if (said === 'setAside') return { ...next, setAside: next.setAside + 1 };
    return { ...next, alreadySettled: next.alreadySettled + 1 };
  }
  const heldKey = s.last && s.last.choice !== 'skip' ? answerKey(s.last.item) : null;
  const held: Record<string, 'added' | 'setAside'> = { ...heldSettled };
  let added = 0;
  let setAside = 0;
  const gone = new Set<string>();
  for (const f of outcome.promoted) {
    const key = answerKey(f);
    if (key === heldKey) held[key] = 'added';
    else {
      added += 1;
      gone.add(key);
    }
  }
  for (const f of outcome.released) {
    const key = answerKey(f);
    if (key === heldKey) held[key] = 'setAside';
    else {
      setAside += 1;
      gone.add(key);
    }
  }
  return {
    ...s,
    queue: s.queue.filter((c) => !gone.has(answerKey(c))),
    skipped: s.skipped.filter((c) => !gone.has(answerKey(c))),
    // A held skip the engine settled has nothing left to undo.
    last: s.last && gone.has(answerKey(s.last.item)) ? null : s.last,
    added: s.added + added,
    setAside: s.setAside + setAside,
    heldSettled: held,
  };
}
