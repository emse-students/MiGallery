# The photo viewer - gestures and the overflow menu

The viewer is `src/lib/components/PhotoModal.svelte`. Its gestures copy Google Photos on the
same phone (decided by the user on 2026-09-25, see [ui-redesign](ui-redesign.md)). The maths
live in a pure module, `src/lib/viewer-gestures.ts`, pinned by `tests/viewer-gestures.test.ts`;
the component only feeds it coordinates and applies the answer.

## The gestures

| Gesture                           | When                   | Effect                                                                              |
| --------------------------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| Horizontal swipe                  | photo not zoomed       | the photo follows the finger, the neighbour slides in; snaps to it or springs back  |
| Swipe down                        | photo not zoomed       | the photo follows the finger and shrinks, the frame fades; closes or springs back   |
| Single tap                        | any                    | toggles the toolbars (immersive black view), confirmed after 250 ms                 |
| Double tap                        | any                    | zooms to 2.5x on the tapped point; a second one resets to 1x                        |
| Pinch                             | any                    | multiplicative zoom anchored at the finger midpoint; a two-finger drag pans with it |
| One-finger drag                   | photo zoomed (> 1.01x) | pans, clamped so the photo keeps covering the frame; never navigates nor closes     |
| Swipe up                          | photo not zoomed       | nothing yet (reserved for an info panel, #11)                                       |
| Wheel / double-click / arrow keys | desktop                | unchanged: zoom at the pointer, toggle zoom, previous / next                        |

A touch sequence stays `pending` inside a 10 px slop, then is classified ONCE by
`classifyMove` and keeps that class until every finger lifts, so a swipe that curves does not
change nature half-way. A second finger turns anything into a pinch (a live swipe springs back).

## The thresholds, and why

All of them are in `GESTURE`, the one place to tune them.

- **Tap slop 10 px, tap at most 300 ms.** Android's touch slop is 8 dp; 10 CSS px is the same
  order on the Mi 9T.
- **Double tap: second tap within 250 ms and 50 px.** 250 ms is also how long a SINGLE tap waits
  before it toggles the toolbars: a surface carrying both gestures cannot know a tap is single
  until the window has passed. 250 ms is the usual web figure; Android uses 300.
- **Swipe commits past 25 % of the width, or on a flick** of at least 0.4 px/ms over at least
  24 px (ViewPager's `MIN_DISTANCE_FOR_FLING` is 25 dp) in the SAME direction as the drag - a
  drag flicked back is a change of mind and springs back. Past the first or last photo the image
  moves at 30 % of the finger and always springs back.
- **Swipe down closes past 20 % of the height, or on a downward flick** (same flick rule). The
  backdrop is fully faded at 50 % of the height, where the photo is at 75 % of its size.
- **Velocity is measured over the last 100 ms** only, so a slow drag ended by a flick reads as
  the flick.
- **Every snap takes 220 ms**, and 0 under `prefers-reduced-motion`.

## How a swipe avoids reloading anything

The track renders three slides - the photo and its two neighbours - keyed by asset id. The
neighbours load their `preview` (at most two extra previews per photo shown, see
[bandwidth](bandwidth.md)). When a swipe commits, the track animates to the neighbour, then the
asset id changes and the track re-centres IN THE SAME FLUSH: the keyed neighbour element becomes
the current one, with its image already decoded. `mediaUrl` is derived from the asset id, so no
render ever shows the new slide with the old photo's URL. Snaps use the Web Animations API, whose
`finished` promise resolves even when start and end are equal - a `transitionend` would never
fire then.

## Constraints kept

- **Outside click** still needs `pointerdown` AND `pointerup` on the backdrop (see CLAUDE.md).
- **Touch listeners are attached by hand with `passive: false`**: Svelte registers
  `ontouchstart` / `ontouchmove` as passive, where `preventDefault()` is ignored. A tap's
  `touchend` is `preventDefault`ed so a double tap is not also a `dblclick`.
- **A video's taps belong to its native controls**: no tap toggle, no zoom on a video.

## The overflow menu - where delete lives

`src/lib/components/OverflowMenu.svelte` is the ONE three-dot menu (decision D4): the viewer
toolbar, the album page's action bar, the photo tiles and the album cards. No destructive action
is a one-tap icon any more; each keeps its existing confirmation. It follows the WAI-ARIA menu
button pattern (`aria-haspopup`, `role="menu"`, arrows / Home / End, Escape closes and focus
returns to the trigger; the focus maths are `nextMenuIndex` in `src/lib/overflow-menu.ts`). The
menu is portalled to `<body>` with fixed coordinates, because album cards and tiles clip their
children and the viewer is its own stacking context. It `preventDefault`s the keys it consumes,
and the viewer's window listener ignores a prevented key, so Escape closes the menu and not the
viewer.

On a photo tile the menu, the selection check and the favourite button appear on hover only
under `@media (hover: hover) and (pointer: fine)`: a touch screen keeps a sticky `:hover` on the
last tile tapped. Touch devices use the long-press sheet instead, whatever their width.

## Owed a device check

- The swipe, dismiss and double-tap feel on the Mi 9T (thresholds are tuned on paper).
- A swipe on a VIDEO's scrubber: the container has `touch-action: none` and a horizontal drag
  there is classified as a swipe; whether that fights the native scrubber is unmeasured.
