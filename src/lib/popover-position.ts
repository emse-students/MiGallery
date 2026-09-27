/**
 * Where a popover anchored to a control goes: below it, or above it when there is more room
 * there and the content does not fit below. Shared by `OverflowMenu.svelte` and
 * `ProfilePicker.svelte`, both portalled to `<body>` with fixed coordinates because their hosts
 * clip their children (`overflow: hidden` on a card, a tile, a mask).
 */

/** The anchor's vertical extent, in viewport coordinates (a `DOMRect` fits). */
export interface AnchorBox {
  top: number;
  bottom: number;
}

export interface PopoverPlacement {
  /** Fixed `top` of the popover, in px. */
  top: number;
  /** The most the popover may be tall on the chosen side before it must scroll, in px. */
  maxHeight: number;
  /** Whether it opens upwards. */
  above: boolean;
}

/**
 * Places a popover of natural height `contentHeight` next to `anchor`, `gap` px away from it and
 * at least `margin` px inside a viewport `viewportHeight` tall. It opens below unless it would not
 * fit there AND the space above is larger - so near the bottom of the screen it flips, and in a
 * cramped viewport it takes the roomier side and scrolls within `maxHeight`.
 */
export function placePopover(
  anchor: AnchorBox,
  contentHeight: number,
  viewportHeight: number,
  gap = 4,
  margin = 8
): PopoverPlacement {
  const below = Math.max(0, viewportHeight - margin - (anchor.bottom + gap));
  const aboveSpace = Math.max(0, anchor.top - gap - margin);
  if (contentHeight <= below || below >= aboveSpace) {
    return { top: anchor.bottom + gap, maxHeight: below, above: false };
  }
  const height = Math.min(contentHeight, aboveSpace);
  return { top: anchor.top - gap - height, maxHeight: aboveSpace, above: true };
}
