#!/usr/bin/env bash
#
# No workflow writes a `${{ ... }}` expression INSIDE a shell script.
#
# An expression is substituted into the text of the script before the shell reads it, so its value
# becomes code. A value therefore reaches a script through `env:`, where it is data, and the script
# reads the variable. This test reads every workflow and fails on an expression found in a `run:`.
#
# Usage: .github/scripts/tests/workflow-expressions.test.sh [workflows-dir]   (no network)
set -uo pipefail

dir="${1:-$(cd "$(dirname "$0")/../../workflows" && pwd)}"
failures=0

# Prints `file:line: text` for each expression inside a `run:` (one-line, or a `|` / `>` block).
scan() {
  awk '
    function indent_of(s) { match(s, /^ */); return RLENGTH }
    {
      line = $0
      if (in_block) {
        if (line ~ /^ *$/) next
        if (indent_of(line) > block_indent) {
          if (line ~ /\$\{\{/) printf "%s:%d: %s\n", FILENAME, FNR, line
          next
        }
        in_block = 0
      }
      if (line ~ /^ *(- )?run: *[|>][-+]? *$/) {
        in_block = 1
        block_indent = indent_of(line)
        if (line ~ /^ *- run:/) block_indent += 2
        next
      }
      if (line ~ /^ *(- )?run: / && line ~ /\$\{\{/) printf "%s:%d: %s\n", FILENAME, FNR, line
    }
  ' "$@"
}

# The scanner must be able to FIND one before its silence means anything.
probe=$(mktemp -d)
trap 'rm -rf "$probe"' EXIT
cat >"$probe/block.yml" <<'YAML'
jobs:
  a:
    steps:
      - name: in a block
        env:
          SAFE: ${{ github.ref }}
        run: |
          echo "$SAFE"
          echo '${{ github.event.release.tag_name }}'
      - run: echo ${{ github.actor }}
      - name: after
        with:
          ref: ${{ github.sha }}
YAML
found=$(scan "$probe/block.yml" | wc -l)
if [ "$found" -ne 2 ]; then
  echo "FAIL the scanner finds $found of the 2 expressions planted in a run"
  failures=$((failures + 1))
else
  echo "ok   the scanner finds an expression in a run block and in a one-line run, and none in env or with"
fi

hits=$(scan "$dir"/*.yml)
if [ -n "$hits" ]; then
  echo "FAIL an expression is written inside a script; pass it through env: instead"
  printf '%s\n' "$hits"
  failures=$((failures + 1))
else
  echo "ok   no workflow in $(basename "$dir") writes an expression inside a script"
fi

[ "$failures" -eq 0 ]
