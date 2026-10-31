#!/usr/bin/env bash
#
# Restauration de la base MiGallery depuis la sauvegarde offsite (OFFSITE_HOST).
# Pensee pour la reprise / migration vers un nouveau serveur.
#
#   ./scripts/restore-offsite.sh --yes                 # derniere sauvegarde offsite
#   ./scripts/restore-offsite.sh /chemin/dump.db.gz --yes
#
# OPERATION DESTRUCTIVE : remplace data/migallery.db. Exige --yes.
# La base Immich se restaure separement (cf docs/MIGRATION.md), via la
# procedure officielle Immich a partir de immich-db-backup-*.sql.gz.
#
set -euo pipefail

# Run from <deploy-dir>/scripts (DEPLOY_DIR defaults to its parent); on a server not yet deployed,
# export OFFSITE_HOST (and DEPLOY_DIR) first.

log() { printf '[migallery-restore] %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { printf '[migallery-restore] ERROR %s\n' "$*" >&2; exit 1; }

# OFFSITE_HOST comes from the deploy-written backup.env (backup-config.sh), or the environment on a
# server that has not been deployed yet. It is required below, only when the archive is fetched.
# shellcheck source=scripts/backup-config.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backup-config.sh"
# Read the file FIRST, so a backup.env that sets OFFSITE_PATH is honoured; the default comes after.
load_backup_config
OFFSITE_PATH="${OFFSITE_PATH:-migallery-offsite}"
# The deploy syncs this script into <deploy-dir>/scripts, so its parent IS the deploy directory.
DEPLOY_DIR="${DEPLOY_DIR:-$(dirname "$BACKUP_SCRIPTS_DIR")}"
DB_DEST="${DB_DEST:-$DEPLOY_DIR/data/migallery.db}"
COMPOSE="docker compose -f $DEPLOY_DIR/docker-compose.prod.yml --project-directory $DEPLOY_DIR"

ARCHIVE=""
CONFIRM="no"
for arg in "$@"; do
  case "$arg" in
    --yes) CONFIRM="yes" ;;
    -*) fail "option inconnue: $arg" ;;
    *) ARCHIVE="$arg" ;;
  esac
done

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Recupere la derniere sauvegarde offsite si aucune archive locale fournie.
if [ -z "$ARCHIVE" ]; then
  load_backup_config OFFSITE_HOST
  log "Recuperation de la derniere sauvegarde depuis $OFFSITE_HOST..."
  LATEST="$(ssh -o BatchMode=yes "$OFFSITE_HOST" \
    "ls -1t '$OFFSITE_PATH'/migallery/migallery-*.db.gz 2>/dev/null | head -1")"
  [ -n "$LATEST" ] || fail "aucune sauvegarde MiGallery offsite trouvee"
  ARCHIVE="$STAGE/$(basename "$LATEST")"
  rsync -a -e "ssh -o BatchMode=yes" "$OFFSITE_HOST:$LATEST" "$ARCHIVE"
fi
[ -f "$ARCHIVE" ] || fail "archive introuvable: $ARCHIVE"

[ "$CONFIRM" = "yes" ] || fail "operation DESTRUCTIVE. Relancer avec --yes (source: $ARCHIVE)"

# Decompresse vers un fichier temporaire (verifie l integrite gzip au passage).
log "Decompression de $(basename "$ARCHIVE")..."
gunzip -c "$ARCHIVE" > "$STAGE/migallery.db"

# Arret du conteneur pour eviter toute ecriture concurrente, swap, redemarrage.
log "Arret du conteneur MiGallery..."
$COMPOSE stop migallery || true

# NOT `[ -f x ] && cp ... || true`, WHICH IS NOT AN IF-THEN-ELSE (SC2015 - the
# CI pinned 0.10.0 named it where the workstation's 0.11.0 did not). In that form a FAILING
# `cp` also lands in the `|| true`, so a restore that could not preserve the database it is
# about to overwrite would continue silently. Losing the previous copy is exactly the thing
# this line exists to prevent, so it must stop.
if [ -f "$DB_DEST" ]; then
  cp "$DB_DEST" "$DB_DEST.before-restore-$(date '+%Y%m%d-%H%M%S')"
fi
install -D "$STAGE/migallery.db" "$DB_DEST"
log "Base restauree -> $DB_DEST"

log "Redemarrage du conteneur..."
$COMPOSE up -d migallery
log "Restauration terminee."
