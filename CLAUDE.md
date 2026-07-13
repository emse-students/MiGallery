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

- PROD DEPLOY PENDING: WP-3a's DROP of the 4 legacy album\_\*\_permissions tables runs on prod at next deploy (idempotent, DROP IF EXISTS). Prod DB backed up on mitv (migallery_backup_pre-wp3a_20260712_020159.db). WP-6 adds users.photos_asset_id (idempotent ALTER, PRAGMA-guarded) - also runs at next deploy.
- i18n idiom: import { m } from '$lib/paraglide/messages'; call m.key() in template; params m.key({ x }); plurals use "(s)" style not ternary; npm run check auto-runs paraglide:compile. Prune orphaned keys with a node script over messages/{fr,en}.json (compare vs `grep -roE "m\.\w+" src`); paraglide output is gitignored+recompiled.
- Immich prod access recipe: pipe a node script into `ssh mitv "docker exec -i migallery-migallery-1 node"` (container has global fetch + IMMICH_BASE_URL/IMMICH_API_KEY, header x-api-key).

**Roadmap (Active WP):**

Themes 0-5 COMPLETE; Theme 4 mostly done (see Open). Done WPs pruned - only forward-relevant gotchas survive below.

Surviving gotchas from done WPs:

- \[x\] WP-2a: /api/users/[id] PUT is a FULL-COLUMN update (role||'user', name??id) - always send the complete row or you demote/rename users. (admin PUT does NOT touch locale - safe.)
- \[x\] WP-4.x states: LoadingState + ErrorState (retry via onRetry) exist beside EmptyState. GOTCHA: EmptyState's card look is an intentional LEAK from global `.empty-state` in app.css (bg/radius/margin/title-size only exist there) - do not delete that global rule.
- \[x\] WP-2.x users.locale: hooks.server.ts seeds PARAGLIDE_LOCALE from DB ONLY when the cookie is absent (never reverts a local switch; a lang change on device B won't reach A until A's cookie clears - acceptable v1). PATCH /api/users/me/locale; $lib/locale.ts switchLocale().
- \[x\] WP-4.3 logger: all server code logs via createLogger(scope) (src/lib/server/logger.ts, LOG_LEVEL-gated); 0 console server-side. Remaining ~44 console are INTENTIONAL client/browser catch-blocks. Audit log (SQLite `logs` via logEvent) is separate.
- \[x\] WP-4.4 memory tests: tests/memory-invariants.test.ts (source guards, CI-durable) + tests/memory-upload.test.ts (runtime chunked-upload contract, SKIPS in CI: empty Immich 500s before the chunk branch).
- \[x\] FR\#3 upload resilience: stable per-file id = SHA-256(name/size/lastModified) resumes the server .part; offline-aware retry (60s/cycle, cap 20). NOT done: drag&drop enqueue-during-upload (handleDrop still `if isUploading return`).
- \[x\] WP-5.1: Immich search/metadata AND-combines personIds+albumIds server-side; handlers.getPersonAssets is the shared path (photos + photos-stream delegate).
- \[x\] WP-5.x face-first picker: ChangePhotoModal renders face crops via FaceCropThumb.svelte (GET /api/immich/faces?id=). NOT done: crops from 250px thumbnail (bump to preview if quality complaints); no browser QA.
- \[x\] WP-6 profile-crop (71f68ab, checked+pushed): MiGallery serves its OWN wider 0.62 square crop as the profile photo, NOT Immich's tight person thumbnail. Crop core = $lib/server/face-crop.ts generateFaceCrop(assetId, personId, fetch) -> {ok,buffer}|{ok:false,reason} (disk cache data/cache/faces, OUTPUT_SIZE=320); /api/faces is a thin wrapper. Source of truth = users.photos_asset_id (persisted by PATCH /api/users/me/face on face pick, after the Immich featureFaceAssetId PUT). /api/users/[username]/avatar serves the crop when photos_asset_id set (Cache-Control long+immutable iff `?v` present, else 1h), FALLS BACK to the Immich /people/{id}/thumbnail proxy for legacy users (no photos_asset_id) or on any crop failure - so pre-first-selection shows Immich's crop, and Avatar.svelte initials only appear when there is NO photos_id at all. Mes-photos header uses loadPerson(id,{userId,version}) -> imageUrl=/api/users/{id}/avatar?v={asset}. GOTCHA: the 3 `<Avatar>` usages (parametres perm-lists + admin list) intentionally get NO ?v (endpoint serves our crop anyway; only up-to-1h stale after an other-user edit). NOT done: skeleton on the Mes-photos header <img> (deemed marginal - header only renders when imageUrl is set). No browser QA yet.
- \[x\] WP-4.x pill buttons: only true pill-text duplicates migrated to .btn-glass. DELIBERATE custom, do NOT fold: photo-card icon overlays (albums .action-btn, corbeille, PhotoCard fav/dl/del), circular (AlbumModal .promo-add-btn), CameraInput, text-links (users .btn-text), nav arrows (photos-cv .btn-nav), card-style (admin/database).

Open:

- \[ \] i18n leftover: client toast.\*/title= -> Paraglide (357e191) and ALL server error()/json({error})/'Erreur inconnue' fallbacks -> English DONE (357e191 did throw error(); 6d2241f swept the missed json({error}) returns + fallbacks in album/avatar/photo-access/db-import/db-restore). STILL FR by design: only the 2 `message:` SUCCESS strings (db-import:51, db-restore:51 "...avec succes") + backup.ts `message:` - surfaced via admin UI, would need a server-returns-key refactor. Un-audited: this.error/aria-label/placeholder FR (toast+title+server-error were the audited scope).
- \[x\] FR\#3 drag&drop enqueue-during-upload: UploadZone now drains a queue. enqueue(files) appends to fileStatuses (additive, dedup by name-size-lastModified) + pendingFiles, kicks drainQueue() which loops batches through runBatch() (old uploadFiles body). Drop/click/select mid-upload enqueues instead of being dropped. handleDrop/DragOver no longer gate on isUploading (only disabled); openFileSelector too; .upload-zone.uploading cursor now `copy`. runBatch catch is scoped to THIS batch's files (queued-but-unstarted stay pending). No browser QA yet.
- \[x\] WP-5 face picker: server-side square-crop endpoint (GET /api/faces/[assetId]/[personId] -> cached WebP in data/cache/faces, OUTPUT_SIZE=320, face ~62%; center-crop when personId="center"/no match). Sharp semaphore lives in $lib/server/sharp-limit.ts, SHARED by covers + faces (one global RAM cap; do NOT reintroduce a per-endpoint one). VERIFIED on prod 2026-07-14: 324 crops cached, endpoint returns our WebP crop end-to-end (source = preview thumbnail).
- \[x\] WP-6 header consumer FIX (2026-07-14): the global app header (+layout.svelte ~L135) was the last place still hitting Immich directly (/api/immich/people/{photos_id}/thumbnail, stable URL -> browser-cached stale -> looked like "not our crop / never updates"). Now uses /api/users/{id_user}/avatar?v={photos_asset_id} like everywhere else (?v busts cache on photo change). Backend was already correct. GOTCHA: /api/users/[username]/avatar keys on id_user (NOT photos_id); it looks up photos_id+photos_asset_id internally.

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
- NO custom +error.svelte exists -> SvelteKit's DEFAULT error page renders error.message. So `throw error(status, msg)` messages ARE user-visible (not just dev-facing). They were English-ified anyway (357e191, accepted tradeoff: error pages are rare edge cases - 403/stale-token/missing-album). To properly localize error pages later, add a +error.svelte that maps status/message to Paraglide. i18n audit fact: accent-based grep UNDERCOUNTS FR literals (accent-free FR like "Fermer"/"Erreur..."/"Photo suivante" slips through) - audit by reading the file category (all toast.\*, all title=), not just \p{accent}.
