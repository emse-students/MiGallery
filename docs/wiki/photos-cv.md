# Photos CV and photo-access consent

MiGallery exposes Immich's face recognition as a personal "my photos" view and
the PhotoCV portraits, guarded by an explicit, RGPD-conscious consent model.

## The people directory

There is no trombinoscope page: no route in `src/routes` renders one. The
directory endpoint, `GET /api/people/people`, lists every person Immich
clustered - members and non-members alike, with the names an admin gave them -
so it answers an admin session or an API key only (see below). The CV-specific
logic lives in `src/lib/photos-cv/`.

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

## Who may read a face-linked photo set - enforced on the server

The rule is ONE function, `src/lib/server/face-access.ts`, and every route below
calls it; the UI's own pre-check (`GET /api/users/[userId]/photo-access`) answers
from the same function, so what the UI says and what the server serves cannot
disagree.

| Caller                                | A person linked to a member (`users.photos_id`) | A person nobody linked | Every person / every face |
| ------------------------------------- | ----------------------------------------------- | ---------------------- | ------------------------- |
| the owner                             | read and edit (name, featured face)             | -                      | no                        |
| a member the owner authorised         | read only                                       | -                      | no                        |
| any other member, `mitviste` included | no (403)                                        | no (403)               | no                        |
| an admin session                      | read and edit                                   | read                   | yes                       |
| an API key                            | read and edit                                   | read                   | yes                       |

API keys keep their access: they are machine credentials issued by an admin
(`/admin/api-keys`), carry no user, and are what the external callers of these
routes use. The PhotoCV album AS A WHOLE (every member's CV portrait) is read and
changed by `admin`, `mitviste` and API keys; a member reads their own CV portraits
through the person rule.

| Route                                                                                                     | Guard                                             |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `/api/people/person/[id]/my-photos`, `/album-photos`                                                      | person                                            |
| `/api/people/people/[personId]/photos`, `/photos-stream`                                                  | person                                            |
| `GET /api/people?action=my-photos` or `album-photos`                                                      | person                                            |
| `GET /api/people?action=all-album-photos` or `album-info`, `POST /api/people`                             | PhotoCV manager                                   |
| `/api/people/album`, `/album/info`, `/album/assets`, `/album/[albumId]/assets`                            | PhotoCV manager                                   |
| `GET /api/people/people` (the Immich directory, names included)                                           | admin or API key                                  |
| `/api/immich/people/{id}[/...]` GET                                                                       | person                                            |
| `/api/immich/people/{id}` PUT                                                                             | owner (an authorised viewer may look, never edit) |
| `/api/immich/people` and any other `people/...` call, `/api/immich/faces...`, `/api/immich/search/person` | admin or API key                                  |
| any proxied call naming `personId(s)` in its query or JSON body (`search/metadata`, `timeline/buckets`)   | person, for EACH id                               |

The proxy judges the path Immich will actually route: `.` segments resolved,
repeated slashes collapsed, case folded (Immich's router is case-insensitive), and
a path that carries its own `?` or `#` (the path parameter arrives decoded) is
refused. A JSON body is read once, judged, and forwarded as that same text, so
Immich never parses a body the check did not see. A search asking for the people
of every result (`withPeople`) is admin-only.

**The link is the trust root, so it is guarded too.** A person id has ONE
spelling, a lowercase UUID (`normalisePersonId`), on write and on every
comparison - SQLite's `=` is case-sensitive, Immich is not. A member links a NEW
person through `PATCH /api/users/me/face` only with `selfie_asset_id`: Immich
must report that asset uploaded within the last 30 minutes and showing exactly
that one person (`selfieProves`). Keeping their current person needs no proof;
admins correct links by hand. What this cannot prove: that the "selfie" is not a
photo of someone else - that is the limit of face matching, not of the code.

`/mes-photos?userId=X` no longer bounces a viewer who has no face of their own: the
page carries no photo, and the routes it reads from enforce the rule above.

Pinned by `tests/face-access.test.ts` (a throwaway SQLite file, no server).

What this does NOT cover: the asset routes (`/api/immich/assets/{id}/...`) and an
asset's detail, which lists the people Immich found in it. Those follow the album
permission model ([albums-and-permissions.md](albums-and-permissions.md)), not
this rule. The avatar route (`/api/users/[username]/avatar`) shows each member's
profile face to any session by design: it is the avatar, not the set.

## Why this design

Immich detects faces globally, but MiGallery must not leak "all photos of person
X" to anyone. The consent table turns that into an opt-in graph: the face-linked
photo sets are visible
only to the owner and the users they explicitly authorized (staff/admin aside,
per role). When changing anything under `/api/people`, `/api/immich/people` or
`/mes-photos`, go through `face-access.ts` - never re-derive the check inline.
