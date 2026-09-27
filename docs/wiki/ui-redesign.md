# UI redesign - towards a Google Photos shape (audit of 2026-09-25)

The user's target, verbatim: _"une interface type Google Photos (sur web comme sur mobile)"_.
This page is the work list for that redesign: every defect found on 2026-09-25, the reference it is
measured against, and the file that carries it. **Delete each row the day it ships.**

How it was measured: production `gallery.mitv.fr` on a **Mi 9T** (Chrome Android, 393 CSS px wide,
DPR 2.75) and in desktop Chrome at 1440x900; the reference is Google Photos, the Android app on the
same Mi 9T and `photos.google.com` at 1440x900. Source locations are from `main` at `8b4b279`.

## The reference, measured

| Surface    | Google Photos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | MiGallery today                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation | Mobile: bottom bar. Desktop: **256 px left sidebar**, search as a wide field in the top bar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Bottom tab bar up to **1440 px**, stretched across the desktop; header carries a "Déconnexion" button                                                                                                                                                                                                                                                                     |
| Album list | 2 columns (mobile) / 254 px squares, ~32 px gap (desktop); **title below the cover, wraps to 2 lines**, then "N éléments - Partagé"; chips Tous / Mes albums / Partagés; sort + grid/list toggle; "New album" is a tile or a text button                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Title **over** the cover, one line, ellipsis (`WANA - C...` names two albums); download + delete in a three-dot menu on every card; a lock on every card; full-width "Créer un album" button and a permanent search field                                                                                                                                                 |
| Album page | **Phone (Mi 9T app, 2026-09-25)**: no site bar, no app bar; a FULL-BLEED cover hero under the status bar, ~1265 of 2340 device px (~54 %, ~510 dp); round translucent-dark ~40 dp buttons over it (back top-left; slideshow, overflow top-right); the title centred on the lower half over a dark scrim, very large (~70 CSS px at 393 px, wraps to 2 lines), then the date ("13 sept. 2025"), then a "Partagé" chip + a copy-link button; photos edge to edge right below; a floating 2-action pill (share, comment) at the bottom centre. **Desktop (photos.google.com shared album, 1440x900)**: top bar ~~64 px (logo; plain icon buttons: slideshow, share, comment, download, overflow); NO hero - the title alone, centred, 128 px condensed, weight 450, as typed, y=112-273; date 14 px at y=275; a centred "Partagées" + copy-link chip row at y~~305-330; **photos at y=357**, 24 px gutters, 4 px gap, rows 373 / 304 px (3 a row); a floating pill bottom-right. (The owner view measured earlier: cover hero, photos at y=296.) | **Shipped (D10)**: phone - cover hero 460 px tall at 393x851 (54 %), no site bar, floating back / overflow, title + date + count centred over a scrim, first photo at y=508; desktop - title-first, first photo at **y=350**, 32 px gutters, 302 px rows. Before: the site bar, a "Retour aux albums" link, a left-aligned title, photos at y=378 (desktop) / 332 (phone) |
| Photo grid | **Edge to edge**, ~2 dp gaps; mobile mosaic of 2-per-row and full-width tiles; desktop justified rows **304-373 px** tall, 4 px gap; fast-scroll handle; per-day select-all check in the day header; no buttons on tiles                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Mobile: 4 square columns inside a padded container; desktop: justified rows **220 px** tall, capped at 400 px wide                                                                                                                                                                                                                                                        |
| Viewer     | Full-screen black, no frame; top: back, **date/time as title**, favourite, overflow; bottom (mobile): 3 **labelled** actions; delete lives in the overflow; swipe = next, swipe down = close, pinch = zoom                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **Shipped (theme 6)**: full-screen black; back, date/time title (tap = info), favourite (mes-photos), overflow; phone bottom bar Share / Download. See [viewer](viewer.md)                                                                                                                                                                                                |
| Settings   | A compact list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | One centered card per setting, each with a large icon                                                                                                                                                                                                                                                                                                                     |

## Work list, by severity

### P1 - broken or dangerous on a phone

None open: #2, the last one, shipped with theme (2).

### P2 - the Google Photos shape

None open: #25, the last one, shipped in v2.15.0 (below).

### P3 - accessibility and polish

None open: #19-#23 shipped in v2.14.0 (below).

## Decisions taken by the user (2026-09-25)

- **D1 - raise Immich's thumbnail size, keep the grid on `thumbnail`.** The grid serves
  `size=thumbnail` only, **never `preview` at any DPR** ([bandwidth](bandwidth.md)), and that rule
  STANDS. Those thumbnails are 250 px on the short side (375x250 measured), already 2-3x too few
  pixels for the Mi 9T's tiles, and Google-sized tiles (#7, #8) make that worse. So the size of
  `thumbnail` itself goes up server-side (target 500 px WebP), done through the Immich admin API
  with a before/after measurement: bytes per grid, and sharpness on the Mi 9T. The result goes into
  [bandwidth](bandwidth.md).
  **Measured with theme (3)**: `thumbnail` is now 600x400 (~25 KB). A phone tile is 195.5 x 130 CSS
  px = 538 x 358 device px at DPR 2.75, so `thumbnail` is enough there; a 277-300 px desktop row
  is enough at DPR 1 and upscaled ~1.4x at DPR 2 - the one place `preview` would be needed, and the
  grid was NOT switched ([photo-grid](photo-grid.md#tile-source---thumbnail-never-preview-d1)).
- **D2 - "add photos" is a "+" button in the album's action bar**, shown only to users allowed to
  upload, opening the file picker. On desktop, dragging files anywhere over the page reveals the
  drop zone; it is never on screen otherwise.
- **D3 - desktop navigation is a left sidebar** (~256 px, icon rail on tablets); the bottom bar is
  <=768 px only; "Déconnexion" moves into the avatar menu (#9).
- **D4 - delete lives in the overflow menu everywhere**: none on album cards, the overflow in the
  album page and the viewer, with the existing confirmation (#3).
  **PR 1 shipped it** as one component, `OverflowMenu.svelte`, in the viewer toolbar, the album
  page's action bar, the photo tiles (pointer devices; touch long-presses into selection, D9) and
  the album cards. On the cards the menu still holds delete, next to "Download (ZIP)", until PR 5
  redraws them; D4's "none on album cards" is met then. The selection's bulk delete sits in the
  selection bar's own overflow (D9) and needs a selection first.
- **D5 - album cards put the title BELOW the cover**, 2 lines max, then "N photos - Partagé" (#5, #6).
- **D6 - one pull request per theme**, each checked on the Mi 9T before it merges, **flat surfaces
  FIRST** so no component is restyled twice: (0) flat surfaces #25, (1) touch safety #1 #3 #4,
  (2) album page #2 #12 #13, (3) grid and thumbnails #7 #8 #14 #24 + D1, (4) navigation and layout
  #9 #10 #16 #17, (5) album list #5 #6 #15, (6) viewer #11, (7) settings, accessibility and manifest
  #18-#23.
  **(3) is shipped**: the Google Photos grid - justified rows (target 300 px desktop; on the
  phone 90 px, three landscape photos a row, and a pinch between 2, 3 and 4 a row - see
  [photo-grid](photo-grid.md#density-and-the-pinch)), edge to edge with 2 px gaps on a phone, the 400 px width cap gone, a select-all check on
  each day header, and the rows virtualised: Gala (707 photos) went from 7339 DOM nodes to 446 at
  1440x900. The maths, the metrics and every measurement are on [photo-grid](photo-grid.md).
  **(2) is shipped**: an album's first screen is photos. The upload box left the flow -
  `UploadZone` `variant="page"` renders nothing while idle, a full-window drop overlay appears only
  while files are dragged over the page on a fine pointer, and its progress panel only once files
  are queued; the "+" ("Ajouter", uploaders only) opens the file picker (D2). The action bar is
  labelled and one colour - add, share, download, select - with edit and delete in the overflow;
  the grid's hardcoded count is gone (`PhotosGrid showCount={false}`, the header keeps its own).
  Measured on Gala (707 photos): the first photo went from y=859 to y=378 at 1440x900, and from
  y=897 (below the fold) to y=332 on a 393x851 phone viewport.
  **(1) is shipped**: swipe / swipe-down / tap / double-tap / pinch in the viewer, with the
  maths in `src/lib/viewer-gestures.ts` and every threshold on [viewer](viewer.md); delete behind
  the overflow (D4); every hover reveal on a tile behind `@media (hover: hover) and (pointer: fine)`,
  which also fixes touch tablets wider than 768 px. The single tap already toggles an immersive
  black view; the full-screen frame itself is #11.
  **(6) is shipped**: the full-screen viewer, #11 deleted - the frame, the title, the info panel
  and the share path are on [viewer](viewer.md).
- **D7 - flat, but the identity stays.** The user, verbatim: _"il ne faut pas non plus perdre
  l'identité de l'app evidemment, les blobs en fond par exemple donnent de la profondeur"_.
  Components lose their glass, glow and text-shadow; the soft blobs in the page BACKGROUND stay,
  and so do the dark-first palette and the logo.
- **D8 - every MiGallery page copies Google Photos, on the phone AND on the computer.** The user,
  verbatim: _"Il faudra aussi modifier toutes les interfaces web pour copier Google photo
  aussi"_. That is the albums list, Mes photos, Photos CV, Paramètres, the admin pages and the
  desktop shell (photos.google.com: a ~256 px left sidebar, search at the top, the bottom bar only
  <= 768 px). The work-list rows still open above are the plan for it.
- **D9 - selection mode is Google Photos', and a long-press ENTERS it.** Tapping "Sélectionner",
  long-pressing a tile (touch), the hover check of a tile (pointer) or a day header's check
  enters it; a tap then toggles a tile instead of opening it; a top bar replaces the site header
  (close, "N sélectionnée(s)", "Tout sélectionner") and the bottom bar swaps to the SELECTION's
  actions (Partager, Télécharger, ⋮ Retirer de l'album / Mettre à la corbeille), disabled at 0,
  never hidden. The long-press used to open an action sheet (#326: select, favourite, download,
  delete); that sheet is DELETED rather than kept beside the new mode, because a long-press
  cannot mean two things and Google Photos, the reference, uses it to select. Its other
  entries were already reachable: download / delete from the selection or the viewer, favourite
  from the viewer's heart. The old floating selection panel is deleted too. Mechanism, rights
  and traps: [photo-grid](photo-grid.md#selection-mode-d9). The album-level "Télécharger" keeps
  its ZIP of every photo, and its confirmation now reads "Télécharger les 707 photos ?" with the
  number of archives (200 photos each); it cannot state a size, which the grid stream does not
  carry.
- **D10 - the album page opens on its cover, Google Photos' way.** On a phone (<= 768 px) the
  site bar steps aside on `/albums/[id]` and the page starts with a full-bleed hero cut from the
  album's cover (`albums.cover_asset_id`; an album with none is given one by `resolveCover`,
  Immich's album thumbnail or its first photo, and persisted - data, not a second path), about
  54 % of the screen (`clamp(320px, 54svh, 600px)`), loading the cover's `preview`: a
  1265-device-px hero would upscale the 600x400 `thumbnail` ~3x, and one preview per album
  opened is what the viewer pays per photo. The title, the date and the photo count sit centred
  on its lower half over a scrim - the one gradient the flat bar allows, under text over a photo.
  Back and the overflow are round translucent-black buttons that float over the hero and stay
  fixed over the photos once scrolled; the "Retour aux albums" link is gone. In selection mode
  the selection bar owns the top and those buttons are `inert` and hidden. On a desktop the page
  is title-first, as photos.google.com measures: no hero (the preview is not even requested), a
  large centred title, date and count, the labelled actions on a row with the back button.
  **The phone's bottom bar STAYS a full-width bar, not Google's floating pill**: Google's pill
  carries two actions, ours carries four labelled ones (Ajouter, Partager, Télécharger,
  Sélectionner - the overflow moved up to the hero), which at 393 px would make a pill as wide as
  the bar while losing its labels or its thumb reach. Code: `src/lib/album-hero.ts` (pinned by
  `tests/album-hero.test.ts`), `src/routes/albums/[id]/+page.svelte`.
- **D11 - the album page's background is its cover, heavily blurred.** The user, verbatim:
  _"Pour le fond de l'album, on peut prendre la couverture et mettre un flou important, ou une
  chose similaire"_. One fixed layer behind the hero and the grid, on phone and desktop: the
  album's 400x400 cover WebP (disk-cached, `immutable` once versioned - never the original),
  `blur(48px)`, oversized by 10vmax on every side so the blur's soft edges stay off screen, then
  70 % of the page colour over it so text keeps its contrast in both themes. Static and fixed,
  so a scroll repaints nothing. It is a page BACKGROUND, the identity layer D7 keeps (it replaces
  the blobs on this page; an album without a cover keeps them) - no component turns to glass.
- **Order**: the student sites Sky, Le Cercle and Canari are audited FIRST against the same bar
  (plus Material 3 / Apple HIG / WCAG 2.2), then the code starts.

## The bars no longer stretch at the top of a page (2026-09-26)

The user saw the bottom bar "change size" when scrolling back to the top. A 15 fps screen recording on
the Mi 9T measured it: when a scroll overshot the top, the bar's top edge went from 2091 to 2104 device
px and the header's from 379 to 382 - both displaced in proportion to their distance from the top.
That is Chrome Android's overscroll STRETCH, which scales the whole page from the top, fixed bars
included; nothing in the bars depends on the viewport. `overscroll-behavior-y: none` on `html` and
`body` removes it (and Chrome's pull-to-refresh, which an app with a bottom bar does not offer). The
same recording on the fix: the edge stays at 2090-2093 throughout.

## Open question from the same session

- **`gallery.mitv.fr` answered Cloudflare error 1033 once, at 12:19:46 UTC (Ray `a409faa66e68078b`)**,
  and 200 on every probe a minute later. `cloudflared` was `active` and `migallery-migallery-1`
  `Up 17 minutes (healthy)`, so it had restarted around 12:03 UTC. The `cloudflared` journal for that
  minute was not read (the agent was not permitted to); it is what separates a tunnel reconnect from
  something else.

## The home page no longer repaints itself on load (2026-09-26)

The user saw the blobs "load twice" and the greeting flip from "Bonsoir" to "Bonjour" at night. Both were
the server render and the hydration drawing their OWN value: `BackgroundBlobs` called `Math.random()`
in each (a readyState-`interactive` snapshot of the server HTML against the hydrated DOM: `#AC52FF` at
12.5% became `#FF3F3F` at -3.0%), and the greeting read the container's clock - UTC, so 22:47 and
"Bonsoir" - then the browser's, 00:47 and `hour < 18` = "Bonjour". `$lib/first-paint` now derives both
from ONE `{ seed, at }` the root layout picks and SvelteKit serializes into the page; the greeting reads
it on the Paris clock, and midnight to 5 a.m. has its own lines ("Encore debout, X ?"), the variant
chosen by the day. Same snapshot after: identical blobs, identical heading.

## The albums list copies Google Photos (2026-09-26)

Rows #5 and #6. Measured on the Mi 9T app: the title with a magnifier and a `+` on one row, two
columns of square covers at 16dp margins and gap, the title BELOW the cover on up to two lines, no
menu and no mark on a card. So: the standing search field and the filled "Créer un album" button are
two icon buttons (the field opens on demand); the caption left the gradient over the cover, which cut
every long title to one line; the per-card overflow menu is gone because download and delete are in
the album's own menu; a visibility mark shows only for the exceptions (private, unlisted), to the
people who can set them. School years stay as small folding headings - with 300 albums they are what
keeps the page short - but the month headings under them went: Google Photos puts none between tiles.
Measured at 393px: 16px margins, 173px tiles, no horizontal scroll.

## Desktop polish from the user's review (2026-09-26)

- **Album header**: 2.5rem between the action pill and the title, which a long title used to crowd.
- **Bars**: the top bar and the bottom bar take the action pill's material - the page colour at 70%
  with a 20px blur. The blur is load-bearing, not decoration: both bars are sticky and photos scroll
  under them.
- **Dialogs** (`Modal.svelte`, so every one): the dark theme overrode the opaque surface with a
  78%-opaque one and no blur, so the album showed through "Modifier l'album". It is opaque again; the
  page behind is dimmed AND blurred; the scroll area reaches the dialog's edge so its scrollbar runs
  along the border rather than over the fields; a short scale-in on open.
- **Viewer**: 1rem side margins and a 4.5rem bar on a computer (the title hugged the corner). The
  "Informations" panel slides in from its side (up on a phone) and is laid out like Google Photos': an
  icon per fact, a main line and its detail - the file with its size and pixels, the camera with its
  lens and exposure, the place when EXIF has one (`exposureLine`, `dimensionsLine`, `placeLine` in
  `$lib/viewer-info`, tested).
- **Face card**: the info icon sat on a line of its own above the note (a lucide svg is a block);
  "Importer une photo" wrapped to two lines. The camera buttons' French literals became Paraglide.

## Photos CV copies the albums list (2026-09-26)

Point 3 of the user's desktop review. The admin tab opened on an upload card that filled the first
screen, as the album page did before #330; it now takes the album page's page-level upload - a `+`
in the title row opens the picker, a drop anywhere on the window works, the progress panel appears
only once files are queued. The header is the albums list's (title left, one icon action); the
sliding segmented control became Google Photos' filter chips; the personal-name heading and its
"Personnel" badge went (the chip already says whose photos these are); the pagination is two icon
buttons around the page number. The mobile-only `!important` colour overrides for the upload card
went with it. Measured at 393px: photos from 0 to 393, title at 16px, no horizontal scroll.

## The drop overlay is glass, not a grey screen (2026-09-27)

`UploadZone`'s `page` variant covered the window with an opaque `--bg-elevated` card while files
were dragged over it. It now follows the dialogs (`Modal.svelte`): the page at 45 % tint behind a
`blur(12px)`, a dashed accent frame over an 8 % accent wash, and the label on an OPAQUE pill -
over a blurred photo grid bare text had no contrast (measured on the rig in both themes, 1440x900).
Fade-in (0.18 s), a 0.97 scale on the frame, a slow float on the icon; all three stop under
`prefers-reduced-motion`.

Two fixes shipped with it: Photos CV no longer prints the page size as a count (`showCount={false}`,
the album page's switch), and `ChangePhotoModal` uses theme tokens instead of hard-coded white text.

**Desktop sidebar decided (user, 2026-09-27):** from 769 px up, a Google-Photos left sidebar
(~256 px) replaces the bottom bar, which stays for phones only (row #9).

## The desktop sidebar (row #9, 2026-09-27)

Decided by the user on 2026-09-27: Google Photos' left sidebar. `SideNav.svelte` shows above
768 px - a 256 px drawer of icon + label rows from 1100 px, an 80 px rail (icon in a pill, label
under it) between 769 and 1099 px - and `MobileNav` only at 768 px and below (it used to show up to
1440 px, stretched across a desktop). Both draw `NAV_ITEMS` from `src/lib/nav-items.ts`, so a new
destination reaches both; the top bar lost its own copy of the links. The album page keeps the
sidebar, which closes the "no navigation between 769 and 1440 px" half of the row.

**Why the width tokens moved out of `@layer components`.** `:root` is unlayered, and an unlayered
declaration beats every layered one, so a `:root` override inside `@layer components` never
applies. The rail's `--sidenav-width: 80px` failed that way on the first render (the rail drew at
256 px), and the same measurement showed the phone's `--topbar-height: 56px` and
`--container-padding: 1rem` had NEVER applied: the phone bar measured 64 px. Those two dead lines
were deleted rather than revived, so the phone keeps the layout already checked on the Mi 9T; the
live overrides (`--mobile-nav-height`, `--sidenav-width`) sit in unlayered media blocks after
`:root`.

Rows #5, #6, #9 and #17 shipped and were pruned from the work list.

## Paramètres is a list (row #18, 2026-09-27)

Google Photos' settings shape: a left-aligned title, groups under a small heading (Profil,
Apparence, Reconnaissance faciale, the two sharing groups, Administration, Compte), each group ONE
flat card of rows. `SettingsRow.svelte` is the row - icon, title, optional description, and on the
right either a control or a chevron when the whole row is the action; it renders a link, a button
or a plain block according to that job. The free-content groups (face capture, sharing lists) keep
their bodies inside the same card; an empty list is one quiet line instead of an `EmptyState`.

**The theme is Système / Clair / Sombre.** The old button showed the theme it would switch TO, so
"Mode Clair" read as a state and acted as an action. `src/lib/theme.ts` now stores a preference
(`system` follows `prefers-color-scheme`, live) and `parsePreference` reads anything unknown -
including nothing stored - as `system`, so a user who never chose now gets their device's theme
instead of dark. `app.html` applies the same rule inline before the first paint: the store only ran
after hydration, which painted every light user dark for a frame.

**Dead global rules removed from `app.css`:** `.settings-main button { margin: 1rem 0 }` (it doubled
the theme pill's height and padded every row button), the `h3` rules of the old page, and
`.blob-1..3`, which nothing has drawn since `BackgroundBlobs` took the seeded blobs.

Row #18 shipped and was pruned from the work list.

## One page header (row #16, 2026-09-27)

`PageHeader.svelte` is the header of Albums, Mes photos, Photos CV and Paramètres: a left-aligned
title with an optional subtitle, an optional `leading` element and `below` line, and `actions` on
the right. The round 44 px icon buttons those actions use are `IconButton.svelte` (a required
label becomes the accessible name and the tooltip), which Photos CV's pager uses too - the same
rule had been copied into two pages. Mes photos' header was a 140 px centred portrait that spent
half a phone screen before the first photo; it is now a 56 px face beside the name, with a camera
badge when tapping it changes the profile photo (Google Photos' person page).

Removed with it: the per-page `.page-header` / `.header-icon` copies, and from `app.css` the global
`.page-header`, `.header-content`, `.page-title`, `.page-title-center` and `.header-section` rules
nothing renders any more. `main h1 { font-weight: 800 !important }` stays: a layered `!important`
beats an unlayered one, so a component cannot override it - the header's title is 800 on purpose.

Row #16 shipped and was pruned from the work list.

## Row #15 closed without chips (user, 2026-09-27)

Google Photos' "Mes albums / Partagés" chips filter on ownership and sharing, and a MiGallery album
has neither: every album is a school event, visible to the whole school (`Album` carries only a
`visibility`). Offered a sort and a "where I appear" chip instead, the user kept the list as it is -
school-year groups, the search icon and the + icon, which already covered the rest of the row.

**Next (user, 2026-09-27):** Canari's viewers before the rest of MiGallery's D8 (#10, #25, P3).

## One container, one sign-in, and the accessibility rows (#10, #19-#23, 2026-09-27)

- **#10 - one page container.** The layout's `<main>` is the only element that sets the page's
  width and side gutter (`--max-width: 1400px`, `--container-padding` in `app.css`); every page
  renders a `div`, never a second `<main>` - Paramètres, the home page, the CGU and the admin
  shell were the ones left - and no page sets its own `max-width` or side padding. Measured: at
  393 px every page starts at x=16 (Paramètres was at 32, the gutter applied twice); at 1440x900
  the titles, headings and first tiles of Albums, Photos CV and Paramètres all start at x=288
  (256 sidebar + 32 gutter; Albums was at 304). Paramètres keeps a 720 px readable column, flush
  left like Google Photos' settings rather than centred. The dead global `.home-main`,
  `.settings-main` and `.albums-main` rules went from `app.css`.
- **#23 - one sign-in, no scroll.** The top bar hides its "Connexion" on the home page, whose card
  carries the one button. The landing scrolled because `main` reserved the phone's bottom bar
  (72 px) with no bottom bar drawn when signed out, plus the old global `.home-main` margins:
  `.app-shell:not(.has-sidenav)` now sets `--mobile-nav-height: 0px`, and the home page fills
  exactly the layout's content box (`100svh` less the bar and the paddings). Measured: 900 of 900
  px at 1440x900, 851 of 851 at 393x851.
- **#19 - one name per album card.** The link's `aria-label` is "title, date" (plus "Visibilité : privée" or
  "Visibilité : non répertoriée" for the marked exceptions); the visible title and date are `aria-hidden`.
- **#20 - the search field.** It opens on demand (#5) and is in the tree as a `search` landmark
  holding a textbox named "Rechercher des albums" (Chrome's accessibility snapshot); the input
  gets `inputmode="search"` and `enterkeyhint="search"`.
- **#21 - the tile overlay.** `PhotoCard`'s favourite button and overflow menu are
  `visibility: hidden` until shown, not only `opacity: 0`: a transparent button stays in the
  accessibility tree. Hover (fine pointers) and the tile's keyboard focus reveal them; the hover
  check was already `display: none`. The favourite button's `aria-label` was a hard-coded English
  "Add to favorites"; it is the Paraglide message the tooltip already used.
- **#22 - the manifest.** `static/manifest.webmanifest`: standalone, opens on `/albums`, dark
  `theme_color` / `background_color` (`#0d0d0d`, the dark `--bg-primary`), the 192 and 512 px
  logo PNGs. They are transparent, so they are declared `any`, not `maskable`.

Rows #10 and #19-#23 shipped in v2.14.0 and were pruned from the work list.

## No glass on the bars, no glow anywhere (#25, 2026-09-27)

Counted with the section-12 script of Canari's `ecosystem-convergence.md` (computed `box-shadow`
coloured or blurred >= 24 px, `backdrop-filter`, `text-shadow`, gradient backgrounds, blur on
`::before`/`::after`), signed in, dark theme, on the rig, on the landing, Albums, an album, Mes
photos, Photos CV and Paramètres, at 1440x900 and 393x851:

|                  | glow  | `backdrop-filter`                                             | `text-shadow` | gradients                                                        |
| ---------------- | ----- | ------------------------------------------------------------- | ------------- | ---------------------------------------------------------------- |
| Before (v2.14.0) | 0     | 1 per page at 1440 (the top bar), 2 at 393 (top + bottom bar) | 0             | the 6 background blobs; +2 on Mes photos; the album hero's scrim |
| After (v2.15.0)  | **0** | **0**                                                         | **0**         | the same: blobs (D7) and the scrim under the hero title          |

The 30 glass surfaces and 14 text-shadows of the audit had already gone with the v2.3.0 flat pass;
`.btn-glass`, `.glass-card` and `.glass-tabs` no longer exist. What was left and changed:

- **The two bars** are opaque `--bg-primary` with a hairline: photos scroll under a sticky bar,
  and an opaque one keeps it legible without the 20 px blur. The bottom bar lost its shadow too.
- **Shadows of 24 px and more**, which the count calls glow: `ChangePhotoModal`'s current photo and
  its hover lift, the drop overlay's label pill (a hairline now), the admin trash's hover lift and
  its ACCENT glow on a selected card.
- **Coloured rings** are outlines, not box-shadows: the input focus ring (`app.css`), the picked
  photo in `ChangePhotoModal`, a selected card in the admin trash.
- **`Skeleton`**: the sweeping shimmer gradient became the placeholder breathing in its own tone,
  stopped under `prefers-reduced-motion`.

**Kept, and the user's call to revisit**: two transient surfaces still blur the page behind them -
the dialogs' `::backdrop` (`Modal.svelte`, `blur(8px)`) and the drop overlay (`UploadZone`,
`blur(12px)`). Both were asked for after this row was written (the 2026-09-26 review and the
2026-09-27 drop-overlay decision), they exist only while a dialog is open or files are dragged,
and neither is a glow. Removing them is two lines each.

## The phone's bottom bar is Instagram's (2026-09-27)

From the user: the bar showed a text label under each icon, which most phone apps do not. Its
shape is now the one Canari measured on Instagram on the Mi 9T (Canari
`docs/wiki/frontend/design-reference.md` section 23, "The two bars"): **48 px** plus the
safe-area inset (it was 72), a **24 px** glyph, **no text** - each tab's full name is an `sr-only`
accessible name, pinned non-empty in every locale by `tests/nav-items.test.ts` -, four tabs of 98 x
48 px at 393 px (the floor is 44), and the active tab marked by the glyph alone: the accent tint
and a 2.5 stroke instead of 2, no underline, no glow. MiGallery has no unread mark; if one comes,
it is a 6 px dot with no ring, centred under the glyph. `--mobile-nav-height` in `app.css` is the
same 48 px + inset, so `main` reserves exactly the bar.

## Buttons centre only when they say so (2026-09-27)

`app.css`'s shared button rule gave EVERY button `justify-content: center`, so a row that fills
its width and forgot to override it drew its content in the middle - it misaligned the overflow
menus (#337). The shared rule now only makes a button an inline flex row; `.btn` alone adds
`justify-content: center`. A button whose box is its content is unaffected either way. Measured by
the offset of every visible button's content inside its box, before and after, on Albums, an
album (its menu, "Modifier" open, a tile's menu, the viewer's menu), Mes photos (a tile's menu),
Photos CV, Paramètres ("Supprimer mon compte" open), the home page and three admin pages, at
1440x900 and 393x851: the ONLY rows that moved are the admin documentation's table of contents,
which went from centred to left-aligned at 12 px - the intended fix. Every menu, dialog button and
settings row already stated its own alignment.

## Three leftovers of the accessibility pass (2026-09-27)

- **Every photo tile names itself.** A tile is a `role="button"` whose name came from its
  thumbnail's `alt`; the thumbnail is lazy, so every tile below the fold (21 of 42 on Gala at
  393 px) was a button with no name - not only the placeholders. `PhotoCard` now carries
  `aria-label` = the file name, or "Photo en cours de chargement" (`pg_tile_loading`) with
  `aria-busy` while its details load. Measured: 0 of 42 unnamed.
- **The year heading reads as a phrase.** The visible count is `aria-hidden` and an `sr-only`
  `albums_year_count` ("14 albums", plural in fr and en) is read instead: the button is announced
  "2026-2027 14 albums". `.sr-only` is now one global utility in `app.css` (MobileNav's scoped
  copy went).
- **`theme-color` follows the painted theme.** It was a fixed accent blue (`#3b82f6`) from the
  layout. It is now each theme's `--bg-primary` (`THEME_COLORS` in `$lib/theme-preference`,
  `#0d0d0d` / `#ffffff`, the manifest's `theme_color` being the dark one), set before the first
  paint by `app.html`'s inline script and repainted by `theme.ts` on every change - checked on the
  rig for Système / Clair / Sombre. `tests/theme.test.ts` pins the four copies (app.css, the
  manifest, app.html, the constant) to each other.
