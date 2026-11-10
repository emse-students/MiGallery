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
  /** Faces the engine added to the member's photos by itself. */
  added: number;
  /** Faces the engine set aside by itself. */
  setAside: number;
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
 * The member chose for the current card. The card leaves the queue and becomes the held choice;
 * the choice held before it (a verdict) is returned as `send`: it is sent NOW and not before.
 */
export function choose(s: Session, choice: Choice): { session: Session; send: Held | null } {
  const item = currentCard(s);
  if (!item) return { session: s, send: null };
  const send = s.last && s.last.choice !== 'skip' ? s.last : null;
  let next: Session = { ...s, queue: s.queue.slice(1), last: { item, choice } };
  next = choice === 'skip' ? { ...next, skipped: [...next.skipped, item] } : bump(next, choice, 1);
  return { session: next, send };
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
 * Fold the server's answer to a sent verdict into the session. Settled faces leave the queue and
 * the skipped list silently and are counted; a 404 drops the card and its count; a failure puts
 * the card back at the front and takes its count back.
 */
export function settleSend(s: Session, sent: Held, outcome: SendOutcome): Session {
  const choice = sent.choice;
  if (choice === 'skip') return s;
  if (outcome.kind === 'failed') {
    return bump({ ...s, queue: [sent.item, ...s.queue] }, choice, -1);
  }
  if (outcome.kind === 'gone') {
    return bump(s, choice, -1);
  }
  const settled = new Set([...outcome.promoted, ...outcome.released].map(answerKey));
  return {
    ...s,
    queue: s.queue.filter((c) => !settled.has(answerKey(c))),
    skipped: s.skipped.filter((c) => !settled.has(answerKey(c))),
    added: s.added + outcome.promoted.length,
    setAside: s.setAside + outcome.released.length,
  };
}
