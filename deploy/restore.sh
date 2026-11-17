#!/usr/bin/env bash
# =============================================================================
# SoftifyOS – restore / verify a backup made by deploy/backup.sh
#
#   sudo bash deploy/restore.sh --verify [BACKUP]   restores into a TEMPORARY database, checks it, drops it.
#                                                   Production is not touched. Cron runs this every Sunday.
#   sudo bash deploy/restore.sh BACKUP              REPLACES the production database and documents with the backup
#                                                   (stops the app, keeps a safety copy of the current state first).
#
# BACKUP = a folder in $BACKUP_DIR (e.g. 2026-11-17_0315) or a full path; default = the newest one.
# =============================================================================
set -euo pipefail
# Newest PostgreSQL client tools first: the server may be newer than the distro default
# (e.g. Plesk on Ubuntu 20.04 ships pg_dump 12, SoftifyOS runs 17), and pg_dump refuses an older client.
PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$PG_BIN" ] && export PATH="$PG_BIN:$PATH"

APP_DIR="${APP_DIR:-/opt/softifyos}"
APP_USER="${APP_USER:-softify}"
ENV_FILE="$APP_DIR/.env"
envval() { { grep -E "^$1=" "$ENV_FILE" || true; } | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
DATABASE_URL="$(envval DATABASE_URL)"
BACKUP_DIR="$(envval BACKUP_DIR)"; BACKUP_DIR="${BACKUP_DIR:-/var/backups/softifyos}"
UPLOAD_DIR="$(envval UPLOAD_DIR)"; UPLOAD_DIR="${UPLOAD_DIR:-storage}"
case "$UPLOAD_DIR" in /*) ;; *) UPLOAD_DIR="$APP_DIR/apps/api/$UPLOAD_DIR" ;; esac
PASSPHRASE="$(envval BACKUP_PASSPHRASE)"

VERIFY=0
[ "${1:-}" = "--verify" ] && { VERIFY=1; shift; }
SRC="${1:-}"
if [ -z "$SRC" ]; then SRC="$(ls -1dt "$BACKUP_DIR"/[0-9]*_[0-9]* 2>/dev/null | head -1)"; fi
[ -d "$SRC" ] || SRC="$BACKUP_DIR/$SRC"
[ -d "$SRC" ] || { echo "Backup not found: $SRC" >&2; exit 1; }
echo "Backup: $SRC"
( cd "$SRC" && sha256sum -c --quiet SHA256SUMS ) || { echo "Checksum mismatch: the backup is damaged" >&2; exit 1; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT; chmod 700 "$WORK"
open() {   # open db.dump|files.tar.gz → path of the readable file
  if [ -f "$SRC/$1.gpg" ]; then
    [ -n "$PASSPHRASE" ] || { echo "The backup is encrypted: set BACKUP_PASSPHRASE in .env" >&2; exit 1; }
    gpg --batch --quiet --pinentry-mode loopback --passphrase "$PASSPHRASE" -d -o "$WORK/$1" "$SRC/$1.gpg"; echo "$WORK/$1"
  else echo "$SRC/$1"; fi
}
DUMP="$(open db.dump)"; FILES="$(open files.tar.gz)"

# Connection pieces (same host / user as the app). Creating / dropping databases is done as the postgres superuser.
BASE_URL="${DATABASE_URL%/*}"; DB_NAME="${DATABASE_URL##*/}"; DB_NAME="${DB_NAME%%\?*}"
read -r DB_USER DB_PORT < <(node -e 'const u=new URL(process.argv[1]);console.log(decodeURIComponent(u.username), u.port||5432)' "$DATABASE_URL")
admin() { sudo -u postgres psql -p "$DB_PORT" -v ON_ERROR_STOP=1 -qAt "$@"; }

if [ "$VERIFY" = 1 ]; then
  TMP_DB="softifyos_verify_$(date +%s)"
  admin -c "CREATE DATABASE $TMP_DB OWNER \"$DB_USER\"" >/dev/null
  trap 'admin -c "DROP DATABASE IF EXISTS $TMP_DB" >/dev/null 2>&1; rm -rf "$WORK"' EXIT
  admin -d "$TMP_DB" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent" >/dev/null 2>&1 || true
  pg_restore --dbname="$BASE_URL/$TMP_DB" --no-owner --exit-on-error "$DUMP"
  read -r T C O < <(psql "$BASE_URL/$TMP_DB" -Atqc "SELECT (SELECT count(*) FROM tenants), (SELECT count(*) FROM customers), (SELECT count(*) FROM offers)" | tr '|' ' ')
  N_FILES="$(tar -tzf "$FILES" | grep -vc '/$' || true)"
  echo "OK · organisations $T · customers $C · offers $O · documents $N_FILES"
  echo "{\"ok\":true,\"verified_at\":\"$(date -Iseconds)\",\"backup\":\"$SRC\",\"tenants\":$T,\"customers\":$C,\"offers\":$O,\"files\":$N_FILES}" > "$BACKUP_DIR/last-verify.json"
  exit 0
fi

echo
echo "⚠️  This REPLACES the database \"$DB_NAME\" and the documents in $UPLOAD_DIR with the backup above."
read -r -p "Type the database name to continue: " CONFIRM
[ "$CONFIRM" = "$DB_NAME" ] || { echo "Cancelled."; exit 1; }

echo "1/5 Safety backup of the current state…"
sudo -u "$APP_USER" -H APP_DIR="$APP_DIR" bash "$APP_DIR/deploy/backup.sh" >/dev/null && echo "    done ($(ls -1dt "$BACKUP_DIR"/[0-9]*_[0-9]* | head -1))"

echo "2/5 Stopping the app…"
sudo -u "$APP_USER" -H pm2 stop softify-web softify-api softify-worker >/dev/null 2>&1 || true

echo "3/5 Restoring the database…"
admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid()" >/dev/null
pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --single-transaction "$DUMP"

echo "4/5 Restoring documents…"
if [ -d "$UPLOAD_DIR" ]; then mv "$UPLOAD_DIR" "$UPLOAD_DIR.before-restore-$(date +%s)"; fi
mkdir -p "$(dirname "$UPLOAD_DIR")"
tar -C "$(dirname "$UPLOAD_DIR")" -xzf "$FILES"
chown -R "$APP_USER":"$APP_USER" "$UPLOAD_DIR"

echo "5/5 Migrations and start…"
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && npm run db:migrate -w @softify/api --silent && pm2 start softify-web softify-api softify-worker" >/dev/null
echo "Restore complete. The previous documents folder was kept as $UPLOAD_DIR.before-restore-*"
