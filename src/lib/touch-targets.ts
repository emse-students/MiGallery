/**
 * Follow a multi-touch gesture on the elements its touches STARTED on
 * (`docs/wiki/photo-grid.md#density-and-the-pinch`).
 *
 * A touch's every later event is dispatched to the element it started on, even once that element
 * has left the DOM - and a detached element no longer bubbles anything to its old ancestors. A
 * gesture that re-renders what is under the fingers (the grid's density step) therefore goes deaf
 * if it listens on a container. Listening on the touch targets themselves keeps hearing it.
 */

/** What a followed gesture reacts to. */
export interface TouchFollowHandlers {
  /** A finger moved. May run twice for one move when two fingers started on two elements. */
  move: (e: TouchEvent) => void;
  /** A finger lifted or the gesture was cancelled. */
  end: (e: TouchEvent) => void;
}

/** The touch targets of `touches`, each once, skipping a touch with no target. */
export function distinctTargets(touches: ArrayLike<Pick<Touch, 'target'>>): EventTarget[] {
  const out = new Set<EventTarget>();
  for (const touch of Array.from(touches)) if (touch.target) out.add(touch.target);
  return [...out];
}

/**
 * Listens for `touchmove`, `touchend` and `touchcancel` on every target in `targets`, passively.
 * Returns the function that removes all of them; calling it twice is harmless.
 */
export function followTouchTargets(
  targets: EventTarget[],
  handlers: TouchFollowHandlers
): () => void {
  const move = handlers.move as EventListener;
  const end = handlers.end as EventListener;
  for (const t of targets) {
    t.addEventListener('touchmove', move, { passive: true });
    t.addEventListener('touchend', end, { passive: true });
    t.addEventListener('touchcancel', end, { passive: true });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const t of targets) {
      t.removeEventListener('touchmove', move);
      t.removeEventListener('touchend', end);
      t.removeEventListener('touchcancel', end);
    }
  };
}
