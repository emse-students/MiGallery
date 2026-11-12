# Architecture

MiGallery is a single SvelteKit application. The same Node process serves the
SSR pages, the `/api/*` REST endpoints, the local SQLite access layer, and the
proxy to Immich. There are no separate backend services.

## Request lifecycle

Every request passes through `src/hooks.server.ts`, which composes its handles
with `sequence(...)` (`robotsHandler` is the outermost: it stamps `X-Robots-Tag` and the
[security headers](#security-headers-and-the-content-security-policy) on every answer):

```
sequence(robotsHandler, paraglideHandler, corsAndCsrfHandler, sessionHandler)
```

1. **`corsAndCsrfHandler`** owns cross-origin and CSRF policy, because SvelteKit's
   native CSRF check is disabled in `svelte.config.js`:
   - Answers `OPTIONS` preflights with the CORS headers.
   - For mutating methods (`POST/PUT/DELETE/PATCH`) it verifies the `Origin`
     against an allow-list (`ALLOWED_ORIGINS`), unless the path is CSRF-exempt.
     Exempt prefixes (`CSRF_EXEMPT_PATHS`): `/api/external/` and `/api/auth/` -
     these authenticate by `x-api-key`, not cookies, so CSRF does not apply.
   - Sets `Cache-Control` per asset type (hashed `/_app/` and images are
     immutable for 2 days; HTML and non-API routes are `max-age=0,
     must-revalidate`) and the CORS headers on API responses.

2. **`sessionHandler`** resolves the session once (`getSession`, shaped by
   `sessionUserOf`) into `event.locals.user` (or `null`) and opportunistically
   deletes legacy-format `current_user_id` cookies (old `prenom.nom` values). It
   never redirects. It is also where a session a Canari handoff opened is
   refused any state-changing request until a MiConnect sign-in (the step-up,
   `src/lib/server/step-up.ts`; [authentication](authentication.md#signed-in-from-canari-the-sign-in-handoff)).
   The `/auth/handoff` landing page gets `Cache-Control: no-store` and
   `Referrer-Policy: no-referrer` from the first handler.

A daily backup scheduler (`startBackupScheduler`) is kicked off once at module
load.

There is no global auth gate in the hook: pages and API endpoints enforce access
themselves via the permission helpers (see
[authentication.md](authentication.md)). Unauthenticated visitors can reach
public pages and unlisted albums; everything else is gated at the handler.

## Security headers and the content security policy

Every answer - a page, an API answer, a redirect - carries `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` and `X-Frame-Options: SAMEORIGIN`. They are
written by the outermost handler of `src/hooks.server.ts` (`robotsHandler`) through
`applySecurityHeaders` (`src/lib/server/security-headers.ts`), which keeps a stricter value an
inner handler already set: the `/auth/handoff` landing page keeps its `Referrer-Policy: no-referrer`
and its `Content-Security-Policy: frame-ancestors 'none'`. `Strict-Transport-Security` is the
front's: it belongs to whatever terminates TLS.

The content security policy lives in `csp.config.ts`, read by `vite.config.ts` (SvelteKit's `csp`
option adds the hash of each inline script it writes; the template's own theme script in
`src/app.html` is hashed from the file by `csp.config.ts`), in two stages:

- **enforced**: `frame-ancestors 'self'`;
- **observed for one release** (`Content-Security-Policy-Report-Only`): `default-src 'self'` and
  the directives beside it. Same-origin everywhere (photos are proxied through `/api/immich/...`),
  plus `data:` and `blob:` for images, `blob:` for media, and Google Fonts for the web fonts
  (`fonts.googleapis.com` styles, `fonts.gstatic.com` files). Nothing is blocked. A browser posts
  each violation to `POST /api/csp-report` (public, stores nothing, bodies over 8 KB dropped,
  always 204, open to a handoff session in the step-up exemptions), and `noteCspReport` logs it
  through the `csp` logger as `would block: directive=... blocked=... page=... source=...` - once
  per distinct violation, then at its 10th, 100th... occurrence with the count; URLs lose their
  query and fragment. When a release's log is quiet, the observed directives move to
  `directives`.

Pinned by `tests/security-headers.test.ts` (unit tests, plus the headers read from the running
test server).

## Logging

Server code logs through a small structured logger (`src/lib/server/logger.ts`),
never `console.*` directly. Create a scoped instance per module and call it by
level:

```
import { createLogger } from '$lib/server/logger';
const log = createLogger('immich-proxy');
log.warn('access denied for asset', { assetId });
```

Every line is one record: `<ISO timestamp> <LEVEL> [scope] <message>` plus an
optional structured field. Levels are gated by a threshold resolved once at
startup: `LOG_LEVEL` (`debug|info|warn|error`) wins when set, otherwise test
logs errors only, production logs info and above, dev logs everything.

Persisted audit events (who created/deleted what) are a separate concern: they
go to the SQLite `logs` table via `logEvent` (see [data-model.md](data-model.md)),
not the logger. Client code has no server logger - browser-only files keep
`console.error`/`console.warn` for genuine failures. Debug/trace and
success-path logging is not kept on either side.

## Directory layout

```
src/
  lib/
    components/        # Svelte components (UploadZone, PhotosGrid, Modal, PhotoCard, …)
    db/                # SQLite: schema.sql, database.ts, users.ts, api-keys.ts
    auth/              # cookies.ts (signSigned/verifySigned)
    immich/            # Immich client: albums, assetDetails, download, fetch-with-auth
    server/            # server-only: permissions, auth, logs, backup, download-tokens
    types/             # centralized TypeScript types (api.ts, …)
    photos-cv/         # CV directory (trombinoscope) logic
    session.ts, auth.ts, promo-utils.ts, toast.ts, theme.ts, …
  routes/
    api/               # REST endpoints (see api-reference.md)
      immich/[...path]/  # the universal Immich proxy
      albums/ people/ users/ download/ admin/ auth/ external/ favorites/
    albums/ photos-cv/ mes-photos/ corbeille/ parametres/ admin/
    +page.svelte, cgu/
  hooks.server.ts      # CORS/CSRF + session resolution
  hooks.client.ts      # navigation guard (in-flight ops)
data/                  # runtime (gitignored): SQLite DB, backups, in-flight upload chunks
static/                # static assets served as-is
scripts/               # Node scripts: init-db, backup, cleanup-chunks, tests
```

## Deployment topology

Production runs as a single Docker container (`migallery`, SvelteKit + Node) on
port `3000`, behind a reverse proxy terminating TLS for `gallery.mitv.fr`. The
`data/` directory is a mounted volume holding the SQLite DB and caches. Immich
runs separately (its own stack, reachable at `IMMICH_BASE_URL`); MiGallery is a
layer on top and never stores media itself. See [deployment.md](deployment.md).
