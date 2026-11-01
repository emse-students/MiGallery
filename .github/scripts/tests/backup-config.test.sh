#!/usr/bin/env bash
#
# Self-tests for `scripts/backup-config.sh`, the loader that tells the offsite backup and restore
# WHERE to go.
#
# WHAT IS ASSERTED. The destination comes from `backup.env` (written by the deploy from the
# repository secrets) or from the environment, never from a default in this repository. A missing
# file, an unknown key and an empty value each stop the script BEFORE any ssh or rsync; the
# environment wins over the file; the file is read, never executed; `faces.db` is never dumped or
# sent; and no private address is written in the scripts. A backup that silently goes nowhere, or somewhere else, is the failure
# this guards - and the 05:00 cron that would meet it is read by nobody.
#
# `ssh`, `rsync` and `sqlite3` are fakes on `PATH` that record their arguments, so nothing leaves the
# runner. Usage: .github/scripts/tests/backup-config.test.sh   (no arguments, no network)
set -uo pipefail

scripts=$(cd "$(dirname "$0")/../../../scripts" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/app/data" "$work/immich"
: >"$work/app/data/migallery.db"
: >"$work/immich/immich-db-backup-20260101T020000.sql.gz"
failures=0

for tool in ssh rsync; do
  cat >"$work/bin/$tool" <<FAKE
#!/usr/bin/env bash
echo "$tool \$*" >>"$work/calls"
exit 0
FAKE
  chmod +x "$work/bin/$tool"
done
# `sqlite3 DB ".backup 'OUT'"` writes OUT; the fake writes it empty, and records the database it
# was asked to dump in `$work/dumps` (kept apart from `$work/calls`, which the cases above read as
# "no ssh or rsync at all").
cat >"$work/bin/sqlite3" <<FAKE
#!/usr/bin/env bash
echo "sqlite3 \$1" >>"$work/dumps"
FAKE
cat >>"$work/bin/sqlite3" <<'FAKE'
out="${2#.backup \'}"; out="${out%\'}"
: >"$out"
FAKE
chmod +x "$work/bin/sqlite3"

# $1 what, $2 expected exit (0 or nonzero), $3 grep that must match the calls ('' = no call at all),
# $4 grep that must match the output, $5.. the command (env assignments first)
expect() {
  local what="$1" want="$2" calls_re="$3" out_re="$4"
  shift 4
  rm -f "$work/calls"
  local out got
  # `env -u` so a variable exported on the runner cannot answer for the file under test.
  out=$(env -u OFFSITE_HOST -u OFFSITE_PATH -u IMMICH_BACKUP_DIR \
    PATH="$work/bin:$PATH" MIGALLERY_DIR="$work/app" DEPLOY_DIR="$work/app" "$@" 2>&1)
  got=$?
  local ok=1
  if [ "$want" = 0 ] && [ "$got" -ne 0 ]; then ok=0; fi
  if [ "$want" != 0 ] && [ "$got" -eq 0 ]; then ok=0; fi
  if [ -z "$calls_re" ]; then
    [ -s "$work/calls" ] && ok=0
  else
    grep -qE "$calls_re" "$work/calls" 2>/dev/null || ok=0
  fi
  printf '%s\n' "$out" | grep -qE "$out_re" || ok=0
  if [ "$ok" = 1 ]; then
    echo "PASS $what"
  else
    echo "FAIL $what (exit $got)"
    printf '     %s\n' "$out"
    [ -f "$work/calls" ] && sed 's/^/     call: /' "$work/calls"
    failures=$((failures + 1))
  fi
}

missing="$work/no-such-backup.env"
good="$work/good.env"
printf 'OFFSITE_HOST=backup@offsite.example\nOFFSITE_PATH=mg-offsite\nIMMICH_BACKUP_DIR=%s\n' "$work/immich" >"$good"
typo="$work/typo.env"
printf 'OFFSITE_HOTS=backup@offsite.example\nIMMICH_BACKUP_DIR=%s\n' "$work/immich" >"$typo"
empty="$work/empty.env"
printf 'OFFSITE_HOST=\nIMMICH_BACKUP_DIR=%s\n' "$work/immich" >"$empty"
no_immich="$work/no-immich.env"
printf 'OFFSITE_HOST=backup@offsite.example\n' >"$no_immich"
# A value that WOULD run a command if the file were sourced - the `$(...)` is meant literally.
hostile="$work/hostile.env"
# shellcheck disable=SC2016
printf 'OFFSITE_HOST=backup@offsite.example\nOFFSITE_PATH=$(touch %s)\nIMMICH_BACKUP_DIR=%s\n' \
  "$work/executed" "$work/immich" >"$hostile"

expect 'backup with no backup.env stops before any ssh' 1 '' 'OFFSITE_HOST is not set' \
  BACKUP_ENV_FILE="$missing" bash "$scripts/backup-offsite.sh"
expect 'backup sends both dumps to the host the file names' 0 \
  'rsync .*immich-db-backup-.*backup@offsite\.example:mg-offsite/immich/' 'MiGallery offsite OK' \
  BACKUP_ENV_FILE="$good" bash "$scripts/backup-offsite.sh"
expect 'an unknown key is refused, not ignored' 1 '' "unknown key 'OFFSITE_HOTS'" \
  BACKUP_ENV_FILE="$typo" bash "$scripts/backup-offsite.sh"
expect 'an empty value is refused' 1 '' 'OFFSITE_HOST is not set' \
  BACKUP_ENV_FILE="$empty" bash "$scripts/backup-offsite.sh"
expect 'the Immich dump directory is required while the Immich dump is sent' 1 '' 'IMMICH_BACKUP_DIR is not set' \
  BACKUP_ENV_FILE="$no_immich" bash "$scripts/backup-offsite.sh"
expect 'and not when it is not' 0 'rsync .*backup@offsite\.example:migallery-offsite/migallery/' 'MiGallery offsite OK' \
  BACKUP_ENV_FILE="$no_immich" INCLUDE_IMMICH=0 bash "$scripts/backup-offsite.sh"
expect 'the environment wins over the file' 0 'rsync .*other@elsewhere\.example:' 'MiGallery offsite OK' \
  BACKUP_ENV_FILE="$good" OFFSITE_HOST=other@elsewhere.example bash "$scripts/backup-offsite.sh"
expect 'the environment alone suffices, with no file' 0 'rsync .*other@elsewhere\.example:' 'MiGallery offsite OK' \
  BACKUP_ENV_FILE="$missing" OFFSITE_HOST=other@elsewhere.example INCLUDE_IMMICH=0 bash "$scripts/backup-offsite.sh"
expect 'restore of the latest backup with no target stops before any ssh' 1 '' 'OFFSITE_HOST is not set' \
  BACKUP_ENV_FILE="$missing" bash "$scripts/restore-offsite.sh" --yes

rm -f "$work/executed"
expect 'the file is read, never executed' 0 'rsync ' 'MiGallery offsite OK' \
  BACKUP_ENV_FILE="$hostile" bash "$scripts/backup-offsite.sh"
if [ -e "$work/executed" ]; then
  echo "FAIL a value in backup.env was executed"
  failures=$((failures + 1))
else
  echo "PASS no value in backup.env was executed"
fi

# `faces.db` holds a print of EVERY face of the library, non-members included, and is deliberately
# in no backup (docs/wiki/face-matching-option-c.md, "Backups"): a lost file is recomputed from the
# photos. It sits next to `migallery.db`, so a backup that took the whole data directory, or dumped
# it by name, would carry it offsite. Neither the dump nor any ssh or rsync may name it.
: >"$work/app/data/faces.db"
rm -f "$work/dumps"
expect 'a full backup with faces.db present next to migallery.db' 0 'rsync ' 'MiGallery offsite OK' \
  BACKUP_ENV_FILE="$good" bash "$scripts/backup-offsite.sh"
if grep -q 'faces' "$work/calls" "$work/dumps" 2>/dev/null; then
  echo "FAIL faces.db is dumped or sent by the offsite backup"
  grep -h 'faces' "$work/calls" "$work/dumps" 2>/dev/null | sed 's/^/     /'
  failures=$((failures + 1))
elif ! grep -q 'migallery\.db' "$work/dumps" 2>/dev/null; then
  echo "FAIL the faces.db check saw no dump at all, so it proves nothing"
  failures=$((failures + 1))
else
  echo "PASS faces.db is never dumped or sent"
fi
rm -f "$work/app/data/faces.db"

# RFC 1918 ranges: the destination is operations data and lives in the secrets, never here.
if grep -nE '(^|[^0-9.])(10\.[0-9]+\.[0-9]+\.[0-9]+|192\.168\.[0-9]+\.[0-9]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+)' \
  "$scripts/backup-offsite.sh" "$scripts/restore-offsite.sh" "$scripts/backup-config.sh"; then
  echo "FAIL a private address is written in the offsite scripts"
  failures=$((failures + 1))
else
  echo "PASS no private address in the offsite scripts"
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures FAILURE(S)"
  exit 1
fi
echo "backup config: all cases pass"
