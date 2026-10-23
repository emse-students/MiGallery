#!/usr/bin/env bash
#
# Self-tests for the offsite target of `scripts/backup-offsite.sh` and `scripts/restore-offsite.sh`.
#
# WHAT IS ASSERTED. The destination comes from the HOST file (`MIGALLERY_OFFSITE_ENV`) or the
# environment, never from a default in the repository; with neither, both scripts stop BEFORE any
# ssh or rsync and name the file to write. Moving the backups to another server is then a host
# setting (WP-MIGALLERY-OFFSITE), and no private address has to live in this public tree.
#
# `ssh`, `rsync` and `sqlite3` are fakes on `PATH` that record their arguments, so nothing leaves the
# runner. Usage: .github/scripts/tests/offsite-target.test.sh   (no arguments, no network)
set -uo pipefail

scripts=$(cd "$(dirname "$0")/../../../scripts" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/app/data"
: >"$work/app/data/migallery.db"
failures=0

for tool in ssh rsync; do
  cat >"$work/bin/$tool" <<FAKE
#!/usr/bin/env bash
echo "$tool \$*" >>"$work/calls"
exit 0
FAKE
  chmod +x "$work/bin/$tool"
done
# `sqlite3 DB ".backup 'OUT'"` writes OUT; the fake writes it empty.
cat >"$work/bin/sqlite3" <<'FAKE'
#!/usr/bin/env bash
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
  out=$(env PATH="$work/bin:$PATH" MIGALLERY_DIR="$work/app" INCLUDE_IMMICH=0 "$@" 2>&1)
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

missing="$work/no-such-offsite.env"
hostfile="$work/offsite.env"
printf 'OFFSITE_HOST=backup@offsite.example\nOFFSITE_PATH=migallery-offsite\n' >"$hostfile"

expect 'backup with no target stops before any ssh, naming the file' 1 '' "$missing" \
  MIGALLERY_OFFSITE_ENV="$missing" OFFSITE_HOST= OFFSITE_PATH= bash "$scripts/backup-offsite.sh"
expect 'backup sends to the host the file names' 0 'rsync .*backup@offsite\.example:migallery-offsite/migallery/' 'MiGallery offsite OK' \
  MIGALLERY_OFFSITE_ENV="$hostfile" OFFSITE_HOST= OFFSITE_PATH= bash "$scripts/backup-offsite.sh"
expect 'the environment wins over the file' 0 'rsync .*other@elsewhere\.example:' 'from the environment' \
  MIGALLERY_OFFSITE_ENV="$hostfile" OFFSITE_HOST=other@elsewhere.example OFFSITE_PATH= bash "$scripts/backup-offsite.sh"
expect 'restore of the latest backup with no target stops before any ssh' 1 '' "$missing" \
  MIGALLERY_OFFSITE_ENV="$missing" OFFSITE_HOST= OFFSITE_PATH= DEPLOY_DIR="$work/app" bash "$scripts/restore-offsite.sh" --yes
if grep -nE '10\.[0-9]+\.[0-9]+\.[0-9]+' "$scripts/backup-offsite.sh" "$scripts/restore-offsite.sh" "$scripts/offsite-target.sh"; then
  echo "FAIL a private address is written in the offsite scripts"
  failures=$((failures + 1))
else
  echo "PASS no private address in the offsite scripts"
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures FAILURE(S)"
  exit 1
fi
echo "offsite target: all cases pass"
