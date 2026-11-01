# Photos CV and photo-access consent

MiGallery shows each member the photos their face is in ("Mes photos") and their PhotoCV
portraits, guarded by an explicit, RGPD-conscious consent model. Since lot A6
([face-matching-option-c.md](face-matching-option-c.md#a6---the-read-side)) every one of those
reads comes from MiGallery's own `face_matches` table, keyed on the member's USER id. Nothing
reads an Immich person or face any more, and the proxy refuses every such call.

## There is no people directory

There is no trombinoscope page and, since A6, no endpoint listing Immich's people: the
`/api/people/people/**`, `/api/people/person/**` and `/api/faces/**` routes are deleted. The
CV-specific logic lives in `src/lib/photos-cv/` (the PhotoCV album) and
`src/lib/server/face-photos.ts` (a member's photos).

## "My photos" (mes-photos)

`/mes-photos` shows the photos in which the signed-in member's face appears: the faces they hold
in `face_matches` that are `auto`, or `suggested` and confirmed by them (`VISIBLE_MATCH_SQL`, the
one spelling). A face waiting for their answer is not one of their photos yet; the page links to
`/mes-photos/confirmer` when some wait. The assets are fetched from Immich BY ID, in batches
(`searchAssetsByIds`), and the answer is checked: an asset that was not asked for, or a next
page, fails the request (500) rather than show photos that are not theirs.

- `GET /api/users/[userId]/photos-stream?in_album=true|false` - a member's photos as NDJSON;
  `false` leaves out the PhotoCV album ("Mes photos"), `true` keeps only it ("Mes photos CV"), no
  value gives every photo (the profile photo picker). Images only, newest first.
- `GET /api/users/me/face/matches` - the faces waiting for the member's answer, as
  `{ asset_id, face_index }` and nothing else; `POST` (A5) answers one.
- `GET /api/users/me/face/crops/[assetId]/[faceIndex]` - the picture of one face the member
  holds now, cut server-side from the box in `faces.db`, cached in the member's own directory
  (`data/cache/faces/members/<hash of the id>/`), `private, no-store`. 404 for any face they do
  not hold, whoever holds it; 403 to an impersonated session; an API key holds no face (401).
- `PUT /api/users/me/profile-photo` - `{ asset_id, user_id? }`: the profile photo, among the
  member's own photos only (404 otherwise); `user_id` is an admin's, for another member.
- `GET /api/users/[username]/avatar` - cut around the member's own face in that photo; 404 when
  they chose none or the photo is no longer one of theirs.

## Photo-access consent (RGPD)

Face-matched photos are biometric-adjacent personal data, so seeing someone else's
"my photos" requires that person's **explicit consent**. This is the
`photo_access_permissions` table:

```
photo_access_permissions(owner_id, authorized_id, created_at)
```

`owner_id` grants `authorized_id` the right to view the owner's face-matched
photos. Access is per-user and opt-in; there is no blanket sharing.

Endpoints:

- `GET/POST/DELETE /api/users/me/photo-access` - manage who I grant access to.
- `GET /api/users/me/photo-access/options` - candidate users to grant.
- `GET /api/users/me/photo-access/shared-with-me` - owners who granted me access.
- `GET /api/users/[userId]/photo-access` - a user's grants (admin/self).

## Who may read a member's photos - enforced on the server

The rule is ONE function, `faceAccessReason` in `src/lib/server/face-access.ts`, keyed on the
owner's USER id, and every route below calls it; the UI's own pre-check
(`GET /api/users/[userId]/photo-access`) answers from the same function, so what the UI says and
what the server serves cannot disagree.

| Caller                                | A member's photos | A face's picture (crop)  | Any Immich person or face |
| ------------------------------------- | ----------------- | ------------------------ | ------------------------- |
| the owner                             | read              | only the faces they hold | no (403)                  |
| a member the owner authorised         | read              | no                       | no (403)                  |
| any other member, `mitviste` included | no (403)          | no                       | no (403)                  |
| an admin session                      | read              | only the faces THEY hold | no (403)                  |
| an API key                            | read              | no (no member, 401)      | no (403)                  |

API keys keep their read: they are machine credentials issued by an admin
(`/admin/api-keys`), carry no user, and are what the external callers of these
routes use. The PhotoCV album AS A WHOLE (every member's CV portrait) is read and
changed by `admin`, `mitviste` and API keys; a member reads their own CV portraits
through the member rule (`in_album=true`).

| Route                                                                               | Guard                                    |
| ----------------------------------------------------------------------------------- | ---------------------------------------- |
| `GET /api/users/[userId]/photos-stream`                                             | member rule                              |
| `GET /api/users/me/face/matches`, `/face/crops/...`                                 | the member themself, never impersonated  |
| `PUT /api/users/me/profile-photo`                                                   | the member (an admin for another member) |
| `GET /api/people?action=all-album-photos` or `album-info`, `POST /api/people`       | PhotoCV manager                          |
| `/api/people/album`, `/album/info`, `/album/assets`, `/album/[albumId]/assets`      | PhotoCV manager                          |
| `/api/immich/people...`, `/api/immich/faces...`, `/api/immich/search/person`        | refused to everyone (403), admins too    |
| any proxied call with a `personId(s)` or `withPeople` key in its query or JSON body | refused to everyone (403), admins too    |

The proxy judges the path Immich will actually route: `.` segments resolved,
repeated slashes collapsed, case folded (Immich's router is case-insensitive), and
a path that carries its own `?` or `#` (the path parameter arrives decoded) is
refused. A mutation's body must be of a type the proxy can judge
(`classifyProxiedBody`): JSON, read once, judged and forwarded as that same text;
the multipart upload of `POST assets`; an `application/octet-stream` upload
chunk. Anything else (urlencoded included, which Immich would parse) gets a 415.
A JSON answer has its `people` and `unassignedFaces` fields removed before it reaches the client
(`stripFaceFields`); one that names them and cannot be parsed is refused (502), never forwarded.

**The legacy link (`users.photos_id`).** A6 reads nothing from it, and keeps the column and its
data for lot A7, which seeds references from those links. A member can no longer write it
(`PATCH /api/users/me/face` with a person answers 400 `person_link_retired`); an admin still
can, through the same `PATCH` (with `user_id`), `POST /api/users` and `PUT /api/users/[id]`, all
through `resolveAdminPersonLink` (one spelling, a lowercase UUID; a 409 for a person another
member holds; a `PUT` that omits `photos_id` leaves the link alone) and `applyFaceLink`. The
partial unique index on `users.photos_id` still makes one person one member. Withdrawal (a null
person) works for everyone, admins on a member's behalf included.

**Retired with A6**: `selfieProves` (the "selfie check" that let a member link a new Immich
person from a recent upload) and the member branch of the person link are deleted. Enrolment is
the A5 selfie, read in memory and never stored, and a member's photos come from the matches.

Pinned by `tests/face-access.test.ts` (the rule and the proxy refusal) and
`tests/face-read-routes.test.ts` (the routes above, as handlers).

What this does NOT cover: the asset routes (`/api/immich/assets/{id}/...`), which follow the album
permission model ([albums-and-permissions.md](albums-and-permissions.md)); an asset's detail
reaches the client without its `people`. The avatar route (`/api/users/[username]/avatar`) shows
each member's profile face to any session by design: it is the avatar, not the set.

## Consent record

`face_consents` (see [data-model.md](data-model.md)) holds one row per consent: who, when, the
terms version (`TERMS_VERSION`, the one value the `/cgu` page also shows) and the source.
The A5 enrolment writes it (`selfie`); `PATCH /api/users/me/face` writes it when an admin links
a person (`admin`, also through `POST /api/users` and `PUT /api/users/[id]`); a changed or cleared link closes the previous row; `ensureSchema` backfills `legacy` rows for every link that
exists without one, idempotently. Withdrawal closes the row (`withdrawn_at`) and keeps it. The
settings screen asks for the agreement explicitly: a box, linking `/cgu#biometrie`, ticked before
the camera opens, and the enrolment request refused (400) without it. A new `TERMS_VERSION` only labels
the consents recorded after it: an open consent row is never rewritten (`recordFaceConsent` skips
it) and nothing asks a member to accept again.

## Erasure

**The contract (owner decision 2026-10-16, extended by option C).** What ties a face to a human
is only what MiGallery writes: the member's sealed references (`face_references`), the faces given
to them (`face_matches`), the profile photo pointer (`users.photos_asset_id`) and, until lot A8,
the legacy Immich person link (`users.photos_id`) and that person's name in Immich. When a member
withdraws consent, unlinks, or deletes their account, all of it goes: the references, the matches,
the crops, the link, and the person's name in Immich. The face store (`data/faces.db`, one sealed
embedding per detected face, everyone's) is not part of a member's erasure: its rows carry no
member, are tied to nobody once the references are gone, and go with their photograph. Until A8,
Immich's own anonymous cluster, its faces and their embeddings stay too; A8 deletes them all
([face-matching-option-c](face-matching-option-c.md#3-the-lots)).

Linking an Immich cluster to a member happens only through MiGallery (`users.photos_id`), and only
an admin can still do it; nothing reads that link but the A7 seed.

Every CHANGE of the person linked to an account runs the erasure for the OLD person, through
`applyFaceLink` (`src/lib/server/face-link.ts`, the one application writer of `users.photos_id`; `createUser`/`updateUser` refuse the column, `POST /api/users` goes through it, and only the test suite's own admin row bypasses it, with a NULL link): a member
withdrawing (`PATCH /api/users/me/face` with `person_id: null`, reason `withdrawal`), an admin
relinking to another person (`relink`; a member can no longer link, A6), an admin unlinking or changing a link (`PATCH` with
`user_id`, `PUT /api/users/[id]`, reason `admin_unlink` / `relink`), and an account deletion
(`DELETE /api/users/me`, an admin's `DELETE /api/users/[id]`). The grants, the consent and the
Immich name hang from the link, so none of them may carry over to a different person. Every one of those writes, an admin's included, is refused (403) in an impersonated session. A journal row whose person is by then linked to a member is closed as `relinked` without touching Immich, and deleting an account also scrubs its id from the audit log by exact match of the quoted id, never a substring. The code is
`src/lib/server/face-erasure.ts`, pinned by `tests/face-erasure.test.ts` and, at handler level,
`tests/face-routes.test.ts`.

**Nothing of this may be done by an admin impersonating the member:** a link, a withdrawal, a
profile photo, an account deletion and a photo-access grant or revocation get a 403 in an
impersonated session (they are the member's own acts and consents).

**In the request, in one SQLite transaction:**

- `photos_id` and `photos_asset_id` set to NULL. `photos_asset_id` is the
  gallery photo chosen as profile picture, an archive photo: it is unlinked,
  never deleted.
- every `photo_access_permissions` row the member GAVE (grants on their own face photos). Grants others
  gave the member concern other people's faces and stay on a withdrawal or a relink; an account deletion
  takes them by cascade;
- the member's open consent row is closed (`withdrawn_at`);
- the member's sealed references (`face_references`) and every `face_matches` row naming them -
  the faces they held, answered or not, and the ones they rejected; those faces are re-decided
  after the commit and may go to the next member;
- account deletion only: the member's id in `logs` becomes `[deleted]` (as
  actor, with the row's `ip` cleared, and as target of a `user` or `person`
  event, whose details are cleared; any other row whose `details` contains the member's id also loses
  its details), their `album_permissions` rows of kind
  `user` (no foreign key, so no cascade) go, then the `users` row goes and its
  foreign keys take sessions and favorites;
- a `face_erasures` row naming the Immich person (never the member).

The link write and its consent row are one transaction. The member's own crop directory
(`data/cache/faces/members/<hash>/`, the A6 confirmation pictures and avatar) is deleted after the
commit of every withdrawal and account deletion (`deleteMemberFaceCrops`, never throws); a "not
me" answer deletes that one face's crop. The older on-disk crops of the person
(`data/cache/faces/*_<personId>.webp`) are files too: they are deleted AFTER the commit, and a failure is
logged per file and never undoes the withdrawal (`deletePersonFaceCrops` never throws). They go again
when the Immich half completes, since they can be regenerated meanwhile. A stored link that is not a
UUID (an admin's hand-typed test id) journals nothing.

**Then in Immich, from the journal** (can fail, so it is retried):

1. `GET /api/people/{id}`. Immich answers 400 both for "not found" and for "no
   access", so "absent" is believed only when a search by that person ALSO
   finds nothing; otherwise the attempt fails.
2. If the person carries a name or a birth date: `PUT /api/people/{id}` with
   `{ "name": "", "birthDate": null }`, then `GET` again; a name still there fails
   the attempt.

The request kicks a run at once (a run already in progress makes one more pass; `runFaceErasures` never rejects, a failing pass is
logged and the next tick retries, and every caller goes through `kickFaceErasures`);
the worker (`startFaceErasureWorker`, `hooks.server.ts`) retries every 15 minutes
and on start. Each failed attempt is logged as an error and recorded on its row
(`attempts`, `last_error`); every row still pending 24 h after it was asked is
logged as `face erasure OVERDUE` on every run until it completes. Once done the
row keeps only its outcome (`erased` or `absent`) and drops the person id. If
another member links the same cluster meanwhile, the name is still cleared:
MiGallery never writes a person's name, so nothing is lost.

The A5 selfie is read in memory and never stored, in Immich or anywhere else.

### Does a screen read the Immich person `name`?

Not since A6: no screen and no MiGallery route reads an Immich person (the proxy refuses them
all), so clearing every name changes nothing a member sees. MiGallery never writes a person name.

### Removing every existing person name in Immich (admin procedure, NOT run)

`scripts/immich-clear-person-names.mjs`: DRY RUN BY DEFAULT, it only counts the people that carry
a name or a birth date (never prints the names). Run it after a dump of the Immich database:

```sh
IMMICH_BASE_URL=https://... IMMICH_API_KEY=... bun scripts/immich-clear-person-names.mjs          # dry run
IMMICH_BASE_URL=https://... IMMICH_API_KEY=... bun scripts/immich-clear-person-names.mjs --apply  # writes
```

The listing is paged until Immich returns an EMPTY page and the count seen must equal the total it reports
(else nothing is written); the page count is printed; an Immich error body is never printed (it can echo a
name). `--apply` sends `PUT /api/people/{id}` `{ "name": "", "birthDate": null }` for each such person
and re-reads it. The Immich key needs the `person.read` and `person.update` permissions. Hidden
people are included. Re-running is safe (a cleared person is skipped).

**What erasure does not reach**, and the terms say so (`/cgu`, section 4):

- **The face store.** `data/faces.db` keeps one sealed embedding per face of every photograph,
  the member's own included: no member, no name, tied to nobody without a reference. It goes with
  the photograph, or as a whole (delete the file or rotate `FACE_STORE_KEY`).
- **The cluster itself, until A8.** Immich keeps the anonymous cluster, its faces and their
  embeddings, unnamed and linked to nobody; only an Immich admin can see them, and A8 deletes them
  all.
- **Immich's featured-face pointer.** `featureFaceAssetId` (the thumbnail MiGallery sets when a
  member picks a profile photo) cannot be unset through Immich's API; the thumbnail stays on the
  anonymous person. MiGallery's own pointer (`photos_asset_id`) is nulled.
- **Backups.** The local snapshots under `data/backups/` (the last 10 kept,
  daily) and the off-site MiGallery copies (about 14 days) keep the references and
  matches until they rotate out; the off-site Immich database dumps (about 7 days,
  `scripts/backup-offsite.sh`, pruned by file age) keep Immich's clusters until
  they rotate out after A8, and A8's encrypted copy of what it deletes is deleted
  30 days after. `data/faces.db` is in no backup. Immich's own local dump retention is an
  Immich setting, not read from here.
- **A person merged away in Immich.** Its id stops existing and its faces live on
  in the person it was merged into, which this erasure never names; a name given to
  that other person is not reached.
- **Photos.** The member's appearances in event photos stay in the archive.
- **The Immich API key's rights.** The calls need the key to hold `person.update`; a refusal
  shows as a failed attempt, then OVERDUE.

## Why this design

Immich detects faces globally, but MiGallery must not leak "all photos of person
X" to anyone. The consent table turns that into an opt-in graph: the face-linked
photo sets are visible
only to the owner and the users they explicitly authorized (staff/admin aside,
per role). When changing anything under `/api/users/[userId]/photos-stream`, the proxy or
`/mes-photos`, go through `face-access.ts` and `face-photos.ts` - never re-derive the check inline.
