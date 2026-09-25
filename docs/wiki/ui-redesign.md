# UI redesign - towards a Google Photos shape (audit of 2026-09-25)

The user's target, verbatim: _"une interface type Google Photos (sur web comme sur mobile)"_.
This page is the work list for that redesign: every defect found on 2026-09-25, the reference it is
measured against, and the file that carries it. **Delete each row the day it ships.**

How it was measured: production `gallery.mitv.fr` on a **Mi 9T** (Chrome Android, 393 CSS px wide,
DPR 2.75) and in desktop Chrome at 1440x900; the reference is Google Photos, the Android app on the
same Mi 9T and `photos.google.com` at 1440x900. Source locations are from `main` at `8b4b279`.

## The reference, measured

| Surface    | Google Photos                                                                                                                                                                                                                            | MiGallery today                                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation | Mobile: bottom bar. Desktop: **256 px left sidebar**, search as a wide field in the top bar                                                                                                                                              | Bottom tab bar up to **1440 px**, stretched across the desktop; header carries a "Déconnexion" button                                                                                                                     |
| Album list | 2 columns (mobile) / 254 px squares, ~32 px gap (desktop); **title below the cover, wraps to 2 lines**, then "N éléments - Partagé"; chips Tous / Mes albums / Partagés; sort + grid/list toggle; "New album" is a tile or a text button | Title **over** the cover, one line, ellipsis (`WANA - C...` names two albums); download + delete in a three-dot menu on every card; a lock on every card; full-width "Créer un album" button and a permanent search field |
| Album page | Full-bleed cover hero (title, date, sharing chip, copy link), **photos start at y=296** (desktop); actions = icons in a thin top bar + a 2-action floating pill (mobile); "add photos" in the overflow menu                              | Upload zone fills the first screen: **photos start at y=860** (desktop) and below the fold on the phone                                                                                                                   |
| Photo grid | **Edge to edge**, ~2 dp gaps; mobile mosaic of 2-per-row and full-width tiles; desktop justified rows **304-373 px** tall, 4 px gap; fast-scroll handle; per-day select-all check in the day header; no buttons on tiles                 | Mobile: 4 square columns inside a padded container; desktop: justified rows **220 px** tall, capped at 400 px wide                                                                                                        |
| Viewer     | Full-screen black, no frame; top: back, **date/time as title**, favourite, overflow; bottom (mobile): 3 **labelled** actions; delete lives in the overflow; swipe = next, swipe down = close, pinch = zoom                               | **Shipped (theme 6)**: full-screen black; back, date/time title (tap = info), favourite (mes-photos), overflow; phone bottom bar Share / Download. See [viewer](viewer.md)                                                |
| Settings   | A compact list                                                                                                                                                                                                                           | One centered card per setting, each with a large icon                                                                                                                                                                     |

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
- **Order**: the student sites Sky, Le Cercle and Canari are audited FIRST against the same bar
  (plus Material 3 / Apple HIG / WCAG 2.2), then the code starts.

## Open question from the same session

- **`gallery.mitv.fr` answered Cloudflare error 1033 once, at 12:19:46 UTC (Ray `a409faa66e68078b`)**,
  and 200 on every probe a minute later. `cloudflared` was `active` and `migallery-migallery-1`
  `Up 17 minutes (healthy)`, so it had restarted around 12:03 UTC. The `cloudflared` journal for that
  minute was not read (the agent was not permitted to); it is what separates a tunnel reconnect from
  something else.
