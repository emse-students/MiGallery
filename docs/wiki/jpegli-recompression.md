# Server-side JPEGLI recompression of the Immich library

Photos reach Immich in two shapes: already compressed by the uploader (JPEGLI q80)
or straight from a camera. The gallery treats them the same, so every JPEG is
recompressed to JPEGLI q80 **after upload**, on the Immich host, by a script that
swaps the file in place. Video, HEIC and PNG are out of scope (a swap would change
the format). First full pass: 2026-11-01 to 2026-11-02.

## Why in place, and not through the Immich API

Immich v3 has no `PUT /assets/{id}/original`; its replacement, `PUT /assets/copy`,
creates a NEW asset id. MiGallery stores Immich asset ids (profile photos, album
covers, favourites, face matches), so a new id breaks all of them. The swap keeps the
id, the path, the albums and the faces, and rewrites only two database values: the
asset `checksum` and the exif `fileSizeInByte`. Faces v2 embeds once per asset from
Immich's PREVIEW, which the swap does not regenerate, so faces are untouched.

## The "already compressed" marker

Name and origin say nothing. The reliable marker is the SHA-1 of the file's DQT
(quantisation table) segments: JPEGLI q80 always writes the same tables (4:2:0). It
is read from the first 256 KB, needs no database flag, and makes every run idempotent
(a replayed album is 100 % `skip_already_q80`).

## Guard rails (any failure leaves the original in place)

Lock (`flock`); Immich image version and column names asserted; disk SHA-1 equal to
the database checksum; same dimensions and orientation; Exif APP1 identical byte for
byte, XMP kept; new file strictly smaller; original copied to a quarantine outside the
library (30 days, then purged); atomic `os.replace`; ONE database block that must hit
exactly one row per table, otherwise the file is restored. A CSV ledger is written per
run and `--undo <ledger>` restores files and database. No `refresh-metadata`: it would
drop the dates of files with no Exif.

## Operating it

- A one-off service ran the whole library (`--all`, heaviest bytes-per-pixel first,
  `nice 19` and idle I/O).
- A nightly cron (03:00) handles the last 3 days of uploads, older than one hour;
  a second one (04:30) purges the quarantine.
- A `PAUSE` file in the quarantine directory holds the run between two assets. Any
  heavy job on the same Postgres (a face purge, a vacuum, a RAID resync) creates it
  first and removes it after.

## Configuration (kept outside the repository)

The script commits no host detail. The two host paths have no default and the run aborts
without them: `JPEGLI_SWAP_ROOT_ON_HOST` (the Immich library on the host) and
`JPEGLI_SWAP_QUARANTINE`. Optional: `JPEGLI_SWAP_API_KEY_CONTAINER` (the container whose
environment holds an admin Immich API key, needed only for the integrity refresh),
`JPEGLI_SWAP_NCONVERT`, `JPEGLI_SWAP_IMMICH_IMAGE`, `JPEGLI_SWAP_POSTGRES_CONTAINER`,
`JPEGLI_SWAP_IMMICH_CONTAINER`, `JPEGLI_SWAP_JOBS_URL`. They are read from the environment
or from the `KEY=VALUE` file named by `JPEGLI_SWAP_ENV`, which lives on the host and is
never committed; the real environment wins over the file.

## Result of the first pass

172 285 images read: 30 795 swapped (80.1 GB to 51.0 GB, 29.1 GB saved), 140 587
already q80, 2 with no gain, 901 refused for a checksum mismatch (since resolved, see below). 0 rollbacks, 0 failed
checks. Load stayed near 2 on 4 vCPU.

## The 901 refusals: a file rewritten behind Immich's back

All 901 are one upload batch from 2026-09-13. Immich recorded their checksum and size
at upload; about nine hours later every one of them was rewritten on disk within five
minutes (inode change time, file modification time preserved). The disk file is larger
than the recorded size by 186 bytes for most (up to 3 245), and the one inspected
carries a GPS-only Exif block: a tool outside Immich injected geolocation into the
originals. Immich does not write its originals, so the database was never told (only 15
of the 901 have a latitude in the database). The writer was not identified.

- The images are intact: all 901 decode, and 30 sampled against Immich's preview differ
  by 0.24 out of 255 on average.
- Immich's own integrity job reported exactly these 901 as `checksum_mismatch`
  (since 2026-09-15). The population was frozen: one change-time hour, one upload day.
- The script refuses them on purpose (disk SHA-1 differs from the database).

**Resolution, decided by the owner on 2026-11-02 and done the same night**: re-baseline,
then recompress.

1. The 901 ids (an allowlist file, never a predicate re-evaluated at write time) and
   their old checksum and size were saved to a restorable SQL file first.
2. Preconditions checked per file: still a mismatch, larger than recorded, valid JPEG,
   untouched since the diagnosed rewrite.
3. ONE transaction set `asset.checksum` and `asset_exif.fileSizeInByte` from the disk
   file, each update asserted to hit exactly one row. Verified afterwards: 901 of 901
   rows equal the disk.
4. The normal swap then ran on the same allowlist (`--ids-file`, a dry run first):
   901 swapped, 0 refused, 1.16 GB to 1.09 GB (these files were already progressive
   JPEGLI, so the gain is small; the point was to end the difference).
5. Immich's integrity report kept its 901 `checksum_mismatch` rows after the
   re-baseline: a report is only deleted by the "refresh" form of the checksum job
   (`integrity-checksum-mismatch-refresh`, `POST /api/jobs`, admin), which re-reads
   existing reports only. It was triggered once by hand, found 901 of 901 reports out of
   date and deleted them; the report then held only the 16 298 known `untracked_file`
   rows, and no new anomaly.

**Gap found, and closed by the owner's decision of 2026-11-02**: Immich's integrity jobs
DO run on their own (checksum job daily at 03:00 with a one-hour limit, missing and
untracked files nightly), but they only create reports and scan forward from a cursor;
nothing schedules the refresh that clears a report after its cause is fixed. So the swap
script ends every REAL run that swapped at least one asset by queueing that refresh
(`trigger_integrity_refresh`, MiGallery's own Immich API key read from its container). A
run with zero swaps and any dry run make no call (pinned by `tests/jpegli-swap.test.ts`,
which runs `scripts/server/test_jpegli_swap.py`, `main()`'s wiring included). A failed call
is logged at ERROR, makes the run exit 1 and leaves a durable `REFRESH_OWED` mark in the
quarantine directory: the next run, whatever its swap count, queues the refresh again and
clears the mark on success (no timer). The refresh also runs when a crash or a stop
interrupts a run, on the swaps done so far. `--refresh-integrity` queues it alone, for a
re-baseline done outside the script.

## Rule for any future bulk write to originals

Any tool that writes originals re-baselines, then triggers the refresh. It must update
`asset.checksum` and `asset_exif.fileSizeInByte` from the file it wrote (or go through
Immich), otherwise the integrity report fills up and a swap like this one refuses the
asset; and once the database is right it queues the integrity refresh
(`jpegli_swap.py --refresh-integrity`), otherwise the stale reports stay.
