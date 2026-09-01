#!/usr/bin/env bash
#
# Decides, for ONE Dependabot pull request, whether this repository has a gate that would see the
# update fail - and merges it when the whole check suite is green.
#
# IT IS A SCRIPT RATHER THAN INLINE YAML BECAUSE IT HAS TWO CALLERS, and they exist for different
# reasons. `dependabot-auto-merge.yml` runs it on a CI completion, which is the fast path, and again
# on a schedule, which is the only path that CONVERGES: a pull request whose checks finished before
# this workflow existed - or while it was disabled, or during a runner outage - will never receive
# another `workflow_run`. An automation that can only act on an event it happened to catch is not
# one that runs on its own.
#
# FAIL-CLOSED ON THE AUTHOR, HERE rather than in either caller: a guard written once in the place
# that does the merging cannot be bypassed by adding a third trigger later.
#
# Usage: dependabot-auto-merge.sh <pr-number>
# Prints `MERGED <pr>` on stdout when it merged, so the caller can dispatch ONE deploy for a sweep
# that merged several. Never exits non-zero for a pull request it declines to touch: a sweep must
# not be stopped by one unmergeable branch.
set -uo pipefail

pr="${1:?usage: dependabot-auto-merge.sh <pr-number>}"
: "${REPO:?REPO must be set}"
: "${GH_TOKEN:?GH_TOKEN must be set}"

# The staleness predicate lives beside this script so it can be exercised on inputs GitHub will
# not produce on demand; see `lib/gate-moves.sh` and its self-tests.
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/gate-moves.sh
. "$(dirname "$0")/lib/gate-moves.sh"

MARKER='<!-- migallery-auto-merge-ceiling -->'

meta=$(gh pr view "$pr" --repo "$REPO" --json author,state,headRefOid,mergeable \
         --jq '"\(.author.login)|\(.state)|\(.headRefOid)|\(.mergeable)"') || {
  echo "#$pr: could not be read; skipping."
  exit 0
}

IFS='|' read -r author state head_sha mergeable <<< "$meta"

if [ "$author" != "app/dependabot" ] && [ "$author" != "dependabot[bot]" ]; then
  echo "#$pr: author is '$author', not Dependabot; refusing."
  exit 0
fi
if [ "$state" != "OPEN" ]; then
  echo "#$pr: state is $state; nothing to do."
  exit 0
fi

echo "#$pr: head=$head_sha mergeable=$mergeable"

# -----------------------------------------------------------------------------------------------
# THE CEILING
# -----------------------------------------------------------------------------------------------
# Dependabot writes one `updated-dependencies` block per dependency into the commit message, with
# typed fields. A grouped PR carries several, and EVERY one has to pass. The blocks are read AS
# BLOCKS rather than as three independent `sed` lists: an update Dependabot could not classify
# carries no `update-type` at all, and three lists pasted side by side would then pair the wrong
# name with the wrong version, silently.
message=$(gh api "repos/$REPO/commits/$head_sha" --jq '.commit.message') || {
  echo "#$pr: could not read its head commit; skipping."
  exit 0
}

parsed=$(awk '
  /^ *- dependency-name:/ {
    if (name != "") print name "|" type "|" version
    name = $0; sub(/^ *- dependency-name: */, "", name); type = ""; version = ""
    next
  }
  /^ *dependency-version:/ { version = $0; sub(/^ *dependency-version: */, "", version) }
  /^ *update-type:/ { type = $0; sub(/^ *update-type: *version-update:semver-/, "", type) }
  END { if (name != "") print name "|" type "|" version }
' <<< "$message")

reasons_file="${RUNNER_TEMP:-/tmp}/ceiling-reasons-$pr.md"
: > "$reasons_file"
refused=0

if [ -z "$parsed" ]; then
  echo "#$pr: no updated-dependencies block on $head_sha - refusing to guess."
  echo "- this commit carries no machine-readable updated-dependencies block, so nothing here can tell what it changes." >> "$reasons_file"
  refused=1
fi

# The loop reads from a redirection rather than a pipe, so the counters below belong to the CURRENT
# shell - a piped `while` runs in a subshell and its state is discarded.
while IFS='|' read -r name type version; do
  [ -z "$name" ] && continue
  # Dependabot YAML-quotes any dependency name that starts with `@`, so the trailer for a scoped npm
  # package reads `"@sveltejs/kit"`, quotes included. Matching without stripping them silently
  # misses the entire scope, and most of what this repository depends on is scoped - `@sveltejs/*`,
  # `@lucide/*`, `@tailwindcss/*`, `@inlang/*`. A ceiling entry written without this stripping would
  # match none of them and refuse nothing.
  name="${name%\"}"
  name="${name#\"}"
  gate=""
  case "$name" in
    # A ceiling entry is a dependency whose failure would be INVISIBLE to this repository's suite.
    # It is never a semver judgement: a break that stops the tree compiling is caught by `bun run
    # check`, `bun run lint` and `bun run build`, and one that breaks a route is caught by the suite,
    # which boots a REAL server (`scripts/test-with-server.mjs`) rather than mocking one. That is
    # why `@sveltejs/adapter-node` needs no entry here and does in a repository whose CI only builds.
    #
    # `sharp` was the largest entry and is GONE, closed the way an entry is meant to be closed - by
    # writing the test rather than by refusing the update. `tests/face-crop.test.ts` builds a source
    # image, runs it through `generateFaceCrop`, and asserts the OUTPUT BYTES: a square WebP of the
    # declared size, cropped onto the face box and not onto the middle of the picture. An `extract`
    # whose coordinates changed meaning now reddens CI instead of shipping every student a photo of
    # their shoulder.
    #
    # ADD AN ENTRY WHEN A NEW DEPENDENCY BRINGS A FAILURE MODE NOTHING HERE WATCHES, and make it
    # name the test that would retire it. An entry with no named test is a refusal nobody can ever
    # lift, which is the queue this whole mechanism exists to avoid.
    jspdf | jspdf-autotable)
      gate="a PDF is generated in the browser by \`src/routes/admin/users/+page.svelte\` and nothing here ever opens one, so a renderer that emitted a blank or malformed document would typecheck, build and ship. THE TEST THAT RETIRES THIS: lift the export out of the component into \`src/lib/pdf/user-export.ts\`, returning the document as bytes, and assert in \`tests/user-export.test.ts\` that the output starts with \`%PDF\`, has the expected page count, and contains a name from the fixture rows"
      ;;
    form-data)
      gate="the Immich upload proxy streams its multipart body with \`formData.submit()\` (\`src/routes/api/immich/[...path]/+server.ts\`), which is the ONE path a photo takes into the gallery, and no test builds it - \`tests/immich-v3-upload.test.ts\` covers the web \`FormData\` helper, a different object entirely. A change to the multipart framing would compile and then be refused by Immich at runtime. THE TEST THAT RETIRES THIS: point \`formData.submit()\` at a local \`http.createServer\` in \`tests/immich-upload-body.test.ts\` and assert the received body carries the file part with its filename and length plus the metadata fields"
      ;;
    "") ;;
  esac

  if [ -n "$gate" ]; then
    echo "  REFUSED: $name -> $version ($type): $gate"
    refused=$((refused + 1))
    echo "- \`$name\` -> \`$version\`: $gate." >> "$reasons_file"
  else
    echo "  ok: $name -> $version ($type) - the suite is evidence about this one"
  fi
done <<< "$parsed"

# -----------------------------------------------------------------------------------------------
# A REFUSAL THAT SAYS NOTHING IS THE QUEUE NOBODY DRAINS
# -----------------------------------------------------------------------------------------------
# The comment names the missing test, so the pull request carries its own reason for sitting there.
# It is posted ONCE: this runs on every check-suite completion AND on a schedule, and a marker line
# is cheaper and more reliable than reasoning about how many passes a branch has seen.
if [ "$refused" -ne 0 ]; then
  echo "#$pr: $refused update(s) have no gate here; it waits for one to be written."
  if gh api "repos/$REPO/issues/$pr/comments" --paginate --jq '.[].body' | grep -qF "$MARKER"; then
    echo "#$pr: already explained."
    exit 0
  fi
  gh pr comment "$pr" --repo "$REPO" --body "$MARKER
**Not auto-merged: this repository has no gate that would see this one fail.**

$(cat "$reasons_file")

This is not a semver judgement - a break that stops the tree compiling is caught by the suite and
merges on its own. It is a statement that a TEST IS MISSING. Write the one named above and this
whole class of update starts merging by itself; the reasoning is in \`.github/scripts/dependabot-auto-merge.sh\`."
  exit 0
fi

# -----------------------------------------------------------------------------------------------
# A GREEN CHECK IS EVIDENCE ABOUT THE WORKFLOW THAT PRODUCED IT
# -----------------------------------------------------------------------------------------------
# NOT about the workflow on `main` today. An ABSENT check and an INAPPLICABLE one are
# indistinguishable - both are simply not in the list - so "nothing failed" cannot be the merge
# condition. This repository gained a sharp gate on 2026-08-31; every pull request opened before it
# has a green suite that ran under definitions where `tests/face-crop.test.ts` did not exist, and
# merging a `sharp` bump on that verdict would walk straight past the test just written for it.
#
# WHAT INVALIDATES THAT SUITE IS A CHANGE TO WHAT PRODUCES IT, NOT ANY MOVEMENT OF `main`, and
# `lib/gate-moves.sh` carries the predicate along with the reasoning. What belongs HERE is the
# consequence for a caller that merges:
#
# Until 2026-09-01 this asked `base_sha != main_sha`, and that made the queue undrainable rather
# than careful. Every merge moves `main`, so every remaining pull request went stale in the same
# instant, and the only exit was a rebuild NOTHING HERE CAN PERFORM: `PUT /update-branch` poisons
# the branch (see the section below), and `@dependabot recreate` is refused when the caller is
# `github-actions[bot]` - measured on emse-students/canari#303, three seconds after the ask,
# "Sorry, only users with push access can use that command." A gate whose only remedy is
# unavailable is not a gate, it is a stop, and across these repositories it stopped every pull
# request that was ready to merge.
main_sha=$(gh api "repos/$REPO/commits/main" --jq '.sha') || {
  echo "#$pr: could not read main; skipping rather than merging on an unknown base."
  exit 0
}
base_sha=$(gh pr view "$pr" --repo "$REPO" --json baseRefOid --jq '.baseRefOid')

if [ "$base_sha" != "$main_sha" ]; then
  # One call: the changed-file count on the first line, then one filename per line - which is
  # exactly the payload `classify_gate_moves` is specified and tested against.
  compare=$(gh api "repos/$REPO/compare/$base_sha...$main_sha" \
    --jq '((.files // []) | length), ((.files // []) | .[].filename)') || compare="gh: compare failed"

  verdict=$(printf '%s\n' "$compare" | classify_gate_moves)
  case "$verdict" in
    settled\ *)
      echo "#$pr: built on ${base_sha:0:8}, main is ${main_sha:0:8} - ${verdict#settled } file(s) changed, none of them a gate definition; its checks still describe today's gates."
      ;;
    moved\ *)
      echo "#$pr: built on ${base_sha:0:8}, main is ${main_sha:0:8}, and the gate definitions moved between them: ${verdict#moved }"
      echo "STALE $pr"
      exit 0
      ;;
    *)
      echo "#$pr: cannot compare ${base_sha:0:8}..${main_sha:0:8} - ${verdict#undecidable }. Treating the gates as moved."
      echo "STALE $pr"
      exit 0
      ;;
  esac
fi

# A HEAD DEPENDABOT DID NOT WRITE IS UNMERGEABLE BY EVERY PATH, AND NOTHING ELSE HERE WOULD SAY SO.
# GitHub parks the `pull_request` run of a branch pushed by anything other than Dependabot in
# `action_required` - waiting for a human to click Approve - and Dependabot then declines the branch
# for good ("this PR has been edited by someone other than Dependabot"). Such a branch is not stale:
# its base can be current `main`, so the check above passes it straight through to a merge decision
# that reads checks which will never complete. It would sit there forever.
#
# This is measured rather than inferred, on the state itself and not on how the state came about, so
# a branch touched by a maintainer, by a bad rebase, or by an earlier version of this very workflow
# converges the same way: it is rebuilt, and the rebuild is Dependabot's.
head_author=$(gh api "repos/$REPO/commits/$head_sha" --jq '.author.login // ""')
if [ "$head_author" != "dependabot[bot]" ]; then
  echo "#$pr: head ${head_sha:0:8} was written by '${head_author:-unknown}', not dependabot[bot] - its checks cannot run unattended."
  echo "STALE $pr"
  exit 0
fi

# -----------------------------------------------------------------------------------------------
# THE MERGE
# -----------------------------------------------------------------------------------------------
# Inspect every check-run on the head commit rather than trusting one workflow's conclusion: the
# repository has several PR-gating workflows, so the only safe reading is "at least one check
# exists, all are completed, none reported a bad conclusion".
runs=$(gh api "repos/$REPO/commits/$head_sha/check-runs" --paginate \
  --jq '.check_runs[] | "\(.name)|\(.status)|\(.conclusion // "")"')

total=0
pending=0
bad=0
while IFS='|' read -r name status conclusion; do
  [ -z "$name" ] && continue
  # Ignore this workflow's own run if it ever surfaces as a check.
  case "$name" in "Dependabot auto-merge"*) continue ;; esac
  total=$((total + 1))
  [ "$status" != "completed" ] && pending=$((pending + 1))
  case "$conclusion" in
    success | skipped | neutral | "") ;;
    *)
      bad=$((bad + 1))
      echo "  FAIL: $name -> $conclusion"
      ;;
  esac
done <<< "$runs"

echo "#$pr: checks total=$total pending=$pending bad=$bad"
if [ "$total" -eq 0 ]; then
  echo "#$pr: no checks yet; skip."
  exit 0
fi
if [ "$bad" -ne 0 ]; then
  echo "#$pr: a check failed; not merging."
  exit 0
fi
if [ "$pending" -ne 0 ]; then
  echo "#$pr: checks still running; a later pass will take it."
  exit 0
fi

# CONFLICTING is a fact about the branch, not a verdict on the update: Dependabot rebases it and the
# next sweep takes it. UNKNOWN means GitHub has not finished computing mergeability - which it does
# lazily, and always does eventually - so waiting one pass is right and guessing is not.
case "$mergeable" in
  MERGEABLE) ;;
  CONFLICTING)
    echo "#$pr: conflicts with main; Dependabot must rebase it first."
    exit 0
    ;;
  *)
    echo "#$pr: mergeability still $mergeable; a later pass will take it."
    exit 0
    ;;
esac

echo "#$pr: all checks green -> merging"
if gh pr merge "$pr" --repo "$REPO" --squash --delete-branch; then
  echo "MERGED $pr"
else
  # Not fatal, and deliberately not retried here: whatever refused the merge is durable state that
  # the next pass reads fresh.
  echo "#$pr: the merge itself was refused; leaving it open."
fi
