#!/usr/bin/env bash
#
# Restauration de la base MiGallery depuis la sauvegarde offsite (serveur canari).
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

OFFSITE_HOST="${OFFSITE_HOST:-canari@10.0.0.3}"
OFFSITE_PATH="${OFFSITE_PATH:-migallery-offsite}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/mitv/MiGallery}"
DB_DEST="${DB_DEST:-$DEPLOY_DIR/data/migallery.db}"
COMPOSE="docker compose -f $DEPLOY_DIR/docker-compose.prod.yml --project-directory $DEPLOY_DIR"

log() { printf '[migallery-restore] %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { printf '[migallery-restore] ERROR %s\n' "$*" >&2; exit 1; }

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

[ -f "$DB_DEST" ] && cp "$DB_DEST" "$DB_DEST.before-restore-$(date '+%Y%m%d-%H%M%S')" || true
install -D "$STAGE/migallery.db" "$DB_DEST"
log "Base restauree -> $DB_DEST"

log "Redemarrage du conteneur..."
$COMPOSE up -d migallery
log "Restauration terminee."
