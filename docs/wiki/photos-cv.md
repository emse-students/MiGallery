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

A member withdrawing their OWN face link (`PATCH /api/users/me/face` with
`person_id: null`) and deleting an account (`DELETE /api/users/me`, or an
admin's `DELETE /api/users/[id]`) erase the face data, not just the link. The
code is `src/lib/server/face-erasure.ts`, pinned by `tests/face-erasure.test.ts`.

Two cases deliberately do NOT erase:

- **an admin (or an API key) unlinking someone else** through the same endpoint
  with `user_id`: that is the correction of a wrong association, and the person
  may be another human's. It only unlinks.
- **anything done while impersonating**: a withdrawal or an account deletion
  is irreversible, so an admin "acting as" the member gets a 403.

**In the request, in one SQLite transaction:**

- `photos_id` and `photos_asset_id` set to NULL. `photos_asset_id` is the
  gallery photo chosen as profile picture, an archive photo - it is unlinked,
  never deleted.
- every `photo_access_permissions` row naming the member, both directions;
- account deletion only: the member's id in `logs` becomes `[deleted]` (as
  actor - with the row's `ip` cleared - and as target of a `user` or `person`
  event, whose details are cleared), their `album_permissions` rows of kind
  `user` (no foreign key, so no cascade) go, then the `users` row goes and its
  foreign keys take sessions and favorites;
- a `face_erasures` row naming the Immich person (never the member).

The on-disk crops of that person (`data/cache/faces/*_<personId>.webp`) are
deleted in the same request - files, so outside the transaction - and again
when the Immich half completes, since they can be regenerated meanwhile.

**Then in Immich, from the journal** (can fail, so it is retried):

1. `GET /api/people/{id}`. Immich answers 400 both for "not found" and for "no
   access", so "absent" is believed only when a search by that person ALSO
   finds nothing; otherwise the attempt fails.
2. Every asset showing the person (`search/metadata`, `withDeleted: true`):
   `GET /api/faces?id=<asset>`, then `DELETE /api/faces/{faceId}` with
   `force: true` (a hard delete of the record and its embedding) for each face
   pointing at the person.
3. The search again: if any asset still shows the person, the attempt fails -
   the person is NOT deleted, because deleting a person detaches its remaining
   faces (embeddings kept) instead of deleting them.
4. `DELETE /api/people/{id}`.

A person with an erasure still owed cannot be linked by anyone (409
`face_erasure_pending`): linking it would make the erasure stand down. A row
whose person is nonetheless linked to a member (one older than that rule) ends
`relinked`, without erasing. The request kicks a run at once (a run already in
progress makes one more pass); the worker (`startFaceErasureWorker`,
`hooks.server.ts`) retries every 15 minutes and on start. Each failed attempt
is logged as an error and recorded on its row (`attempts`, `last_error`); every
row still pending 24 h after it was asked is logged as `face erasure OVERDUE` on
every run until it completes. Once done the row keeps only its outcome
(`erased`, `absent` or `relinked`) and drops the person id.

The selfie used to link a face is deleted by the browser right after
detection, with `force: true` so it skips Immich's trash. That deletion is
client-side: a tab closed in the middle of the detection leaves it in Immich.

**What erasure does not reach**, and the terms must say so:

- **Backups.** The local snapshots under `data/backups/` (the last 10 kept,
  daily), the off-site MiGallery copies (about 14 days) and the off-site Immich
  database dumps (about 7 days, `scripts/backup-offsite.sh`, pruned by file age)
  keep the data until they rotate out. Immich's own local dump retention is an
  Immich setting, not read from here.
- **Faces Immich does not list.** `GET /api/faces` returns visible faces only.
  If the search keeps finding the person after the visible ones went, the
  erasure stays pending and goes OVERDUE - an admin must look in Immich.
- **Other clusters of the same human.** Immich often splits one person into
  several clusters; only the one linked to the member is erased. The others are
  unnamed and linked to nobody, so only an admin can read them, but they hold
  that member's faces.
- **A person merged away in Immich.** Its id stops existing and its faces live on
  in the person it was merged into, which this erasure never names.
- **Faces Immich detects again.** A full re-run of Immich's face detection job
  re-detects every face and would create new records for that member.
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
