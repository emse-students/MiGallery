# MiGallery - unreleased

## Changes

- **Faces v2** (the owner's decisions of 2026-11-01): up to 15 references per member, chosen for variety and renewed toward recent photos (never by a timer, never past 0.5 of what is held); existing members re-selected once in the background from their proven faces; "Pas moi" kept as a sealed negative example that withholds lookalikes from that member only (deleted on withdrawal); an `auto` photo is never taken away by a later scan; every photo of "Mes photos", automatic or confirmed, has a discreet "Ce n'est pas moi" (a confirmation, then it leaves as a "Pas moi" does, a reference learned from it deleted), and Paramètres -> "Photos écartées" lists the rejected faces with "En fait, c'est moi" (the negative deleted, the face back confirmed, refused when another member confirmed it). The confirmation screen is sorted nearest first, answers with "Jusqu'ici" (everything above), the keyboard or a tap, removes a tile at once and puts it back on a failure, and its buttons fit at every width. Terms updated (2026-11-01). See [face-matching-option-c](docs/wiki/face-matching-option-c.md#faces-v2---references-renewal-negatives-sticky-auto-the-owners-decisions-of-2026-11-01).
- Faces: a member who never chose a profile photo has one again (A6 had dropped Immich's person thumbnail, so every such member showed initials): the face Immich featured for their old person when it is already one of their visible photos (never claimed, never taken from another member), else the best of their own photos (confirmed, nearer, larger, single-face, recent). A photo the member chose is never replaced while it is theirs and Immich still has it (archived, hidden or locked counts as present); one deleted (known from Immich's own table in the one-off run) or trashed is, and an unreadable one is kept. A one-off admin run applies it to every member (`scripts/faces/default-photos-client.mjs`, dry run first). The picker shows the member's face in each of their photos, newest first, the current one marked, and fits a phone screen. The confirmation screen's empty tiles are fixed: crops are asked three at a time instead of all at once, which overflowed the server's shared image pool, and a tile that fails offers a retry.
- **Trombinoscope PDF**: a fixed 5-column A4 grid, names wrapped by the browser on at most two lines (never overlapping), MiGallery's fonts (Space Grotesk, Inter) embedded, a header with the date and a page count, one tile shape for every member with initials as the single fallback, members sorted by last name in a French collation, and real selectable text over the raster. Ported from Canari's trombinoscope export.
- **Admin panel version**: the deployed image now reports the version it was released as; since v2.18.0 it kept showing 2.17.0, because only the tarball job synced `package.json` with the tag.

# MiGallery v2.18.0

**Date**: November 1, 2026
**Type**: Minor Release

## 🎯 Objective

The face store goes live: enrolment by a selfie never stored (A5), "Mes photos" read from MiGallery's own matches (A6), the one-shot seed from Immich's vectors (A7), and the terms that describe it (A9).

## Changes

- Immich proxy: an asset detail cleaned of its people leaves without Immich's `etag`/`last-modified`; a failed write of an upload's audit row (`import`, which makes the upload the member's own) is logged at error. The upload ownership rules (latest row, 90 days, impersonation) are written down in `docs/wiki/immich-proxy.md`.
- Faces (A5, released together with A6, A7 and A9 - never on its own): enrolment by a selfie read in memory and never stored (no longer uploaded to Immich), with an explicit agreement that replaces an older legacy or admin consent; a member's answers on their matches, a confirmed face becoming a reference up to 5 only when within 0.5 of a reference they hold (a confirmed lookalike in the 0.5-0.62 band is shown, never learned); the re-match after an enrolment or a learned face runs in the background, at most one queued per member; at most 10 selfies an hour per member (429); a picture the model refuses is a 422, not "unavailable"; withdrawal of a member enrolled by selfie alone closes the consent too.
- Faces (A6): "Mes photos" reads MiGallery's own matches (photos fetched from Immich by id, a search that sends no `page`, which Immich v3 refuses alongside a filter, #427); the faces offered with a doubt are confirmed on a new screen, with pictures cut on the server for that member only and deleted on withdrawal; the profile photo is chosen among the member's own photos; the people routes are removed and the Immich proxy refuses every person and face call, admins included. Ships with A7, which carries the existing profile photos over.
- Faces (A7): the one-shot seed of the face store from Immich's own vectors (no recomputation): every face sealed, every recognised asset done, each linked member's references taken from their own person (the 5 faces nearest its centroid, only while they consent), every face decided, profile photos carried over, and the parity with the old links measured as aggregates (`POST /api/admin/faces/seed`, `scripts/faces/seed-client.mjs`). Every phase carries the run token `begin` returns; the finish is refused unless the counts Immich gave before the export equal what arrived, runs in the background (polled with `GET`), and has a dry run that writes nothing.
- Faces (A9): the terms (`/cgu`, sections 4 and 5) describe the face store as it now is: a print of every face of the library, members or not, not grouped by person (save the one-time seed, which groups a linked member's faces just long enough to compute their references) and in no backup, a trashed photo keeping its prints until the trash is emptied; a member's references from a selfie never stored or, for an existing link, from their own photos; faces shown at once or offered for confirmation; withdrawal erasing references, matches and crops at once; Immich's former groups deleted at the cutover, an encrypted copy kept 30 days. Terms version 2026-10-31 (labels the consents recorded from now on). The wiki's data model and erasure pages follow.

# MiGallery v2.17.2

**Date**: October 31, 2026
**Type**: Patch Release

## 🎯 Objective

The first lots of the face store (A2-A4, off until the seed), quieter logs, and an Immich proxy that forwards only the routes MiGallery uses.

## Changes

- Docs: the face matching design (option C) moves here from the Canari repository, with the 2026-10-31 measurements: float16 against float32, the 0.62 threshold on the members' own links, and the store's memory (`docs/wiki/face-matching-option-c.md`).
- Faces (A2): the client of the face model and the matcher - the nearest member only, the 0.5 / 0.62 bands, a runner-up closer than 0.05 (a member who rejected the face included) or fewer than 3 references never accepted without the member, a selfie refused on any second face, the store streamed rather than held. No route or worker calls it yet.
- Faces (A3, A4): ingestion of new photos into `data/faces.db` (no backup copies it), with durable per-asset state, retries, a daily reconciliation with Immich (a photo's faces go only once two listings at least 20 hours apart miss it) and an hourly report; the match engine, sole writer of `face_matches`. Withdrawal and account deletion now also delete the member's matches in the same transaction. Deploy: needs the `FACE_STORE_KEY` secret, and a network `migallery-face-ml` holding MiGallery and Immich's model service only (the deploy creates it and checks it; Immich's compose attaches its model service, `docs/MIGRATION.md`). Off until the store is seeded (A7).
- Logs: with no Immich configured, the PhotoCV and people routes answer 503 and say it once at info, instead of two error lines per request; a real failure to resolve a system album is still an error.
- Logs: a request the client got wrong (a 4xx: no session, a missing field, a forged sign-in state, a duplicate user, a body that is not JSON or a form) is logged as a warning with its route and status; a server fault stays an error. A missing backup or a malformed body on the database restore and import now answers 4xx instead of 500.
- Immich proxy: forwards only the routes MiGallery's pages use (an allowlist of methods and paths, `src/lib/server/immich-proxy-allowlist.ts`) and answers 404 to any other; every decision reads one canonical path; the trash routes require the admin scope; deleting assets is for admins, mitvistes and a member's own uploads; search takes the profile photo picker's body only; an asset's detail reaches a member without its people (the settings page's selfie flow reads them through `GET /api/users/me/face/selfie/[assetId]`); Immich not configured answers 503.

# MiGallery v2.17.0

**Date**: October 25, 2026
**Type**: Minor Release

## 🎯 Objective

SvelteKit 3 on `@sveltejs/adapter-bun`, which clears the last advisories (`bun audit` ends at zero), and the first tables of the sealed face store.

## Changes

- Deps: SvelteKit 3.1 replaces 2.x and `@sveltejs/adapter-bun` replaces adapter-node; the build is `bun --bun vite build` and the server still runs as `bun build/index.js` (#406).
- Contract: every `POST`/`PUT`/`PATCH`/`DELETE` an API-key client makes MUST carry a `Content-Type` (`application/json` is enough, also on a body-less call). Kit 3 answers `403 Cross-site DELETE form submissions are forbidden` to a mutation with neither an `Origin` nor a `Content-Type`, before any route runs, and offers no per-route opt-out. This binds `DELETE /api/external/media/[id]`, `DELETE /api/admin/api-keys/[id]` and `DELETE /api/albums/[id]`. Sky, Portail-etu, Le Cercle and Canari only `GET`.
- Deploy: the public origin is no longer configured (`ORIGIN` is gone): it comes from the `Host` header with https assumed, so the proxy or tunnel must forward `gallery.mitv.fr` unchanged. The OIDC `redirect_uri` and canonical URLs follow it.
- Deploy: `docker stop` now exits 0 within seconds (SIGTERM stops the timers and waits for a face erasure) instead of being killed after 10 s; the compose file sets `stop_grace_period: 45s`.
- Config: the server reads only the variables declared in `src/env.ts` (Immich, MiConnect, avatar signing key).
- New: the sealed face store tables, reference vectors, erasure and link (A1, #404); `FACE_STORE_KEY` has no reader yet.
- Fixed: the sign-in redirect to the identity provider is allow-listed to the issuer's origin, as kit 3 requires.
- Fixed: a callback whose code the identity provider refuses (forged, expired, replayed) answers `401` instead of `500`.

# MiGallery v2.16.0

**Date**: October 18, 2026
**Type**: Minor Release

## 🎯 Objective

Privacy and access fixes across albums, faces and logs, revocable signed avatar links, and one request to learn which users have a photo.

## Changes

- New: `GET /api/users/avatar-presence?ids=a,b` answers which of up to 100 users have a photo in one request, so Canari no longer collects one 404 per face (#387).
- New: each user has a salt behind their signed avatar links, so those links can be revoked; deleting an account rotates it, and a signed link is refused while impersonating (#394).
- Security: an unlisted album serves only its own photos, and its visibility is never read from the request (#388).
- Fixed: an empty album listing is no longer cached, and visibility is compared case-insensitively (#389).
- Privacy: the face-photo consent rule is enforced on the server (#390).
- Privacy: withdrawing a face or deleting an account erases the face data (#392).
- Privacy: the audit log is kept 90 days, and the client address is taken from one trusted source (#393).
- Terms: the CGU name the controller, the legal bases, the retention periods and what erasure leaves (#395).
- Deploy: the image name comes from the repository and the health is read from the container (#386); the container port is bound to loopback (#396).

# MiGallery v2.15.6

**Date**: September 30, 2026
**Type**: Patch Release

## 🎯 Objective

MinoWiki and Archives no longer need an API key to show a MiGallery avatar.

## Changes

- Security: an avatar can be fetched with a per-person signature (`?sig=`), which opens that one avatar and nothing else. It replaces the API key MiConnect used to put in the avatar URL of every MinoWiki and Archives user.

# MiGallery v2.15.5

**Date**: September 29, 2026
**Type**: Patch Release

## 🎯 Objective

A pinch on the phone grid stopped after one step, and a failed album load also said the album was empty.

## Changes

- Fixed: one pinch now walks the whole grid density scale, in both directions. It used to stop after a single step whenever the row under the fingers was redrawn.
- Fixed: when an album's photos fail to load, the page shows the error alone instead of also saying "Cet album est vide pour le moment."

# MiGallery v2.15.4

**Date**: September 28, 2026
**Type**: Patch Release

## 🎯 Objective

One failed file could stall a whole import, and a rare race could silently save a truncated video.

## Changes

- Fixed: one file failing its upload no longer stops the rest of a batch - every other file still uploads, and the failed one shows its own error and can be retried.
- Fixed: a stuck upload lock now clears itself automatically after a few minutes instead of blocking that file forever.
- Fixed: a rare timing issue could let an incomplete video be saved as if it were complete. The server now checks the file is whole before accepting it.

# MiGallery v2.15.3

**Date**: September 28, 2026
**Type**: Patch Release

## 🎯 Objective

A file that hit a network hiccup mid-import could never be uploaded again.

## Changes

- Fixed: an error while writing an upload chunk (a dropped connection, a write failure) could leave the per-file lock stuck on disk forever. Every retry of that exact file - including after reconnecting - then failed permanently with "File currently locked, retry" instead of resuming.

# MiGallery v2.15.2

**Date**: September 27, 2026
**Type**: Patch Release

## 🎯 Objective

The profile search in Paramètres shows its whole list.

## Changes

- In "Partage de mes photos", the list of matching profiles is no longer cut off by the card: it floats over the page, and opens upwards when the field is near the bottom of the screen.
- The list can be used with the keyboard: the arrows move through it, Entrée picks a profile, Échap closes it.

# MiGallery v2.15.1

**Date**: September 27, 2026
**Type**: Patch Release

## 🎯 Objective

Three small accessibility and polish fixes.

## Changes

- Screen readers name every photo in a grid, including the ones not loaded yet ("Photo en cours de chargement").
- The school-year headings in Albums are read as "2026-2027, 14 albums" instead of "2026-2027 14".
- On a phone, the browser's status bar takes the page colour - dark or light, following your theme - instead of blue.

# MiGallery v2.15.0

**Date**: September 27, 2026
**Type**: Minor Release

## 🎯 Objective

Flat bars, a phone bar without text, and menus that line up.

## Changes

- The top bar and the phone's bottom bar are solid, in the page colour, instead of see-through and blurred.
- The phone's bottom bar shows its four icons without text, like most phone apps: it is shorter (48 px), the current page is the coloured icon, and screen readers still hear each tab's full name.
- No glow and no large shadows anywhere: the profile-photo picker, the drop area and the admin trash are flat; loading tiles fade in their own colour instead of a sweeping shine.
- Lists of buttons (menus, the admin documentation contents) are aligned on the left instead of centred.

# MiGallery v2.14.0

**Date**: September 27, 2026
**Type**: Minor Release

## 🎯 Objective

Every page lines up on the same edge, screen readers hear each thing once, and MiGallery can be installed on a phone.

## Changes

- Every page uses the same margins: on a phone, Paramètres no longer has a double margin on each side, and on a computer the titles of Albums, Photos CV and Paramètres start on the same line.
- The home page has one "Se connecter" button instead of two, and no longer scrolls on a phone.
- MiGallery can be added to a phone's home screen, where it opens full screen on the albums list.
- Screen readers (TalkBack, VoiceOver) announce each album once, with its title and date, and no longer read the hidden buttons of every photo; the album search field is announced as a search.
- The favourite button on a photo is read in the app's language instead of always in English.

# MiGallery v2.13.0

**Date**: September 27, 2026
**Type**: Minor Release

## 🎯 Objective

One page header everywhere, and "Mes photos" gets to your photos straight away.

## Changes

- "Mes photos" shows your face small, beside your name, instead of a large centred portrait: the photos start on the first screen. Tap the face to change your profile photo.
- Albums, Mes photos, Photos CV and Paramètres share the same header: the title on the left, the page's actions as round icons on the right.

# MiGallery v2.12.0

**Date**: September 27, 2026
**Type**: Minor Release

## 🎯 Objective

Settings become a list, like Google Photos.

## Changes

- Paramètres is a list of rows grouped under small headings, instead of large centred cards.
- The theme has three choices - Système, Clair, Sombre - and "Système" follows your phone or computer, live. If you never picked one, the app now follows your device instead of always starting dark.
- A light theme no longer flashes dark for an instant when a page loads.
- "Photo de profil" is one row you tap; when face recognition is not set up yet, the row says so.
- "Supprimer mon compte" and "Dissocier mon visage" are red rows under "Compte".

# MiGallery v2.11.0

**Date**: September 27, 2026
**Type**: Minor Release

## 🎯 Objective

On a computer, navigation moves to a sidebar, like Google Photos.

## Changes

- From tablet width up, a left sidebar carries Albums, Mes photos, Photos CV and Paramètres; the page you are on is highlighted. On a narrower window it becomes a slim rail of icons.
- The bottom bar is for phones only: it no longer stretches across a computer screen.
- An album page now has navigation at every width.

# MiGallery v2.10.0

**Date**: September 27, 2026
**Type**: Minor Release

## 🎯 Objective

The drop overlay and two fixes from the user's review.

## Changes

- Dragging files over an album or Photos CV no longer greys out the whole window: the page stays visible, blurred, behind a dashed frame, and the "Déposez vos fichiers" label fades in on its own card.
- Photos CV no longer shows "100 photos" above the grid: it was the page size, not a count.
- In the light theme, the "Changer la photo de profil" dialog is readable again: its label and instructions were written in white.

# MiGallery v2.9.0

**Date**: September 26, 2026
**Type**: Minor Release

## 🎯 Objective

The new logo everywhere, and the fixes from the desktop review.

## Logo

- The 2026 logo replaces the old one everywhere: tab icon, iPhone home screen, top bar, home page, README and link previews. The old 716 KB image used for every link preview is replaced by a 42 KB one.

## Desktop

- The top and bottom bars are translucent and blurred, like the album's action bar; more room between the album's actions and its title.
- Dialogs such as "Modifier l'album" are opaque again, over a blurred page, and their scrollbar no longer runs over the fields.
- The viewer has margins, and its "Informations" panel slides in with an icon per fact: the file with its size and resolution, the camera with its lens and settings, and the place.
- Settings: the face recognition note has its icon beside the text, and "Importer une photo" stays on one line.
- Photos CV looks like the albums list: the upload panel no longer fills the first screen (a + next to the title, or drop files anywhere), chips instead of tabs, and no photo overflows the screen.
- Counts agree with their number: "1 photo", "2956 photos" - no more "photo(s)" anywhere in the app.

# MiGallery v2.8.0

**Date**: September 26, 2026
**Type**: Minor Release

## 🎯 Objective

Sixth step of the redesign: the albums list copies Google Photos, and the pages stop moving on their own.

## Albums

- The albums list: a magnifier and a + next to the title instead of a search field and a big button; square covers with the full title underneath on up to two lines; no menu on each card (download and delete are inside the album); year headings kept, month headings gone.

## Fixes

- The home page no longer redraws its background on load, and the greeting no longer says "Bonjour" in the middle of the night - after midnight it asks "Encore debout ?" instead.
- The home page's profile card centres its icon, and its button is the filled accent.
- The navigation bars no longer stretch when a scroll overshoots the top of a page.
- Photos CV and Mes photos show the grid edge to edge, with no photo overflowing the screen.

# MiGallery v2.7.0

**Date**: September 25, 2026
**Type**: Minor Release

## 🎯 Objective

Fifth step of the redesign: an album opens on its cover, and selecting photos works as in Google Photos.

## Album

- On a phone, an album opens on its cover, full width, with the title, date and photo count over it; back and ⋮ float over the photo. On a computer the title comes first and the photos start above the fold. The album's own cover, heavily blurred, is the page background.
- Three photos a row on a phone; pinch to switch between 2, 3 and 4. The choice is remembered.

## Selection

- A long-press (or "Sélectionner") starts selecting: a ring on every photo, "N sélectionnée(s)" at the top, and only the selection's actions at the bottom (share, download, remove from album, move to trash - the last two still confirmed).
- Downloading a whole album now asks "Télécharger les N photos ?" in plain French.

## Fixes

- The ⋮ menus line their icons up on one edge.
- The Immich people list is read in Immich v3's paged shape.

# MiGallery v2.6.0

**Date**: September 25, 2026
**Type**: Minor Release

## 🎯 Objective

Fourth step of the redesign: an album opens on its photos, laid out as a phone gallery does.

## Album

- The first screen of an album is its photos: the upload panel left the page, and the album actions (add, share, download, select) sit in one labelled bar at the bottom on a phone.
- The grid runs edge to edge in justified rows, each photo at its own proportions, grouped under day headings, and only what is on screen is rendered, so a 700-photo album scrolls smoothly. Checked on a Mi 9T.

# MiGallery v2.5.0

**Date**: September 25, 2026
**Type**: Minor Release

## 🎯 Objective

Third step of the redesign: the viewer takes the whole screen, as a phone gallery does.

## Viewer

- Full-screen black frame, edge to edge. The bars float over the photo and fade on a tap.
- The title is the date and time the photo was taken; the file name moved to an info panel (date, file, size, camera), opened from the title, the ⋮ menu or a swipe up. On a phone it is a bottom sheet.
- On a phone, labelled Share and Download buttons at the bottom; Share hands the original file to the phone's share sheet. Checked on a Mi 9T.
- The zoom buttons and the "1 / N" counter are gone; one zoom toggle stays on desktop.

# MiGallery v2.4.0

**Date**: September 25, 2026
**Type**: Minor Release

## 🎯 Objective

Second step of the redesign: the photo viewer answers the gestures a phone gallery owes.

## Viewer

- Swipe left or right to change photo, swipe down to close, tap to hide or show the bars, double-tap to zoom on the tapped point, pinch to zoom from 0.5x to 5x. While zoomed, one finger pans instead of changing photo. Checked on a Mi 9T.
- The two neighbouring photos are preloaded, so a swipe lands on an image that is already there (at most two extra previews per photo shown).

## Interface

- Delete moved behind a ⋮ menu in the viewer, on the album page, on photo tiles and on album cards; every delete keeps its confirmation.
- On a touch screen, the hover overlay no longer sticks on photo tiles; their actions stay in the long-press sheet.

# MiGallery v2.3.0

**Date**: September 25, 2026
**Type**: Minor Release

## 🎯 Objective

First step of the redesign towards a Google-Photos-grade gallery: flat surfaces, as the reference apps are.

## Interface

- No more glass, glow or text-shadow: buttons and panels are flat tonal surfaces (measured on the albums page: 30 blurred elements, 14 text-shadows and 1 glow down to 0). The background colour blobs stay - they are the app's identity.
- Dialogs and the photo viewer are opaque, so the page behind no longer shows through their text.
- Icons in buttons render at their intended size (the sizing rule was invalid CSS and ignored by every browser); the viewer's arrows went from a tiny glyph to 32 px.

## Developer

- `bun run dev` runs on bun (it ran vite under node, which cannot load `bun:sqlite`), and no longer logs a warning per `:global()` on start.

# MiGallery v2.2.0

**Date**: September 25, 2026
**Type**: Minor Release

## 🎯 Objective

Make the gallery fast again on a production uplink capped around 1 MB/s. The server was idle; every visitor was waiting on bytes. This release sends far fewer of them.

## Performance

- Album and person grids no longer make one Immich call per photo: a single slim, gzipped line per asset replaces ~2.5 KB of owner/EXIF/path data (an album of 479 photos went from ~800 KB to a few tens of KB).
- Grid tiles load the thumbnail only. High-density screens (phones, Retina) used to download the ~450 KB preview for every tile as well.
- The lightbox opens on the preview; the original (up to ~8 MB) now loads only when zooming in.
- The grid re-renders once per received chunk instead of once per photo.
- Album covers are now cached at the Cloudflare edge.

## Fixes

- Avatars and face crops are sent as `private`: they require a session and must never be kept by a shared cache.
- The admin panel shows the real version instead of `v1.0`.

# MiGallery v2.1.2

**Date**: September 19, 2026
**Type**: Patch Release

## Fixes

- Deleting an album now removes its Immich assets only when they are not referenced by another album.
- Shared assets and assets whose membership cannot be verified are preserved.

# MiGallery v2.1.1

**Date**: September 19, 2026
**Type**: Patch Release

## Improvements

- Avatar downloads now accept a scoped API key through the `api_key` query parameter.
- Removed all lint warnings and kept the Svelte/TypeScript checks clean.

# MiGallery v2.0.0

**Date**: August 17, 2026
**Type**: Major Release

## 🎯 Objective

Rebuild authentication on a foundation that can actually revoke a session, and make the gallery usable in two languages. Six months of work: the login stack was replaced, every user-visible string was externalized, and the album grid was rewritten around covers served from disk.

## ⚠️ Breaking Changes

Read this section before upgrading: a 1.1.0 deployment will not start unchanged.

- **Authentication moved to Authentik (MiConnect) OIDC.** EMSE CAS is gone. Three new variables are required: `MICONNECT_ISSUER`, `MICONNECT_CLIENT_ID`, `MICONNECT_CLIENT_SECRET`.
- **Auth.js was removed entirely.** `AUTH_SECRET` and `COOKIE_SECRET` are no longer read by anything - drop them. There is nothing left to sign or rotate.
- **Sessions are server-side rows.** The `migallery_session` cookie now carries a random opaque token; the row in the database is the truth. This is what makes logout and revocation real instead of advisory. **Every existing session is invalidated by the upgrade** - all users log in again.
- **Node 24 is required** (`engines: >=24.0.0`).
- **Legacy `album_*_permissions` tables were dropped** in favour of a single unified permissions table. The migration runs on startup.

## ✨ New Features and Improvements

### 🔐 Authentication and Security

- Native OIDC implementation, with the post-login destination sanitized on both write and read so a crafted return path cannot bounce a user off-site.
- A shared album link now lands on that album after login, not on the home page.
- Impersonation lives in the session row, so the real actor stays provable and a revoked session cannot outlive its logout.
- Path traversal, file-system race conditions in the image caches, and log leakage were fixed.

### 🌍 Internationalization

- Full French/English UI through Paraglide, with the choice persisted per user.
- All server-side diagnostics and code comments are English-only.

### 📸 Albums and Photos

- Album covers are rendered once and persisted on disk as square WebP, keyed by asset, instead of being resolved by the browser on every page load.
- The album grid is grouped into a school-year timeline (rollover on 15 August), and browsing state - search, unfolded years, scroll - survives a trip into an album and back.
- Accent- and typo-tolerant search across albums and the member directory.
- Uploads survive a connection loss, report live per-file status, and accept new files while one is already in flight.
- Favorites filter and long-press action sheet on mobile.

### 👤 Profiles

- Face-first profile picture picker with server-side square crops.
- Photo sharing between users, by person, formation or promotion.

### 🛠️ Administration

- Users and roles page, server health metrics, searchable and paginated logs, database maintenance, and the wiki rendered in-app.
- Scheduled database backups.

### 🎨 Interface

- Unified design tokens, theme-aware components, a global keyboard focus ring, and decluttered navigation.

## 🔧 Migration from 1.1.0

1. Register the application in Authentik and set `MICONNECT_ISSUER`, `MICONNECT_CLIENT_ID` and `MICONNECT_CLIENT_SECRET`.
2. Remove `AUTH_SECRET` and `COOKIE_SECRET` from the environment.
3. Upgrade the runtime to Node 24.
4. Back up `data/migallery.db`, then start the application - the schema migrations run automatically.
5. Warn users that they will be signed out once.

---

# MiGallery v1.1.0

**Date**: February 5, 2026
**Type**: Minor Release

## 🎯 Objective

Introduction of advanced album management features to improve flexibility without compromising data.

## ✨ New Features and Improvements

### 📸 Photo Management

- **Removal without deletion**: Ability to remove photos from a specific album without permanently deleting them from the Immich library.
- **Improved interface**: Clear contextual options added to the selection toolbar ("Remove" vs "Delete").
- **Security**: Separate confirmation modals to prevent accidental deletions.

---

# MiGallery v1.0.0

**Date**: December 22, 2025
**Type**: Stable Release

## 🎯 Objective

First official stable version of MiGallery. This version brings increased robustness, refined permission management, and full integration with the EMSE CAS.

## ✨ New Features and Improvements

### 🔒 Security and Authentication

- **EMSE CAS Integration**: Secure authentication via OIDC with `client_secret_post` support.
- **Granular Permissions**: Overhaul of the scopes system (`public`, `read`, `write`, `admin`).
- **Secure Downloads**: ZIP archive downloads are now considered a read operation (`read`), allowing more flexible yet secure access.
- **CSRF Protection**: Custom origin verification implementation for API mutations.

### 📸 Media Management

- **Optimized Immich Proxy**: Better data flow management and API path resolution.
- **Reliable ZIP Download**: New robust implementation for downloading complete albums, compatible with all modern browsers.
- **Public Album Support**: Simplified access to unlisted albums via secure links.

### 🛠️ Administration and Maintenance

- **Audit Logs**: New logging system to track logins, API key usage, and asset modifications.
- **Automatic Cleanup**: Maintenance scripts to purge temporary files and optimize disk space.
- **API Documentation**: Updated interactive documentation and complete permission audit.

### 🚀 Performance and DevOps

- **Bun Optimization**: Intensive use of Bun capabilities for maximum performance.
- **Robust CI/CD**: Improved GitHub Actions workflow for frictionless deployments.
- **Zero Technical Debt**: Complete cleanup of obsolete scripts and fix of all linting warnings.

---

# MiGallery v0.1.0-alpha.1

**Date**: November 21, 2025
**Type**: Pre-release (Alpha)

## 🎯 Objective

First public alpha version of MiGallery for functional testing and user feedback. This version contains all core features and a complete CI/CD system.

## ✨ Core Features

### Core Features

- 📸 Modern photo gallery with Svelte 5 interface
- 👤 Facial recognition via Immich integration
- 📁 Custom and shared album management
- 🎓 Directory system for organizations
- 🔐 SSO Authentication (Authelia/Authentik)
- 🗑️ Trash with restore

### API & Security

- ✅ Complete REST API with API keys and scopes (read/write/delete/admin)
- ✅ Protection of all external endpoints
- ✅ Interactive API documentation (Swagger-like)
- ✅ Unit tests with Vitest (18+ tests)

### DevOps & Quality

- ✅ CI/CD GitHub Actions (lint, check, build, test, package, deploy)
- ✅ Pre-commit hooks with ESLint + TypeScript
- ✅ Automatic packaging (.tgz with build + data + .env)
- ✅ 0 TypeScript errors in strict mode
- ✅ ESLint v9 with modern flat configuration

## 📦 Package Contents

- `build/` - Compiled application ready for production
- `data/` - SQLite database (if present)
- `.env` - Configuration (adjust for your environment)
- `package.json` - Metadata and dependencies
- `README.md` - Complete documentation
- `scripts/` - Administration scripts (init-db, backup, etc.)

## 🚀 Quick Installation

```bash
# Extract the archive
tar -xzf migallery-0.1.0-alpha.1-full.tgz
cd migallery

# Install dependencies
npm ci --omit=dev

# Configure .env (edit according to your environment)
# Adjust IMMICH_URL, IMMICH_API_KEY, AUTH_SECRET, COOKIE_SECRET

# Initialize the database (if needed)
npm run db:init

# Start the application
bun build/index.js
```

Access at http://localhost:3000

## 📚 Documentation

- **Main README**: Complete installation and configuration instructions
- **Tutorial**: `docs/tutorials/tutorial.md` - Step-by-step user guide
- **API Security**: `docs/API_SECURITY.md` - API keys and scopes documentation
- **CI/CD Workflows**: `.github/workflows/` - Automated pipelines

## ⚠️ Known Limitations (Alpha)

- Tutorial incomplete (being rewritten)
- Debugging video not provided (coming soon)
- Test coverage to be improved (currently ~70%)
- Some non-blocking ESLint warnings remaining

## 🔄 Full Changelog

### Features

- Complete Immich integration with API proxy
- Granular permission system per album
- NDJSON streaming for optimized photo loading
- Smart client cache for increased performance
- Complete admin interface (users, API keys, database)

### Fixes

- ✅ Fixed 208 TypeScript errors
- ✅ Consolidated API types (`src/lib/types/api.ts`)
- ✅ Secured all external endpoints
- ✅ Restored CI workflow after corruption

### Chore

- Updated pre-commit hooks (lint + check)
- Merged DevOps documentation into README
- Created automatic packaging script
- ESLint v9 flat config configuration

## 🐛 Known Bugs

No blocking bugs identified. To report an issue:
https://github.com/DeMASKe/MiGallery/issues

## 📋 Next Steps (v0.1.0-beta.1)

- [ ] Complete tutorial rewrite with screenshots
- [ ] Debugging demonstration video (3 min)
- [ ] E2E tests with Playwright
- [ ] Increase test coverage to 85%+
- [ ] Auto-generated TypeDoc documentation
- [ ] Multi-language support (i18n)

## 🙏 Contributors

- **DeMASKe** - Lead development
- **MiTV Team** - Testing and feedback

## 📄 License

GNU General Public License v3.0 (GPL-3.0)
See `LICENSE` for more details.

---

**Note**: This is an alpha pre-release intended for testing. Do not use in production without thorough testing.
