#!/usr/bin/env python3
"""In-place JPEGLI q80 recompression of Immich originals on `mitv`.

Replaces each original file IN PLACE (same asset id, same path) so that every
reference to the asset survives: Immich albums, faces and dates, and the asset ids
MiGallery stores (profile photo, album covers, favourites, faces v2 matches).
Immich v3.3.3 has no API to replace an original (`PUT /assets/{id}/original` is
gone; `PUT /assets/copy` mints a new id), so the only database write is the
checksum and the file size, in one transaction, guarded by a schema assertion
that makes the script abort if Immich changes underneath it.

"Already compressed" is decided by the JPEG quantisation tables (DQT): nconvert
`-out jpegli -q 80` always writes the same tables, whatever the build (Windows
v7.301 and Linux v7.300 both give fingerprint b5e89ed5c7). The criterion is the
bytes, never the file name or the uploader.

Each original is copied to the quarantine before the swap; `--undo LEDGER`
restores from it until `--purge-days` deletes it. A `PAUSE` file in the
quarantine directory holds the run between two assets (the MiGallery sessions
touch it during their own heavy runs). Usage (always under nice/ionice):
    jpegli_swap.py --album <uuid> [--dry-run]      one album (the prototype)
    jpegli_swap.py --all [--dry-run]                the backlog, heaviest bytes-per-pixel first
    jpegli_swap.py --recent-days 3 --min-age-minutes 60   the nightly cron
    jpegli_swap.py --ids-file <file> [--dry-run]    an allowlist of asset ids, one UUID per line
    jpegli_swap.py --purge-days 30                  drop quarantine days older than that
    jpegli_swap.py --undo <ledger.csv>
    jpegli_swap.py --refresh-integrity              only queue Immich's integrity refresh (after a re-baseline)

A real run that swapped at least one asset ends by queueing Immich's integrity
"refresh" job, the only thing that deletes a `checksum_mismatch` report once its
cause is fixed (nothing schedules it). A failure there is logged at ERROR and makes
the run exit 1; a run with zero swaps and any dry run make no call.
"""
import argparse, csv, datetime, fcntl, hashlib, json, os, re, shutil, struct, subprocess, sys, time, urllib.request

ROOT_IN_CONTAINER = "/usr/src/app/upload"
ROOT_ON_HOST = "/srv/dev-disk-by-uuid-ff73ed20-08b7-4b38-b53c-6de6a86bfd6a/immich-app/library"
QUARANTINE = "/srv/dev-disk-by-uuid-ff73ed20-08b7-4b38-b53c-6de6a86bfd6a/jpegli-quarantine"
NCONVERT = os.path.expanduser("~/jpegli-swap/NConvert/nconvert.sh")
EXPECTED_IMMICH = "ghcr.io/immich-app/immich-server:v3.3.3"
TARGET_DQT = {"b5e89ed5c7"}
LEDGER_FIELDS = ["at", "asset_id", "path", "status", "old_sha1", "new_sha1", "old_size", "new_size", "quarantine", "detail"]


INTEGRITY_REFRESH_JOB = "integrity-checksum-mismatch-refresh"
IMMICH_JOBS_URL = "http://localhost:2283/api/jobs"
API_KEY_CONTAINER = "migallery-migallery-1"


def log(msg):
    print(f"{datetime.datetime.now():%H:%M:%S} {msg}", flush=True)


def log_error(msg):
    print(f"{datetime.datetime.now():%H:%M:%S} ERROR {msg}", file=sys.stderr, flush=True)


def trigger_integrity_refresh():
    """Queue Immich's integrity refresh (re-reads existing reports only, deletes the ones now out of date).

    Uses MiGallery's own Immich API key, read from its container. Returns False after logging at ERROR
    on any failure: the swaps are already committed, so this never raises.
    """
    try:
        key = subprocess.run(["docker", "exec", API_KEY_CONTAINER, "printenv", "IMMICH_API_KEY"],
                             capture_output=True, text=True, check=True).stdout.strip()
        if not key:
            raise RuntimeError("IMMICH_API_KEY is empty in the MiGallery container")
        req = urllib.request.Request(IMMICH_JOBS_URL, data=json.dumps({"name": INTEGRITY_REFRESH_JOB}).encode(),
                                     headers={"x-api-key": key, "Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status != 204:
                raise RuntimeError(f"HTTP {resp.status}")
    except Exception as e:  # noqa: BLE001 - every cause is reported the same way
        log_error(f"integrity refresh NOT queued, stale checksum_mismatch reports will stay: {e}")
        return False
    log(f"integrity refresh queued ({INTEGRITY_REFRESH_JOB})")
    return True


def refresh_after_run(counts, dry_run, trigger=trigger_integrity_refresh):
    """Queue the integrity refresh iff a real run swapped something. Returns False only when a needed call failed."""
    if dry_run or counts.get("swapped", 0) == 0:
        return True
    return trigger()


def psql(sql):
    """Run SQL in immich_postgres; raises on any SQL error (ON_ERROR_STOP)."""
    p = subprocess.run(["docker", "exec", "-i", "immich_postgres", "psql", "-U", "postgres", "-d", "immich",
                        "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t"], input=sql, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"psql failed: {p.stderr.strip()}")
    return [line.split("\t") for line in p.stdout.splitlines() if line]


def preflight():
    """Abort unless the Immich image and the columns this script writes are exactly the ones it was written for."""
    image = subprocess.run(["docker", "inspect", "immich_server", "--format", "{{.Config.Image}}"],
                           capture_output=True, text=True).stdout.strip()
    if image != EXPECTED_IMMICH:
        sys.exit(f"ABORT: immich_server is {image!r}, script validated on {EXPECTED_IMMICH!r}")
    cols = {tuple(r) for r in psql("""SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema='public' AND ((table_name='asset' AND column_name IN ('checksum','checksumAlgorithm','originalPath'))
        OR (table_name='asset_exif' AND column_name='fileSizeInByte'));""")}
    need = {("asset", "checksum", "bytea"), ("asset", "originalPath", "character varying"),
            ("asset_exif", "fileSizeInByte", "bigint"), ("asset", "checksumAlgorithm", "USER-DEFINED")}
    if not need <= cols:
        sys.exit(f"ABORT: schema changed, missing {need - cols}")


def segments(data):
    """JPEG header walk: DQT payloads, SOF (marker, w, h, sampling), Exif APP1 payload, XMP presence."""
    i, dqt, sof, exif, xmp = 2, [], None, None, False
    if data[:2] != b"\xff\xd8":
        return None
    while i + 4 <= len(data) and data[i] == 0xFF:
        m = data[i + 1]
        if m == 0xDA:
            break
        ln = struct.unpack(">H", data[i + 2:i + 4])[0]
        seg = data[i + 4:i + 2 + ln]
        if m == 0xDB:
            dqt.append(seg)
        elif m in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", seg[1:5])
            sof = (m, w, h, tuple(seg[6 + 3 * c + 1] for c in range(seg[5])))
        elif m == 0xE1 and seg[:6] == b"Exif\x00\x00":
            exif = seg
        elif m == 0xE1 and seg[:4] == b"http":
            xmp = True
        i += 2 + ln
    return {"dqt": hashlib.sha1(b"".join(dqt)).hexdigest()[:10], "sof": sof, "exif": exif, "xmp": xmp}


def ledger_writer(path):
    new = not os.path.exists(path)
    f = open(path, "a", newline="", encoding="utf-8")
    w = csv.DictWriter(f, LEDGER_FIELDS)
    if new:
        w.writeheader()
    return f, w


def swap_one(row, args, w):
    asset_id, cpath, old_hex, db_w, db_h = row
    path = cpath.replace(ROOT_IN_CONTAINER, ROOT_ON_HOST, 1)
    rec = {"at": datetime.datetime.now().isoformat(timespec="seconds"), "asset_id": asset_id, "path": path, "old_sha1": old_hex}

    def done(status, detail=""):
        rec.update(status=status, detail=detail)
        w.writerow(rec)
        return status

    try:
        with open(path, "rb") as fh:
            head = segments(fh.read(256 * 1024))
            if head and head["sof"] and head["dqt"] in TARGET_DQT:
                return done("skip_already_q80")
            fh.seek(0)
            data = fh.read()
    except OSError as e:
        return done("skip_unreadable", str(e))
    rec["old_size"] = len(data)
    if hashlib.sha1(data).hexdigest() != old_hex:
        return done("skip_checksum_mismatch", "file on disk is not the one Immich recorded")
    src = segments(data)
    if not src or not src["sof"]:
        return done("skip_not_parsable_jpeg")
    if src["dqt"] in TARGET_DQT:
        return done("skip_already_q80")
    tmp = os.path.join(QUARANTINE, "tmp", f"{asset_id}.jpg")
    p = subprocess.run([NCONVERT, "-quiet", "-no#", "-noholder", "-out", "jpegli", "-q", "80", "-overwrite", "-o", tmp, path],
                       capture_output=True, text=True)
    if p.returncode != 0 or not os.path.exists(tmp):
        return done("skip_encoder_failed", (p.stdout + p.stderr)[-300:])
    new = open(tmp, "rb").read()
    out = segments(new)
    checks = {
        "dims": out and out["sof"] and out["sof"][1:3] == src["sof"][1:3],
        "dims_db": (not db_w or not db_h) or {int(db_w), int(db_h)} == set(src["sof"][1:3]),
        "exif_identical": out and out["exif"] == src["exif"],
        "xmp_kept": out and out["xmp"] == src["xmp"],
        "smaller": len(new) < len(data),
    }
    failed = [k for k, ok in checks.items() if not ok]
    if failed:
        os.remove(tmp)
        return done("skip_check_failed" if failed != ["smaller"] else "skip_no_gain", ",".join(failed))
    new_hex = hashlib.sha1(new).hexdigest()
    rec.update(new_sha1=new_hex, new_size=len(new))
    if args.dry_run:
        os.remove(tmp)
        return done("dry_run_ok")

    qdir = os.path.join(QUARANTINE, datetime.date.today().isoformat())
    os.makedirs(qdir, exist_ok=True)
    qpath = os.path.join(qdir, f"{asset_id}.jpg")
    shutil.copy2(path, qpath)
    rec["quarantine"] = qpath
    st = os.stat(path)
    os.chown(tmp, st.st_uid, st.st_gid)
    os.chmod(tmp, st.st_mode & 0o7777)
    os.utime(tmp, ns=(st.st_atime_ns, st.st_mtime_ns))
    os.replace(tmp, path)
    try:
        psql(f"""DO $$ DECLARE n int; BEGIN
            UPDATE asset SET checksum = decode('{new_hex}','hex') WHERE id = '{asset_id}' AND checksum = decode('{old_hex}','hex');
            GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'asset rows %', n; END IF;
            UPDATE asset_exif SET "fileSizeInByte" = {len(new)} WHERE "assetId" = '{asset_id}';
            GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'exif rows %', n; END IF;
        END $$;""")
    except RuntimeError as e:
        shutil.copy2(qpath, path)
        os.chown(path, st.st_uid, st.st_gid)
        return done("rolled_back", str(e)[-300:])
    return done("swapped")


def undo(ledger):
    """Restore every swapped asset of a ledger from its quarantine copy, and its checksum and size."""
    for r in csv.DictReader(open(ledger, encoding="utf-8")):
        if r["status"] != "swapped":
            continue
        st = os.stat(r["path"])
        shutil.copy2(r["quarantine"], r["path"])
        os.chown(r["path"], st.st_uid, st.st_gid)
        psql(f"""UPDATE asset SET checksum = decode('{r['old_sha1']}','hex') WHERE id = '{r['asset_id']}';
                 UPDATE asset_exif SET "fileSizeInByte" = {r['old_size']} WHERE "assetId" = '{r['asset_id']}';""")
        log(f"restored {r['asset_id']}")


def purge(days):
    """Delete quarantine day directories older than `days`; their ledgers stay (they are the history)."""
    limit = datetime.date.today() - datetime.timedelta(days=days)
    for name in sorted(os.listdir(QUARANTINE)):
        try:
            day = datetime.date.fromisoformat(name)
        except ValueError:
            continue
        if day < limit:
            shutil.rmtree(os.path.join(QUARANTINE, name))
            log(f"purged quarantine {name}")


def wait_while_paused():
    pause = os.path.join(QUARANTINE, "PAUSE")
    if os.path.exists(pause):
        log("PAUSE file present, holding")
        while os.path.exists(pause):
            time.sleep(30)
        log("PAUSE removed, resuming")


def main():
    ap = argparse.ArgumentParser()
    sel = ap.add_mutually_exclusive_group(required=True)
    sel.add_argument("--album")
    sel.add_argument("--all", action="store_true")
    sel.add_argument("--recent-days", type=int)
    sel.add_argument("--ids-file")
    sel.add_argument("--purge-days", type=int)
    sel.add_argument("--undo")
    sel.add_argument("--refresh-integrity", action="store_true")
    ap.add_argument("--min-age-minutes", type=int, default=60)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    os.makedirs(os.path.join(QUARANTINE, "tmp"), exist_ok=True)
    lock = open(os.path.join(QUARANTINE, ".lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit("ABORT: another jpegli_swap run holds the lock")
    if args.purge_days:
        return purge(args.purge_days)
    if args.refresh_integrity:
        sys.exit(0 if trigger_integrity_refresh() else 1)
    preflight()
    if args.undo:
        return undo(args.undo)
    base = """SELECT a.id, a."originalPath", encode(a.checksum,'hex'), a.width, a.height
        FROM asset a JOIN asset_exif e ON e."assetId" = a.id
        WHERE a."deletedAt" IS NULL AND a.type = 'IMAGE' AND lower(a."originalPath") ~ '\\.jpe?g$'"""
    if args.album:
        rows = psql(base + f""" AND a.id IN (SELECT "assetId" FROM album_asset WHERE "albumId" = '{args.album}') ORDER BY a.id;""")
    elif args.ids_file:
        ids = [l.strip() for l in open(args.ids_file) if l.strip()]
        bad = [i for i in ids if not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", i)]
        if bad:
            sys.exit(f"ABORT: {len(bad)} entries of {args.ids_file} are not UUIDs")
        quoted = ",".join(f"'{i}'" for i in ids)
        rows = psql(base + f""" AND a.id IN ({quoted}) ORDER BY a.id;""")
    elif args.all:
        rows = psql(base + """ ORDER BY e."fileSizeInByte"::float8 / greatest(coalesce(a.width, 1) * coalesce(a.height, 1), 1) DESC, a.id;""")
    else:
        rows = psql(base + f""" AND a."createdAt" > now() - interval '{args.recent_days} days'
            AND a."createdAt" < now() - interval '{args.min_age_minutes} minutes' ORDER BY a."createdAt";""")
    ledger = os.path.join(QUARANTINE, f"ledger-{datetime.datetime.now():%Y%m%d-%H%M%S}{'-dry' if args.dry_run else ''}.csv")
    f, w = ledger_writer(ledger)
    counts = {}
    log(f"{len(rows)} assets, ledger {ledger}")
    for i, row in enumerate(rows, 1):
        wait_while_paused()
        s = swap_one(row, args, w)
        f.flush()
        counts[s] = counts.get(s, 0) + 1
        if i % 500 == 0:
            log(f"{i}/{len(rows)} {counts}")
    log(f"done {counts}")
    if not refresh_after_run(counts, args.dry_run):
        sys.exit(1)


if __name__ == "__main__":
    main()
