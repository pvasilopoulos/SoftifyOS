#!/usr/bin/env bash
# =============================================================================
# SoftifyOS – deploy / update
#
#   sudo bash /opt/softifyos/deploy/deploy.sh                      # build & restart current code
#   sudo bash /opt/softifyos/deploy/deploy.sh /root/softifyos-*.tar.gz   # unpack a new release first
#
# Steps: (unpack) → npm ci → build → database migrations → zero-downtime reload → health check.
# The .env file is never touched.
# =============================================================================
set -euo pipefail

APP_USER="${APP_USER:-softify}"
APP_DIR="${APP_DIR:-/opt/softifyos}"
RELEASE="${1:-}"

c() { echo -e "\n\033[1;35m==> $*\033[0m"; }
die() { echo -e "\n\033[1;31m✗ $*\033[0m" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Τρέξε το script ως root: sudo bash $0"
[ -f "$APP_DIR/.env" ] || die "Λείπει το $APP_DIR/.env. Τρέξε πρώτα το deploy/setup-server.sh."

as_app() { sudo -u "$APP_USER" -H bash -lc "cd '$APP_DIR' && $*"; }

if [ -n "$RELEASE" ]; then
  [ -f "$RELEASE" ] || die "Δεν βρέθηκε το αρχείο $RELEASE"
  c "Αποσυμπίεση $(basename "$RELEASE")"
  tar -xzf "$RELEASE" -C "$APP_DIR"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
fi

c "Εγκατάσταση dependencies"
as_app "npm ci --no-audit --no-fund --loglevel=error"

c "Build (API + PWA)"
as_app "npm run build"

c "Migrations βάσης"
as_app "npm run db:migrate"

c "Εκκίνηση / επαναφόρτωση υπηρεσιών"
as_app "pm2 startOrReload deploy/ecosystem.config.cjs --update-env && pm2 save"

API_PORT="$(grep -E '^API_PORT=' "$APP_DIR/.env" | cut -d= -f2)"
WEB_PORT="$(grep -E '^WEB_PORT=' "$APP_DIR/.env" | cut -d= -f2)"
c "Έλεγχος λειτουργίας"
for i in $(seq 1 20); do
  # The API answers 503 when something needs attention (e.g. no backup yet): it is still up
  API_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${API_PORT:-4000}/api/health" 2>/dev/null || true)"
  if { [ "$API_CODE" = 200 ] || [ "$API_CODE" = 503 ]; } \
     && curl -fsS -o /dev/null "http://127.0.0.1:${WEB_PORT:-3000}/el/login"; then
    as_app "pm2 ls"
    echo -e "\n\033[1;32m✓ Το SoftifyOS τρέχει.\033[0m"
    exit 0
  fi
  sleep 1
done
as_app "pm2 logs --lines 40 --nostream" || true
die "Οι υπηρεσίες δεν απάντησαν. Δες τα logs παραπάνω (ή: sudo -u $APP_USER pm2 logs)."
