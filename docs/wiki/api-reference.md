# API reference

MiGallery's endpoints live under `src/routes/api/`. Access is enforced per handler
via `requireScope` / `requireSession` / `requireAdminSession` (see
[authentication.md](authentication.md)); there is no global gate. "Auth" below is
the effective minimum.

## Immich proxy

| Path                    | Auth                                                   | Purpose                                                                                                 |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `/api/immich/[...path]` | read (GET) / write (mutations); unlisted assets public | Universal proxy to Immich; chunked uploads; binary passthrough (see [immich-proxy.md](immich-proxy.md)) |

## Albums

| Path                                                                         | Auth                           | Purpose                           |
| ---------------------------------------------------------------------------- | ------------------------------ | --------------------------------- |
| `GET/POST /api/albums`                                                       | read / write                   | List / create albums              |
| `GET/PATCH/DELETE /api/albums/[id]`                                          | per `checkAlbumAccess` / write | Album detail and edit             |
| `/api/albums/[id]/assets`, `/assets-simple`, `/assets-stream`                | album access                   | Album assets                      |
| `/api/albums/[id]/asset-original/[assetId]` and `/asset-thumbnail/[assetId]` | album access                   | Single asset / thumbnail          |
| `/api/albums/[id]/cover/[assetId]`, `/og-cover`, `/og-preview`               | album access                   | Cover and social preview          |
| `/api/albums/[id]/info`, `/metadata`                                         | album access                   | Album info/metadata               |
| `/api/albums/[id]/permissions/users`, `/tags`                                | write                          | Edit album permissions            |
| `/api/albums/covers`                                                         | read                           | Cover batch                       |
| `/api/albums/permissions/options`                                            | write                          | Options for the permission editor |

## People / CV directory

| Path                                                       | Auth              | Purpose                            |
| ---------------------------------------------------------- | ----------------- | ---------------------------------- |
| `/api/people`, `/api/people/people`, `/api/people/album/*` | session           | Trombinoscope people and CV albums |
| `/api/people/people/[personId]/photos`, `/photos-stream`   | session + consent | A person's photos                  |
| `/api/people/person/[id]/my-photos`, `/album-photos`       | session + consent | Face-based photo sets              |

## Users and photo-access

| Path                                                        | Auth         | Purpose                            |
| ----------------------------------------------------------- | ------------ | ---------------------------------- |
| `GET /api/users`, `/api/users/[id]`                         | admin / self | User management                    |
| `/api/users/me`                                             | session      | Current user                       |
| `/api/users/me/face`                                        | session      | Own reference face                 |
| `/api/users/me/promo`                                       | session      | Set promo/formation (first login)  |
| `/api/users/me/photo-access`, `/options`, `/shared-with-me` | session      | RGPD photo-access consent          |
| `/api/users/[userId]/photo-access`                          | admin / self | A user's grants                    |
| `/api/users/[username]/avatar`                              | read         | User avatar (used by Sky, Canari)  |
| `/api/change-user`                                          | admin        | Impersonation (sets signed cookie) |

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

| Path                                              | Auth        | Purpose                                                            |
| ------------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `/api/external/media`, `/api/external/media/[id]` | `x-api-key` | Server-to-server media access (consumed by Sky/Canari for avatars) |
| `/api/health`                                     | public      | Liveness probe                                                     |

## Admin

All under `requireAdminSession` / admin scope.

| Path                                                                             | Purpose                     |
| -------------------------------------------------------------------------------- | --------------------------- |
| `/api/admin/api-keys`, `/[id]`                                                   | Create/list/revoke API keys |
| `/api/admin/db-export`, `/db-import`, `/db-backup`, `/db-restore`, `/db-inspect` | Database maintenance        |

Admin pages: `/admin`, `/admin/api-keys`, `/admin/database`,
`/admin/logs`.
