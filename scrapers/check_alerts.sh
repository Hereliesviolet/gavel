#!/bin/bash
# Stündlicher Cron-Job (analog zu archive_expired.sh) für häufigere
# Alert-Prüfung, zusätzlich zum täglichen Check in der Prefect-Pipeline
# (daily_pipeline.py, Schritt 7). Wichtig für Alerts mit Frequenz "instant".
#
# Ruft die intern per CRON_SECRET geschützte Next.js-Route über die
# öffentliche Domain auf (der Web-Container publiziert Port 3000 nicht auf
# den Host, ist aber über Caddy/die Domain erreichbar - siehe proxy.ts für
# den /api/cron-Ausnahmepfad).
#
# Einrichtung (crontab -e):
#   0 * * * * /path/to/gavel/scrapers/check_alerts.sh >> /var/log/gavel-alerts.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../.env}"
# shellcheck source=cron_secret.sh
. "$SCRIPT_DIR/cron_secret.sh"

CRON_SECRET="$(cron_secret_for_audience CRON_EMAIL_SECRET)"
if [ -z "${DOMAIN:-}" ] && [ -f "$ENV_FILE" ]; then
  DOMAIN=$(grep -E '^DOMAIN=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)
fi

if [ -z "${CRON_SECRET:-}" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S'): FEHLER - CRON_EMAIL_SECRET/CRON_SECRET nicht gefunden in $ENV_FILE"
  exit 1
fi

: "${DOMAIN:?DOMAIN ist nicht gesetzt (Umgebungsvariable oder DOMAIN= in der .env)}"
URL="https://${DOMAIN}/api/cron/check-alerts"

RESPONSE=$(curl -sS -m 60 -w "\nHTTP_STATUS:%{http_code}" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "$URL")

STATUS=$(echo "$RESPONSE" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed 's/HTTP_STATUS:[0-9]*$//')

echo "$(date '+%Y-%m-%d %H:%M:%S'): HTTP $STATUS - $BODY"

if [ "$STATUS" != "200" ]; then
  exit 1
fi
