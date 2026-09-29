import { describe, expect, it } from 'vitest';
import { distinctTargets, followTouchTargets } from '../src/lib/touch-targets';

/** A touch event the listeners can receive; `touches` is all they read. */
function touchEvent(type: string, touches = 2): Event {
  const e = new Event(type);
  Object.defineProperty(e, 'touches', { value: { length: touches } });
  return e;
}

describe('distinctTargets', () => {
  it('keeps each target once and skips a touch without one', () => {
    const a = new EventTarget();
    const b = new EventTarget();
    expect(distinctTargets([{ target: a }, { target: a }])).toEqual([a]);
    expect(distinctTargets([{ target: a }, { target: b }])).toEqual([a, b]);
    expect(distinctTargets([{ target: null as unknown as EventTarget }])).toEqual([]);
  });
});

describe('followTouchTargets', () => {
  it('hears moves on the touched element even once it has left its container', () => {
    // The Mi 9T defect: the grid re-rendered the row under the fingers, and a container
    // listener stopped hearing the gesture. The row's own listener must still fire.
    const container = new EventTarget();
    const row = new EventTarget(); // stands for a node that is no longer in the DOM
    let containerMoves = 0;
    container.addEventListener('touchmove', () => containerMoves++);
    const moves: Event[] = [];
    followTouchTargets([row], { move: (e) => moves.push(e), end: () => {} });

    row.dispatchEvent(touchEvent('touchmove'));
    row.dispatchEvent(touchEvent('touchmove'));

    expect(moves).toHaveLength(2);
    expect(containerMoves).toBe(0);
  });

  it('routes touchend and touchcancel to end', () => {
    const t = new EventTarget();
    const ends: string[] = [];
    followTouchTargets([t], { move: () => {}, end: (e) => ends.push(e.type) });
    t.dispatchEvent(touchEvent('touchend', 1));
    t.dispatchEvent(touchEvent('touchcancel', 0));
    expect(ends).toEqual(['touchend', 'touchcancel']);
  });

  it('listens on both fingers when they started on two elements', () => {
    const a = new EventTarget();
    const b = new EventTarget();
    let moves = 0;
    followTouchTargets([a, b], { move: () => moves++, end: () => {} });
    a.dispatchEvent(touchEvent('touchmove'));
    b.dispatchEvent(touchEvent('touchmove'));
    expect(moves).toBe(2);
  });

  it('stops listening once released, and a second release is harmless', () => {
    const t = new EventTarget();
    let calls = 0;
    const release = followTouchTargets([t], { move: () => calls++, end: () => calls++ });
    release();
    release();
    t.dispatchEvent(touchEvent('touchmove'));
    t.dispatchEvent(touchEvent('touchend', 0));
    expect(calls).toBe(0);
  });
});
