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

- Post-deploy of b25fad2: click "Couvertures orphelines" once on `/admin/database` to reclaim the ~330 pre-tracking cover files on prod (it resolves missing `cover_asset_id` first, then sweeps).
- (Canari side done 2026-08-17, commits 7be8d7a3 + 73606ddc + 741efee8a: `EcosystemCoverPreview.svelte` builds the square cover URL from the link itself via `ecosystemHosts.ts`. One rule now governs the key there: an image is public and needs no key, a metadata read does - only `/api/albums/[id]/info` carries `MIGALLERY_API_KEY`, covers go through Canari's SSRF-guarded image proxy. The keyed `mls/gallery-cover/:albumId` proxy is deleted.)

**Memory Gotchas (Do not repeat):**

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
