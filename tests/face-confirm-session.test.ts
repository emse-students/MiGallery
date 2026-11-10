import { describe, it, expect } from 'vitest';
import {
  canUndo,
  choose,
  clearLast,
  currentCard,
  isFinished,
  pendingSend,
  position,
  settleSend,
  startSession,
  undo,
} from '#lib/face-confirm-session.ts';

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
