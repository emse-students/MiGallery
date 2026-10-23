#!/usr/bin/env bash
#
# Where the offsite backup goes, read from the HOST, never from this repository.
#
# Sourced by `backup-offsite.sh` and `restore-offsite.sh`. The destination used to be a default
# here (`OFFSITE_HOST=canari@<a LAN address>`), which put a private address in a public repository
# and pinned the backups to one machine: moving them (WP-MIGALLERY-OFFSITE, to the Canari project's
# offsite server) would have been a code change instead of a host setting.
#
# The host file (default `/etc/migallery/offsite.env`, root-owned, mode 600) holds:
#
#   OFFSITE_HOST=<user>@<host>       # the ssh destination, its key authorised there
#   OFFSITE_PATH=<dir>               # relative to that user's home, or absolute
#
# A value already in the environment wins over the file (a one-off restore from another place).
# NOTHING DEFAULTS: with no host named, the script stops and says which file to write. A backup that
# silently went to a machine being wound down is the failure this replaces.
#
# shellcheck shell=bash

MIGALLERY_OFFSITE_ENV="${MIGALLERY_OFFSITE_ENV:-/etc/migallery/offsite.env}"

# Reads the host file without letting it override what the caller already set.
load_offsite_target() {
  local pre_host="${OFFSITE_HOST:-}" pre_path="${OFFSITE_PATH:-}"
  if [ -f "$MIGALLERY_OFFSITE_ENV" ]; then
    # shellcheck disable=SC1090
    . "$MIGALLERY_OFFSITE_ENV"
  fi
  [ -n "$pre_host" ] && OFFSITE_HOST="$pre_host"
  [ -n "$pre_path" ] && OFFSITE_PATH="$pre_path"
  if [ -z "${OFFSITE_HOST:-}" ] || [ -z "${OFFSITE_PATH:-}" ]; then
    printf '[migallery-offsite] ERROR no offsite target: write OFFSITE_HOST and OFFSITE_PATH into %s (see docs/MIGRATION.md section 3)\n' \
      "$MIGALLERY_OFFSITE_ENV" >&2
    return 1
  fi
  printf '[migallery-offsite] target %s:%s (from %s)\n' "$OFFSITE_HOST" "$OFFSITE_PATH" \
    "$([ -n "$pre_host" ] && echo 'the environment' || echo "$MIGALLERY_OFFSITE_ENV")"
  export OFFSITE_HOST OFFSITE_PATH
}
