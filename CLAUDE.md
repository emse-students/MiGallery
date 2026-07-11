# **MiGallery \- Rules & Session State**

## **AGENT DIRECTIVES (CRITICAL)**

- NO BLIND GREP: Never run generic grep or find across the project. Check the SESSION STATE below first, or ask the user for exact paths.
- ASK EARLY: State assumptions explicitly. If uncertain about architecture, multiple interpretations, or a bug, ASK during the planning phase. No guessing.
- SURGICAL EDITS: Touch ONLY requested code. Map changes 1:1 to the prompt.
- MODEL DELEGATION: Opus \= reasoning/architecture. Haiku/Sonnet \= crawling, massive edits.
- WIKI & CLEANLINESS: Documentation goes EXCLUSIVELY in docs/wiki/. Delete unused/legacy code immediately.
- PROD ACCESS: You can connect to production via SSH using ssh mitv (or ssh canari for Canari-related systems).
- SAVE TOKENS: After completing a task, output exactly: "Task done. Please git add to clear diff context, then run /compact."
- UPDATE STATE: You MUST update the SESSION STATE at the bottom of this file before finishing a Work Package.

## **ARCHITECTURE & DATA FLOWS**

- Svelte 5 ONLY: Use runes ($state, $derived, $effect). NEVER use old reactive $ syntax.
- SSR Guards: Browser imports (e.g., StreamSaver) MUST be lazy (await import) or guarded by typeof window \!== 'undefined'.
- FILE UPLOADS (No RAM): \<10MB direct, \>10MB chunked. Stream to disk (fs.createWriteStream) then to Immich. NEVER use Buffer.alloc.
- ARCHIVE DOWNLOADS: Flow is POST /api/download (creates UUID token) \-\> GET /api/download/{token} (native browser streaming). Do NOT use StreamSaver or the Service Worker for this.
- Synchronous SQLite: better-sqlite3 queries live in server handlers. Stores ONLY what Immich lacks (users, roles, permissions, logs). Upload concurrency uses per-file locks fs.openSync(lockPath, 'wx'). Do not remove.
- Auth.js \+ Authentik: Roles are admin (full access), mitviste (gallery mgmt, no admin), user (basic).

## **CODING STANDARDS**

- English Only: Code, comments, docs, and dev-facing strings (console.log, errors) MUST be English.
- I18N: User-visible strings use Paraglide (messages/fr.json, en.json). No inline string literals.
- ASCII Punctuation: Normalize to ASCII (', ", \-) everywhere. Preserve French accents (é, à) ONLY in localized strings/French comments.
- UI: Single source of truth is src/app.css (tokens, \--radius-\*). Use .btn-glass with modifiers. Dark-first glassmorphism. Avoid raw hex/px. lucide-svelte only (no aliases).
- Husky: Pre-commit runs ESLint \+ Prettier \+ svelte-check. Fix errors; do not bypass.

## **KEY PATHS & COMMANDS**

- API Proxy Handler: src/routes/api/immich/\[...path\]/+server.ts
- DB Queries: src/lib/db/
- Commands: npm run dev, npm run check (Type-check), npm run test (Integration), npm run db:init

## **SESSION STATE (Active Memory)**

**Current WIP:**

- Admin harmonization: remove ALL emojis, unify every tab on the AdminPage shell, full-width layout (no horizontal scroll), mobile pass, integrate trombinoscope + corbeille INTO the admin layout.
- Next step: await user's chosen starting sub-step (see the ordered plan discussed 2026-07-10).
- Target files: src/routes/admin/+layout.svelte, src/routes/admin/api-docs/+page.svelte, src/routes/admin/shared-admin.css, src/lib/components/AdminPage.svelte, src/routes/trombinoscope/+page.svelte, src/routes/corbeille/+page.svelte

**Roadmap (detailed WP):**

Theme 0 - Foundations (DONE, in prod)

- \[x\] WP-0.1 metrics/memory tab (process mem, uptime, Immich cache stats)
- \[x\] WP-0.2 permissions fusion phase 1: merge album\_\*\_permissions -> album_permissions(album_id,kind,value)
- \[x\] WP-0.3 legacy aliases kept for back-compat
- \[x\] WP-0.4 EmptyState component; fuzzy search on trombino/albums
- \[x\] WP-0.5 Authentik->gallery sync verified (no bug): name/promo/formation come from Authentik at login; gallery owns only role + photos_id/face

Theme 1 - Admin shell unification (DONE)

- \[x\] WP-1.1 AdminPage shell (icon badge + h1 + subtitle + actions slot)
- \[x\] WP-1.2 adopt shell on metrics/logs/api-keys/Documentation/database (+users already matching)
- \[x\] WP-1.3 users select-chevron theme-aware mask fix

Theme 1b - FULL admin harmonization (ACTIVE)

- \[x\] WP-1b.1 central icon barrel src/lib/icons.ts; sidebar emojis -> lucide; husky hook -> npm
- \[x\] WP-1b.2 api-docs: AdminPage shell + strip ALL emojis + quick-links -> header actions
- \[x\] WP-1b.3 no horizontal page scroll (.content min-width:0 -> wide children scroll in their own overflow wrappers) + mobile pass (<=768px sidebar becomes sticky horizontal top-bar, content full-width). AdminPage per-page max-widths left as-is (deliberate per content type); users page has no AdminPage (own matching shell, capped by .admin-shell 1400px).
- \[x\] WP-1b.4 de-globalize shared-admin.css: ALL selectors scoped under .admin-shell (main gets that class). Behavior-neutral inside admin (specificity unchanged vs app.css button:not); stops leak before 1b.5. Icons were never actually broken (valid names + explicit colors + app.css :global(.lucide) min-size guard).
- \[ \] WP-1b.5 integrate /trombinoscope + /corbeille INTO admin layout (keep sidebar visible)
- \[ \] WP-1b.6 wiki: repoint Documentation tab to render docs/wiki/\*; retire api-docs page; write concise EN LLM-friendly API section

Theme 2 - Profile / trombinoscope

- \[ \] WP-2a trombinoscope edit reduced to PROFILE PHOTO only (remove name/promo/formation/role; keep face+photo link; PUT=full replace so resend Authentik fields unchanged; restrict edit to mitviste/admin)
- \[ \] WP-2b selfie incitation: stop hiding "Mes photos"/"Photos CV" tabs without profile; show "complete profile" section (reuse /parametres pattern)

Theme 3 - DB (BLOCKED on SSH prod backup greenlight)

- \[ \] WP-3a permissions fusion phase 2: DROP the 4 legacy album\_\*\_permissions tables

Theme 4 - Backlog (last)

- \[ \] WP-4.x UX: WP-3.3 pill buttons trombino/photos-cv, WP-3.4 error/loading states + upload feedback, WP-3.5 a11y+responsive
- \[ \] FR#3 upload resilience (stable fileId, auto-retry, enqueue on connection loss)
- \[ \] WP-5.x Immich: 5.1b combined personIds+albumIds queries, 5.2 face-first profile photo picker, 5.3 new capabilities, 5.4 clean [TEST] albums + prod guard
- \[ \] WP-4.1 remove StreamSaver/SW/mitm.html; WP-4.3 configurable structured logger; WP-4.4 memory non-regression tests
- \[ \] WP-2.x i18n backend: users.locale column + endpoint for a persisted locale preference (string externalization moved to Theme 5)

Theme 5 - i18n + Normalization (ACTIVE - do not collide with Theme 1b admin work)

Externalize all user-visible FR strings to Paraglide (messages/fr.json + en.json) and sweep dev-facing strings/comments to English. Supersedes the old "externalize all FR strings" backlog note. Tolerant search already shipped (WP-0.4, commit debbb95) - NOT remaining.

Migrated (DONE, on main):

- \[x\] N-1 nav + layout + LocaleSwitcher (35c7c50)
- \[x\] N-2 landing + first-login modal (264cac2)
- \[x\] N-3 albums list + album modal (7f4fe34)
- \[x\] N-4 album detail + PhotosGrid/PhotoCard/PhotoModal + UploadZone (44019bc)
- \[x\] N-5 CameraInput + ChangePhotoModal (6984b90)
- \[x\] N-6 parametres: profile, apparence, face, sharing, danger zone, 3 modals (c425a05)

Remaining (ordered; verify per file - some strings may already be partially done):

- \[ \] N-7 mes-photos + photos-cv + trombinoscope (0 m.\* today = full page strings)
- \[ \] N-8 corbeille + cgu
- \[ \] N-9 admin pages (+layout, dashboard, api-keys, api-docs, database, logs, metrics, users). COORDINATE with Theme 1b (admin harmonization ACTIVE) - run after/with it, not in parallel.
- \[ \] N-10 residual components with real strings: ConfirmHost, EmptyState, AdminPage subtitle (Avatar/BackgroundBlobs/LazyImage/Skeleton/Spinner are stringless - skip)
- \[ \] N-11 dev-string sweep FR -> EN: console.\*/thrown Error/comments across src (parametres has ~30 FR logs near lines 278-535); verify README.md + docs/MIGRATION.md bodies (CLAUDE.md already EN)

Conventions (locked): messages/*.json are TAB-indented (inlang message-format); FR keeps accents + straight apostrophes + typographic space before : and ! + ellipsis; use getLocale() for toLocale*String; bun run check MUST be 0 errors / 0 warnings.

**Memory Gotchas (Do not repeat):**

- lucide-svelte 1.0.1: some old names removed (BarChart2->ChartColumn, UploadCloud->CloudUpload). Verify names against node_modules/lucide-svelte/dist/icons/. Trash2/RotateCcw/RefreshCw DO exist -> if they look "missing" it is a CSS/render issue, not a bad name.
- Central icon barrel EXISTS: src/lib/icons.ts. Import icons from there, not directly from lucide-svelte; add new icons to the barrel (names verified against dist/icons).
- shared-admin.css is now SCOPED under .admin-shell (the admin layout <main>). Bare-element rules (h1/table/input/button...) no longer leak. It is only injected on /admin routes anyway (layout code-split). AdminPage's scoped .admin-page-heading h1 still beats it.
- Icon prop typing for passing lucide components: ComponentType<SvelteComponent> (NOT Component).
- Pre-commit hook runs via npm (npx lint-staged && npm run check).
- The in-process immichCache was REMOVED (2026-07-11): near-useless hit rate, thumbnails were never in it (they are HTTP/CDN-cached via forwarded etag/cache-control). The only surviving memo is a tiny TTL map INSIDE the immich proxy (publicMetaCache), scoped to checkPublicAssetAccess for public shared-album browsing. Do not reintroduce a global metadata cache.
