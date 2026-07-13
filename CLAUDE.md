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
- Commands: `npm run dev`, `npm run check` (Type-check), `npm run test` (Integration), `npm run db:init`, `npm run validate` (full CI mirror)

## **SESSION STATE (Active Memory)**

**Current WIP:**

- PROD DEPLOY PENDING: at next deploy prod runs (idempotent) WP-3a's DROP of the 4 legacy album\_\*\_permissions tables (DROP IF EXISTS; backup migallery_backup_pre-wp3a_20260712_020159.db on mitv) + WP-6's ALTER adding users.photos_asset_id (PRAGMA-guarded).
- i18n idiom: `import { m } from '$lib/paraglide/messages'`; call `m.key()` in template, `m.key({ x })` for params; plurals use "(s)" style not ternary. `npm run check` auto-runs paraglide:compile (output gitignored). Prune orphan keys via a node script comparing messages/{fr,en}.json vs `rg -oE "m\.\w+" src`.
- Immich prod access: pipe a node script into `ssh mitv "docker exec -i migallery-migallery-1 node"` (container has global fetch + IMMICH_BASE_URL/IMMICH_API_KEY, header x-api-key). Use the PowerShell tool for ssh (Git Bash mangles the Windows cloudflared ProxyCommand path); write the script to scratchpad and pipe via `Get-Content` (inline `node -e` with escaped backticks breaks).

**Roadmap:** Themes 0-6 COMPLETE. All WPs shipped and the i18n plan is closed. Only forward-relevant gotchas survive.

Surviving gotchas from shipped work:

- /api/users/[id] PUT (admin) is a FULL-COLUMN update (role||'user', name??id) - always send the complete row or you demote/rename users. Does NOT touch locale (safe).
- EmptyState's card look is an intentional LEAK from the global `.empty-state` rule in app.css (bg/radius/margin/title-size only exist there) - do NOT delete that global rule. LoadingState + ErrorState (retry via onRetry) sit beside it.
- users.locale: hooks.server.ts seeds PARAGLIDE_LOCALE from DB ONLY when the cookie is absent (never reverts a local switch; a lang change on device B won't reach A until A's cookie clears - acceptable v1). PATCH /api/users/me/locale; $lib/locale.ts switchLocale().
- Server logging: all via createLogger(scope) (src/lib/server/logger.ts, LOG_LEVEL-gated); 0 console server-side (the ~44 remaining console are intentional client catch-blocks). Audit log (SQLite `logs` via logEvent) is separate.
- Upload resilience: stable per-file id = SHA-256(name/size/lastModified) resumes the server .part; offline-aware retry (60s/cycle, cap 20). Drag&drop/click/select MID-upload enqueues (UploadZone drains a queue: enqueue -> drainQueue -> runBatch; additive fileStatuses, dedup by name-size-lastModified; runBatch catch scoped to its own batch so queued-but-unstarted files stay pending). No isUploading gate on drop/dragover/openFileSelector (only `disabled`).
- Immich search/metadata AND-combines personIds+albumIds server-side; handlers.getPersonAssets is the shared path (photos + photos-stream delegate).
- Profile crop (WP-6): MiGallery serves its OWN 0.62 square crop as the avatar, NOT Immich's tight person thumbnail. Core = $lib/server/face-crop.ts generateFaceCrop(assetId, personId, fetch) (disk cache data/cache/faces, OUTPUT_SIZE=320). Source of truth = users.photos_asset_id (persisted by PATCH /api/users/me/face after the Immich featureFaceAssetId PUT). /api/users/[username]/avatar keys on id_user (looks up photos_id/photos_asset_id internally), serves the crop and FALLS BACK to the Immich people/{id}/thumbnail proxy for legacy users (no photos_asset_id) or on any crop failure; `?v={asset}` busts browser cache (Cache-Control long+immutable), else 1h. The 3 `<Avatar>` usages (parametres perm-lists + admin list) DELIBERATELY get no `?v` (endpoint serves our crop anyway; only <=1h stale after another user's edit). +layout header uses /api/users/{id_user}/avatar?v={photos_asset_id}.
- Face picker endpoint: GET /api/faces/[assetId]/[personId] -> cached WebP (data/cache/faces, OUTPUT_SIZE=320, face ~62%; center-crop when personId="center"/no match), source = preview thumbnail. Sharp semaphore in $lib/server/sharp-limit.ts is SHARED by covers + faces (one global RAM cap; do NOT reintroduce a per-endpoint one). ChangePhotoModal renders crops via FaceCropThumb.svelte.
- Pill buttons: only true pill-text duplicates use .btn-glass. DELIBERATE custom, do NOT fold: photo-card icon overlays (albums .action-btn, corbeille, PhotoCard fav/dl/del), circular (AlbumModal .promo-add-btn), CameraInput, text-links (users .btn-text), nav arrows (photos-cv .btn-nav), card-style (admin/database).
- i18n status (CLOSED): all user-visible strings are on Paraglide (toast/title/aria-label/placeholder/this.error swept; server error()/json({error})/message fallbacks English-ified). DELIBERATELY left French: db-inspect coupling to inspect-db.cjs's "Erreurs détectées" output (a string-match contract - do NOT touch one side without the other) and src/lib/docs/COMPONENTS.md (French dev doc, not a UI string). Audit gotcha: accent-based grep UNDERCOUNTS FR (accent-free "Fermer"/"Erreur..."/"Photo suivante" slip through) - audit by category (all toast./title=/aria-label/placeholder), not `\p{accent}`.

**Memory Gotchas (Do not repeat):**

- lucide-svelte 1.0.1: some old names removed. Verify against node_modules/lucide-svelte/dist/icons/. Central icon barrel EXISTS at src/lib/icons.ts - import from there (Icon prop typing: ComponentType\<SvelteComponent\>).
- shared-admin.css is SCOPED under .admin-shell. Bare-element rules no longer leak.
- Hooks: pre-commit = `npx lint-staged && npm run check` (svelte-check only, NOT tests). Pre-push (.husky/pre-push) runs `npm run validate` = scripts/ci-local.mjs, the full local mirror of ci.yml (check + lint + fresh-DB build+tests). Tests gate the push.
- VALIDATE/CI env: hooks.server.ts calls dotenv `config({ override:true })`, so the built server ALWAYS force-loads the repo-root .env, ignoring passed env vars. ci-local.mjs briefly swaps in a synthetic .env (empty IMMICH_BASE_URL, ENABLE_DEV_ROUTES=true, disposable DB), runs the suite like CI, then restores the real .env + data/migallery.db* (self-heals from an interrupted run via *.civalidate-bak). The suite REFUSES non-local Immich (would pollute prod with [TEST] albums) - never bypass; empty Immich is how CI/validate run. Dev-route auth (/dev/login-as) is gated by NODE_ENV==='test' || ENABLE_DEV_ROUTES==='true'.
- WINDOWS ZOMBIE: test-with-server.mjs child.kill() does NOT kill the detached node tree on Windows -> a leaked server holds port 3000 and the next run silently tests a STALE server (symptom: ~180 skipped, spurious 500s, EADDRINUSE). Fixed via taskkill /T on win32 + ci-local frees port 3000 first. If tests skip en masse locally, check for a zombie on 3000.
- The in-process immichCache was REMOVED. The only surviving memo is publicMetaCache inside the immich proxy. Do NOT reintroduce a global metadata cache.
- SCHEMA <-> INSPECT DRIFT: scripts/inspect-db.cjs has a hard-coded `expectedTables` list; dropping/renaming a table in schema.sql WITHOUT updating it makes the script exit 1 -> /api/admin/db-inspect returns { success:false } -> admin-auth integration test fails in CI only. Keep expectedTables in sync with schema.sql.
- A11Y baseline (done): global `:focus-visible` ring in app.css @layer base + `prefers-reduced-motion` block. Svelte-check enforces a11y warnings (at 0), so structural a11y is clean. Responsive: per-component media queries + table overflow-x already exist; do NOT make blind responsive edits - verify a concrete breakpoint issue in-browser first.
- NO custom +error.svelte exists -> SvelteKit's DEFAULT error page renders error.message, so `throw error(status, msg)` messages ARE user-visible. They were English-ified anyway (accepted tradeoff: error pages are rare 403/stale-token/missing-album edge cases). To localize them later, add a +error.svelte mapping status/message to Paraglide.
- SESSION-END SIGNAL: when tool calls start failing with "claude-opus-4-8 is temporarily unavailable", the session is ending. STOP new work, conclude cleanly (note what is committed vs not), hand off. Do not loop-retry.
