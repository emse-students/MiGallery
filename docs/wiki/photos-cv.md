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

## Consent record

`face_consents` (see [data-model.md](data-model.md)) holds one row per consent: who, when, the
terms version (`TERMS_VERSION`, the one value the `/cgu` page also shows) and the source.
`PATCH /api/users/me/face` writes it when a person is newly linked (`selfie` for the member,
`admin` when an admin links for them); `ensureSchema` backfills `legacy` rows for every link that
exists without one, idempotently. Withdrawal closes the row (`withdrawn_at`) and keeps it. There is
no explicit consent step in the settings UI yet: the link is the recorded act.

## Erasure

**The contract (owner decision 2026-10-16).** Immich groups EVERY face into anonymous clusters
(people with no name). That is accepted: it is internal, a black box, and never shown to a
member. A cluster is tied to a human only by what MiGallery writes (`users.photos_id`,
`users.photos_asset_id`) and by the person's name and birth date in Immich. When a member
withdraws consent, unlinks, or deletes their account, MiGallery undoes the link AND removes the
person's name in Immich. The anonymous cluster, its faces and their embeddings stay.

Linking a cluster to a member happens only through MiGallery (`users.photos_id`).

A member withdrawing their OWN face link (`PATCH /api/users/me/face` with
`person_id: null`) and deleting an account (`DELETE /api/users/me`, or an
admin's `DELETE /api/users/[id]`) run the erasure. The code is
`src/lib/server/face-erasure.ts`, pinned by `tests/face-erasure.test.ts`.

Two cases deliberately do NOT run it:

- **an admin (or an API key) unlinking someone else** through the same endpoint
  with `user_id`: that is the correction of a wrong association. It only unlinks.
- **anything done while impersonating**: a withdrawal or an account deletion
  is irreversible, so an admin "acting as" the member gets a 403.

**In the request, in one SQLite transaction:**

- `photos_id` and `photos_asset_id` set to NULL. `photos_asset_id` is the
  gallery photo chosen as profile picture, an archive photo: it is unlinked,
  never deleted.
- every `photo_access_permissions` row naming the member, both directions;
- account deletion only: the member's id in `logs` becomes `[deleted]` (as
  actor, with the row's `ip` cleared, and as target of a `user` or `person`
  event, whose details are cleared), their `album_permissions` rows of kind
  `user` (no foreign key, so no cascade) go, then the `users` row goes and its
  foreign keys take sessions and favorites;
- a `face_erasures` row naming the Immich person (never the member).

The on-disk crops of that person (`data/cache/faces/*_<personId>.webp`) are
deleted in the same request (files, so outside the transaction) and again
when the Immich half completes, since they can be regenerated meanwhile.

**Then in Immich, from the journal** (can fail, so it is retried):

1. `GET /api/people/{id}`. Immich answers 400 both for "not found" and for "no
   access", so "absent" is believed only when a search by that person ALSO
   finds nothing; otherwise the attempt fails.
2. If the person carries a name or a birth date: `PUT /api/people/{id}` with
   `{ "name": "", "birthDate": null }`, then `GET` again; a name still there fails
   the attempt.

The request kicks a run at once (a run already in progress makes one more pass);
the worker (`startFaceErasureWorker`, `hooks.server.ts`) retries every 15 minutes
and on start. Each failed attempt is logged as an error and recorded on its row
(`attempts`, `last_error`); every row still pending 24 h after it was asked is
logged as `face erasure OVERDUE` on every run until it completes. Once done the
row keeps only its outcome (`erased` or `absent`) and drops the person id. If
another member links the same cluster meanwhile, the name is still cleared:
MiGallery never writes a person's name, so nothing is lost.

The selfie used to link a face is deleted by the browser right after
detection, with `force: true` so it skips Immich's trash. That deletion is
client-side: a tab closed in the middle of the detection leaves it in Immich.

### Does a screen read the Immich person `name`?

Read on 2026-10-16: one place, and it degrades. `photos.svelte.ts#loadPerson` reads
`GET /api/immich/people/{id}` into `personName` (`'Sans nom'` when empty), shown in the
`/mes-photos` header only as the fallback of `targetUserName`, which is the MiGallery
user's own name. Nothing else reads it: the trombinoscope lists MiGallery users, the
admin face check (`admin/users`) reads person ids. The one other path is `GET /api/people/people` (the whole Immich list, `name` included, no in-app caller): an EXTERNAL API-key consumer would see empty names. MiGallery
never writes a person name (it writes `featureFaceAssetId` only). Clearing every name
therefore changes nothing a member sees except that header fallback.

### Removing every existing person name in Immich (admin procedure, NOT run)

`scripts/immich-clear-person-names.mjs`: DRY RUN BY DEFAULT, it only counts the people that carry
a name or a birth date (never prints the names). Run it after a dump of the Immich database:

```sh
IMMICH_BASE_URL=https://... IMMICH_API_KEY=... bun scripts/immich-clear-person-names.mjs          # dry run
IMMICH_BASE_URL=https://... IMMICH_API_KEY=... bun scripts/immich-clear-person-names.mjs --apply  # writes
```

`--apply` sends `PUT /api/people/{id}` `{ "name": "", "birthDate": null }` for each such person
and re-reads it. The Immich key needs the `person.read` and `person.update` permissions. Hidden
people are included. Re-running is safe (a cleared person is skipped).

**What erasure does not reach**, and the terms must say so:

- **The cluster itself.** Immich keeps the anonymous cluster, its faces and their embeddings,
  accepted by the owner. Only an Immich admin can see them, unnamed and linked to nobody.
- **Immich's featured-face pointer.** `featureFaceAssetId` (the thumbnail MiGallery sets when a
  member picks a profile photo) cannot be unset through Immich's API; the thumbnail stays on the
  anonymous person. MiGallery's own pointer (`photos_asset_id`) is nulled.
- **Backups.** The local snapshots under `data/backups/` (the last 10 kept,
  daily), the off-site MiGallery copies (about 14 days) and the off-site Immich
  database dumps (about 7 days, `scripts/backup-offsite.sh`, pruned by file age)
  keep the data until they rotate out. Immich's own local dump retention is an
  Immich setting, not read from here.
- **A person merged away in Immich.** Its id stops existing and its faces live on
  in the person it was merged into, which this erasure never names; a name given to
  that other person is not reached.
- **Photos.** The member's appearances in event photos stay in the archive.
- **The Immich API key's rights.** The calls need the key to hold `person.update`; a refusal
  shows as a failed attempt, then OVERDUE.

## Why this design

Immich detects faces globally, but MiGallery must not leak "all photos of person
X" to anyone. The consent table turns that into an opt-in graph: the trombinoscope
is a directory of who exists, while the actual face-linked photo sets are visible
only to the owner and the users they explicitly authorized (staff/admin aside,
per role). When changing anything under `/api/people` or `/mes-photos`, preserve
the `photo_access_permissions` check.
