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
  (MiConnect on the School's shared server, Cloudflare in transit, a second server
  on the same LAN for backups), a legal basis per data item, the retentions, the
  rights, and the minimum age (15, the age at which a minor consents alone in
  France). Where a number comes from code it is that code's: logs 90 days
  (`LOG_RETENTION_DAYS`, `src/lib/server/logs.ts`), backups from
  `scripts/backup-offsite.sh` and `src/lib/server/backup.ts`, erasure from
  [photos-cv.md](photos-cv.md#erasure). When one of those changes, change the page
  and `TERMS_VERSION` in the same pull request.

What the page says about faces, and why it says it plainly: Immich groups EVERY
detected face into anonymous clusters, for members and non-members alike, and that
is accepted (internal, never shown). The page states it, offers objection by
e-mail, and says that withdrawing consent removes the link and the person's name
but not the anonymous cluster, which is deleted on request.

Two UI strings repeat these claims and must move with them:
`param_face_note_*` (what happens to the selfie) and `param_unlink_face_desc`
(what unlinking does).
