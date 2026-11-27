# The Alumni merge - MiGallery's half

A person who once signed in through the Alumni base (Alumnforce) got a SECOND MiConnect account,
and, if they opened MiGallery with it, a second MiGallery account. When Canari merges the two
MiConnect accounts, it asks every sibling site to move what the duplicate owns onto the real
account and erase the rest. The design is Canari's (`docs/wiki/profiles-and-access.md`, D52-D58,
the owner's decisions of 2026-11-26); this page is what MiGallery built for it.

## The call

`POST /api/internal/alumni-merge`, server to server, from Canari's core-service
(`alumni-merge-site-jobs.service.ts`), one call per merge and site, retried by Canari until it
answers.

- **Authentication**: `Authorization: Bearer <token>`. The token is ES256, header
  `typ: canari-merge+jwt`, signed with Canari's HANDOFF key, verified against the same JWKS and
  issuer as the [sign-in handoff](authentication.md#signed-in-from-canari-the-sign-in-handoff)
  (`CANARI_HANDOFF_ISSUER`, `CANARI_HANDOFF_JWKS`): no new secret. Audience `migallery`, lifetime at
  most 60 s, 30 s of skew. Its own `typ` means a handoff token is never accepted here, nor the
  reverse. The verifier is `src/lib/server/handoff/alumni-merge-verify.ts`, VENDORED
  BYTE-IDENTICALLY from Canari's `libs/handoff/alumni-merge-verify.ts` beside `handoff-verify.ts`
  (whose leeway and lifetime it imports), like the handoff verifier: edit it in Canari, then copy
  it; Canari's `tools/ecosystem-shape/shape.mjs` compares the copies. It is excluded from `oxfmt`
  (`oxfmt.json`) so the formatter never makes it drift.
- **Claims**: `dup` (the duplicate's subject), `jti` (Canari's job id, logged), and `mode`:
  absent or `transfer` is the merge and REQUIRES `target` (the real account's subject); `erase`
  erases the duplicate and moves nothing (the target was erased in Canari in the meantime), and its
  token carries NO `target` - one that does is refused `invalid`. The mode is a signed claim, not a
  body field, so that nobody holding a token can turn a transfer into an erasure. The body is
  ignored.
- **Answers**:

| Status | Body                                          | Meaning                                                                                                    | Canari                 |
| ------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------- |
| 200    | `{ outcome: 'transferred' }`                  | moved, then the duplicate erased                                                                           | done                   |
| 200    | `{ outcome: 'erased' }`                       | erase-only mode: the duplicate erased                                                                      | done                   |
| 200    | `{ outcome: 'absent' }`                       | no duplicate account here: never signed in, or already done                                                | done                   |
| 409    | `{ code: 'ALUMNI_MERGE_DUPLICATE_IS_ADMIN' }` | the duplicate holds `admin` here                                                                           | blocked, a human looks |
| 409    | `{ code: 'ALUMNI_MERGE_SAME_SUBJECT' }`       | `dup` equals `target`                                                                                      | blocked                |
| 409    | `{ code: 'ALUMNI_MERGE_FACE_UNREADABLE' }`    | a sealed face row of the duplicate does not open                                                           | blocked                |
| 503    | `{ code: 'FACE_STORE_KEY_UNAVAILABLE' }`      | the duplicate holds templates and `FACE_STORE_KEY` is unusable                                             | retried                |
| 503    | `{ outcome: 'keys_unavailable' }`             | Canari's JWKS could not be fetched                                                                         | retried                |
| 401    | `{ outcome: <class> }`                        | the token is refused (`invalid`, `wrong_issuer`, `wrong_audience`, `expired`, `not_yet_valid`, `too_long`) | retried                |
| 503    | `{ outcome: 'not_configured' }`               | this deployment trusts no Canari issuer                                                                    | retried                |

A refusal writes nothing. Every 409 is a state no retry changes (Canari blocks the job); every 503 is retried.

## What moves, in ONE transaction

`src/lib/server/alumni-merge/merge.ts`. `BEGIN IMMEDIATE`, so a sign-in of the target racing the
call waits for it.

1. No duplicate row: `absent`, nothing written (the target is NOT created).
2. A duplicate holding `admin`: refused. A duplicate is an Alumni sign-in, never an administrator;
   the refusal also makes the last-admin guard (`admin-floor.ts`) unreachable from here.
3. The target's row is created if missing: name, first and last name, promo and formation copied,
   role `user`. Its next sign-in overwrites them as every sign-in does.
4. Favourites (`INSERT OR IGNORE`), photo-access grants on BOTH sides (the duplicate's given ones
   become the target's, the ones it received too; a grant to oneself is dropped), per-user album
   grants, and `locale` when the target has none.
5. **The face enrolment** (the owner's decision of 2026-11-26, item 9): when the duplicate holds
   face data and the target holds NONE (no `photos_id`, no template, no negative, no answer, no
   ledger row, no open consent), the face link (`photos_id`, `photos_asset_id`,
   `photos_asset_source`) and EVERY face row move: `face_consents` (unchanged - date, terms version,
   `source`: the same person's consent), `face_references`, `face_negatives`,
   `face_reference_ledger`, `face_reference_selection`, `face_match_ledger`, `face_avatar_ledger`,
   `face_rematch_pending`, `face_matches`. A sealed template is bound to its member
   ([face-matching-option-c](face-matching-option-c.md)), so each is opened with the duplicate's
   context and re-sealed with the target's, in the transaction; the plaintext is zeroed after use.
   Nothing is journalled to Immich: the link moved, it was not withdrawn. When the target already
   holds face data, it keeps it and the duplicate's is erased like any account deletion (journalled
   for Immich when it had a person).
6. The duplicate's `handoff_redemptions` rows are deleted, then `deleteUserAccountRows` erases the
   account exactly as an account deletion does (face data, the audit log anonymised, the avatar
   salt rotated, album grants, the row and its cascades - sessions included). `secure_delete` is
   on, so deleted rows are overwritten. `finishLocalErasure` runs after the commit (crops).

`role` is never carried: a privilege belongs to the account it was granted to; a `mitviste`
duplicate's role is dropped and logged.

**The allowlist** is `ALUMNI_MERGE_TABLES`; `tests/alumni-merge.test.ts` walks the schema and fails
on a table naming a user that is not in it.

## Idempotence

From state, not from a ledger: the duplicate's row is what is owed. Once it is gone, every call - a
retry whose answer was lost, a replayed token, a duplicate that never came here - answers `absent`
and nothing moves twice. The `jti` is logged, not stored.

## Logs

`[ALUMNI_MERGE]` lines name the `jti`, 8-character subject prefixes and counts. Never a token, a
name, a full subject, a template, a distance or a face key. Pinned by the test.

## The admin list tells homonyms apart

"Utilisateurs & roles" (`/admin/users`) showed the real account and the duplicate as two identical
rows. One rule across the ecosystem (Canari's D56): a row whose folded name another shown row
shares carries the promo, then the formation, then the first 8 characters of `id_user`. The list
already shows every promo and formation, so `homonymIdHints` (`src/lib/admin-homonyms.ts`) adds the
id prefix to rows identical in name, promo AND formation.
