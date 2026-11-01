# Data model

MiGallery's local database is a single SQLite file (`DATABASE_PATH`, default
`./data/migallery.db`), accessed synchronously through `bun:sqlite`
(`src/lib/db/database.ts`). The schema is `src/lib/db/schema.sql`.

The local DB stores **only what Immich does not**: identity/roles, album
visibility and permissions, favorites, photo-access consent, the face references
and matches of consenting members, logs and API keys. Media, thumbnails and the
underlying albums/assets live in Immich. IDs in the local DB match the
corresponding Immich UUIDs.

A second SQLite file, `data/faces.db` (`FACE_DATABASE_PATH`,
`src/lib/db/face-database.ts`), holds the face store: one sealed embedding per
detected face of the whole library. It is kept apart so that no backup copies it
([the face tables](#the-face-tables-two-files)). Until lot A8, Immich still holds
its own faces, persons and embeddings as well.

## Tables

### `users`

| Column                            | Notes                                                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id_user` TEXT PK                 | the OIDC `sub`                                                                                                                                                                                                            |
| `name`, `first_name`, `last_name` | display identity                                                                                                                                                                                                          |
| `photos_id` TEXT                  | legacy Immich person link: READ BY NOTHING since lot A6, kept for the A7 seed; admin-written only                                                                                                                         |
| `photos_asset_id` TEXT            | the profile photo, one of the member's own face-matched photos (A6)                                                                                                                                                       |
| `photos_asset_source` TEXT        | `chosen` (the member, or an admin for them) or `default` (picked for them: [the default profile photo](face-matching-option-c.md#the-default-profile-photo-hotfix-2026-11-01)); a default may be replaced, a choice never |
| `role` TEXT                       | `admin` \| `mitviste` \| `user`, default `user`                                                                                                                                                                           |
| `promo` INTEGER                   | graduation year, **mirrored from the SSO, nulls included**                                                                                                                                                                |
| `formation` TEXT                  | e.g. `InfoCom`, `ICM`, …                                                                                                                                                                                                  |

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
production `docker-compose.prod.yml` sets adapter-bun's
`ADDRESS_HEADER=cf-connecting-ip`: the reverse proxy in front of the app sets that
header to the address it was reached from, overwriting any value the client sent.
`X-Forwarded-For` is never read: its first value is whatever the client chose to
send, and it used to be stored whole. When no address is available
(`getClientAddress()` throws) the row records NULL, never a guess, and the fault
is logged once per process at error level.

**The invariant this rests on: the app must only be reachable through the reverse
proxy.** A header the proxy sets is only evidence if nothing else can reach the
listener. `docker-compose.prod.yml` therefore binds the container's port to
`127.0.0.1` - a property of the file and not of a firewall - and no other service
of this repository calls the container by a network address.

**What reaches what, exactly (since the face store, 2026-10-31).** The container is on two
Docker networks. Its own compose network holds MiGallery alone. `migallery-face-ml` is internal
(no route out) and holds MiGallery and Immich's model service ONLY, which the deploy checks
([MIGRATION](../MIGRATION.md)). So:

- MiGallery reaches the model service (`immich-machine-learning:3003`) and nothing else of Immich
  by network: not its database, not its server (that one only through `IMMICH_BASE_URL`, as before).
- **The model service can reach MiGallery's listener directly**, without the proxy, and so could
  send any `cf-connecting-ip` it likes. That is the one exception to the invariant above: it
  trusts Immich's model container as much as Immich itself is trusted. Nothing else can.

`avatar_revocations(id_user, salt, revoked_at)` holds the salt of a user whose signed avatar links were
revoked. It is keyed by id_user with no foreign key ON PURPOSE: it survives the deletion of the account,
so a user recreated at their next sign-in does not re-validate old URLs. Account deletion rotates the salt in its own transaction; the pseudonymous id then stays here as a tombstone (an id and a random salt, no personal data) while the audit-log scrub removes it everywhere else
([api-reference.md](api-reference.md#the-signed-avatar-url)).

### `face_consents`

`face_consents(id, user_id, created_at, version, source, withdrawn_at)` - the record that a
member agreed to link their face: when, under which terms version (`src/lib/legal.ts`
`TERMS_VERSION`) and how (`selfie`, `admin`, or `legacy` for a link that predates the table,
backfilled at start; its `created_at` is the backfill date, not the consent date - the owner holds
that proof). A withdrawal sets `withdrawn_at`; an account deletion cascades. See
[photos-cv.md](photos-cv.md#consent-record).

### The face tables, two files

The face store of option C ([face-matching-option-c](face-matching-option-c.md), the reference
for the mechanism). Every embedding is a float16 512-d vector sealed with AES-256-GCM under
`FACE_STORE_KEY`, bound to its member (a reference) or to its asset and face index (a detected
face), and tagged with its model.

| Table              | File           | Holds                                                                                                                                                                          | Whose                                      | Written by                                                                       | Backed up |
| ------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------- | --------- |
| `face_embeddings`  | `faces.db`     | one sealed embedding per detected face, its box and image size, the detector score (NULL when seeded)                                                                          | **everyone photographed, non-members too** | ingestion (A3), the seed (A7); its rows go with their asset (`removeAssetFaces`) | **no**    |
| `face_assets`      | `faces.db`     | per asset: `pending` / `done` / `failed`, attempts, last error, absent listings                                                                                                | assets                                     | ingestion (A3), the seed (A7)                                                    | **no**    |
| `face_store_state` | `faces.db`     | `seeded_at`, `last_counted_listing_at`                                                                                                                                         | -                                          | the seed (A7), ingestion (A3)                                                    | **no**    |
| `face_references`  | `migallery.db` | 3 to 5 sealed reference embeddings per member and model (`selfie`, `photo`, `admin`), a trigger holding the cap; never returned by any route                                   | consenting members                         | enrolment and a confirmed answer (A5), the seed's carry-over of the links (A7)   | yes       |
| `face_matches`     | `migallery.db` | which member a face was given to (`auto` at a distance <= 0.5, `suggested` up to 0.62), the distance and runner-up, the member's answer (`pending` / `confirmed` / `rejected`) | consenting members                         | the match engine only (A4), `claimFace` for the seed's profile photos (A7)       | yes       |
| `face_consents`    | `migallery.db` | see above                                                                                                                                                                      | members                                    | enrolment (A5), an admin link, the legacy backfill                               | yes       |

**Erasure.** A member's withdrawal, an unlink and an account deletion run `eraseLocalFaceData`
(`src/lib/server/face-erasure.ts`): their references and matches go and their consent closes in
ONE transaction, their crops (`data/cache/faces/members/<hash>/`, not in any backup) right after
the commit ([photos-cv](photos-cv.md#erasure)). `face_references` and `face_matches` also cascade
on the account row. The rows of `faces.db` are never part of a member's erasure: they carry no
member, and go with their asset. **The whole store is erased by deleting `faces.db` or rotating
`FACE_STORE_KEY`.**

**The A1 table in `migallery.db`.** A1 created `face_embeddings` there; no code path ever wrote it,
and A3 drops it at start when it is empty (a non-empty one is left and reported).

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

The DB is backed up daily (scheduler started in `hooks.server.ts`, `src/lib/server/backup.ts`,
the last 10 copies kept under `data/backups/`) and pushed offsite (`scripts/backup-offsite.sh`,
about 14 days; see [deployment.md](deployment.md)). Both copy `migallery.db` only, so the face
references, matches and consents are in the backups and **`data/faces.db` is in none**: a lost
store is seeded or recomputed from the photographs ([face-matching-option-c](face-matching-option-c.md#1-what-is-decided),
about 22 hours of the model service once Immich no longer holds the vectors). The face crops under
`data/cache/` are not backed up either. Media is not backed up here - it lives in Immich on the
RAID and is handled by Immich's own backup; the offsite Immich database dumps (about 7 days) hold
Immich's own faces, persons and embeddings until lot A8 deletes them (an encrypted copy of what A8
deletes is kept 30 days, then deleted).
