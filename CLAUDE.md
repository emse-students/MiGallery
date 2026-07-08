# MiGallery - Guide for Claude Code

## What this project is

Photo gallery web app for MiTV (EMSE). It wraps **Immich** (self-hosted photo backend) and adds: role-based access control, album management, SSO via Authentik (MiConnect), and a Svelte UI.

The SvelteKit server acts mostly as an **authenticated proxy** to the Immich API.

---

## Model / agent delegation (cost)

To avoid burning expensive tokens, **reserve Opus for reasoning tasks** (architecture, design decisions, filtering/judging findings, tricky fixes). **Delegate everything else to cheaper models** via subagents: **Haiku** for crawling/auditing/searching the codebase, mechanical edits, running commands, commits/pushes; **Sonnet** only if a task is too hard for Haiku but does not need Opus-level reasoning. Concretely: spawn Haiku subagents to read/crawl large files and report findings, then have Opus decide and either fix the delicate parts itself or hand mechanical fixes back to Haiku. Never use Opus to read thousands of lines just to locate issues.

---

## Tech stack

| Layer    | Technology                                              |
| -------- | ------------------------------------------------------- |
| Frontend | Svelte 5, SvelteKit 2, TypeScript, Tailwind CSS 4       |
| Backend  | SvelteKit SSR (Node.js), adapter-node                   |
| Database | SQLite via `better-sqlite3` (synchronous)               |
| Auth     | Auth.js + Authentik OIDC (SSO MiConnect)                |
| Photo    | Immich (REST API, proxied via `/api/immich/*`)          |
| Build    | Vite (build via npm)                                    |
| Quality  | ESLint, Prettier, Husky (pre-commit: lint + type-check) |

---

## Essential commands

```bash
npm run dev          # Dev server with HMR
npm run build        # Production build -> build/
npm run check        # Type-check (svelte-check + tsc)
npm run lint         # ESLint
npm run format       # Prettier
npm run db:init      # Initialize the SQLite schema
npm run db:backup    # Manual DB backup
npm run test         # Full integration suite
npm run test:unit    # Vitest unit tests only
```

> The Husky pre-commit hook runs ESLint + Prettier + svelte-check. A commit fails if any of them fails. Fix the problem rather than bypassing the hook.

---

## Directory layout

```
src/
  lib/
    components/       # Reusable Svelte components (UploadZone, PhotosGrid, Modal...)
    db/               # SQLite access: schema, queries (users, albums, permissions)
    auth/             # Auth.js configuration
    immich/           # Immich client: albums, assets, downloads
    server/           # Server-only utilities (permissions, logs, cache, download-tokens)
    types/            # Centralized TypeScript types (api.ts, streamsaver.d.ts)
    photos-cv/        # Photos-CV specific logic (trombinoscope)
  routes/
    api/
      immich/[...path]/ # Main proxy to Immich - universal handler
      albums/           # Album CRUD (reads from the local DB + Immich)
      download/         # Archive download: token prep + streaming
      people/           # People management (photos CV)
      users/            # User management
      auth/             # OIDC login/logout/callback
      admin/            # Admin routes (DB export, logs, API keys)
    albums/             # Album list and detail pages
    photos-cv/          # Photos-CV album page
    trombinoscope/      # Directory/trombinoscope
    admin/              # Admin interface
  hooks.server.ts       # Auth middleware, session validation, CSRF
  hooks.client.ts       # Navigation guard (in-flight operations), SW registration

data/                   # Runtime (gitignored): DB, backups, in-flight upload chunks
static/
  streamsaver-sw.js     # Minimal service worker (install/activate, no fetch interception)
  mitm.html             # StreamSaver MITM (present but not actively used)
scripts/                # Node.js scripts: init-db, backup, cleanup-chunks, tests...
```

---

## Key data flows

### Authentication

1. Login -> redirect to Authentik (OIDC)
2. Callback -> `Auth.js` creates a JWT session (httpOnly cookie `__Secure-authjs.session-token`)
3. `hooks.server.ts` validates the session on every request
4. `requireScope(event, 'read'|'write')` protects the API endpoints

Roles: `admin` - `mitviste` - `user` (default)

- `admin`: the only role with access to `/admin` and the admin API (`ensureAdmin`).
- `mitviste`: elevated gallery role (photo management: photos-cv, trash...) but **no admin access**.
- `user`: basic access.

### Immich proxy

All `/api/immich/*` routes are handled by `src/routes/api/immich/[...path]/+server.ts`. This handler:

- Checks the scope (read/write)
- Handles chunked uploads (disk streaming, zero RAM)
- Handles public (unlisted) albums
- Formats and forwards binary responses (images, videos, archives)

### Archive download (albums)

**Do not use StreamSaver or the service worker for downloads.**
Flow: `POST /api/download` (creates a UUID token) -> `GET /api/download/{token}` (server streams from Immich, the browser downloads natively). See `src/lib/immich/download.ts` and `src/lib/server/download-tokens.ts`.

### File upload

- < 10 MB: `POST /api/immich/assets` with a plain `FormData`
- 10 MB and above: 5 MB chunks with resume, SHA256 hash per chunk, disk storage in `data/chunk-uploads/`
- The server streams chunks to disk with no RAM buffer (`fs.createWriteStream`)
- On completion: stream to Immich via `fs.createReadStream` inside a FormData

---

## Local database (SQLite)

The local DB stores **only** what Immich does not manage:

- `users` - roles (admin/mitviste/user), emails
- `albums` - visibility (private/authenticated/unlisted), date, location
- `album_formation_permissions` - access by formation
- `album_promo_permissions` - access by promo year
- `album_user_permissions` - access by individual user
- `album_tag_permissions` - free-form tags
- `logs` - event log (upload, delete, etc.)

IDs in the local DB match the Immich IDs (UUID).

---

## Required environment variables

```bash
# Immich
IMMICH_BASE_URL=http://10.0.0.4:2283
IMMICH_API_KEY=<immich_api_key>

# Authentik OIDC (MiConnect)
MICONNECT_ISSUER=https://auth.canari-emse.fr/application/o/migallery
MICONNECT_CLIENT_ID=<client_id>
MICONNECT_CLIENT_SECRET=<client_secret>

# Auth.js
AUTH_SECRET=<64_chars_hex>      # node ./scripts/generate-auth-secret.cjs
AUTH_TRUSTED_HOST=true

# Server
PORT=3000
ORIGIN=https://gallery.mitv.fr
DATABASE_PATH=./data/migallery.db
COOKIE_SECRET=<64_chars_hex>    # node ./scripts/generate_cookie_secret.cjs

# Upload (max body size)
BODY_SIZE_LIMIT=20G

# Dev only - never in production
ENABLE_DEV_ROUTES=false
```

---

## Things to watch out for

- **Svelte 5 runes**: this project uses `$state`, `$derived`, `$effect`. Do not use the old `reactive` / `$:` syntax.
- **SSR**: any browser-only library import (e.g. StreamSaver) must be lazy (`await import(...)`) or guarded by `typeof window !== 'undefined'`.
- **No memory buffering** for large files: uploads stream to disk, downloads use a native token. Do not introduce `Buffer.alloc` or chunk accumulation for files larger than a few MB.
- **Synchronous DB**: `better-sqlite3` is synchronous by design. Queries live in server handlers; this is intentional.
- **Upload concurrency**: per-file lock via `fs.openSync(lockPath, 'wx')`. Do not remove this logic.
- **Iconography**: `lucide-svelte` only. Do not use aliases (`ScanFace`, `CheckSquare`) - verify the name exists in the installed version.

---

## UI / design system

- **Single source for styling primitives.** Shared tokens live in `src/app.css` (`:root` / `[data-theme='light']`): colors, `--radius-*` scale, `--glass-*`, shadows, `--ease`. Reuse them; do not hardcode hex or px radii in page CSS.
- **Buttons**: use the canonical `.btn-glass` from `app.css` with its modifiers (`primary`, `success`, `danger`, `info`, `edit`, `active`, `icon`). Do not redefine `.btn-glass` per page.
- **Visual identity to preserve**: dark-first theme, glassmorphism, decorative background blobs (`BackgroundBlobs`). Keep it - refine and unify rather than replace.
- **Theme**: every surface must work in both dark and light via the theme tokens; avoid literal `white`/`black` and raw rgba where a token exists.

---

## Language and character conventions

Adopted from `C:\Users\jolan\Documents\Programmation\canari\CLAUDE.md` (sections "Language" and "Text characters"), adapted to MiGallery.

- **Code language**: comments (`//`, `/* */`, `/** */`) and developer-facing strings (`console.*`, internally thrown errors) are in **English**. Every user-visible string goes through Paraglide (`messages/fr.json` + `messages/en.json`), never an inline literal.
- **Normalize PUNCTUATION to ASCII** (code, strings, comments, docs, translation JSON): straight apostrophe `'` (never `’`), straight quote `"` (never `“ ” « »`), hyphen `-` (never `—` / `–`). Exception: the ellipsis `…` is kept. In code, escape `\'` / `\"` rather than reintroducing a typographic character.
- **Accented French letters are ALWAYS preserved** (`é è ê à ù ç î ô` ...). This rule targets typographic punctuation ONLY: "ASCII" does NOT mean "French without accents". Writing "evenements" or "privee" instead of "évènements" / "privée" is a bug. Applies to FR i18n values and to French inside comments.
