#!/bin/bash
# Wächter über die Frische des Bestands: wie alt ist der jüngste last_seen_at
# über die aktiven Listings? Die Frage ist absichtlich ursachenblind - sie
# greift beim Vorfall vom 14.08.2026 (Upsert schrieb nichts, Prefect grün)
# genauso wie bei einem gestoppten Worker, einer gesperrten Quelle oder einem
# künftigen Fehler, der ganz anders aussieht.
#
# Warum E-Mail über die bestehende Next.js-Route und kein neuer Kanal
# (Recherche 2026-08-17, damit sie niemand wiederholen muss):
#   - Der Datenqualitäts-Report (/api/cron/data-quality-report) wäre inhaltlich
#     der passende Ort, läuft aber als Schritt 6.5 der daily_pipeline. Läuft die
#     Pipeline nicht, kommt auch kein Bericht - ein Wächter darf nicht in dem
#     Prozess wohnen, den er überwacht. Deshalb eigener Cron-Eintrag, eigene
#     Route, aber derselbe SMTP-Weg (lib/email.ts, ADMIN_EMAIL).
#   - check_alerts.sh bedient Suchabos von Nutzern; ein Betriebsalarm dort
#     hinein würde Nutzer-E-Mails und Betriebsmeldungen vermischen.
#   - Grafana/Prometheus laufen, haben aber weder Datenquelle noch Contact
#     Point noch eine einzige Alarmregel (geprüft per Provisioning-API). Dort
#     zu alarmieren hieße, Alerting erst komplett aufzubauen.
#
# Einrichtung (crontab -e):
#   45 * * * * /path/to/gavel/scrapers/check_freshness.sh >> /var/log/gavel-frische.log 2>&1
#
# Test des Schlechtfalls ohne Datenänderung: MAX_ALTER_STUNDEN=0 setzen und
# STAMP_DATEI auf einen Pfad in /tmp umbiegen, damit die Tagesbremse des
# Produktivbetriebs unberührt bleibt.

set -euo pipefail

# 26 Stunden - derselbe Wert, mit dem die Anwendung den Scraper-Status als
# "online" bewertet (apps/web/components/layout/live-ticker.tsx). Die Pipeline
# läuft täglich; die zwei Stunden Zugabe fangen Laufzeitschwankungen ab.
MAX_ALTER_STUNDEN="${MAX_ALTER_STUNDEN:-26}"

# Wiederholungsbremse: eine Datei mit dem Kalendertag der letzten Meldung.
# Bei stündlichem Lauf und anhaltendem Problem bleibt es damit bei einer
# E-Mail pro Tag. Einfacher als eine Tabelle und ausreichend, weil der Zustand
# keine Historie braucht - erholt sich der Bestand, wird die Datei gelöscht und
# ein erneutes Problem meldet sofort wieder.
STAMP_DATEI="${STAMP_DATEI:-/var/lib/gavel/frische_gemeldet}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S'): $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../.env}"
# shellcheck source=cron_secret.sh
. "$SCRIPT_DIR/cron_secret.sh"

CRON_SECRET="$(cron_secret_for_audience CRON_OPS_SECRET)"
if [ -z "${DOMAIN:-}" ] && [ -f "$ENV_FILE" ]; then
  DOMAIN=$(grep -E '^DOMAIN=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)
fi

if [ -z "${CRON_SECRET:-}" ]; then
  log "FEHLER - CRON_OPS_SECRET/CRON_SECRET nicht gefunden in $ENV_FILE"
  exit 1
fi

# count(*) ist bei leerem Bestand 0, max(last_seen_at) dann NULL - beide
# Felder kommen deshalb bewusst als leerer String zurück und werden unten als
# schwerster Fall behandelt, nicht als "0 Minuten alt".
MESSUNG=$(docker exec gavel_postgres psql -U immopulse -d immopulse -t -A -c "
  SELECT
    count(*),
    coalesce(to_char(max(last_seen_at) AT TIME ZONE 'Europe/Berlin', 'DD.MM.YYYY HH24:MI'), ''),
    coalesce(floor(extract(epoch FROM now() - max(last_seen_at)) / 60)::text, '')
  FROM zvg_listings WHERE ist_aktiv = true;" 2>&1) || {
  log "FEHLER bei der Messung: $MESSUNG"
  exit 1
}

AKTIV=$(echo "$MESSUNG" | cut -d'|' -f1)
LETZTER=$(echo "$MESSUNG" | cut -d'|' -f2)
ALTER_MINUTEN=$(echo "$MESSUNG" | cut -d'|' -f3)

case "${AKTIV:-}" in
  ''|*[!0-9]*)
    log "FEHLER - unerwartete Antwort der Datenbank: $MESSUNG"
    exit 1
    ;;
esac

if [ "$AKTIV" -gt 0 ] && [ -n "$ALTER_MINUTEN" ] &&
   [ "$ALTER_MINUTEN" -le $((MAX_ALTER_STUNDEN * 60)) ]; then
  log "Bestand frisch - jüngster last_seen_at $LETZTER (${ALTER_MINUTEN} Minuten alt), $AKTIV aktive Objekte"
  rm -f "$STAMP_DATEI"
  exit 0
fi

HEUTE=$(date '+%Y-%m-%d')
if [ -f "$STAMP_DATEI" ] && [ "$(cat "$STAMP_DATEI")" = "$HEUTE" ]; then
  log "Bestand veraltet ($AKTIV aktive Objekte, jüngster last_seen_at '${LETZTER:-keiner}') - heute bereits gemeldet, keine weitere E-Mail"
  exit 0
fi

if [ -n "$ALTER_MINUTEN" ]; then
  ALTER_JSON="$ALTER_MINUTEN"
  LETZTER_JSON="\"$LETZTER\""
else
  ALTER_JSON="null"
  LETZTER_JSON="null"
fi

: "${DOMAIN:?DOMAIN ist nicht gesetzt (Umgebungsvariable oder DOMAIN= in der .env)}"
URL="https://${DOMAIN}/api/cron/data-freshness"
RESPONSE=$(curl -sS -m 60 -w "\nHTTP_STATUS:%{http_code}" -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  -d "{\"aktiveObjekte\":${AKTIV},\"letzterSchreibzeitpunkt\":${LETZTER_JSON},\"alterMinuten\":${ALTER_JSON},\"schwelleStunden\":${MAX_ALTER_STUNDEN}}" \
  "$URL") || {
  log "FEHLER - Alarm konnte nicht abgesetzt werden (curl): $URL"
  exit 1
}

STATUS=$(echo "$RESPONSE" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed 's/HTTP_STATUS:[0-9]*$//' | tr -d '\n')

log "ALARM: Bestand veraltet - $AKTIV aktive Objekte, jüngster last_seen_at '${LETZTER:-keiner}' (${ALTER_MINUTEN:-kein Wert} Minuten alt, Schwelle ${MAX_ALTER_STUNDEN} Stunden)"
log "ALARM: E-Mail-Versand HTTP $STATUS - $BODY"

if [ "$STATUS" != "200" ]; then
  log "ALARM: Versand fehlgeschlagen - Meldung existiert nur in diesem Log"
  exit 1
fi

mkdir -p "$(dirname "$STAMP_DATEI")"
echo "$HEUTE" > "$STAMP_DATEI"
