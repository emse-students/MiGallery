# shellcheck shell=bash
#
# Where the offsite backups go, read by backup-offsite.sh and restore-offsite.sh (sourced, never run).
#
# The destinations are OPERATIONS data, not code: this public repository names no host, account or
# path for them. The deploy writes `backup.env` beside these scripts from the repository secrets
# `OFFSITE_HOST` and `IMMICH_BACKUP_DIR` (deploy.yml), and refuses to deploy without them. A
# variable already set in the environment wins over the file, so a one-off run can point elsewhere.
#
# A missing value is a hard failure, never a default: a backup that silently writes
# somewhere else, or silently stops, is worse than one that fails. The caller defines `fail`
# before sourcing this file.

BACKUP_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-$BACKUP_SCRIPTS_DIR/backup.env}"

# load_backup_config KEY... - reads KEY=VALUE lines WITHOUT executing them, refuses an unknown key
# so a typo cannot pass for a setting, then fails unless every KEY named by the caller is non-empty.
# The file may be absent only when the environment names every required KEY itself: a restore on a
# new server, before its first deploy, has no backup.env yet.
load_backup_config() {
  local key value
  if [ -r "$BACKUP_ENV_FILE" ]; then
    while IFS='=' read -r key value || [ -n "$key" ]; do
      case "$key" in
        '' | '#'*) continue ;;
        OFFSITE_HOST | OFFSITE_PATH | IMMICH_BACKUP_DIR) ;;
        *) fail "unknown key '${key}' in ${BACKUP_ENV_FILE}" ;;
      esac
      # Only a variable that is UNSET takes the file's value.
      if [ -z "${!key+x}" ]; then printf -v "$key" '%s' "$value"; fi
    done <"$BACKUP_ENV_FILE"
  fi

  for key in "$@"; do
    [ -n "${!key:-}" ] \
      || fail "${key} is not set: export it, or deploy (which writes ${BACKUP_ENV_FILE} from the repository secrets)"
  done
}
