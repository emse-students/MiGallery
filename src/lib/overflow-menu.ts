import type { Component } from 'svelte';

/**
 * One entry of an overflow (three-dot) menu, rendered by `OverflowMenu.svelte`.
 *
 * Destructive actions (`danger`) live ONLY in such a menu, never behind a one-tap icon
 * (decision D4 in `docs/wiki/ui-redesign.md`): the menu is the second gesture that keeps a
 * resting thumb from deleting anything.
 */
export interface OverflowMenuItem {
  /** Visible, localized label (Paraglide). */
  label: string;
  /** Lucide icon component shown before the label. */
  icon?: Component<{ size?: number }>;
  /** Paints the entry in the error colour; the action keeps its own confirmation. */
  danger?: boolean;
  disabled?: boolean;
  /** Runs after the menu has closed and focus is back on its trigger. */
  onSelect: () => void;
}

/**
 * The index keyboard focus moves to in a menu of `count` entries, skipping disabled ones and
 * wrapping around (WAI-ARIA menu pattern). `delta` is +1 / -1 for the arrows; `Home` and
 * `End` pass `current = -1, delta = 1` and `current = count, delta = -1`. Returns -1 when
 * every entry is disabled.
 */
export function nextMenuIndex(
  current: number,
  delta: 1 | -1,
  disabled: readonly boolean[]
): number {
  const count = disabled.length;
  for (let step = 1; step <= count; step++) {
    const index = (((current + delta * step) % count) + count) % count;
    if (!disabled[index]) return index;
  }
  return -1;
}
