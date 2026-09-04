#!/usr/bin/env bash
#
# Self-tests for `release-preflight.sh`, the three gates a release cannot be talked out of.
#
# THEY RUN WITHOUT A NETWORK. `gh` is a fake on `PATH` that answers from the environment, so every
# gate is asserted on both sides of its decision - which is the only way a gate is known to be able
# to REFUSE, as opposed to known to be able to pass.
#
# Usage: .github/scripts/tests/release-preflight.test.sh   (no arguments, no network)
set -uo pipefail

script=$(cd "$(dirname "$0")/.." && pwd)/release-preflight.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
failures=0

# The fake `gh`. `compare` answers with $FAKE_COMPARE, `check-runs` with $FAKE_CHECKS, and either
# answers with a non-zero status when its variable is the literal `ERROR` - which is how the
# "an absent measurement is not permission" branches are reached.
cat >"$work/bin/gh" <<'FAKE'
#!/usr/bin/env bash
case "$*" in
  *compare*)
    [ "$FAKE_COMPARE" = ERROR ] && exit 1
    printf '%s\n' "$FAKE_COMPARE" ;;
  *check-runs*)
    [ "$FAKE_CHECKS" = ERROR ] && exit 1
    [ -n "$FAKE_CHECKS" ] && printf '%s\n' "$FAKE_CHECKS" ;;
esac
exit 0
FAKE
chmod +x "$work/bin/gh"

# $1 what it is, $2 expected exit, $3 version, $4 compare status, $5 check-run lines
expect() {
  local what="$1" want="$2" version="$3" compare="$4" checks="$5" got out
  out=$(PATH="$work/bin:$PATH" REPO='o/r' VERSION="$version" TARGET_SHA='abc1234def' \
    FAKE_COMPARE="$compare" FAKE_CHECKS="$checks" bash "$script" 2>&1)
  got=$?
  if [ "$got" -eq "$want" ]; then
    echo "PASS $what"
  else
    echo "FAIL $what: expected exit $want, got $got"
    echo "     ${out//$'\n'/$'\n'     }"
    failures=$((failures + 1))
  fi
}

GREEN='completed success'

echo "=== a release that may start ==="
expect 'a stable on main with a green suite' 0 '1.2.3' 'behind' "$GREEN"
expect 'a pre-release is equally acceptable here' 0 '1.2.3-alpha.1' 'behind' "$GREEN"
expect 'the leading v is optional' 0 'v1.2.3' 'identical' "$GREEN"

echo "=== gate 1, the version ==="
expect 'a typo is refused' 1 '1.2' 'behind' "$GREEN"
expect 'a word is refused' 1 'latest' 'behind' "$GREEN"
expect 'a four-part version is refused' 1 '1.2.3.4' 'behind' "$GREEN"

echo "=== gate 2, the trunk ==="
expect 'a commit main does not contain is refused' 1 '1.2.3' 'diverged' "$GREEN"
expect 'a commit AHEAD of main is refused' 1 '1.2.3' 'ahead' "$GREEN"
expect 'a compare that cannot be read is refused' 1 '1.2.3' 'ERROR' "$GREEN"

echo "=== gate 3, the suite ==="
expect 'a red suite is refused' 1 '1.2.3' 'behind' 'completed failure'
expect 'an UNFINISHED suite is refused' 1 '1.2.3' 'behind' 'in_progress '
expect 'NO check at all is refused - an absence is not a pass' 1 '1.2.3' 'behind' ''
expect 'checks that cannot be read are refused' 1 '1.2.3' 'behind' 'ERROR'
# Two check-runs under one name happen on a re-run, and BOTH have to be green: taking the first
# would let a re-run that failed ship behind a stale success.
expect 'two runs of the check, one of them red, is refused' 1 '1.2.3' 'behind' \
  "$GREEN
completed failure"

echo
if [ "$failures" -gt 0 ]; then
  echo "$failures assertion(s) failed."
  exit 1
fi
echo 'release-preflight.sh: every assertion passed.'
