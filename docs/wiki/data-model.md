# Data model

MiGallery's local database is a single SQLite file (`DATABASE_PATH`, default
`./data/migallery.db`), accessed synchronously through `bun:sqlite`
(`src/lib/db/database.ts`). The schema is `src/lib/db/schema.sql`.

The local DB stores **only what Immich does not**: identity/roles, album
visibility and permissions, favorites, photo-access consent, logs and API keys.
Media, thumbnails, faces and the underlying albums/assets live in Immich. IDs in
the local DB match the corresponding Immich UUIDs.

## Tables

### `users`

| Column                            | Notes                                                      |
| --------------------------------- | ---------------------------------------------------------- |
| `id_user` TEXT PK                 | the OIDC `sub`                                             |
| `name`, `first_name`, `last_name` | display identity                                           |
| `photos_id` TEXT                  | linked Immich person id (for face-based "my photos")       |
| `role` TEXT                       | `admin` \| `mitviste` \| `user`, default `user`            |
| `promo` INTEGER                   | graduation year, **mirrored from the SSO, nulls included** |
| `formation` TEXT                  | e.g. `InfoCom`, `ICM`, …                                   |

### `albums` and permissions

- `albums(id, name, date, location, visibility, visible)` - `visibility` is
  `private | authenticated | unlisted`; `visible` toggles listing.
- `album_permissions(album_id, kind, value)` - unified permissions table,
  `PRIMARY KEY (album_id, kind, value)`. `kind` is one of `user | tag | formation
| promo` and `value` holds the corresponding id/tag/formation name/promo year
  (promo stored as text). Replaces four legacy tables
  (`album_user_permissions`, `album_formation_permissions`,
  `album_promo_permissions`, `album_tag_permissions`), which were backfilled into
  this table and dropped by the `database.ts` migration at `PRAGMA user_version 2`.

Cascades on album delete. Access resolution combines this with visibility in
`checkAlbumAccess` (see [albums-and-permissions.md](albums-and-permissions.md)).

### `user_favorites`

`user_favorites(user_id, asset_id, created_at)` - per-user favorite photos, kept
in MiGallery (not pushed to Immich). Managed via `/api/favorites`.

### `photo_access_permissions`

`photo_access_permissions(owner_id, authorized_id, created_at)` - RGPD consent for
the CV directory: `owner_id` lets `authorized_id` view their face-linked photos
(see [photos-cv.md](photos-cv.md)).

### `logs`

`logs(id, timestamp, actor, event_type, target_type, target_id, details, ip)` -
audit trail (uploads, deletes, logins, API-key usage), written by
`logEvent` (`src/lib/server/logs.ts`) and browsable under `/admin/logs`.

**Retention: 90 days.** `purgeOldLogs` deletes older rows; `startLogRetention`
(`hooks.server.ts`) runs it a minute after start, then daily, in-process like the
backup scheduler. Each row's own `timestamp` decides, so a missed day only makes
the next run delete more. Pinned by `tests/logs-retention.test.ts`.

**`ip` comes from ONE trusted source**, SvelteKit's `getClientAddress()`. In
production `docker-compose.prod.yml` sets adapter-node's
`ADDRESS_HEADER=cf-connecting-ip`: the only public way in is the Cloudflare
tunnel (`cloudflared` on the host, see [bandwidth.md](bandwidth.md)), and
Cloudflare sets `CF-Connecting-IP` to the address it was reached from,
overwriting any value the client sent. `X-Forwarded-For` is never read: its
first value is whatever the client chose to send, and it used to be stored
whole. When no address is available (`getClientAddress()` throws, e.g. a request
that did not come through the tunnel) the row records NULL, never a guess, and the fault is logged once per process
at error level. What this rests on: the container's published port must only be
reached through the tunnel - a client reaching port 3000 directly could set that
header itself. `docker-compose.prod.yml` publishes it on every interface, so that
is a property of the host's firewall today, not of this code. Binding it to
`127.0.0.1` would make it a property of the file, and is safe only once the
tunnel's ingress target is confirmed to be the loopback address (not verified
from this repository).

### `face_consents`

`face_consents(id, user_id, created_at, version, source, withdrawn_at)` - the record that a
member agreed to link their face: when, under which terms version (`src/lib/legal.ts`
`TERMS_VERSION`) and how (`selfie`, `admin`, or `legacy` for a link that predates the table,
backfilled at start; its `created_at` is the backfill date, not the consent date - the owner holds
that proof). A withdrawal sets `withdrawn_at`; an account deletion cascades. See
[photos-cv.md](photos-cv.md#consent-record).

### `face_erasures`

`face_erasures(id, person_id, reason, requested_at, attempts, last_attempt_at,
last_error, done_at, outcome)` - the journal of the Immich half (name removal) of
a face withdrawal or account deletion (`src/lib/server/face-erasure.ts`, see
[photos-cv.md](photos-cv.md#erasure)). It names the Immich person, never the
member, and clears that id once done.

### `sessions`

`sessions(token, id_user, impersonated_id_user, created_at, expires_at)` - the
server-side half of the login cookie, which carries the opaque `token` and
nothing else. Deleting a row logs that session out everywhere; both foreign keys
cascade, so deleting a user removes their sessions and ends any impersonation of
them. See [authentication.md](authentication.md).

### `api_keys`

`api_keys(id, key_hash, label, scopes, revoked, created_at)` - hashed external
API keys with scopes; see [authentication.md](authentication.md).

## Backups

The DB is backed up daily (scheduler started in `hooks.server.ts`) and pushed
offsite (see [deployment.md](deployment.md)). Media is not backed up here - it
lives in Immich on the RAID and is handled by Immich's own backup.
