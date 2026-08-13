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

One unified table, `album_permissions(album_id, kind, value)`, grants access to
an album, in addition to its visibility. `kind` selects the dimension:

- `user` - specific users (`value` = `id_user`).
- `formation` - by formation (ICM, ISMIN, FSSS, Master, …).
- `promo` - by graduation year (`value` = promo year, stored as text).
- `tag` - free-form tags (e.g. "Promo 2024") for labeling.

(Four separate tables existed historically, one per dimension; they were
backfilled into `album_permissions` and dropped - see
[data-model.md](data-model.md).)

## Access resolution

`checkAlbumAccess(user, album)` in `src/lib/albums.ts` is the single source of
truth. It evaluates, in order:

1. **`unlisted`** visibility -> access granted to anyone (this is the shareable
   public-link case; asset-level access is mirrored by the Immich proxy, see
   [immich-proxy.md](immich-proxy.md)).
2. **No user** (and not unlisted) -> denied.
3. **`mitviste` or `admin`** role -> full access.
4. **Explicit user permission** (`album_permissions` row with `kind = 'user'`,
   `value = id_user`) -> access.
5. **Formation AND promo** match combined -> access. This is a self-join on
   `album_permissions`: the user needs BOTH a `kind = 'formation'` row matching
   their formation AND a `kind = 'promo'` row matching their promo year, on the
   same album - not either alone.
6. **`authenticated`** visibility -> any logged-in user has access.
7. Otherwise (`private` with no matching grant) -> denied.

So `private` and `unlisted` both restrict to explicit grants / criteria / staff;
the difference is that `unlisted` additionally allows direct link access without a
session, while `private` never does. `authenticated` opens the album to every
signed-in user.

> Note: `kind = 'tag'` rows are a labeling/permission dimension surfaced in the
> album editor and the permissions options endpoint; the core `checkAlbumAccess`
> path above keys on user + (formation AND promo) + visibility, and never reads
> `kind = 'tag'` rows. Keep this in mind when changing access logic.

## Managing albums

- **Create/update**: `POST`/`PATCH /api/albums` and `/api/albums/[id]` write the
  `albums` row and replace the `album_permissions` rows (kinds
  user/formation/promo/tag) from the request. Album creation is logged
  (`logEvent`).
- **Options**: `GET /api/albums/permissions/options` returns the selectable
  formations, promos, tags and users for the permission editor.
- **Covers and OG**: `/api/albums/[id]/cover`, `/og-cover`, `/og-preview` produce
  the album cover and social preview images.
- **Assets**: `/api/albums/[id]/assets`, `/assets-simple`, `/assets-stream`,
  `/asset-original`, `/asset-thumbnail` serve album contents (streamed from
  Immich through the proxy, gated by `checkAlbumAccess`).
