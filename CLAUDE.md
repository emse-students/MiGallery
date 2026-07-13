# **MiGallery \- Rules & Session State**

## **AGENT DIRECTIVES (OPUS AUTONOMOUS MODE)**

- NO BLIND GREP: Never run generic grep or find across the project. Check the SESSION STATE below first, or ask the user for exact paths.
  ASK EARLY: State assumptions explicitly. If uncertain about architecture, multiple interpretations, or a bug, ASK during the planning phase. No guessing.
- SURGICAL EDITS: Touch ONLY requested code. Map changes 1:1 to the prompt.
- STATE PRUNING: When updating the roadmap, DELETE the detailed descriptions of completed tasks. Keep the file small.
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
- Auth.js \+ Authentik: Roles are `admin` (full access), `mitviste` (gallery mgmt, no admin), `user` (basic).

## **CODING STANDARDS**

- English Only: Code, comments, docs, and dev-facing strings (`console.log`, errors) MUST be English.
- I18N: User-visible strings use Paraglide (`messages/fr.json`, `en.json`). No inline string literals.
- ASCII Punctuation: Normalize to ASCII (`'`, `"`, `-`) everywhere. Preserve French accents (`é`, `à`) ONLY in localized strings/French comments.
- UI: Single source of truth is `src/app.css` (tokens, `--radius-*`). Use `.btn-glass` with modifiers. Dark-first glassmorphism. Avoid raw hex/px. `lucide-svelte` only (no aliases).
- Husky: Pre-commit runs ESLint \+ Prettier \+ svelte-check. Fix errors; do not bypass.

## **KEY PATHS & COMMANDS**

- API Proxy Handler: `src/routes/api/immich/[...path]/+server.ts`
- DB Queries: `src/lib/db/`
- Commands: `npm run dev`, `npm run check` (Type-check), `npm run test` (Integration), `npm run db:init`

## **SESSION STATE (Active Memory)**

**Current WIP:**

- Themes 2 and 3 COMPLETE this session: WP-2a (b7d710d) + WP-2b (267d64d, selfie incitation) + WP-3a (cdb4012, dropped 4 legacy album\_\*\_permissions tables). See Roadmap.
- Next step: open work = WP-4.x UX (pill buttons + upload feedback + a11y/responsive still open; error/loading/empty states slice DONE 1832c97) + WP-2.x i18n backend (users.locale) + deferred i18n externalization. Pick one (independent WPs). WP-4.4 memory tests DONE this session (3cd0dc9, see roadmap). WP-4.3 structured logger DONE (see roadmap). WP-4.1 StreamSaver removal DONE (01f41ff). WP-5.x face-first picker DONE (7a004fc); FR#3 upload resilience (c49e2c6) + WP-5.1 combined queries (283d4f4) DONE prior sessions. PROD DEPLOY NOTE: WP-3a's DROP runs on prod at next deploy; prod DB already backed up on mitv (migallery_backup_pre-wp3a_20260712_020159.db).
- Deferred i18n externalization WP (from Theme 5): user-visible FR string literals still inline (error()/json({error}) responses, src/lib/admin/endpoints.ts `description:`, toast.\*, this.error, backup.ts `message:`, some title= attrs). Real Paraglide-externalization WP, not cosmetic.
- i18n idiom recap: import { m } from '$lib/paraglide/messages'; call m.key() in template; params m.key({ x }); plurals use "(s)" style not ternary; npm run check auto-runs paraglide:compile. Prune orphaned keys with a node script over messages/{fr,en}.json (compare vs `grep -roE "m\.\w+" src`), paraglide output is gitignored+recompiled.

**Roadmap (Active WP):**

- \[x\] Themes 0, 1, 1b.1-1b.5, and 5 (N1-N6): COMPLETED.

Theme 1b \- FULL admin harmonization

- \[x\] WP-1b.6 wiki: Documentation tab now renders docs/wiki/\* (index-first, then api-reference); api-docs route retired; nav link + api-keys button repointed to /admin.

Theme 2 \- Profile / trombinoscope

- \[x\] WP-2a (b7d710d): trombinoscope page DELETED, merged into /admin/users. Gotcha: /api/users/[id] PUT is a FULL-COLUMN update (role||'user', name??id) - always send the complete row or you demote/rename users.
- \[x\] WP-2b (267d64d): selfie incitation. Un-gated "Mes photos"/"Photos CV" nav tabs (removed hasPhoto/canManagePhotos gates in +layout.svelte + MobileNav.svelte). /mes-photos now shows a "complete profile" incitation (mp*incite*\* keys) linking to /parametres#face-recognition instead of goto('/'). /photos-cv funnels no-photo non-managers to /mes-photos. KEY FACT: the full self-service selfie flow (CameraInput -> upload -> face detect -> /api/users/me/face) ALREADY EXISTS in /parametres for EVERYONE - no porting needed; WP-2b just links to it.

Theme 3 \- DB (COMPLETE)

- \[x\] WP-3a (cdb4012): permissions fusion phase 2 DONE. Dropped the 4 legacy album\_\*\_permissions tables via a PRAGMA user_version=2 migration in database.ts (after the uv=1 backfill), and removed their CREATE blocks from schema.sql. album_permissions is now the sole source of truth. Prod verified before shipping: legacy==unified (44/707/260/826, 1837 total), uv already 1, DB backed up (migallery_backup_pre-wp3a_20260712_020159.db on mitv). DROP executes on prod at next deploy; migration is idempotent (DROP TABLE IF EXISTS).

Theme 4 \- Backlog

- \[ \] WP-4.x UX (partial): pill buttons, upload feedback, a11y+responsive still open.
- \[x\] WP-4.x error/loading/empty states (1832c97): completed the state-block trio. NEW `LoadingState.svelte` (centered Spinner + label, inline/block layouts, role=status) + `ErrorState.svelte` (XCircle + message + optional retry button via `onRetry`, role=alert, error-tinted surface) alongside the pre-existing `EmptyState.svelte`. Migrated ALL raw status blocks: mes-photos + admin/corbeille (error now has a real retry - loadPerson / fetchTrashedAssets); albums/[id] + PhotosGrid + ChangePhotoModal (raw empty divs -> EmptyState); admin/api-keys (mislabeled `.empty-state` LOADING block -> LoadingState). Deleted dead global `.error`/`.loading` from app.css (kept `.empty-state` - EmptyState still leans on its bg/radius/margin + `.empty-state p` title size) and the per-page scoped `.empty-state`/`.loading-state` dupes. No new i18n (reused common_retry/common_loading/common_error_detail). GOTCHA: EmptyState's card look is an intentional-kept LEAK from global `.empty-state` (unlayered scoped styles win per-property, but bg/radius/margin/title-size only exist globally) - do not delete that global rule.
- \[x\] FR\#3 upload resilience (c49e2c6): stable per-file upload id = SHA-256(name/size/lastModified) so retries RESUME the server .part (regex-safe hex) instead of orphaning it; offline-aware retry loop in handleAlbumUpload waits for `online` event (60s/cycle, cap 20, never infinite) without spending server-retry budget; UploadZone shows a "Connexion perdue" banner (WifiOff, uz_connection_lost FR+EN) via online/offline listeners. Server chunk-status/x-file-id contract UNCHANGED. NOT done: drag&drop enqueue-during-upload (handleDrop still `if isUploading return`) - separate UX item.
- \[x\] WP-5.1 combined queries (283d4f4): Immich search/metadata AND-combines personIds+albumIds server-side (verified prod: personIds+albumIds == person INTERSECT album, 30==A∩PhotoCV for Ophelie). handlers.getPersonAssets now: inAlbum=true = 1 combined query; inAlbum=false = personAssets MINUS combined-subset (no full-album fetch). photos/+server.ts + photos-stream now delegate to the shared handler; removed dup fetch-all-then-filter + unused getAssetIdsInSystemAlbum. Verified true=30/false=1645/all=1675 disjoint+complete.
- \[x\] WP-5.x face-first profile picker (7a004fc): ChangePhotoModal renders detected-face crops via new FaceCropThumb.svelte (lazy IntersectionObserver -> GET /api/immich/faces?id={assetId}, picks face where person.id===personId, CSS-crops thumbnail onto bounding box with kCover-clamp + center-cover fallback). /faces field names verified against prod (boundingBoxX1/Y1/X2/Y2, imageWidth/Height, person.id). Selection still pushes featureFaceAssetId. NOT done: face crops rendered from 250px thumbnail (could bump to preview if quality complaints); no visual QA in a real browser yet.
- Clean [TEST] albums = DONE/verified 2026-07-12 (prod already clean: 0 real test albums out of 266; regex false-positive was the real album "Soiree The Greatest Show'Mines"). Immich prod access recipe: pipe a node script into `ssh mitv "docker exec -i migallery-migallery-1 node"` (container has global fetch + IMMICH_BASE_URL/IMMICH_API_KEY, header x-api-key).
- \[x\] WP-4.1 (01f41ff): removed dead StreamSaver shim + no-op SW. Archive DL already used the server token flow (POST /api/download -> GET /{token}, native save), so it was all dead code. Deleted static/streamsaver-sw.js, static/mitm.html, src/lib/types/streamsaver.d.ts; dropped the streamsaver dep + eslint ignore. hooks.client.ts now DEFENSIVELY UNREGISTERS any lingering streamsaver-sw SW (a 404 on the deleted script does NOT auto-unregister an already-installed SW on deployed clients). Wiki updated. NOT run: full `npm run validate` (only npm run check=0/0 + eslint=1 preexisting test warning); pre-push will run it.
- \[x\] WP-4.3 structured logger: new `src/lib/server/logger.ts` (`createLogger(scope)`, levels debug/info/warn/error gated by LOG*LEVEL env; test=error-only, prod=info+, dev=all; line = ISO ts + LEVEL + [scope] + msg + optional fields). BIG CLEANUP per user: console.* went 249/75files -> 44/17files. ALL server code now logs via the logger (0 console left server-side: lib/server/\_, lib/db, hooks.server, lib/auth+session+immich, the whole immich proxy, ALL /api route handlers incl the 44-file bulk-converted leaf handlers, +layout.server, admin/database). Deleted noise everywhere: emoji/debug/success traces (esp users/me/face was ~15 emoji trace lines -> rewritten to keep only the catch error; logout debug; album-delete success; immich-proxy face-pairing deletion emoji traces -- audit already covered by logEvent). Remaining 44 console are INTENTIONAL: client/browser files (.svelte, .svelte.ts, client-cache, streaming, album-operations) keep genuine catch-block console.error/warn (no server logger in browser) + logger.ts sink + a docs README example. AUDIT LOG (SQLite `logs` table via logEvent) is a SEPARATE concern, untouched. Wiki: architecture.md has a Logging section; index.md conventions bullet added. check=0/0, lint clean. Bulk conversion done via PowerShell (insert createLogger import+scoped const after last import, console.X->log.X, strip redundant [Prefix] tags). GOTCHA hit: Read line numbers are display-only; Edit needs EXACT tabs -- the immich proxy handler bodies are 2-tab indented, mis-counting as 3 caused repeated no-match; minimal (no-leading-whitespace) substrings or PowerShell literal .Replace are the reliable fallback.
- \[x\] WP-4.4 memory tests (3cd0dc9): two non-regression test files pinning the RAM-safe upload path. (1) tests/memory-invariants.test.ts = SOURCE guards over the immich proxy handler, run everywhere (no server/Immich): no Buffer.alloc, no whole-file readFileSync, chunk append-flag, streamed sha256, streamed createReadStream upload, duplex-half passthrough, <=2 bounded request.arrayBuffer() sites -- this is the CI-durable guard. (2) tests/memory-upload.test.ts = REAL chunked-upload contract over HTTP (per-chunk disk buffering, resume via chunk-status receivedBytes, per-chunk sha256, file-id validation); it NEVER sends the final chunk so it makes ZERO Immich contact, and is guarded by an immichConfigured probe so it SKIPS in CI (empty IMMICH_BASE_URL -> handler 500s at the baseUrlFromEnv guard BEFORE the chunk branch). KEY CONSTRAINT: the immich proxy returns 500 "IMMICH_BASE_URL not set" (line ~664) BEFORE both the chunk-upload branch and chunk-status, so any runtime upload test is un-runnable in CI by design -> source guards do the real CI work, runtime file only bites locally/prod. Exercised runtime file against a live built server (12/12 green) by starting `node build/index.js` with NODE_ENV=test + real .env; the test-with-server.mjs non-local-Immich guard was not triggered (ran only these 2 files, which create no [TEST] albums).
- \[ \] WP-2.x i18n backend: users.locale column

Theme 5 \- i18n \+ Normalization (COMPLETE)

- \[x\] N-7..N-11b ALL DONE. User-facing strings -> Paraglide; dev console/throw + all code comments + test titles -> EN. Residual inline FR = user-visible response/UI string literals only, deferred as a proper Paraglide-externalization WP (see Current WIP note), NOT a comment task.

**Memory Gotchas (Do not repeat):**

- lucide-svelte 1.0.1: some old names removed. Verify against node_modules/lucide-svelte/dist/icons/. Trash2/RotateCcw/RefreshCw DO exist.
- Central icon barrel EXISTS: src/lib/icons.ts. Import from there. Icon prop typing: ComponentType\<SvelteComponent\>.
- shared-admin.css is SCOPED under .admin-shell. Bare-element rules no longer leak.
- Pre-commit hook runs via npm (npx lint-staged && npm run check = svelte-check only, NOT tests). Pre-push (.husky/pre-push, added 0d668fe) runs `npm run validate` = scripts/ci-local.mjs, the full local mirror of ci.yml (check + lint + fresh-DB build+tests). So tests now gate the push, not just CD.
- VALIDATE/CI env facts: hooks.server.ts calls dotenv config({ override:true }) -> the built server ALWAYS force-loads the repo-root .env, ignoring passed env vars. So ci-local.mjs briefly swaps in a synthetic .env (empty IMMICH_BASE_URL, ENABLE_DEV_ROUTES=true, disposable DB) to run the suite like CI, then restores the real .env + data/migallery.db* (side-effect-free, self-heals from an interrupted run via *.civalidate-bak). The test suite's guard REFUSES non-local Immich (would pollute prod with [TEST] albums) - never bypass it; empty Immich is how CI/validate run. Dev-route auth (/dev/login-as) is gated by NODE_ENV==='test' || ENABLE_DEV_ROUTES==='true'.
- WINDOWS ZOMBIE: test-with-server.mjs child.kill() does NOT kill the detached node tree on Windows -> leaks a server holding port 3000, so the next run silently tests a STALE server (symptom: ~180 skipped, spurious 500s, EADDRINUSE). Fixed 0d668fe via taskkill /T on win32 + ci-local frees port 3000 before tests. If tests skip en masse locally, check for a zombie on 3000.
- The in-process immichCache was REMOVED (2026-07-11). The only surviving memo is publicMetaCache inside the immich proxy. Do not reintroduce a global metadata cache.
- SCHEMA <-> INSPECT DRIFT: scripts/inspect-db.cjs has a hard-coded `expectedTables` list; dropping/renaming a table in schema.sql WITHOUT updating it makes the script exit 1 -> /api/admin/db-inspect catch branch returns { success:false } (no `tables`) -> admin-auth integration test fails in CI only (hooks run svelte-check, NOT `npm run test`; pre-push is empty). Fixed 6b5e85a (WP-3a had dropped album\_\*\_permissions). Keep expectedTables in sync with schema.sql.
- SESSION-END SIGNAL: when tool calls start failing with "claude-opus-4-8 is temporarily unavailable" (classifier can't gate Bash/PowerShell), it means the session is ending. STOP starting new work, conclude cleanly (note state honestly - what is committed vs not), and hand off. Do not loop-retry commands.
