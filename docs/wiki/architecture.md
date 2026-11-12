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

1. **`corsAndCsrfHandler`** owns cross-origin and CSRF policy for every content type. SvelteKit's
   native check stays on for FORM content types with a list of trusted origins (`csrf` in
   `vite.config.ts`); it answers before any handler runs, so its 403 carries no header a hook
   writes:
   - Answers `OPTIONS` preflights with the CORS headers.
   - For mutating methods (`POST/PUT/DELETE/PATCH`) it verifies the `Origin`
     against an allow-list (`ALLOWED_ORIGINS`), unless the path is CSRF-exempt.
     Exempt prefixes (`CSRF_EXEMPT_PATHS`): `/api/external/` and `/api/auth/` -
     these authenticate by `x-api-key`, not cookies, so CSRF does not apply.
   - Sets the CORS headers on API responses.

2. **`sessionHandler`** resolves the session once (`getSession`, shaped by
   `sessionUserOf`) into `event.locals.user` (or `null`) and opportunistically
   deletes legacy-format `current_user_id` cookies (old `prenom.nom` values). It
   never redirects. It is also where a session a Canari handoff opened is
   refused any state-changing request until a MiConnect sign-in (the step-up,
   `src/lib/server/step-up.ts`; [authentication](authentication.md#signed-in-from-canari-the-sign-in-handoff)).
   The `/auth/handoff` landing page gets `Cache-Control: no-store` and
   `Referrer-Policy: no-referrer` from the first handler.

**`Cache-Control` is written by the OUTERMOST handler (`robotsHandler`)**, through
`cacheControlFor` (`src/lib/server/cache-policy.ts`, pinned by `tests/cache-policy.test.ts`), so
an answer an inner handler returned without resolving (the 403 of a refused cross-site request, a
preflight) and a thrown redirect carry it too. The default is `private, no-store`: a page, the
`__data.json` that carries its data, a redirect and an error are answers to the member who asked.
Only an explicit list is shared, and only when it was SERVED (2xx or 304): hashed `/_app/` files
and static images and fonts are public and immutable for 2 days, `robots.txt` and the manifest are
`public, max-age=0, must-revalidate`. An `/api/` route keeps the policy it set itself, whatever
its path ends with.

**In production the hook does not see the files of the build.** `adapter-bun` serves `/_app/`
and everything under `static/` from its own routes, before SvelteKit's `handle` runs, and writes
their headers itself; the list above reaches a file only where the hook does serve it (the dev
server, a prerendered or generated path). What the hook decides in production is everything
else: pages, data, redirects, errors, and a path that LOOKS like a file and is not one.

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
  query and fragment, and every control character and white space, so a reported value stays one
  field of one line. Every line the route writes passes `logCspLine`, which writes at most
  `CSP_REPORT_LINES_PER_HOUR` (200) in a clock hour, then one line saying the bound was passed,
  then nothing until the next hour. When a release's log is quiet, the observed directives move
  to `directives`.

Two things to know when reading that log and the headers:

- an SSR page is served `max-age=0, must-revalidate`, and after a revalidation it can reach the
  browser as an old body with a new header, so the nonces differ and report-only logs false
  `would block` lines for the page's own scripts. Reconcile that before `script-src` moves to
  enforced;
- the front's nginx `add_header` writes `X-Frame-Options` and `X-Content-Type-Options` too, so an
  answer can carry each twice with the same value. That is harmless.

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
