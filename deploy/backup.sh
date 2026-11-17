#!/usr/bin/env bash
# =============================================================================
# SoftifyOS – backup: database + uploaded documents, with rotation, optional encryption and off-site copy.
#
#   sudo bash /opt/softifyos/deploy/backup.sh            (cron runs it every night, see setup-server.sh)
#
# Writes  $BACKUP_DIR/<YYYY-MM-DD_HHMM>/{db.dump, files.tar.gz, SHA256SUMS}   (+ .gpg when encrypted)
# Keeps   14 daily, 8 weekly (Sunday) and 12 monthly (1st of month) backups.
# Settings from /opt/softifyos/.env (all optional):
#   BACKUP_DIR=/var/backups/softifyos
#   BACKUP_PASSPHRASE=…         encrypt every file with GPG (AES-256). KEEP THIS PASSPHRASE SOMEWHERE ELSE TOO.
#   BACKUP_REMOTE=remote:path   copy each backup off the server with rclone (S3, Backblaze B2, Google Drive, SFTP…)
#   BACKUP_KEEP_DAYS=14
# Writes $BACKUP_DIR/last.json, which /api/health reads (alerts when the last backup is older than 26 h or failed).
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/softifyos}"
ENV_FILE="$APP_DIR/.env"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE" >&2; exit 1; }
envval() { { grep -E "^$1=" "$ENV_FILE" || true; } | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

DATABASE_URL="$(envval DATABASE_URL)"
BACKUP_DIR="$(envval BACKUP_DIR)"; BACKUP_DIR="${BACKUP_DIR:-/var/backups/softifyos}"
UPLOAD_DIR="$(envval UPLOAD_DIR)"; UPLOAD_DIR="${UPLOAD_DIR:-storage}"
case "$UPLOAD_DIR" in /*) ;; *) UPLOAD_DIR="$APP_DIR/apps/api/$UPLOAD_DIR" ;; esac
PASSPHRASE="$(envval BACKUP_PASSPHRASE)"
REMOTE="$(envval BACKUP_REMOTE)"
KEEP_DAYS="$(envval BACKUP_KEEP_DAYS)"; KEEP_DAYS="${KEEP_DAYS:-14}"

STAMP="$(date +%F_%H%M)"
DEST="$BACKUP_DIR/$STAMP"
START="$(date -Iseconds)"
mkdir -p "$DEST"; chmod 700 "$BACKUP_DIR" "$DEST"

status() {   # status ok|failed "message"
  printf '{"ok":%s,"started_at":"%s","finished_at":"%s","path":"%s","message":"%s"}\n' \
    "$([ "$1" = ok ] && echo true || echo false)" "$START" "$(date -Iseconds)" "$DEST" "${2//\"/\'}" > "$BACKUP_DIR/last.json"
  chmod 644 "$BACKUP_DIR/last.json"
}
trap 'status failed "backup failed at line $LINENO"; exit 1' ERR

# 1) Database: custom format (compressed, restorable table by table), consistent snapshot without locking writers
pg_dump --dbname="$DATABASE_URL" -Fc -Z 6 -f "$DEST/db.dump"   # keeps GRANTs (the app role relies on them)
pg_restore --list "$DEST/db.dump" > /dev/null          # the dump is readable

# 2) Uploaded documents
if [ -d "$UPLOAD_DIR" ]; then
  tar -C "$(dirname "$UPLOAD_DIR")" -czf "$DEST/files.tar.gz" "$(basename "$UPLOAD_DIR")"
else
  tar -czf "$DEST/files.tar.gz" --files-from /dev/null
fi

# 3) Optional encryption
if [ -n "$PASSPHRASE" ]; then
  for f in db.dump files.tar.gz; do
    gpg --batch --yes --pinentry-mode loopback --passphrase "$PASSPHRASE" --symmetric --cipher-algo AES256 -o "$DEST/$f.gpg" "$DEST/$f"
    shred -u "$DEST/$f" 2>/dev/null || rm -f "$DEST/$f"
  done
fi
( cd "$DEST" && sha256sum ./* > SHA256SUMS )

# 4) Weekly / monthly copies (hard links: no extra space until the daily one is rotated away)
DOW="$(date +%u)"; DOM="$(date +%d)"
if [ "$DOW" = 7 ]; then cp -al "$DEST" "$BACKUP_DIR/weekly-$STAMP"; fi
if [ "$DOM" = 01 ]; then cp -al "$DEST" "$BACKUP_DIR/monthly-$STAMP"; fi

# 5) Rotation
find "$BACKUP_DIR" -maxdepth 1 -type d -regex '.*/[0-9]\{4\}-[0-9][0-9]-[0-9][0-9]_[0-9]\{4\}' -mtime +"$KEEP_DAYS" -exec rm -rf {} +
{ ls -1dt "$BACKUP_DIR"/weekly-* 2>/dev/null || true; } | tail -n +9 | xargs -r rm -rf
{ ls -1dt "$BACKUP_DIR"/monthly-* 2>/dev/null || true; } | tail -n +13 | xargs -r rm -rf
# Old format from earlier versions (single .dump files)
find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' -mtime +"$KEEP_DAYS" -delete

# 6) Off-site copy
if [ -n "$REMOTE" ]; then
  command -v rclone >/dev/null || { status failed "BACKUP_REMOTE is set but rclone is not installed"; exit 1; }
  rclone copy "$DEST" "$REMOTE/$STAMP" --transfers 2 --retries 5
  rclone delete "$REMOTE" --min-age "$((KEEP_DAYS + 1))d" --rmdirs 2>/dev/null || true
fi

SIZE="$(du -sh "$DEST" | cut -f1)"
status ok "$SIZE${REMOTE:+ + off-site}"
echo "Backup OK: $DEST ($SIZE)"
