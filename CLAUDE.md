# **MiGallery \- Rules & Session State**

## **AGENT DIRECTIVES (OPUS AUTONOMOUS MODE)**

- NO BLIND GREP: Never run generic grep or find across the project. Check the SESSION STATE below first, or ask the user for exact paths.
  ASK EARLY: State assumptions explicitly. If uncertain about architecture, multiple interpretations, or a bug, ASK during the planning phase. No guessing.
- SURGICAL EDITS: Touch ONLY requested code. Map changes 1:1 to the prompt.
- STATE PRUNING: When updating the roadmap, DELETE the detailed descriptions of completed tasks. Keep the file small.
- CLAUDE.md HYGIENE: When this file grows long, actively trim it. DELETE Work Packages for past/shipped work (keep only forward-relevant gotchas), collapse redundant notes, and drop stale entries. A lean CLAUDE.md is a hard requirement, not optional.
- UPDATE STATE: You MUST update the SESSION STATE at the bottom of this file before finishing a Work Package.
- BASH OVER SUBAGENTS: Use native `rg`/`find` to filter text BEFORE the LLM sees it. 10 lines of `rg` output in Opus is cheaper than 1000 lines of `cat` in a Haiku subagent.
- EDITING STRATEGY: Opus must write surgical edits directly. ONLY spawn subagents for broad, semantic codebase audits or massive multi-file refactors.
- WORKFLOW CYCLE:
  1. Plan the step and read files (using `rg`/tools).
  2. Ask questions EARLY if uncertain (or during execution if needed).
  3. Execute the code (Surgical edits only).
  4. Run tests/checks.
  5. Run `git add . && git commit -m "[Task summary]"`.
  6. Update SESSION STATE below.
  7. STOP and output: "Task committed. Please run `/compact` (or `/clear` if switching to a new theme)."
- WIKI & CLEANLINESS: Documentation goes EXCLUSIVELY in `docs/wiki/`. Delete unused/legacy code immediately.
- PROD ACCESS: Connect to production via SSH using ssh mitv (or ssh canari).

## **ARCHITECTURE & DATA FLOWS**

- Svelte 5 ONLY: Use runes (`$state`, `$derived`, `$effect`). NEVER use old reactive `$` syntax.
- SSR Guards: Browser imports (e.g., StreamSaver) MUST be lazy (`await import`) or guarded by `typeof window !== 'undefined'`.
- FILE UPLOADS (No RAM): \<10MB direct, \>10MB chunked. Stream to disk (`fs.createWriteStream`) then to Immich. NEVER use `Buffer.alloc`.
- ARCHIVE DOWNLOADS: Flow is `POST /api/download` (creates UUID token) \-\> `GET /api/download/{token}` (native browser streaming). Do NOT use StreamSaver or the Service Worker for this.
- Synchronous SQLite: `better-sqlite3` queries live in server handlers. Stores ONLY what Immich lacks (users, roles, permissions, logs). Upload concurrency uses per-file locks `fs.openSync(lockPath, 'wx')`. Do not remove.
- Authentik (OIDC) \+ OPAQUE sessions: the `migallery_session` cookie carries a random TOKEN, never an identity; the `sessions` row is the truth (`src/lib/db/sessions.ts`), which is what makes logout and revocation real. Auth.js is long gone - no `AUTH_SECRET`, no `COOKIE_SECRET`, nothing to sign or rotate. Roles are `admin` (full access), `mitviste` (gallery mgmt, no admin), `user` (basic).

## **CODING STANDARDS**

- English Only: Code, comments, docs, and dev-facing strings (`console.log`, errors) MUST be English.
- I18N: User-visible strings use Paraglide (`messages/fr.json`, `en.json`). No inline string literals.
- ASCII Punctuation: Normalize to ASCII (`'`, `"`, `-`) everywhere. Preserve French accents (`é`, `à`) ONLY in localized strings/French comments.
- UI: Single source of truth is `src/app.css` (tokens, `--radius-*`). Use `.btn-glass` with modifiers. Dark-first glassmorphism. Avoid raw hex/px. `lucide-svelte` only (no aliases).
- Husky: Pre-commit runs ESLint \+ Prettier \+ svelte-check. Fix errors; do not bypass.

## **KEY PATHS & COMMANDS**

- API Proxy Handler: `src/routes/api/immich/[...path]/+server.ts`
- DB Queries: `src/lib/db/`
- Commands: `npm run dev`, `npm run check` (Type-check), `npm run test` (Integration), `npm run db:init`, `npm run validate` (full CI mirror)

## **SESSION STATE (Active Memory)**

_Cleared 2026-07-14: all shipped WPs and the i18n plan are complete; prod migrations (WP-3a legacy-table DROP, WP-6 users.photos_asset_id) verified applied on prod. Repopulate the sections below as new work starts._

**Current WIP:**

- (none)

**Roadmap (Active WP):**

- WP-B SHIPPED 2026-08-25: `/admin/medias` (page + `/api/admin/medias`, `/orphans?page=N`, `/scan` POST|GET). Detection tooling only, no automatic sorting - the multi-album list is read-only and there is no permanent delete anywhere. The same-name-albums family was DROPPED by the user's call (the roadmap's "2 same-name albums" did not reproduce: exact name gave 49 groups, name+date 0, name+year 8, Immich's case-insensitive compare 38 - no definition of "duplicate" was defensible). DEPLOYED to prod 2026-08-25 (run 32850613053, container healthy on `:latest`), along with the trash-restore upload fix and the album-assets refactor.
- DUE NOW (b25fad2 is deployed): click "Couvertures orphelines" once on `/admin/database` to reclaim the ~330 pre-tracking cover files on prod (it resolves missing `cover_asset_id` first, then sweeps).
- (Canari side done 2026-08-17, commits 7be8d7a3 + 73606ddc + 741efee8a: `EcosystemCoverPreview.svelte` builds the square cover URL from the link itself via `ecosystemHosts.ts`. One rule now governs the key there: an image is public and needs no key, a metadata read does - only `/api/albums/[id]/info` carries `MIGALLERY_API_KEY`, covers go through Canari's SSRF-guarded image proxy. The keyed `mls/gallery-cover/:albumId` proxy is deleted.)

**Memory Gotchas (Do not repeat):**

- Immich answers a re-upload of a known checksum with `{status:'duplicate', id}` and does NOT restore the asset if it is in the trash (verified in v3.1.0 `asset-media.service.ts`), and a trashed asset added to an album stays invisible. `restoreAssetsFromTrash` (`src/lib/server/immich-trash.ts`) never throws, and restoring a non-trashed id is an upstream no-op, so callers fire it unconditionally. It now runs in exactly TWO places: `finishImmichUpload` (the proxy's ONE finish point for both the simple and the chunked path) and inside `addAlbumAssets`. Do not re-inline a copy of it.

- `src/lib/server/immich-album-assets.ts` is the ONLY code that mutates album membership - `addAlbumAssets` / `removeAlbumAssets`, one `PUT|DELETE /api/albums/{id}/assets` between them. The trash restore lives INSIDE `addAlbumAssets` on purpose: the original bug was that four of the five add paths each had to remember to restore and did not, so now there is nowhere else to add from and nothing left to forget. The four former copies (`api/albums/[id]/assets`, `api/people/album/assets`, `api/people/album/[albumId]/assets`, `photos-cv/handlers`) are thin callers - never grow a fifth. Status contract: a 4xx from Immich travels as-is, everything else (a timeout included) answers 500, because `tests/people-photoscv.test.ts` pins the accepted set to [200, 400, 401, 404, 500].

- There is NO `handleError` hook in this app, so an exception that leaves a route unlogged is invisible in prod - no stack, no route name, nothing. That is why the logging sits in the shared helpers (`immich-album-assets`, and `getOrCreateSystemAlbum`, where the album-list round trip is what times out under load) instead of in per-route catches. Before deleting a route's try/catch, check what would stop being logged.

- `PUT|DELETE /api/people/album/assets` has ZERO callers in `src/` and is NOT dead: prod logs show authenticated hits (2 on 2026-08-25, both timing out inside an Immich slow window that also killed an `assets-simple` GET). The app itself uses `POST /api/people {action:'add-to-album'}`; the bulk route is what external API-key callers use, and both now go through `photos-cv/handlers`. Grep-says-unused is not proof for anything reachable with an API key - check the prod logs (`docker logs migallery-migallery-1`, note the compose-prefixed name).

- `const _err = ensureError(e)` followed by a line that logs the raw `e` was a mechanical lint-appeasement leftover; 23 such dead assignments were deleted. The ones that survive genuinely read `_err`. Do not reintroduce the pattern - if you normalize an error, use the result.

- `buildImmichUploadFormData` appends every metadata field BEFORE `assetData`, deliberately. Immich parses the multipart body as a stream, so metadata arriving after the file part reaches the DTO validator too late and it answers `400 ... fileCreatedAt ... received undefined` - 5 such 400s on prod in 30 days before commit. Never move `assetData` back to the front.

- PortailEtu is DEAD (deleted 2026-08-25, user's call): the album, `POST/GET/DELETE /api/external/media`, `SYSTEM_ALBUMS`, `getSystemAlbumIds`, `getAllAssetIdsInSystemAlbums`. What SURVIVES on purpose: `/api/external/media/[id]` (Sky/Canari avatars), `getOrCreateSystemAlbum` (still used for `'PhotoCV'`), and the `https://portail-etu.emse.fr` CORS origin in `hooks.server.ts` - that is the site origin, not the album.
- **The `users` row is a COPY of Authentik, never a second opinion** (`handleUserInDatabase`, commit
  ace982a). `SSO_OWNED_FIELDS` - `first_name`, `last_name`, `promo`, `formation` - are written on
  EVERY login, **nulls included**. The `if (value != null)` guard that stood there until 2026-08-24
  meant a claim Authentik had REMOVED survived here for ever, and `promo` is an album-access key.
  What licenses erasing a local value is that `completeOIDCFlow` only reaches this function after
  the token exchange AND the userinfo fetch both SUCCEEDED: an absent claim is then the IdP's
  ANSWER, not a transport failure. `role`, `photos_id`, `photos_asset_id` and `locale` are the
  app's own and stay out of that list on purpose. Pinned by `tests/sso-mirror.test.ts`, which is
  the first test this module ever had - `$env/dynamic/private` is unresolvable outside a SvelteKit
  build, so `vitest.config.ts` aliases it to `tests/mocks/env-dynamic-private.ts`. Reuse that alias
  for any other server module you need under test.
- **`first_login` and its graduation-year modal are DELETED, column included** (commit 82b0254). It
  was the one place a user could CHOOSE their own promo, which is an album-access key; Authentik
  describes 277 of the 280 accounts on prod, and for the school staff it does not describe (no
  promo, and none owed - they get public and directly shared albums) the modal wrote NULL over
  NULL. Do not reintroduce a client-writable promo: the SSO is its only writer.

- Releases: the tag MUST be `vX.Y.Z`. `release.yml` triggers on `v*.*.*` only, so the historical bare tags (`1.0.0`, `1.1.0`) never fired it - those releases were made by hand. v2.0.0 (2026-08-17) is the first one the workflow actually produced. Bump `package.json` + `RELEASE_NOTES.md` (newest entry on top), commit, push, THEN tag.

- Closing a modal on an outside click can NEVER be judged from the `click` event alone: its target is the common ancestor of press and release, so selecting text inside the modal and releasing on the backdrop reports the backdrop and closed it. Both `Modal.svelte` (the `<dialog>`) and `PhotoModal.svelte` (the portal backdrop) now require pointerdown AND pointerup on the backdrop. Do not "simplify" either back to `e.target === e.currentTarget && close()`.

- Lucide icons: NEVER re-declare `width`/`height` on an `svg` inside a component. `app.css` guards `.lucide` with `flex-shrink: 0` (commit dad341b) so the `size` prop wins everywhere; a local `.foo :global(svg) { width: 1rem }` silently overrides the prop and the icon looks shrunken inside its button (was `.promo-add-btn`, commit e806f93). Size the BUTTON, not the icon.
- Albums page browsing state (`src/lib/albums-view-state.svelte.ts`): search, unfolded school years and scroll live in a module singleton, NOT in the component - that is what survives the trip into an album and back. Two halves make it work: `albums` on `/albums` is `$derived` from `page.data` (an `$effect` fills it only AFTER first paint, so the page is empty-height exactly when the scroll is restored), and the album's back button calls `markReturnTrip()` because `goto()` PUSHES, which makes SvelteKit scroll to top. Browser back is left alone - SvelteKit restores that scroll itself, and the flag is not set. Deliberately not persisted to storage: a fresh load starts at the top.
- Repo-wide `npm run format` rewrites ~190 files (pre-existing prettier drift + LF/CRLF churn under `core.autocrlf=true`). Only 12-ish are real content diffs. Format your own files, then `git checkout -- . ':!<your files>'` before committing.
- SEARCH: every box goes through `src/lib/fuzzy.ts`. A list that TRUNCATES (the two user dropdowns, admin users) uses `fuzzySearch`, which filters AND ranks; `/albums` uses `fuzzyMatch` on purpose - it buckets by school year and month and shows everything, so a relevance order would only scramble the chronology inside a month. Do NOT write a `.includes()` filter in a surface: that is exactly how `AlbumModal`'s share dropdown stayed on plain substring while the others were tolerant, and it caps at 8, so a name spelled slightly differently was not ranked low, it was unreachable. `editDistance` is Damerau-Levenshtein on purpose - a transposition ("jaen"/"jean") is the commonest typo and plain Levenshtein prices it like a different name. The admin LOG search stays exact `LIKE`: an audit trail returning neighbouring ids is the opposite of its job. See `docs/wiki/search.md`.

- `/mes-photos` favorites (commit b69fcd7): the separate top "Favoris" section is GONE. Favorites now stay in chronological place with a passive `.favorite-badge` in `PhotoCard`, plus a "Toutes/Favoris" filter chip in `PhotosGrid` (`favoritesFilter` state -> `displayedAssets`). The lightbox navigates `displayedAssets` (chronological), which is what prevents the old "toggle favorite -> jump to top" bug. Do NOT reintroduce a `[...favoriteAssets, ...nonFavoriteAssets]` reordering for the modal list.
- Mobile `PhotoCard`: corner action buttons are hidden on mobile; actions live in the long-press `.action-sheet` (bottom sheet). The favorite corner button's always-on state was replaced by `.favorite-badge`. `.mobile-actions-overlay` has a 400ms guard (`sheetOpenedAt`) so the synthetic post-long-press click doesn't instantly close the sheet.
- A cookie whose content IS the identity it claims is not a credential, whatever flags it carries: `httpOnly` stops other people's JS from READING it, never the holder from WRITING one. That was the `__session_user` hole (fixed 2026-08-04). The ids it needed were public to any logged-in user via `/api/albums/permissions/options`, so "hard to guess" was never a defence either.
- Impersonation lives in the session ROW (`impersonated_id_user`), never in a second cookie: a parallel credential outlives the logout of the first, and nothing can then prove who the real actor was. `ensureAdmin` judges the EFFECTIVE user, `canStopImpersonating` the REAL one - that split is the whole design.
- A SvelteKit `redirect()` is NOT an `Error`, so a `try { ... throw redirect() } catch (e) { if (e instanceof Error) ... }` swallows it and answers 500 on a handler that worked. Throw redirects OUTSIDE the try.
- Post-login destination (`src/lib/auth-redirect.ts`, wiki `authentication.md`): only the ANONYMOUS branch of a guard may carry one. Giving it to "logged in but refused" (`checkAlbumAccess`, a non-admin under `/admin`) returns the user to the same refusal forever - hence `requireAdminPage`, which splits what `ensureAdmin` conflates.
- A leading `/` does not prove a path is ours: `//evil.com` and `/\evil.com` both start with one and both leave the site. Control characters split the `Location` header, and `/api/auth/*` loops the login. One sanitizer, applied on WRITE (login) and again on READ (callback) - the `__oidc_return` cookie is browser input like any query param.
- `requireScope(event, 'read')` returns `grantedScope: 'read'` for a SESSION admin (only 'admin' required-scope or an admin API key yields `grantedScope: 'admin'`). To gate cross-user actions on a read/write endpoint, check `auth.user?.role === 'admin'`, never `grantedScope === 'admin'`.
- Album covers (commit b25fad2, `src/lib/server/album-cover.ts`): WHICH asset is the cover lives in `albums.cover_asset_id`; the 400x400 WebP lives in `data/cache/covers/<assetId>.webp` - keyed by ASSET, not album, so two albums sharing a cover share one file. Retention = "delete once nothing points at it" (`pruneCoverAsset` checks `SELECT 1 FROM albums WHERE cover_asset_id = ?`). NEVER resolve a cover client-side again: that meant 2 upstream calls + a paginated asset search per album per load. `resolveMissingCovers` MUST run before `pruneOrphanCovers` or unresolved albums' valid files look orphaned.
- `GET /api/albums/[id]/cover` and `/og-cover` are PUBLIC for every visibility, private included (commit 1839ff6, user's explicit call). An external site embeds a cover from an `<img>`, which carries no key, so any gate there means no cover at all. Only the cover is exposed - `/og-preview` still 403s on private, contents stay behind `checkAlbumAccess`. Do not "restore" a scope check here.
- A Svelte 5 `$effect` stops tracking at its first `await`, but everything read SYNCHRONOUSLY before it IS tracked. Reading your own cache (`albumCovers[id]`) at the top of an async effect therefore re-fires the effect on every write to it. That was the albums-page fetch loop.
- Prettier here has NO `plugins` entry, so `.svelte` files are silently skipped by lint-staged's `--ignore-unknown` and are not prettier-managed. Format with `npm run format` (or let husky do it) - a bare `npx prettier --write "src/**/*.svelte"` just errors "No parser could be inferred".
- `npm run test` refuses to run while `IMMICH_BASE_URL` points at prod (it creates real `[TEST]` albums). Do not set `ALLOW_REMOTE_IMMICH_TESTS=true`. Server-free suites that always run: `tests/disk-cache.test.ts`, `tests/auth-redirect.test.ts`.
- `/api/users/[username]/avatar`: unbusted URLs (shared `Avatar.svelte`) now revalidate via ETag=asset id (`no-cache`); only `?v=assetId` URLs are `immutable`. Don't reintroduce a long `max-age` on the unbusted path or the profile photo goes stale for ~1h.

- `POST /api/search/metadata` reports `total` = the size of the PAGE, not of the result set (verified on prod: `size:1` -> `total:1`, `size:1000` -> `total:1000`), and `nextPage` comes back as a STRING (`"2"`). There is no cheap count in Immich: anything that needs one must paginate. That is the whole reason `/api/admin/medias` serves an instant inventory with no orphan count, `/orphans` serves ONE page per request while the client loops for the total, and the multi-album answer is a detached background scan (528 albums -> 581 requests) instead of a query.
- `src/lib/server/immich-search.ts` is the ONE paginated Immich search. Three call sites had each grown their own loop agreeing on nothing (page size 500 vs 1 vs 1000, cap 20 vs none, one silently pinning `type:'IMAGE'`). `searchAssetPage` for a caller that wants one page at a time, `searchAllAssets` to collect. Status contract matches the album mutations: a 4xx travels as-is, everything else answers 500. Do not inline a fourth copy - `src/lib/server/album-cover.ts` still has one and should move over.
- Orphan detection carries NO type filter, deliberately: prod's 4 533 orphans include 145 VIDEOS, and the `type:'IMAGE'` that the trombinoscope searches pin would hide every one of them. Check for that pin before reusing a search filter from `photos-cv/handlers.ts`.
- `startDeepScan()` takes no fetch and uses the GLOBAL one on purpose: the scan outlives by minutes the response that started it, so `event.fetch` belongs to a request that is over. Same reason its `.catch` logs explicitly - it runs detached from any request and there is no `handleError` hook, so an unlogged throw there vanishes completely.
- lucide-svelte 1.0.x still re-exports 243 DEPRECATED aliases from `dist/aliases`, so `AlertCircle`/`CheckCircle`/`XCircle`/`AlertTriangle`/`HelpCircle` render fine and `svelte-check` stays green - until the next major deletes them. 13 files were on them (commit 53ab0de), `src/lib/icons.ts` included. `dist/icons/index.js` is the list that counts. Also verify the alias TARGET before renaming: `CheckCircle` maps to `circle-check-big`, not `circle-check`, so the obvious rename changes the glyph. Note 27 files still import lucide directly instead of through `$lib/icons` (68 distinct icons) - the registry rule is real but largely unadopted; migrating is a separate sweep.
- Every server-to-server call MUST carry `signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS)` (`$lib/server/outbound`). `album-cover.ts` and `face-crop.ts` had five that did not (commit 5aecbb9), and they were the worst two files for it: both download their source image AFTER `acquireSharp()`, so a hung download holds a slot the whole pool is queueing for, and `/cover`+`/og-cover` are public, so an external `<img>` opens one. Check for a signal before adding an outbound call anywhere.
- An assertion inside a guard that repeats it cannot fail: `if (Array.isArray(d)) expect(Array.isArray(d)).toBe(true)`, `expect(true).toBe(true)` in a catch, `expect(body).toBeDefined()` on parsed JSON (holds for `{}`). `tests/people-photoscv.test.ts` had four, plus two tests named for failures they never induced, plus two `Array.isArray(body)` checks against routes answering `{assets:[...]}` (commit 6081982). The suite only reaches those lines with a live local Immich, so nothing ever reported it. Its accepted status sets ARE pinned on purpose - do not narrow those.
- NEVER run `npm install` here to "refresh" node_modules after a merge: npm on Windows rewrites `package-lock.json` against the WINDOWS optional-dependency tree and drops what only Linux resolves - it deleted 162 lines including `@emnapi/core|runtime|wasi-threads` (sharp's wasm fallback), and `npm ci` on the ubuntu runner then failed with `EUSAGE ... Missing: @emnapi/core@1.11.3 from lock file` before a single check ran. Nothing local catches it: the pre-push hook runs `npm run test`, not `npm ci`. If a branch changes no dependencies, the lockfile must come back byte-identical - `git checkout <upstream-ref> -- package-lock.json`. Only run `npm install` when you are DELIBERATELY changing `package.json`.
