import { describe, it, expect } from 'vitest';
import { answerKey } from '#lib/face-confirm-list.ts';
import {
  canUndo,
  choose as chooseKeyed,
  clearLast,
  currentCard,
  isFinished,
  pendingSend,
  position,
  settleSend,
  startSession,
  undo,
  type Choice,
  type Session,
} from '#lib/face-confirm-session.ts';

/** The member chooses for the card they see now. */
const choose = (s: Session, choice: Choice) => {
  const card = currentCard(s);
  return chooseKeyed(s, choice, card ? answerKey(card) : '');
};

const f = (n: number) => ({ asset_id: `a${n}`, face_index: 0 });
const list = [f(1), f(2), f(3), f(4)];

describe('a session', () => {
  it('starts on the first card of the list, counted from 1', () => {
    const s = startSession(list);
    expect(currentCard(s)).toEqual(f(1));
    expect(position(s)).toBe(1);
    expect(s.total).toBe(4);
    expect(isFinished(startSession([]))).toBe(true);
  });

  it('holds the answer and sends nothing until the next one', () => {
    const first = choose(startSession(list), 'confirm');
    expect(first.send).toBeNull();
    expect(first.session.last).toEqual({ item: f(1), choice: 'confirm' });
    expect(position(first.session)).toBe(2);
    const second = choose(first.session, 'reject');
    expect(second.send).toEqual({ item: f(1), choice: 'confirm' });
    expect(second.session.last).toEqual({ item: f(2), choice: 'reject' });
    expect([second.session.confirmed, second.session.rejected]).toEqual([1, 1]);
  });

  it('never sends a skip, and a skip sends the answer held before it', () => {
    const a = choose(startSession(list), 'reject');
    const b = choose(a.session, 'skip');
    expect(b.send).toEqual({ item: f(1), choice: 'reject' });
    const c = choose(b.session, 'confirm');
    expect(c.send).toBeNull();
    expect(c.session.skipped).toEqual([f(2)]);
  });

  it('keeps the position inside the total at the end', () => {
    let s = startSession([f(1)]);
    s = choose(s, 'confirm').session;
    expect(isFinished(s)).toBe(true);
    expect(position(s)).toBe(1);
  });
});

describe('undo', () => {
  it('brings the held card back with its count, and sends nothing', () => {
    const a = choose(startSession(list), 'confirm').session;
    expect(canUndo(a)).toBe(true);
    const back = undo(a);
    expect(currentCard(back)).toEqual(f(1));
    expect(back.confirmed).toBe(0);
    expect(back.last).toBeNull();
    expect(canUndo(back)).toBe(false);
    expect(pendingSend(back)).toBeNull();
  });

  it('is one level: the answer before the last one is already on its way', () => {
    const a = choose(startSession(list), 'confirm');
    const b = choose(a.session, 'reject');
    const back = undo(b.session);
    expect(currentCard(back)).toEqual(f(2));
    expect(back.last).toBeNull();
    expect(back.confirmed).toBe(1);
    expect(back.rejected).toBe(0);
  });

  it('takes a skip back out of the skipped list', () => {
    const a = choose(startSession(list), 'skip').session;
    expect(a.skipped).toEqual([f(1)]);
    const back = undo(a);
    expect(back.skipped).toEqual([]);
    expect(currentCard(back)).toEqual(f(1));
  });
});

describe('leaving or finishing', () => {
  it('names the held verdict to send, and nothing for a held skip', () => {
    const a = choose(startSession(list), 'confirm').session;
    expect(pendingSend(a)).toEqual({ item: f(1), choice: 'confirm' });
    expect(pendingSend(clearLast(a))).toBeNull();
    expect(pendingSend(choose(startSession(list), 'skip').session)).toBeNull();
  });
});

describe('what the server answered to a sent verdict', () => {
  const sent = { item: f(1), choice: 'confirm' as const };

  it('removes the faces the engine settled, silently, and counts them', () => {
    let s = choose(startSession(list), 'skip').session; // f1 skipped
    s = choose(s, 'confirm').session; // f2 held
    s = settleSend(s, sent, { kind: 'recorded', promoted: [f(3)], released: [f(1)] });
    expect(s.queue).toEqual([f(4)]);
    expect(s.skipped).toEqual([]);
    expect([s.added, s.setAside]).toEqual([1, 1]);
  });

  it('drops a card the engine had already settled (404) without a trace', () => {
    let s = choose(startSession(list), 'confirm').session;
    s = settleSend(s, sent, { kind: 'gone' });
    expect(s.confirmed).toBe(0);
    expect(s.queue).toEqual([f(2), f(3), f(4)]);
  });

  it('puts the card back at the front on a failure, with its count taken back', () => {
    let s = choose(startSession(list), 'confirm').session;
    s = choose(s, 'reject').session;
    s = settleSend(s, sent, { kind: 'failed' });
    expect(currentCard(s)).toEqual(f(1));
    expect(s.confirmed).toBe(0);
    expect(s.rejected).toBe(1);
    expect(s.last).toEqual({ item: f(2), choice: 'reject' });
  });
});

describe('a choice for a card that is no longer the current one', () => {
  it('is refused and changes nothing (a stale dialog, a repeated call for the same card)', () => {
    const s0 = startSession(list);
    const once = chooseKeyed(s0, 'confirm', answerKey(f(1)));
    expect(once.accepted).toBe(true);
    const twice = chooseKeyed(once.session, 'confirm', answerKey(f(1)));
    expect(twice.accepted).toBe(false);
    expect(twice.send).toBeNull();
    expect(twice.session).toBe(once.session);
    expect(currentCard(twice.session)).toEqual(f(2));
  });
});

describe('the summary counts server outcomes', () => {
  it('keeps a promoted face held: its answer applies, it is not counted as added', () => {
    let s = choose(startSession(list), 'confirm').session; // f1 held
    s = choose(s, 'confirm').session; // f2 held, f1 to send
    // f1's send says the engine promoted f2 (held) and f3 (queued).
    s = settleSend(
      s,
      { item: f(1), choice: 'confirm' },
      {
        kind: 'recorded',
        promoted: [f(2), f(3)],
        released: [],
      }
    );
    expect(s.added).toBe(1); // f3 only
    expect(s.queue).toEqual([f(4)]);
    expect(s.confirmed).toBe(2); // f1 and the held f2
    expect(s.heldSettled).toEqual({ [answerKey(f(2))]: 'added' });
    // f2 is sent and accepted: still the member's answer, counted once.
    s = settleSend(
      s,
      { item: f(2), choice: 'confirm' },
      { kind: 'recorded', promoted: [], released: [] }
    );
    expect(s.confirmed).toBe(2);
    expect(s.added).toBe(1);
    expect(s.heldSettled).toEqual({});
  });

  it('counts a released held face once, as the engine said it, when its send answers 404', () => {
    let s = choose(startSession(list), 'confirm').session;
    s = choose(s, 'reject').session; // f2 held
    s = settleSend(
      s,
      { item: f(1), choice: 'confirm' },
      {
        kind: 'recorded',
        promoted: [],
        released: [f(2)],
      }
    );
    expect(s.setAside).toBe(0);
    s = settleSend(s, { item: f(2), choice: 'reject' }, { kind: 'gone' });
    expect(s.rejected).toBe(0);
    expect(s.setAside).toBe(1);
    expect(s.alreadySettled).toBe(0);
  });

  it('counts a 404 with no word of the engine as already settled, and a retry too', () => {
    let s = choose(startSession(list), 'confirm').session;
    s = settleSend(s, { item: f(1), choice: 'confirm' }, { kind: 'failed' });
    expect(currentCard(s)).toEqual(f(1));
    s = choose(s, 'confirm').session;
    s = settleSend(s, { item: f(1), choice: 'confirm' }, { kind: 'gone' });
    expect([s.confirmed, s.alreadySettled]).toEqual([0, 1]);
  });

  it('adds up: every face of the list is counted exactly once at the end', () => {
    let s = choose(startSession(list), 'confirm').session; // f1
    s = choose(s, 'skip').session; // f2 skipped, f1 to send
    s = settleSend(
      s,
      { item: f(1), choice: 'confirm' },
      {
        kind: 'recorded',
        promoted: [f(2)], // the skipped one is settled by the engine
        released: [f(4)],
      }
    );
    s = choose(s, 'reject').session; // f3
    const final = settleSend(
      s,
      { item: f(3), choice: 'reject' },
      { kind: 'recorded', promoted: [], released: [] }
    );
    const total =
      final.confirmed +
      final.rejected +
      final.skipped.length +
      final.added +
      final.setAside +
      final.alreadySettled;
    expect(isFinished(final)).toBe(true);
    expect(total).toBe(final.total);
  });

  it('forgets a held skip the engine settled: nothing left to undo', () => {
    let s = choose(startSession(list), 'confirm').session;
    s = choose(s, 'skip').session; // f2 held as a skip
    s = settleSend(
      s,
      { item: f(1), choice: 'confirm' },
      { kind: 'recorded', promoted: [f(2)], released: [] }
    );
    expect(s.last).toBeNull();
    expect(s.skipped).toEqual([]);
    expect(s.added).toBe(1);
  });
});

describe('undo of a held answer the engine already settled', () => {
  it('does not bring the face back: it counts once, as the engine said it', () => {
    let s = choose(startSession(list), 'confirm').session;
    s = choose(s, 'confirm').session; // f2 held
    s = settleSend(
      s,
      { item: f(1), choice: 'confirm' },
      { kind: 'recorded', promoted: [f(2)], released: [] }
    );
    expect(s.heldSettled).toEqual({ [answerKey(f(2))]: 'added' });
    s = undo(s);
    expect(s.queue).toEqual([f(3), f(4)]);
    expect([s.confirmed, s.added, s.setAside]).toEqual([1, 1, 0]);
    expect(s.heldSettled).toEqual({});
    expect(s.last).toBeNull();
  });

  it('does the same for a released one', () => {
    let s = choose(startSession(list), 'confirm').session;
    s = choose(s, 'reject').session;
    s = settleSend(
      s,
      { item: f(1), choice: 'confirm' },
      { kind: 'recorded', promoted: [], released: [f(2)] }
    );
    s = undo(s);
    expect(s.queue).toEqual([f(3), f(4)]);
    expect([s.rejected, s.setAside]).toEqual([0, 1]);
  });
});

describe('a double tap', () => {
  it('answers two cards: the first is committed, the second is the held one and can be undone', () => {
    const first = chooseKeyed(startSession(list), 'confirm', answerKey(f(1)));
    // The second tap lands on the NEXT card, which is now the current one: a real answer.
    const second = chooseKeyed(first.session, 'confirm', answerKey(f(2)));
    expect(second.send).toEqual({ item: f(1), choice: 'confirm' });
    const back = undo(second.session);
    expect(currentCard(back)).toEqual(f(2));
    expect(back.confirmed).toBe(1);
  });
});
