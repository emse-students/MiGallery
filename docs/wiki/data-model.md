# Data model

MiGallery's local database is a single SQLite file (`DATABASE_PATH`, default
`./data/migallery.db`), accessed synchronously through `better-sqlite3`
(`src/lib/db/database.ts`). The schema is `src/lib/db/schema.sql`.

The local DB stores **only what Immich does not**: identity/roles, album
visibility and permissions, favorites, photo-access consent, logs and API keys.
Media, thumbnails, faces and the underlying albums/assets live in Immich. IDs in
the local DB match the corresponding Immich UUIDs.

## Tables

### `users`

| Column                            | Notes                                                  |
| --------------------------------- | ------------------------------------------------------ |
| `id_user` TEXT PK                 | the OIDC `sub`                                         |
| `name`, `first_name`, `last_name` | display identity                                       |
| `photos_id` TEXT                  | linked Immich person id (for face-based "my photos")   |
| `role` TEXT                       | `admin` \| `mitviste` \| `user`, default `user`        |
| `promo` INTEGER                   | graduation year                                        |
| `formation` TEXT                  | e.g. `InfoCom`, `ICM`, …                               |
| `first_login` INTEGER             | 1 until the promo/formation modal is completed, then 0 |

### `albums` and permissions

- `albums(id, name, date, location, visibility, visible)` - `visibility` is
  `private | authenticated | unlisted`; `visible` toggles listing.
- `album_user_permissions(album_id, id_user)` - explicit users.
- `album_formation_permissions(album_id, formation)` - by formation.
- `album_promo_permissions(album_id, promo_year)` - by promo.
- `album_tag_permissions(album_id, tag)` - free-form tags.

All permission tables cascade on album delete. Access resolution combines these
with visibility in `checkAlbumAccess` (see
[albums-and-permissions.md](albums-and-permissions.md)).

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

### `api_keys`

`api_keys(id, key_hash, label, scopes, revoked, created_at)` - hashed external
API keys with scopes; see [authentication.md](authentication.md).

## Backups

The DB is backed up daily (scheduler started in `hooks.server.ts`) and pushed
offsite (see [deployment.md](deployment.md)). Media is not backed up here - it
lives in Immich on the RAID and is handled by Immich's own backup.
