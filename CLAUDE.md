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

- WP-2a DONE this session (b7d710d): merged /admin/trombinoscope INTO /admin/users and deleted the trombi page (user decision "fusionner dans users"). /admin/users now = role mgmt + delete + PDF export + photo-only profile-photo (face) linking. Admin-only. Pruned 35 orphaned trombi\_\* i18n keys. See Roadmap WP-2a for the PUT full-column gotcha.
- Next step: Theme 2 WP-2b (selfie incitation) - stop hiding Mes photos/Photos CV nav tabs when no profile photo; add a "complete your profile" surface. Then Theme 3 is BLOCKED on SSH prod backup greenlight.
- Deferred i18n externalization WP (from Theme 5): user-visible FR string literals still inline (error()/json({error}) responses, src/lib/admin/endpoints.ts `description:`, toast.\*, this.error, backup.ts `message:`, some title= attrs). Real Paraglide-externalization WP, not cosmetic.
- i18n idiom recap: import { m } from '$lib/paraglide/messages'; call m.key() in template; params m.key({ x }); plurals use "(s)" style not ternary; npm run check auto-runs paraglide:compile. Prune orphaned keys with a node script over messages/{fr,en}.json (compare vs `grep -roE "m\.\w+" src`), paraglide output is gitignored+recompiled.

**Roadmap (Active WP):**

- \[x\] Themes 0, 1, 1b.1-1b.5, and 5 (N1-N6): COMPLETED.

Theme 1b \- FULL admin harmonization

- \[x\] WP-1b.6 wiki: Documentation tab now renders docs/wiki/\* (index-first, then api-reference); api-docs route retired; nav link + api-keys button repointed to /admin.

Theme 2 \- Profile / trombinoscope

- \[x\] WP-2a (b7d710d): DECISION change - trombinoscope page DELETED and merged into /admin/users (user chose "fusionner dans users, supprimer trombi"). PDF export + profile-photo (face) linking now live in /admin/users; photo edit is photo-only and round-trips SSO fields (name/promo/formation/role) so the full-column PUT never wipes them. Role mgmt + delete stay (admin-only). Trombinoscope stays admin-only (the "mitviste edit" note was an error). Pruned 35 orphaned trombi\_\*/nav_trombinoscope i18n keys. Gotcha: /api/users/[id] PUT is a FULL-COLUMN update (role||'user', name??id) - always send the complete row or you demote/rename users.
- \[ \] WP-2b selfie incitation: stop hiding "Mes photos"/"Photos CV" tabs without profile; show "complete profile" section. Files: src/routes/+layout.svelte (L112-123 hasPhoto gating) + src/lib/components/MobileNav.svelte (L43-65). first_login flow uses FirstLoginModal; profile photo upload+face flow now lives in /admin/users (admin) - a user-facing selfie surface may need porting.

Theme 3 \- DB (BLOCKED on SSH prod backup greenlight)

- \[ \] WP-3a permissions fusion phase 2: DROP the 4 legacy album\_\*\_permissions tables

Theme 4 \- Backlog

- \[ \] WP-4.x UX: pill buttons, error/loading states, upload feedback, a11y+responsive
- \[ \] FR\#3 upload resilience
- \[ \] WP-5.x Immich: combined queries, face-first profile picker, clean test albums
- \[ \] WP-4.1 remove StreamSaver/SW/mitm.html; WP-4.3 structured logger; WP-4.4 memory tests
- \[ \] WP-2.x i18n backend: users.locale column

Theme 5 \- i18n \+ Normalization (COMPLETE)

- \[x\] N-7..N-11b ALL DONE. User-facing strings -> Paraglide; dev console/throw + all code comments + test titles -> EN. Residual inline FR = user-visible response/UI string literals only, deferred as a proper Paraglide-externalization WP (see Current WIP note), NOT a comment task.

**Memory Gotchas (Do not repeat):**

- lucide-svelte 1.0.1: some old names removed. Verify against node_modules/lucide-svelte/dist/icons/. Trash2/RotateCcw/RefreshCw DO exist.
- Central icon barrel EXISTS: src/lib/icons.ts. Import from there. Icon prop typing: ComponentType\<SvelteComponent\>.
- shared-admin.css is SCOPED under .admin-shell. Bare-element rules no longer leak.
- Pre-commit hook runs via npm (npx lint-staged && npm run check).
- The in-process immichCache was REMOVED (2026-07-11). The only surviving memo is publicMetaCache inside the immich proxy. Do not reintroduce a global metadata cache.
