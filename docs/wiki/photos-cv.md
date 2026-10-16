# Photos CV, trombinoscope and photo-access consent

MiGallery exposes Immich's face recognition as a member directory
(trombinoscope) and a personal "my photos" view, guarded by an explicit,
RGPD-conscious consent model.

## Trombinoscope

The `/trombinoscope` page lists people detected by Immich (faces), acting as a
visual directory. It is backed by the `/api/people/*` endpoints, which proxy
Immich's people/faces data and join it with MiGallery users where relevant. The
CV-specific logic lives in `src/lib/photos-cv/`.

## "My photos" (mes-photos)

`/mes-photos` shows the photos in which the signed-in user's face appears
(resolved through the user's linked Immich person). A user can also set/replace
their reference face:

- `GET/POST /api/users/me/face` - the user's own face reference.
- `/api/people/people/[personId]/photos` and `/photos-stream` - the assets for a
  detected person.

## Photo-access consent (RGPD)

Face-linked photos are biometric-adjacent personal data, so seeing someone else's
"my photos" requires that person's **explicit consent**. This is the
`photo_access_permissions` table:

```
photo_access_permissions(owner_id, authorized_id, created_at)
```

`owner_id` grants `authorized_id` the right to view the owner's face-linked
photos. Access is per-user and opt-in; there is no blanket sharing.

Endpoints:

- `GET/POST/DELETE /api/users/me/photo-access` - manage who I grant access to.
- `GET /api/users/me/photo-access/options` - candidate users to grant.
- `GET /api/users/me/photo-access/shared-with-me` - owners who granted me access.
- `GET /api/users/[userId]/photo-access` - a user's grants (admin/self).
- `/api/people/person/[id]/my-photos` and `/album-photos` - a person's photos,
  enforced against the consent table.

## Erasure

Withdrawing the face link (`PATCH /api/users/me/face` with `person_id: null`) and
deleting an account (`DELETE /api/users/me`, or an admin's `DELETE
/api/users/[id]`) erase the face data, not just the link. The code is
`src/lib/server/face-erasure.ts`, pinned by `tests/face-erasure.test.ts`.

**In the request, in one SQLite transaction** (cannot fail halfway):

- `photos_id` and `photos_asset_id` set to NULL. `photos_asset_id` is the
  gallery photo chosen as profile picture, an archive photo - it is unlinked,
  never deleted.
- every `photo_access_permissions` row naming the member, both directions;
- the on-disk face crops of that person (`data/cache/faces/*_<personId>.webp`);
- account deletion only: the member's id in `logs` becomes `[deleted]` (as
  actor, and as target of a `user` or `person` event, whose details are cleared),
  then the `users` row goes and its foreign keys take sessions and favorites;
- a `face_erasures` row naming the Immich person (never the member).

**Then in Immich, from the journal** (can fail, so it is retried):
`GET /api/people/{id}` (absent = done), every asset showing the person
(`search/metadata`, `withDeleted: true`), `DELETE /api/faces/{faceId}` with
`force: true` for each face record still pointing at the person - the record
holds the face's embedding - then `DELETE /api/people/{id}`. The person is
deleted only after all its faces, so a run cut short is resumed by the next
one from what Immich still holds. The request kicks a run at once; the worker
(`startFaceErasureWorker`, `hooks.server.ts`) retries every 15 minutes and on
start. Each failed attempt is logged as an error and recorded on its row
(`attempts`, `last_error`); every row still pending 24 h after it was asked is
logged as `face erasure OVERDUE` on every run until it completes. Once done the
row keeps only its outcome (`erased`, `absent`, or `relinked` when a member
linked that person again before the run, which is then NOT erased) and drops
the person id.

The selfie used to link a face is deleted by the browser right after
detection, with `force: true` so it skips Immich's trash. That deletion is
client-side: a tab closed in the middle of the detection leaves it in Immich.

**What erasure does not reach**, and the terms must say so:

- **Backups.** The in-app snapshots under `data/backups/` (last 10, daily), the
  off-site MiGallery copies (14 days) and the off-site Immich database dumps
  (7 days, `scripts/backup-offsite.sh`) keep the data until they rotate out.
  Immich's own local dump retention is an Immich setting, not read from here.
- **Faces Immich detects again.** A FULL re-run of Immich's face detection job
  re-detects every face on every asset and would create new records (and a new
  unnamed person) for that member. The incremental runs only process new assets.
- **Photos.** The member's appearances in event photos stay in the archive; only
  the face records that tied them together are removed.
- **The Immich API key's rights.** The calls need the key to hold the face and
  person delete permissions; a refusal shows as a failed attempt, then OVERDUE.

## Why this design

Immich detects faces globally, but MiGallery must not leak "all photos of person
X" to anyone. The consent table turns that into an opt-in graph: the trombinoscope
is a directory of who exists, while the actual face-linked photo sets are visible
only to the owner and the users they explicitly authorized (staff/admin aside,
per role). When changing anything under `/api/people` or `/mes-photos`, preserve
the `photo_access_permissions` check.
