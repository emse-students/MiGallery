# Photo grid - justified rows, virtualised

`PhotosGrid.svelte` renders every photo list (album, "Mes photos", Photos CV) the way Google
Photos does: days of **justified rows**, edge to edge on a phone, and only the rows near the
viewport in the DOM. The maths are pure and live in `src/lib/photo-grid-layout.ts` (pinned by
`tests/photo-grid-layout.test.ts`); the day select is `src/lib/day-selection.ts` (pinned by
`tests/day-selection.test.ts`). It shipped as redesign theme (3), [ui-redesign](ui-redesign.md)
#7, #8, #14, #24.

## The layout

`justifyRows(ratios, { containerWidth, targetRowHeight, gap })` places photos (width / height) in
rows. A row takes photos while its fill height stays above the target, then closes on whichever of
"with the next photo" or "without it" lands closer to the target. So:

- **every full row fills the width exactly** - the last tile takes what is left, absorbing float
  rounding (well under a pixel);
- **no photo is cropped out of its ratio** - width = ratio x row height;
- **the last row is not stretched** - it keeps the target height and natural widths, unless even
  that overflows (a lone panorama on a phone), in which case it is fitted to the width;
- a closed row's height stays within a factor of two of the target.

The ratio comes from `assetAspectRatio`: EXIF, then the raw EXIF, then the slim stream's `width` /
`height` ([bandwidth](bandwidth.md)), else 3:2.

| Metrics (`GRID_METRICS`) | Target row | Gap  | Day header | Where                                                |
| ------------------------ | ---------- | ---- | ---------- | ---------------------------------------------------- |
| `desktop`                | 300 px     | 4 px | 56 px      | viewport > 768 px, inside the page's container       |
| `phone`                  | 140 px     | 2 px | 48 px      | viewport <= 768 px, **edge to edge** (`100vw` bleed) |

Google Photos measures 304-373 px rows on desktop. The phone target keeps two 3:2 photos per row on
a 393 px screen, and keeps a tile inside the `thumbnail` (below).

Measured on Gala (707 photos, all 3:2) on 2026-09-25: rows are **277 px** at 1440x900 (grid 1254
px wide: three per row gives 277, two would give 417 - the target picks the closer), and **130 px**
on a 393x851 phone viewport, tiles 195.5 x 130 CSS px with 2 px gaps and no side gutter.

## Tile source - `thumbnail`, never `preview` (D1)

Immich's `thumbnail` now measures **600x400** (400 px on the short side, ~25 KB WebP). What a tile
needs is its CSS height x DPR (for a landscape photo, the short side is the height):

| Screen                          | Tile (CSS px) | Device px needed | `thumbnail` enough?                                 |
| ------------------------------- | ------------- | ---------------- | --------------------------------------------------- |
| Mi 9T, DPR 2.75, phone rows     | 195.5 x 130   | 538 x 358        | yes (600 x 400)                                     |
| Desktop DPR 1, 277-300 px rows  | ~415 x 277    | ~415 x 277       | yes                                                 |
| Desktop DPR 1.5 (Windows 150 %) | ~415 x 277    | ~623 x 416       | just short: ~1.04x upscale                          |
| Desktop DPR 2 (Retina)          | ~415 x 277    | ~830 x 554       | no: ~1.4x upscale - where `preview` would be needed |

The phone target was chosen so the phone case holds up to DPR 2.75: 140 x 2.75 = 385 < 400. The
grid was **not** switched to `preview` for high-DPR desktops: that is D1's rule
([bandwidth](bandwidth.md)), and the cost is a ~30x byte multiplier per tile. If Retina desktops
look soft, the lever is the `thumbnail` size again (Immich admin), not `preview`.

## Virtualisation (#24)

`buildGridBlocks` stacks the days into absolutely positioned blocks - a header, then that day's
rows - with the total height; the grid element takes that height. `visibleBlockRange` finds, by
binary search, the blocks within **one viewport of overscan** above and below; only those are
rendered. The window scroll is listened to passively and coalesced to one update per animation
frame, and the range state only changes when the slice does. Row keys are the day plus the first
tile's index, so a row whose first photo is unchanged keeps its DOM node while more photos stream in.

| Gala, 707 photos         | Before                    | After                            |
| ------------------------ | ------------------------- | -------------------------------- |
| DOM nodes, 1440x900      | 7339 (707 cards)          | 446 at the top, 629-657 mid-page |
| DOM nodes, 393x851 phone | 7345                      | 494 at the top, 720-725 mid-page |
| Page height, 1440x900    | 53 849 px                 | 67 164 px (bigger rows)          |
| Page height, phone       | 13 721 px (68 px squares) | 47 437 px (130 px rows)          |

A tile is re-mounted when it scrolls back into the window, so `PhotoCard` has no entrance
animation (it would replay on every scroll), and `LazyImage` loads it through the HTTP cache.

## Select a whole day (#14)

Each day header carries a check: shown while selecting or once part of that day is selected, and on
hover on a pointer device. `daySelectionState` reads `none` / `some` / `all`; a tap runs
`toggleDaySelection` - a fully selected day is cleared, any other is completed, other days are left
alone. A tap outside selection mode enters it; clearing a day never leaves it (see below).

## Selection mode (D9)

Google Photos' selection, for every host of the grid (album, Mes photos, Photos CV). The
transitions are pure, in `src/lib/selection.ts` (pinned by `tests/selection.test.ts`);
`PhotosState` keeps `selecting` + `selectedAssets` and delegates to them.

| Step        | How                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enter       | the album's "Sélectionner" (empty), a **long-press on a tile** (touch, 500 ms, that tile picked), the hover check of a tile (pointer devices), a day header's check       |
| While in it | every tile draws a ring; a tap toggles the tile and never opens the viewer; a picked tile shows a filled check and shrinks to an 8 % inset on an accent tint              |
| Top bar     | fixed over the site header, same height: close cross, "N sélectionnée(s)", "Tout sélectionner" (every SHOWN photo; "Tout désélectionner" once they all are)               |
| Actions     | Partager (where `navigator.canShare({ files })`), Télécharger, and a ⋮ with Retirer de l'album (managers, in an album) / Mettre à la corbeille (managers), each confirmed |
| Where       | on a phone (<= 768 px) in a bottom bar that covers the page's own bar and the tab bar; on a desktop at the right of the top bar                                           |
| Leave       | the cross, Escape (unless a dialog or a menu took it), or an action that consumed the selection (download, remove, delete). Leaving clears the selection                  |

**Deselecting the last photo does not leave the mode**: the button enters it empty, and the
actions are drawn DISABLED at 0 selected, never hidden. Rights are unchanged: remove and delete
keep the grid's `mitviste` / `admin` test exactly, and "Sélectionner" is offered to every
viewer, since the long-press and the day check already let anyone select and share / download
are open to anyone who sees the photo.

**Share** goes through `src/lib/share-files.ts`, the viewer's implementation (originals, the
kept-files second tap after a lapsed user activation), capped at `MAX_SHARE_FILES` = 25:
every original is fetched into memory before the sheet opens, so beyond that the toast points
at Télécharger.

**The bars are portalled to `<body>`**: the album page's container is `z-index: 1` and would
stack them under the site header (z 50). Nothing of the old panel survives: it was a sticky
card in the flow (224 px tall on a phone), deleted with its global class left only to the
bin page. The bars exist only while selecting (`{#if}`), the album's own bottom bar is not
rendered then, and its desktop toolbar is `inert` + `visibility: hidden` (it keeps its room, so
the grid does not jump).

**The long-press sheet is deleted.** Its four entries were: select (now the long-press itself),
download and delete (the selection's actions, or the viewer's), favourite (the viewer's heart on
Mes photos). The release of a long-press is `preventDefault`ed on `touchend`, else its click
would un-pick the tile at once; Chrome's image context menu is suppressed for that press only.
Drag-to-select across tiles (Google Photos' long-press-and-slide) is not built.

## Traps

- `app.css` still carries a GLOBAL `.photos-grid` (a CSS grid, 1rem gap) and `.photo-card` (square,
  rounded, hover shadow, a 3 px selection outline) for older pages. The grid and the card override
  them explicitly; renaming the classes would also drop the global round selection checkbox.
- The phone bleed (`width: 100vw; margin-left: calc(50% - 50vw)`) is clipped by any ancestor with
  `overflow: hidden`. The album page's root had `overflow-x: hidden` for no remaining reason (the
  blobs are `position: fixed` and clip themselves) and lost it. Photos CV still nests the grid in a
  card (#17), so it is clipped there until that card goes.
