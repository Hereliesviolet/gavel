#!/bin/bash
# Täglicher Cron-Job: hält Bewertungsstand und Datenabdeckung des aktiven
# ZVG-Bestands als Lauf in investor_evaluation_runs fest. Ohne diesen Lauf gibt
# es auf der Datenbasis-Seite keinen Abdeckungsverlauf, nur eine Momentaufnahme.
#
# Einrichtung (crontab -e):
#   45 5 * * * /path/to/gavel/scrapers/investor_evaluation.sh >> /var/log/gavel-evaluation.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../.env}"
# shellcheck source=cron_secret.sh
. "$SCRIPT_DIR/cron_secret.sh"

CRON_SECRET="$(cron_secret_for_audience CRON_JOBS_SECRET)"
if [ -z "${DOMAIN:-}" ] && [ -f "$ENV_FILE" ]; then
  DOMAIN=$(grep -E '^DOMAIN=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)
fi

if [ -z "${CRON_SECRET:-}" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S'): FEHLER - CRON_JOBS_SECRET/CRON_SECRET nicht gefunden in $ENV_FILE"
  exit 1
fi

: "${DOMAIN:?DOMAIN ist nicht gesetzt (Umgebungsvariable oder DOMAIN= in der .env)}"
URL="https://${DOMAIN}/api/cron/investor-evaluation"

RESPONSE=$(curl -sS -m 300 -X POST -w "\nHTTP_STATUS:%{http_code}" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "$URL")

STATUS=$(echo "$RESPONSE" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed 's/HTTP_STATUS:[0-9]*$//')

# Der Report selbst ist gross; für das Log reichen Umfang und Abdeckungsstand.
echo "$(date '+%Y-%m-%d %H:%M:%S'): HTTP $STATUS - $(echo "$BODY" | head -c 400)"

if [ "$STATUS" != "201" ]; then
  exit 1
fi
