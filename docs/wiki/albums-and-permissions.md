# Albums and permissions

An album exists in Immich (the assets) and in MiGallery's local `albums` table
(its visibility and access rules). MiGallery decides who may see an album; Immich
serves its photos.

## Album metadata (local)

The `albums` row (keyed by the Immich album UUID) holds:

- `name`, `date`, `location`
- `visibility`: `private | authenticated | unlisted`
- `visible`: whether to show the album in public listings (1) or hide it (0)

## Permission dimensions

Four tables grant access to an album, in addition to its visibility:

- `album_user_permissions` - specific users (by `id_user`).
- `album_formation_permissions` - by formation (ICM, ISMIN, FSSS, Master, …).
- `album_promo_permissions` - by graduation year (promo).
- `album_tag_permissions` - free-form tags (e.g. "Promo 2024") for labeling.

## Access resolution

`checkAlbumAccess(user, album)` in `src/lib/albums.ts` is the single source of
truth. It evaluates, in order:

1. **`unlisted`** visibility -> access granted to anyone (this is the shareable
   public-link case; asset-level access is mirrored by the Immich proxy, see
   [immich-proxy.md](immich-proxy.md)).
2. **No user** (and not unlisted) -> denied.
3. **`mitviste` or `admin`** role -> full access.
4. **Explicit user permission** (`album_user_permissions`) -> access.
5. **Formation AND promo** match combined -> access. This is an INNER JOIN: the
   user needs BOTH a matching `formation` AND a matching `promo_year` permission
   on the same album, not either alone.
6. **`authenticated`** visibility -> any logged-in user has access.
7. Otherwise (`private` with no matching grant) -> denied.

So `private` and `unlisted` both restrict to explicit grants / criteria / staff;
the difference is that `unlisted` additionally allows direct link access without a
session, while `private` never does. `authenticated` opens the album to every
signed-in user.

> Note: `album_tag_permissions` is a labeling/permission dimension surfaced in the
> album editor and the permissions options endpoint; the core `checkAlbumAccess`
> path above keys on user + (formation AND promo) + visibility. Keep this in mind
> when changing access logic.

## Managing albums

- **Create/update**: `POST`/`PATCH /api/albums` and `/api/albums/[id]` write the
  `albums` row and replace the permission rows (user/formation/promo/tag) from the
  request. Album creation is logged (`logEvent`).
- **Options**: `GET /api/albums/permissions/options` returns the selectable
  formations, promos, tags and users for the permission editor.
- **Covers and OG**: `/api/albums/[id]/cover`, `/og-cover`, `/og-preview` produce
  the album cover and social preview images.
- **Assets**: `/api/albums/[id]/assets`, `/assets-simple`, `/assets-stream`,
  `/asset-original`, `/asset-thumbnail` serve album contents (streamed from
  Immich through the proxy, gated by `checkAlbumAccess`).
