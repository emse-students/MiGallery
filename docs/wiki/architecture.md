# Architecture

MiGallery is a single SvelteKit application. The same Node/Bun process serves the
SSR pages, the `/api/*` REST endpoints, the local SQLite access layer, and the
proxy to Immich. There are no separate backend services.

## Request lifecycle

Every request passes through `src/hooks.server.ts`, which composes two handles
with `sequence(...)`:

```
sequence(corsAndCsrfHandler, sessionHandler)
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

2. **`sessionHandler`** resolves the current user (`getSessionUser`) into
   `event.locals.user` (or `null`) and opportunistically deletes legacy-format
   `current_user_id` cookies (old `prenom.nom` values). It never redirects.

A daily backup scheduler (`startBackupScheduler`) is kicked off once at module
load.

There is no global auth gate in the hook: pages and API endpoints enforce access
themselves via the permission helpers (see
[authentication.md](authentication.md)). Unauthenticated visitors can reach
public pages and unlisted albums; everything else is gated at the handler.

## Directory layout

```
src/
  lib/
    components/        # Svelte components (UploadZone, PhotosGrid, Modal, PhotoCard, …)
    db/                # SQLite: schema.sql, database.ts, users.ts, api-keys.ts
    auth/              # cookies.ts (signSigned/verifySigned)
    immich/            # Immich client: albums, assetDetails, download, fetch-with-auth
    server/            # server-only: permissions, auth, logs, backup, download-tokens,
                       #   immich-cache
    types/             # centralized TypeScript types (api.ts, …)
    photos-cv/         # CV directory (trombinoscope) logic
    session.ts, auth.ts, promo-utils.ts, toast.ts, theme.ts, …
  routes/
    api/               # REST endpoints (see api-reference.md)
      immich/[...path]/  # the universal Immich proxy
      albums/ people/ users/ download/ admin/ auth/ external/ favorites/
    albums/ photos-cv/ trombinoscope/ mes-photos/ corbeille/ parametres/ admin/
    +page.svelte, cgu/
  hooks.server.ts      # CORS/CSRF + session resolution
  hooks.client.ts      # navigation guard (in-flight ops), service-worker registration
data/                  # runtime (gitignored): SQLite DB, backups, in-flight upload chunks
static/                # streamsaver-sw.js (minimal SW, no fetch interception), mitm.html
scripts/               # Node scripts: init-db, backup, cleanup-chunks, tests
```

## Deployment topology

Production runs as a single Docker container (`migallery`, SvelteKit + Bun) on
port `3000`, behind a reverse proxy terminating TLS for `gallery.mitv.fr`. The
`data/` directory is a mounted volume holding the SQLite DB and caches. Immich
runs separately (its own stack, reachable at `IMMICH_BASE_URL`); MiGallery is a
layer on top and never stores media itself. See [deployment.md](deployment.md).
