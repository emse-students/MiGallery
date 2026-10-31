# API reference

MiGallery's endpoints live under `src/routes/api/`. Access is enforced per handler
via `requireScope` / `requireSession` / `requireAdminSession` (see
[authentication.md](authentication.md)); there is no global gate. "Auth" below is
the effective minimum.

## Immich proxy

| Path                    | Auth                                                   | Purpose                                                                                                                  |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `/api/immich/[...path]` | read (GET) / write (mutations); unlisted assets public | Proxy to Immich for an allowlist of routes; chunked uploads; binary passthrough (see [immich-proxy.md](immich-proxy.md)) |

## Albums

| Path                                                                         | Auth                           | Purpose                           |
| ---------------------------------------------------------------------------- | ------------------------------ | --------------------------------- |
| `GET/POST /api/albums`                                                       | read / write                   | List / create albums              |
| `GET/PATCH/DELETE /api/albums/[id]`                                          | per `checkAlbumAccess` / write | Album detail and edit             |
| `/api/albums/[id]/assets`, `/assets-simple`, `/assets-stream`                | album access                   | Album assets                      |
| `/api/albums/[id]/asset-original/[assetId]` and `/asset-thumbnail/[assetId]` | album access                   | Single asset / thumbnail          |
| `GET/PUT /api/albums/[id]/cover`                                             | public / write                 | Square cover, pin a cover         |
| `GET /api/albums/[id]/og-cover`                                              | public                         | Wide cover (1200x630)             |
| `GET /api/albums/[id]/og-preview`                                            | public unless private          | Social preview metadata           |
| `/api/albums/[id]/info`, `/metadata`                                         | album access                   | Album info/metadata               |
| `/api/albums/[id]/permissions/users`, `/tags`                                | write                          | Edit album permissions            |
| `/api/albums/permissions/options`                                            | write                          | Options for the permission editor |

## People / CV directory

| Path                                                       | Auth              | Purpose                            |
| ---------------------------------------------------------- | ----------------- | ---------------------------------- |
| `/api/people`, `/api/people/people`, `/api/people/album/*` | session           | Trombinoscope people and CV albums |
| `/api/people/people/[personId]/photos`, `/photos-stream`   | session + consent | A person's photos                  |
| `/api/people/person/[id]/my-photos`, `/album-photos`       | session + consent | Face-based photo sets              |

## Users and photo-access

| Path                                                        | Auth            | Purpose                                                                                                                      |
| ----------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/users`, `/api/users/[id]`                         | admin / self    | User management                                                                                                              |
| `/api/users/me`                                             | session         | Current user                                                                                                                 |
| `/api/users/me/face`                                        | session         | Own reference face                                                                                                           |
| `GET /api/users/me/face/selfie/[assetId]`                   | session         | People ids on the member's own new upload (the selfie flow)                                                                  |
| `/api/users/me/photo-access`, `/options`, `/shared-with-me` | session         | RGPD photo-access consent                                                                                                    |
| `/api/users/[userId]/photo-access`                          | admin / self    | A user's grants                                                                                                              |
| `/api/users/[username]/avatar`                              | read, or `?sig` | User avatar (used by Sky, Canari); `?sig=` is the keyless URL MiConnect gives MinoWiki and Archives - see below              |
| `/api/users/avatar-presence?ids=a,b`                        | read            | Which of up to 100 users have a photo, in one query (`{ withPhoto }`) - Canari asks it instead of collecting 404s; see below |
| `/api/change-user`                                          | admin           | Impersonation (sets signed cookie)                                                                                           |

## Favorites and download

| Path                             | Auth    | Purpose                                               |
| -------------------------------- | ------- | ----------------------------------------------------- |
| `GET/POST/DELETE /api/favorites` | session | Per-user favorites                                    |
| `POST /api/download`             | session | Create a one-time download token                      |
| `GET /api/download/[token]`      | token   | Stream the archive (see [downloads.md](downloads.md)) |

## Auth

| Path                     | Auth   | Purpose                  |
| ------------------------ | ------ | ------------------------ |
| `GET /api/auth/login`    | public | Start OIDC               |
| `GET /api/auth/callback` | public | OIDC return, set session |
| `GET /api/auth/logout`   | public | Clear session            |

## External (API key)

| Path                       | Auth        | Purpose                                                            |
| -------------------------- | ----------- | ------------------------------------------------------------------ |
| `/api/external/media/[id]` | `x-api-key` | Server-to-server media access (consumed by Sky/Canari for avatars) |
| `/api/health`              | public      | Liveness probe                                                     |

**A server-to-server caller must send a `Content-Type` on every `POST`/`PUT`/`PATCH`/`DELETE`** (SvelteKit 3,
which this app runs since the kit 3 migration): a mutation with no `Origin` header (no browser) and no
`Content-Type` is refused `403` by the framework before `hooks.server.ts` runs, and `csrf.trustedOrigins`
cannot allow a missing origin. `Content-Type: application/json` on a body-less call is enough.

**There is no per-route opt-out**: kit's check (`runtime/server/csrf.js`) runs before any hook, `csrf.trustedOrigins` is matched against the `Origin` header only, and neither the config nor adapter-bun offers a path exception for `/api/external/*`. So the header is a CONTRACT with every client, pinned by `tests/server-env.test.ts`. It binds `DELETE /api/external/media/[id]`, `DELETE /api/admin/api-keys/[id]` and `DELETE /api/albums/[id]` (and every other mutating route) when called with an API key. The 403 body reads `Cross-site DELETE form submissions are forbidden`, which names the cause once you know to look for it. Known clients (Sky, portail-etu, le-cercle, Canari core-service) only GET.

## Admin

All under `requireAdminSession` / admin scope.

| Path                                                                             | Purpose                     |
| -------------------------------------------------------------------------------- | --------------------------- |
| `/api/admin/api-keys`, `/[id]`                                                   | Create/list/revoke API keys |
| `/api/admin/db-export`, `/db-import`, `/db-backup`, `/db-restore`, `/db-inspect` | Database maintenance        |
| `POST /api/admin/covers-prune`                                                   | Delete orphan album covers  |

Admin pages: `/admin`, `/admin/api-keys`, `/admin/database`,
`/admin/logs`.

## Which users have a photo, asked for a list

`GET /api/users/avatar-presence?ids=<a>,<b>` answers `{ withPhoto: [...] }`: the ids among those
named whose `users` row has a `photos_id` - exactly the ones `/api/users/<id>/avatar` does not
answer 404 for (a `photos_id` whose Immich person is gone is the rare exception). At most 100 distinct
ids (`MAX_AVATAR_PRESENCE_IDS`, Canari's profile batch size); a longer or empty list is a 400, never a
short answer. It exists because Canari learned which members have no photo by being refused once per
face - 37 404s in one salon walk on 2026-10-13 - for a fact this table already holds
(`src/lib/server/avatar-presence.ts`, `tests/avatar-presence.test.ts`).

## The signed avatar URL

`GET /api/users/<id_user>/avatar?sig=<sig>` answers with no session and no API key when
`sig = base64url(HMAC-SHA256(AVATAR_SIGNING_KEY, id_user))`, unpadded
(`src/lib/server/avatar-signature.ts`). It exists because MinoWiki and Archives MINO receive the
avatar URL inside each user's own OIDC claims: that URL used to carry a `read` API key, and a key
here is never scoped to a route, so every user of either app held a key reading every read-scoped
API. A signature opens ONE avatar, and each person only ever receives their own.

MiConnect computes the same value in its `avatar` property mapping, the only other holder of the
key; `tests/avatar-signature.test.ts` pins a vector produced by the PYTHON expression, since the
two sides share no code. No expiry, deliberately (a relying party stores the URL it was given);
rotating the key is the revocation, and it invalidates every URL at once. The response stays
`private`, like every avatar: a shared cache must never hold a face.

**Revoking one user's links.** Each revoked user has a salt in `avatar_revocations` (keyed by id_user, surviving the account's
deletion; no row until a revocation). No row signs the bare id, what MiConnect computes today; once set, the signed message is
`<id_user>\n<salt>`, so `DELETE /api/users/me/avatar-link` (the member, session only) and
`DELETE /api/users/<id>/avatar-link` (an admin) kill every URL ever issued for that user and nobody
else's. MiConnect cannot compute a salted signature, so after a revocation that user's avatar stops
showing in MinoWiki and Archives until the mapping learns the salt: it is a hard stop, which is what
a revocation is for. Pinned by `tests/avatar-signature.test.ts` (the salted message, the unsalted
Python vector unchanged) and `tests/avatar-revocation.test.ts`. A relying party may have cached the image server-side (MinoWiki, Archives): a revocation stops
new fetches, not a copy they already hold. Nothing revokes automatically yet
(a face withdrawal does not), and the settings page has no button for it.

**An API key is read from the `x-api-key` header ONLY.** The `?api_key=` query parameter this route
used to accept existed for that URL alone, and it was removed once the mapping switched (2026-09-30):
a key in a URL lands in logs, histories and claims.
