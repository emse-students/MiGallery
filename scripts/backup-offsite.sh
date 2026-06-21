#!/usr/bin/env bash
#
# Sauvegarde offsite de MiGallery (et, en option, du dump de la base Immich)
# vers le serveur canari (miroir reciproque entre les deux serveurs LAN).
#
# - Base MiGallery : dump SQLite coherent via l API de sauvegarde en ligne
#   (sqlite3 ".backup", WAL-safe), gzip, puis envoi rsync offsite.
# - Base Immich : on ne re-dumpe pas ; Immich produit deja un dump SQL quotidien
#   (library/backups/immich-db-backup-*.sql.gz) avec ses extensions vector. On
#   envoie simplement le plus recent offsite. Les medias (sur le RAID) sont exclus.
#
# Tourne sur mitv (root, via cron). L offsite utilise la cle SSH de root,
# autorisee pour l utilisateur canari sur 10.0.0.3.
#
set -euo pipefail

# ── Configuration (surchargeable via l environnement) ─────────────────────────
MIGALLERY_DIR="${MIGALLERY_DIR:-/home/mitv/MiGallery}"
MIGALLERY_DB="${MIGALLERY_DB:-$MIGALLERY_DIR/data/migallery.db}"
IMMICH_BACKUP_DIR="${IMMICH_BACKUP_DIR:-/srv/dev-disk-by-uuid-ff73ed20-08b7-4b38-b53c-6de6a86bfd6a/immich-app/library/backups}"
OFFSITE_HOST="${OFFSITE_HOST:-canari@10.0.0.3}"
OFFSITE_PATH="${OFFSITE_PATH:-migallery-offsite}"   # relatif au home du user canari
MIGALLERY_RETENTION_DAYS="${MIGALLERY_RETENTION_DAYS:-14}"
IMMICH_RETENTION_DAYS="${IMMICH_RETENTION_DAYS:-7}"   # dumps ~1 Go : retention courte
INCLUDE_IMMICH="${INCLUDE_IMMICH:-1}"

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)

log() { printf '[migallery-backup] %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { printf '[migallery-backup] ERROR %s\n' "$*" >&2; exit 1; }

command -v sqlite3 >/dev/null || fail "sqlite3 CLI requis (apt-get install sqlite3)"
command -v rsync >/dev/null || fail "rsync requis"
[ -f "$MIGALLERY_DB" ] || fail "base MiGallery introuvable: $MIGALLERY_DB"

TS="$(date '+%Y%m%d-%H%M%S')"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/migallery-backup.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

ssh "${SSH_OPTS[@]}" "$OFFSITE_HOST" "mkdir -p '$OFFSITE_PATH/migallery' '$OFFSITE_PATH/immich'"

# ── 1. Base MiGallery (dump coherent + gzip + offsite) ────────────────────────
log "Dump SQLite MiGallery (online backup)..."
sqlite3 "$MIGALLERY_DB" ".backup '$STAGE/migallery-$TS.db'"
gzip "$STAGE/migallery-$TS.db"
log "Dump pret ($(du -h "$STAGE/migallery-$TS.db.gz" | cut -f1)), envoi offsite..."
rsync -a --partial "$STAGE/migallery-$TS.db.gz" "$OFFSITE_HOST:$OFFSITE_PATH/migallery/"
ssh "${SSH_OPTS[@]}" "$OFFSITE_HOST" \
  "find '$OFFSITE_PATH/migallery' -name 'migallery-*.db.gz' -type f -mtime +$MIGALLERY_RETENTION_DAYS -delete" || true
log "MiGallery offsite OK"

# ── 2. Dump Immich (le plus recent, deja produit par Immich) -> offsite ───────
if [ "$INCLUDE_IMMICH" = "1" ]; then
  if [ -d "$IMMICH_BACKUP_DIR" ]; then
    LATEST_IMMICH="$(ls -1t "$IMMICH_BACKUP_DIR"/immich-db-backup-*.sql.gz 2>/dev/null | head -1 || true)"
    if [ -n "$LATEST_IMMICH" ]; then
      log "Envoi du dump Immich $(basename "$LATEST_IMMICH") ($(du -h "$LATEST_IMMICH" | cut -f1))..."
      rsync -a --partial "$LATEST_IMMICH" "$OFFSITE_HOST:$OFFSITE_PATH/immich/"
      ssh "${SSH_OPTS[@]}" "$OFFSITE_HOST" \
        "find '$OFFSITE_PATH/immich' -name 'immich-db-backup-*.sql.gz' -type f -mtime +$IMMICH_RETENTION_DAYS -delete" || true
      log "Immich offsite OK"
    else
      log "WARN aucun dump Immich dans $IMMICH_BACKUP_DIR"
    fi
  else
    log "WARN dossier de dumps Immich introuvable: $IMMICH_BACKUP_DIR"
  fi
fi

log "Sauvegarde offsite terminee."
