#!/usr/bin/env bash
# =================================================================================================
# MAY THIS RELEASE START?
#
# THREE QUESTIONS, in the order that makes a refusal cheapest to read:
#
#   1. Is the version a version?          - a typo must not become a deployed image tag
#   2. Is the released commit on `main`?  - everything downstream reads the trunk
#   3. Did the tests pass ON THAT COMMIT? - "if the tests are green" is otherwise written nowhere
#
# WHY THERE IS NO BYPASS INPUT. A skip flag is a fallback path, and reaching one means the primary
# path failed - so the fix belongs there. The emergency path is unchanged and is not in software: a
# human with admin rights acting by other means.
#
# WHY QUESTION 3 IS NOT "RUN THE TESTS AGAIN". They already ran on this commit, on the pull request
# and again on `main`. Running them a second time here is a SECOND OPINION about the same tree, and
# it is the opinion that ships - so a flake would decide a deployment, and a suite that changed
# since the merge would be judging code it was not written for. Reading the verdict that already
# exists is both cheaper and stricter.
#
# ARGUMENTS: none. It reads the environment:
#   REPO        owner/name
#   VERSION     the version being released, with or without a leading `v`
#   TARGET_SHA  the commit the release names
#   CHECK_NAME  the required check to look for (default: `CI passed`)
#   GH_TOKEN    a token that can read checks
#
# EXIT: 0 if every gate passed, 1 if any refused.
# =================================================================================================
set -uo pipefail

REPO="${REPO:?REPO is required}"
VERSION="${VERSION:?VERSION is required}"
TARGET_SHA="${TARGET_SHA:?TARGET_SHA is required}"
CHECK_NAME="${CHECK_NAME:-CI passed}"

FAILED=0
step() { printf '\n== %s\n' "$1"; }
ok() { printf '  OK      %s\n' "$1"; }
refuse() { FAILED=1; printf '  REFUSE  %s\n' "$1"; }
hint() { printf '          %s\n' "$1"; }

VERSION="${VERSION#v}"

# -- 1 -------------------------------------------------------------------------------------------
step 'the version is a version'
# `X.Y.Z` optionally followed by a pre-release suffix. The HYPHEN is the definition of a
# pre-release, exactly as it is in Canari - one rule, four repositories.
if [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  if [[ "$VERSION" == *-* ]]; then
    ok "$VERSION parses, and the hyphen makes it a PRE-RELEASE"
  else
    ok "$VERSION parses, and it is a STABLE release"
  fi
else
  refuse "'$VERSION' is not a version - expected X.Y.Z or X.Y.Z-suffix"
  hint 'The tag names what is deployed and what the image is labelled with, so a typo here'
  hint 'reaches production under a name nobody can find again.'
fi

# -- 2 -------------------------------------------------------------------------------------------
step 'the released commit is on main'
if ON_MAIN="$(gh api "repos/$REPO/compare/main...$TARGET_SHA" --jq '.status' 2>/dev/null)"; then
  case "$ON_MAIN" in
    identical | behind)
      ok "main contains ${TARGET_SHA:0:8} (compare says $ON_MAIN)"
      ;;
    *)
      refuse "main does not contain ${TARGET_SHA:0:8} - the compare says $ON_MAIN"
      hint 'A release is published from the trunk. Everything downstream reads main, so a tag'
      hint 'placed anywhere else deploys code that is not there.'
      ;;
  esac
else
  refuse 'could not compare the released commit against main'
  hint 'An absent measurement is not permission.'
fi

# -- 3 -------------------------------------------------------------------------------------------
step "the tests passed on that commit ($CHECK_NAME)"
# The check runs on the COMMIT, not on the pull request that carried it - so this reads the exact
# tree being deployed, whatever route it took to `main`.
if RUNS="$(gh api "repos/$REPO/commits/$TARGET_SHA/check-runs?per_page=100" \
  --jq ".check_runs[] | select(.name == \"$CHECK_NAME\") | \"\(.status) \(.conclusion)\"" 2>/dev/null)"; then
  if [ -z "$RUNS" ]; then
    refuse "no '$CHECK_NAME' check exists on ${TARGET_SHA:0:8}"
    hint 'That is not the same as a failure - it means nothing ever asked. Wait for the run on'
    hint 'main to finish, or find out why it never started, before deploying this.'
  elif grep -qv '^completed success$' <<<"$RUNS"; then
    refuse "'$CHECK_NAME' on ${TARGET_SHA:0:8} is not green: $(tr '\n' ';' <<<"$RUNS")"
    hint 'The commit being released has a red or unfinished suite. Fix the trunk first.'
  else
    ok "'$CHECK_NAME' is green on ${TARGET_SHA:0:8}"
  fi
else
  refuse "could not read the checks on ${TARGET_SHA:0:8}"
  hint 'An absent measurement is not permission.'
fi

printf '\n'
if [ "$FAILED" -ne 0 ]; then
  echo '::error::This release is refused. Every line above marked REFUSE has to be answered.'
  exit 1
fi
echo "This release may start: $VERSION at ${TARGET_SHA:0:8}."
