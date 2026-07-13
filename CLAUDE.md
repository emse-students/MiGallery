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

- Open work (pick one, all independent): WP-4.x UX (upload feedback DONE 018d7e4; a11y focus-visible DONE 3e66acc; responsive still open) | deferred i18n externalization (user-visible FR string literals still inline in error()/json({error}) responses, src/lib/admin/endpoints.ts `description:`, toast.\*, this.error, backup.ts `message:`, some title= attrs -- a real Paraglide-externalization WP, not cosmetic).
- PROD DEPLOY PENDING: WP-3a's DROP of the 4 legacy album\_\*\_permissions tables runs on prod at next deploy (idempotent, DROP IF EXISTS). Prod DB backed up on mitv (migallery_backup_pre-wp3a_20260712_020159.db).
- i18n idiom: import { m } from '$lib/paraglide/messages'; call m.key() in template; params m.key({ x }); plurals use "(s)" style not ternary; npm run check auto-runs paraglide:compile. Prune orphaned keys with a node script over messages/{fr,en}.json (compare vs `grep -roE "m\.\w+" src`); paraglide output is gitignored+recompiled.

**Roadmap (Active WP):**

Done (one-liners; details in git):

- \[x\] Themes 0, 1, 1b, 3, 5 COMPLETE. Theme 2 COMPLETE. Theme 4 partially done (see open items below).
- \[x\] WP-2a (b7d710d): trombinoscope merged into /admin/users. GOTCHA: /api/users/[id] PUT is a FULL-COLUMN update (role||'user', name??id) - always send the complete row or you demote/rename users.
- \[x\] WP-2b (267d64d): selfie incitation. The full self-service selfie flow (CameraInput -> upload -> face detect -> /api/users/me/face) lives in /parametres for EVERYONE.
- \[x\] WP-3a (cdb4012): dropped 4 legacy album\_\*\_permissions tables (uv=2 migration in database.ts); album_permissions is sole source of truth. See PROD DEPLOY PENDING above.
- \[x\] WP-4.x error/loading/empty states (1832c97): LoadingState + ErrorState components (retry via onRetry) beside EmptyState; all raw status blocks migrated. GOTCHA: EmptyState's card look is an intentional-kept LEAK from global `.empty-state` in app.css (bg/radius/margin/title-size only exist there) - do not delete that global rule.
- \[x\] WP-4.1 (01f41ff): removed dead StreamSaver shim + no-op SW (archive DL uses the server token flow). hooks.client.ts defensively unregisters any lingering streamsaver-sw SW on deployed clients.
- \[x\] WP-4.x upload feedback (018d7e4): onFileStart signal threaded handleAlbumUpload -> UploadZone so the per-file 'uploading' spinner (was dead code) + pending Clock icon + "{n} en attente" counter now render. New key uz_pending_count.
- \[x\] WP-4.x a11y focus-visible (3e66acc): one global `:focus-visible` accent ring in app.css @layer base. reduced-motion already global; svelte-check a11y at 0. Responsive verified clean (media queries + table overflow-x wrappers everywhere) - no code defect, further work needs real-device QA.
- \[x\] WP-2.x users.locale (adea6ea): per-user UI language persisted server-side. Additive users.locale TEXT (guarded ALTER + schema.sql). PATCH /api/users/me/locale (isLocale-validated, /me/promo auth cascade). $lib/locale.ts switchLocale() persists then Paraglide setLocale (cookie+reload), wired into LocaleSwitcher + parametres. hooks.server.ts seeds the PARAGLIDE_LOCALE cookie from DB ONLY when absent (new device adopts saved lang; never reverts a local switch - so a lang change on device B won't propagate to device A until A's cookie clears; acceptable v1). admin PUT /api/users/[id] does NOT touch locale (safe).
- \[x\] WP-4.3 structured logger (src/lib/server/logger.ts, createLogger(scope), LOG_LEVEL-gated): all server code logs via it (0 console server-side). Remaining ~44 console are INTENTIONAL client/browser catch-blocks (no server logger in browser). Audit log (SQLite `logs` via logEvent) is separate, untouched.
- \[x\] WP-4.4 memory tests (3cd0dc9): tests/memory-invariants.test.ts = source guards over immich proxy (CI-durable). tests/memory-upload.test.ts = runtime chunked-upload contract, SKIPS in CI (immich proxy 500s "IMMICH_BASE_URL not set" before the chunk branch; empty Immich = how CI runs).
- \[x\] FR\#3 upload resilience (c49e2c6): stable per-file id = SHA-256(name/size/lastModified) so retries RESUME the server .part; offline-aware retry loop waits on `online` (60s/cycle, cap 20). NOT done: drag&drop enqueue-during-upload (handleDrop still `if isUploading return`) - separate UX item.
- \[x\] WP-5.1 combined queries (283d4f4): Immich search/metadata AND-combines personIds+albumIds server-side; handlers.getPersonAssets is the shared path (photos/+server.ts + photos-stream delegate to it).
- \[x\] WP-5.x face-first profile picker (7a004fc): ChangePhotoModal renders detected-face crops via FaceCropThumb.svelte (GET /api/immich/faces?id=, CSS-crops thumbnail onto bounding box). NOT done: crops from 250px thumbnail (bump to preview if quality complaints); no browser visual QA yet.
- \[x\] Clean [TEST] albums (2026-07-12): prod already clean. Immich prod access recipe: pipe a node script into `ssh mitv "docker exec -i migallery-migallery-1 node"` (container has global fetch + IMMICH_BASE_URL/IMMICH_API_KEY, header x-api-key).
- \[x\] WP-4.x pill buttons (3a3c961): surgical dedup only. mes-photos .btn-primary -> .btn-glass primary; admin/users .export-pdf-btn adopts .btn-glass (scoped rule reduced to margin-left:auto). DELIBERATE: photo-card icon overlays (albums .action-btn, corbeille restore/delete-permanent, PhotoCard favorite/download/delete), circular (AlbumModal .promo-add-btn), camera UI (CameraInput), text-links (users .btn-text), nav arrows (photos-cv .btn-nav), and card-style buttons (admin/database) are INTENTIONALLY custom (different pattern: positioned/opacity-reveal/scale-hover/circular) - do NOT fold into .btn-glass. Only true pill-text duplicates were migrated.

Open:

- \[ \] WP-4.x UX: upload feedback, a11y+responsive.
- \[ \] WP-2.x i18n backend: users.locale column.
- \[ \] Deferred i18n externalization (see Current WIP).

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
- A11Y baseline (done): global `:focus-visible` ring in app.css @layer base (3e66acc) + `prefers-reduced-motion` block at app.css:~1755. Svelte-check enforces a11y warnings and is at 0, so structural a11y (alt, click-without-keyboard) is clean. Responsive: per-component media queries + table overflow-x already exist; do NOT make blind responsive edits - verify a concrete breakpoint issue in-browser first (No guessing).
