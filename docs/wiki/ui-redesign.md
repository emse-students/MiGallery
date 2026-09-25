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

| #   | Defect                                                                                                                                                                                                                                                                                                                                         | Where                                                                                                               | Change                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | Album titles truncated to ~10 characters on a phone.                                                                                                                                                                                                                                                                                           | `src/routes/albums/+page.svelte:711-721` (`nowrap` + `ellipsis`)                                                    | Title + meta BELOW the cover, `line-clamp: 2`.                                                                                                                                                                    |
| 6   | The lock icon is on every album, so it says nothing.                                                                                                                                                                                                                                                                                           | `src/routes/albums/+page.svelte:395-406`, helper 191-192                                                            | Show a badge only for the exception (shared / public link), as "Partagé" in the meta line.                                                                                                                        |
| 9   | The mobile bottom tab bar shows up to 1440 px (stretched across a desktop, labels 350 px apart); between 769 and 1440 px the album page has NO navigation at all.                                                                                                                                                                              | `src/lib/components/MobileNav.svelte:79-102`; `app.css:1643-1700`                                                   | Bottom bar <=768 px only; a left sidebar (~256 px) above that, collapsing to an icon rail on tablets. Logout moves into the avatar menu.                                                                          |
| 10  | Each page has its own side gutter (albums 1400, photos-cv 1200, paramètres 720) and the padding is applied twice: the global `main {}` rule hits the layout's `<main>` AND every page's own `<main>`.                                                                                                                                          | `app.css:477-485, 736-741`; `src/routes/+layout.svelte:169-171`; every `routes/*/+page.svelte` root                 | Pages stop rendering their own `<main>` (use a `div`); one container token for width and gutter. Left edges then align (title, search and section headers differ today).                                          |
| 15  | Album list: no filter chips, no sort, no list view; "Créer un album" is a full-width button and the search field is permanent.                                                                                                                                                                                                                 | `src/routes/albums/+page.svelte:308-324`                                                                            | Chips (Tous / Mes albums / Partagés), sort, search as an icon in the top bar (it keeps `fuzzyMatch`), "Nouvel album" as a tile.                                                                                   |
| 16  | Huge vertical gaps: ~150 px between "Créer un album" and the first year header on a phone; "Mes photos" spends half the first screen on the avatar and name; "Photos CV" centres its title where "Albums" left-aligns it.                                                                                                                      | `src/routes/albums/+page.svelte`, `src/routes/mes-photos/+page.svelte`, `src/routes/photos-cv/+page.svelte:108-250` | One page-header component (left-aligned title, optional subtitle, actions on the right) shared by every page.                                                                                                     |
| 17  | Photos CV nests the grid in a padded glass card inside the padded container, so thumbnails shrink further (~137 px gutters).                                                                                                                                                                                                                   | `src/routes/photos-cv/+page.svelte:171, 212, 350-360`                                                               | Drop the wrapper card.                                                                                                                                                                                            |
| 18  | Paramètres: one screen for one setting, big centred cards; "Choisir sa photo" does not look like a button; "Mode Clair" is ambiguous (current state or action?).                                                                                                                                                                               | `src/routes/parametres/+page.svelte:590-780, 1122-1132`                                                             | A list: row = icon, label, current value, chevron. Theme = Système / Clair / Sombre.                                                                                                                              |
| 25  | **Glassmorphism and glow everywhere**: on the signed-in albums page, 30 elements carry a `backdrop-filter`, 14 a `text-shadow`, 20 a gradient background, and the primary button a blue glow (`rgba(59,130,246,.16) 0 6px 18px`). Google Photos, same page: 0 of each. The user: _"les effets glow ... pas du tout l'esprit des app de 2026"_. | `src/app.css` (glass tokens, `.btn-glass`), `.glass-card`, `.glass-tabs` and every component using them             | Flat tonal surfaces, no glow, no text-shadow; `.btn-glass` replaced by plain button variants. Counted by the script in Canari `docs/wiki/ecosystem-convergence.md` section 12 - re-run it after, the target is 0. |

### P3 - accessibility and polish

| #   | Defect                                                                                                                                           | Where                                                  | Change                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 19  | Each album card is announced twice ("WEI 2026 .. WEI 2026 .."), the emoji comes out as "..".                                                     | `src/routes/albums/+page.svelte:364-446`               | One accessible name per card (`aria-label` = title + date), decorative text `aria-hidden`. |
| 20  | The album search field is absent from the Android accessibility tree.                                                                            | `src/routes/albums/+page.svelte:308-315`               | Check its label/role once the field becomes an icon + input.                               |
| 21  | Every thumbnail exposes hidden "Select / Download / Delete" buttons to assistive tech (`Select IMG_2042_DxO.jpg Download ... Delete ...`).       | `PhotoCard.svelte:236-291`                             | Hide the overlay from the tree when it is not shown (`inert` or conditional render).       |
| 22  | No web app manifest: MiGallery cannot be installed to a home screen, the cheapest way to an "app" on mobile.                                     | `static/`, `src/app.html`                              | `manifest.webmanifest` (name, icons, `display: standalone`, dark `theme_color`).           |
| 23  | The landing page offers two sign-in buttons ("Connexion" in the header and "Se connecter" in the card) and scrolls by 143 px with nothing below. | `src/routes/+page.svelte`, `src/routes/+layout.svelte` | One button; no scroll.                                                                     |

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
