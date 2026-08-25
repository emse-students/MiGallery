# MiGallery - Rules & Session State

## AGENT DIRECTIVES (OPUS AUTONOMOUS MODE)

- NO BLIND GREP: never grep/find across the whole project. Check SESSION STATE first, or ask for exact paths.
- ASK EARLY: state assumptions. If uncertain about architecture or a bug, ask during planning. No guessing.
- SURGICAL EDITS: touch ONLY requested code, 1:1 with the prompt.
- CLAUDE.md HYGIENE: trim this file actively. DELETE shipped Work Packages (keep only forward-relevant gotchas). A lean CLAUDE.md is a hard requirement.
- UPDATE STATE: update SESSION STATE before finishing a Work Package.
- BASH OVER SUBAGENTS: filter with native `rg`/`find` before the LLM sees it. Only spawn subagents for broad semantic audits or massive multi-file refactors.
- WORKFLOW CYCLE: plan/read -> ask if uncertain -> surgical edit -> tests -> `git add . && git commit -m "[Task summary]"` -> update SESSION STATE -> STOP and output: "Task committed. Please run `/compact` (or `/clear` if switching to a new theme)."
- WIKI: documentation goes EXCLUSIVELY in `docs/wiki/`. Delete legacy code immediately.
- PROD ACCESS: `ssh mitv` (or `ssh canari`).

## ARCHITECTURE & DATA FLOWS

- Svelte 5 ONLY: runes (`$state`, `$derived`, `$effect`). Never the old reactive `$` syntax.
- SSR guards: browser imports must be lazy (`await import`) or guarded by `typeof window !== 'undefined'`.
- UPLOADS (no RAM): <10MB direct, >10MB chunked. Stream to disk (`fs.createWriteStream`) then to Immich. Never `Buffer.alloc`.
- ARCHIVE DOWNLOADS: `POST /api/download` (UUID token) -> `GET /api/download/{token}` (native browser streaming). No StreamSaver, no Service Worker.
- SQLite: synchronous `better-sqlite3` in server handlers. Stores only what Immich lacks (users, roles, permissions, logs). Upload concurrency uses per-file locks `fs.openSync(lockPath, 'wx')` - do not remove.
- AUTH: Authentik (OIDC) + OPAQUE sessions. The `migallery_session` cookie carries a random TOKEN, never an identity; the `sessions` row is the truth (`src/lib/db/sessions.ts`). No Auth.js, no `AUTH_SECRET`. Roles: `admin`, `mitviste` (gallery mgmt), `user`.

## CODING STANDARDS

- English only for code, comments, docs, dev-facing strings.
- I18N: user-visible strings via Paraglide (`messages/fr.json`, `en.json`). No inline literals.
- ASCII punctuation everywhere; French accents only inside localized strings/French comments.
- UI: single source of truth is `src/app.css` (tokens, `--radius-*`). `.btn-glass` with modifiers, dark-first glassmorphism, no raw hex/px, `lucide-svelte` only.
- Husky pre-commit runs ESLint + Prettier + svelte-check. Fix errors, do not bypass.

## KEY PATHS & COMMANDS

- API proxy: `src/routes/api/immich/[...path]/+server.ts` - DB queries: `src/lib/db/`
- `npm run dev`, `npm run check`, `npm run test`, `npm run db:init`, `npm run validate` (full CI mirror)

## SESSION STATE

**Current WIP:** (none)

**Due now:** click "Couvertures orphelines" once on `/admin/database` on prod to reclaim the ~330 pre-tracking cover files (it resolves missing `cover_asset_id` first, then sweeps).

## MEMORY GOTCHAS (do not repeat)

**Immich**

- A re-upload of a known checksum answers `{status:'duplicate', id}` and does NOT restore a trashed asset; a trashed asset added to an album stays invisible. `restoreAssetsFromTrash` (`src/lib/server/immich-trash.ts`) never throws and is a no-op on non-trashed ids, so callers fire it unconditionally. It runs in exactly TWO places: `finishImmichUpload` and inside `addAlbumAssets`. Do not re-inline a copy.
- `src/lib/server/immich-album-assets.ts` is the ONLY code that mutates album membership. Four thin callers exist; never grow a fifth. Status contract: a 4xx travels as-is, everything else answers 500 (pinned by `tests/people-photoscv.test.ts`).
- `src/lib/server/immich-search.ts` is the ONE paginated search (`searchAssetPage` / `searchAllAssets`). Do not inline a fourth copy - `album-cover.ts` still has one and should move over.
- `POST /api/search/metadata` reports `total` = size of the PAGE, and `nextPage` comes back as a STRING. There is no cheap count: anything needing one must paginate.
- Orphan detection carries NO type filter deliberately (prod has 145 orphan VIDEOS). Check for a `type:'IMAGE'` pin before reusing a filter from `photos-cv/handlers.ts`.
- `buildImmichUploadFormData` appends metadata BEFORE `assetData` deliberately - Immich streams the multipart body and answers 400 if metadata arrives after the file part.
- `startDeepScan()` uses the GLOBAL fetch on purpose (it outlives the request that started it) and logs its own `.catch`.
- Every server-to-server call MUST carry `signal: AbortSignal.timeout(OUTBOUND_BUDGET_MS)` (`$lib/server/outbound`).

**Auth & security**

- The `users` row is a COPY of Authentik, never a second opinion. `SSO_OWNED_FIELDS` (`first_name`, `last_name`, `promo`, `formation`) are written on EVERY login, nulls included - an absent claim is the IdP's answer, not a transport failure. `role`, `photos_id`, `photos_asset_id`, `locale` stay out of that list. Pinned by `tests/sso-mirror.test.ts` (uses the `$env/dynamic/private` alias in `vitest.config.ts` - reuse it for other server modules under test).
- `first_login` and its graduation-year modal are DELETED, column included. Never reintroduce a client-writable `promo`: the SSO is its only writer.
- A cookie whose content IS the identity it claims is not a credential (the old `__session_user` hole). `httpOnly` stops other people's JS from reading it, never the holder from writing one.
- Impersonation lives in the session ROW (`impersonated_id_user`), never a second cookie. `ensureAdmin` judges the EFFECTIVE user, `canStopImpersonating` the REAL one.
- A SvelteKit `redirect()` is NOT an `Error` - throw redirects OUTSIDE any try/catch that inspects `instanceof Error`.
- Post-login destination (`src/lib/auth-redirect.ts`): only the ANONYMOUS branch of a guard may carry one, else a refused user loops forever - hence `requireAdminPage`. A leading `/` does not prove a path is ours (`//evil.com`, `/\evil.com`, control chars); one sanitizer, applied on WRITE (login) and again on READ (callback).
- `requireScope(event, 'read')` returns `grantedScope: 'read'` for a SESSION admin. Gate cross-user actions on `auth.user?.role === 'admin'`, never `grantedScope === 'admin'`.
- `GET /api/albums/[id]/cover` and `/og-cover` are PUBLIC for every visibility, private included (an external `<img>` carries no key). `/og-preview` and album contents stay gated. Do not "restore" a scope check there.
- There is NO `handleError` hook: an exception leaving a route unlogged is invisible in prod. Logging sits in the shared helpers - check what would stop being logged before deleting a route's try/catch.
- `PUT|DELETE /api/people/album/assets` has zero callers in `src/` but is NOT dead - external API-key callers hit it. Grep-says-unused is not proof; check `docker logs migallery-migallery-1`.
- PortailEtu is DELETED. What survives on purpose: `/api/external/media/[id]` (Sky/Canari avatars), `getOrCreateSystemAlbum` (still used for `'PhotoCV'`), and the `https://portail-etu.emse.fr` CORS origin in `hooks.server.ts` (site origin, not the album).

**Frontend**

- A Svelte 5 `$effect` stops tracking at its first `await`, but everything read synchronously before it IS tracked. Reading your own cache at the top of an async effect re-fires it on every write.
- Outside-click close can never be judged from `click` alone (its target is the common ancestor of press and release). `Modal.svelte` and `PhotoModal.svelte` require pointerdown AND pointerup on the backdrop. Do not simplify back.
- Lucide: never re-declare `width`/`height` on an svg inside a component - size the BUTTON, not the icon. Avoid the deprecated aliases from `dist/aliases` (`AlertCircle`, `CheckCircle`, ...); `dist/icons/index.js` is the list that counts, and `CheckCircle` maps to `circle-check-big`, not `circle-check`.
- Albums browsing state (`src/lib/albums-view-state.svelte.ts`): search, unfolded school years and scroll live in a module singleton. `albums` on `/albums` is `$derived` from `page.data`, and the album back button calls `markReturnTrip()` because `goto()` pushes. Browser back is left alone. Not persisted, deliberately.
- SEARCH: every box goes through `src/lib/fuzzy.ts`. Truncating lists use `fuzzySearch` (filters + ranks); `/albums` uses `fuzzyMatch` to preserve chronology. Never write a `.includes()` filter in a surface. `editDistance` is Damerau-Levenshtein on purpose. The admin LOG search stays exact `LIKE`. See `docs/wiki/search.md`.
- `/mes-photos`: favorites stay in chronological place (`.favorite-badge` in `PhotoCard` + a "Toutes/Favoris" chip in `PhotosGrid`). The lightbox navigates `displayedAssets`; never reintroduce a favorites-first reordering. Mobile `PhotoCard` actions live in the long-press `.action-sheet` (400ms `sheetOpenedAt` guard).
- Album covers (`src/lib/server/album-cover.ts`): the asset lives in `albums.cover_asset_id`, the 400x400 WebP in `data/cache/covers/<assetId>.webp` (keyed by ASSET, so albums sharing a cover share one file). `pruneCoverAsset` deletes once nothing points at it; `resolveMissingCovers` MUST run before `pruneOrphanCovers`. Never resolve a cover client-side.
- `/api/users/[username]/avatar`: unbusted URLs revalidate via ETag (`no-cache`); only `?v=assetId` is `immutable`.

**Tooling**

- NEVER run `npm install` to "refresh" node_modules: npm on Windows rewrites `package-lock.json` against the Windows optional-dependency tree and drops Linux-only entries (`@emnapi/*`), so `npm ci` on the runner fails. If a branch changes no deps the lockfile must come back byte-identical - `git checkout <upstream-ref> -- package-lock.json`. Only install when deliberately changing `package.json`.
- Repo-wide `npm run format` rewrites ~190 files (prettier drift + CRLF churn). Format your own files, then `git checkout -- . ':!<your files>'`.
- Prettier has no `plugins` entry, so `.svelte` is skipped by lint-staged. Use `npm run format`, not a bare `npx prettier --write "src/**/*.svelte"`.
- `npm run test` refuses to run while `IMMICH_BASE_URL` points at prod. Do not set `ALLOW_REMOTE_IMMICH_TESTS=true`. Server-free suites: `tests/disk-cache.test.ts`, `tests/auth-redirect.test.ts`.
- Tests: no assertions inside a guard that repeats them (`expect(true).toBe(true)`, `expect(body).toBeDefined()` on parsed JSON). The accepted status sets in `tests/people-photoscv.test.ts` ARE pinned on purpose - do not narrow them.
- Do not reintroduce `const _err = ensureError(e)` followed by logging the raw `e`. If you normalize an error, use the result.
- Releases: the tag MUST be `vX.Y.Z` (`release.yml` triggers on `v*.*.*`). Bump `package.json` + `RELEASE_NOTES.md`, commit, push, THEN tag.
