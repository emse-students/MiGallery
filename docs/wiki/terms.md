# Terms of use (`/cgu`)

The page is `src/routes/cgu/+page.svelte`; its text is the `cgu_*` messages of
`messages/{fr,en}.json` (Paraglide, trusted inline HTML). Two things about it are
rules, not prose:

- **The version is one value**, `TERMS_VERSION` in `src/lib/legal.ts` (an ISO
  date). The page shows it as "Version of <date>" - it used to show today's date,
  which dated every visit and meant nothing. The server writes the same value into
  `face_consents.version` ([photos-cv.md](photos-cv.md#consent-record)) when a
  member consents. **Change it, and only it, when the terms change in substance.**
- **Every claim on the page must be one the repository can back.** The page names
  the controller (the association MiTV, `bureau@mitv.fr`), the recipients
  (Cloudflare in transit, the Canari project's server on the same LAN for the backups
  `scripts/backup-offsite.sh` sends to `OFFSITE_HOST`; MiConnect is described only as a separate
  service with its own terms, because nothing in this repository says where it runs), who else
  reads face-linked sets (administrators and admin-issued API keys), what is public (unlisted
  albums by link, album cover images), a legal basis per data item, the retentions, the
  rights, and the minimum age (15, the age at which a minor consents alone in
  France). Where a number comes from code it is that code's: logs 90 days
  (`LOG_RETENTION_DAYS`, `src/lib/server/logs.ts`), backups from
  `scripts/backup-offsite.sh` and `src/lib/server/backup.ts`, erasure from
  [photos-cv.md](photos-cv.md#erasure). When one of those changes, change the page
  and `TERMS_VERSION` in the same pull request.

What the page says about faces (section 4), and why it says it plainly: MiGallery keeps
an encrypted print of EVERY detected face of the library, members and non-members
alike, in no backup and grouped by no person (the face store,
[face-matching-option-c.md](face-matching-option-c.md)). A face is tied to someone only
by comparison with the references of a member who agreed. The page states it, offers
objection by e-mail to anyone in a photo, and says that withdrawing consent erases the
member's references, matches, answers and crops at once (`cgu_s4_store`,
`cgu_s4_match`, `cgu_s4_revoke_body`).

**Immich no longer groups faces.** Until 2026-11-01 it clustered every face into
anonymous groups that a member linked to their account. At the cutover (lot A8) its
recognition was switched off and its faces, groups and prints were deleted, after an
encrypted copy kept until 2026-12-01; the nightly Immich backups taken before hold
them until 2026-11-09 (offsite) and 2026-11-15 (Immich's own). `cgu_s4_cutover` and
`cgu_s5_backups_body` state those dates; they are facts about the past, so they move
only if the record in [face-matching-option-c.md](face-matching-option-c.md) (section 5)
is corrected.

UI strings repeat these claims and must move with them: `param_face_note_*` (what
happens to the selfie) and `param_unlink_face_desc` (what unlinking does).

**What the page must NOT assert** because the repository cannot back it: where the server
physically stands, and who administers MiConnect's host. The association's postal address appears as
the controller's address only. The consent origins are three (`selfie`, `admin`, `legacy`): the page
must not say every link is the member's own selfie. The log scrub covers the member's id as actor,
as target and inside `details`, and the IP of the rows they acted in - no more.
