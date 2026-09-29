#!/bin/bash
# Wird stündlich per Cron ausgeführt (Sicherheitsnetz zur Prefect-Pipeline,
# die denselben konsolidierten Mechanismus einmal täglich als Schritt 6 der
# daily-pipeline ausführt, siehe scrapers/src/flows/archive_past_listings.py).
#
# Archiviert alle Listings, die EINES der beiden Kriterien erfüllen:
#   1. termin_date liegt in der Vergangenheit.
#   2. "Verschwunden"-Erkennung: last_seen_at ist seit MISSING_TOLERANCE_DAYS
#      Tagen nicht mehr aktualisiert worden (Objekt taucht seitdem nicht mehr
#      im täglichen Scrape-Ergebnis seiner Quelle auf - vermutlich Termin
#      abgesagt/verschoben/aufgehoben). Gilt einheitlich für alle drei Quellen
#      (justizportal, zvg.com, hanmark.de).
#
# Fix (2026-07-04): Verband sich bisher direkt per "localhost:5434" - dieser
# Port wurde nur vom dev-Compose-Stack (docker-compose.dev.yml) auf den Host
# published und ist seit dem Produktiv-Go-Live (docker-compose.prod.yml, siehe
# DEPLOYMENT.md) NICHT mehr gebunden. Der psql-Aufruf schlug seitdem bei jedem
# stündlichen Cron-Lauf mit "Connection refused" fehl (durch das
# "2>/dev/null" beim Aufruf UND die grep-basierte Zählung, die bei leerer
# Ausgabe schlicht "0" zurückgibt, blieb das unbemerkt - das Log zeigte
# irreführend durchgehend "0 Listings archiviert" statt eines Fehlers). Läuft
# jetzt per "docker exec" direkt gegen den gavel_postgres-Container -
# funktioniert unabhängig davon, ob/welcher Host-Port gerade published ist.
#
# Bremse (2026-08-17): Beide Kriterien liefen bisher in einem einzigen UPDATE.
# Als der Upsert drei Tage lang nichts mehr schrieb (kaputte SQL-Platzhalter,
# siehe docs/DATA_QUALITY.md), lief Kriterium 2 für praktisch den gesamten
# Bestand gleichzeitig ab und deaktivierte 650 Objekte in einem Lauf. Die
# Kriterien sind deshalb getrennt: ein abgelaufener Termin ist überprüfbare
# Tatsache und darf auch in großer Zahl greifen (viele Termine liegen auf
# demselben Tag), ein Massenabgang über last_seen_at dagegen bedeutet nie
# "alle Objekte sind weg", sondern immer "der Scraper schreibt nicht mehr".
#
# Aufruf mit --dry-run zählt nur und ändert nichts.

MISSING_TOLERANCE_DAYS="${MISSING_TOLERANCE_DAYS:-3}"

# Anteil des aktiven Bestands, den ein einzelner Lauf über last_seen_at
# höchstens deaktivieren darf. Im Normalbetrieb verschwinden pro Stunde
# einzelne Objekte, nicht Prozente - 20 % ist bewusst großzügig gewählt,
# damit auch ein echter Sammelabgang einer Quelle noch durchgeht, während
# der Ausfallmodus (50-100 % auf einen Schlag) sicher hängen bleibt.
MAX_MISSING_SHARE_PERCENT="${MAX_MISSING_SHARE_PERCENT:-20}"

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
fi

log() { echo "$(date '+%Y-%m-%d %H:%M:%S'): $*"; }

psql_query() {
  docker exec gavel_postgres psql -U immopulse -d immopulse -t -A -c "$1" 2>&1
}

# Kriterium 1: abgelaufene Termine - ohne Bremse, siehe Kopfkommentar.
if [ "$DRY_RUN" -eq 1 ]; then
  ABGELAUFEN=$(psql_query "
    SELECT source FROM zvg_listings
    WHERE ist_aktiv = true AND termin_date IS NOT NULL AND (
      (
        ((termin_date AT TIME ZONE 'Europe/Berlin')::time = TIME '00:00:00')
        AND ((termin_date AT TIME ZONE 'Europe/Berlin')::date
          < (NOW() AT TIME ZONE 'Europe/Berlin')::date)
      )
      OR
      (
        ((termin_date AT TIME ZONE 'Europe/Berlin')::time <> TIME '00:00:00')
        AND termin_date < NOW()
      )
    );")
else
  ABGELAUFEN=$(psql_query "
    WITH archived AS (
      UPDATE zvg_listings
      SET ist_aktiv = false, updated_at = NOW()
      WHERE ist_aktiv = true
        AND termin_date IS NOT NULL AND (
          (
            ((termin_date AT TIME ZONE 'Europe/Berlin')::time = TIME '00:00:00')
            AND ((termin_date AT TIME ZONE 'Europe/Berlin')::date
              < (NOW() AT TIME ZONE 'Europe/Berlin')::date)
          )
          OR
          (
            ((termin_date AT TIME ZONE 'Europe/Berlin')::time <> TIME '00:00:00')
            AND termin_date < NOW()
          )
        )
      RETURNING source
    )
    SELECT source FROM archived;")
fi

if [ $? -ne 0 ]; then
  log "FEHLER beim Archivieren abgelaufener Termine: $ABGELAUFEN"
  exit 1
fi

ANZAHL_ABGELAUFEN=$(echo "$ABGELAUFEN" | grep -c '.' || true)

# Kriterium 2: seit MISSING_TOLERANCE_DAYS nicht mehr bei der Quelle gesehen.
# Erst zählen, dann entscheiden.
ZAEHLUNG=$(psql_query "
  SELECT
    count(*) FILTER (
      WHERE last_seen_at IS NOT NULL
        AND last_seen_at < NOW() - (${MISSING_TOLERANCE_DAYS} * INTERVAL '1 day')
    ),
    count(*)
  FROM zvg_listings WHERE ist_aktiv = true;")

if [ $? -ne 0 ]; then
  log "FEHLER beim Zählen verschwundener Listings: $ZAEHLUNG"
  exit 1
fi

KANDIDATEN=$(echo "$ZAEHLUNG" | cut -d'|' -f1)
AKTIV=$(echo "$ZAEHLUNG" | cut -d'|' -f2)
ANTEIL=0
if [ "$AKTIV" -gt 0 ]; then
  ANTEIL=$((KANDIDATEN * 100 / AKTIV))
fi

if [ "$KANDIDATEN" -gt 0 ] && [ "$ANTEIL" -gt "$MAX_MISSING_SHARE_PERCENT" ]; then
  log "ALARM: $KANDIDATEN von $AKTIV aktiven Listings (${ANTEIL} %) wären wegen"
  log "ALARM: fehlender Aktualisierung seit ${MISSING_TOLERANCE_DAYS}+ Tagen deaktiviert worden -"
  log "ALARM: mehr als ${MAX_MISSING_SHARE_PERCENT} %. Das ist kein Massenabgang bei den Quellen,"
  log "ALARM: sondern ein nicht mehr schreibender Scraper. Deaktivierung NICHT ausgeführt."
  log "ALARM: Prefect-Läufe der drei Scrape-Flows prüfen, danach diesen Job erneut laufen lassen."
  log "$ANZAHL_ABGELAUFEN Listings mit abgelaufenem Termin archiviert"
  exit 2
fi

if [ "$DRY_RUN" -eq 1 ]; then
  VERSCHWUNDEN=$(psql_query "
    SELECT source FROM zvg_listings
    WHERE ist_aktiv = true
      AND last_seen_at IS NOT NULL
      AND last_seen_at < NOW() - (${MISSING_TOLERANCE_DAYS} * INTERVAL '1 day');")
else
  VERSCHWUNDEN=$(psql_query "
    WITH archived AS (
      UPDATE zvg_listings
      SET ist_aktiv = false, updated_at = NOW()
      WHERE ist_aktiv = true
        AND last_seen_at IS NOT NULL
        AND last_seen_at < NOW() - (${MISSING_TOLERANCE_DAYS} * INTERVAL '1 day')
      RETURNING source
    )
    SELECT source FROM archived;")
fi

if [ $? -ne 0 ]; then
  log "FEHLER beim Archivieren verschwundener Listings: $VERSCHWUNDEN"
  exit 1
fi

ANZAHL_VERSCHWUNDEN=$(echo "$VERSCHWUNDEN" | grep -c '.' || true)

PRAEFIX=""
if [ "$DRY_RUN" -eq 1 ]; then
  PRAEFIX="PROBELAUF (nichts geändert): "
fi

log "${PRAEFIX}$((ANZAHL_ABGELAUFEN + ANZAHL_VERSCHWUNDEN)) Listings archiviert - davon $ANZAHL_ABGELAUFEN mit abgelaufenem Termin und $ANZAHL_VERSCHWUNDEN seit ${MISSING_TOLERANCE_DAYS}+ Tagen nicht mehr bei ihrer Quelle gesehen (${ANTEIL} % des aktiven Bestands von $AKTIV)"

if [ $((ANZAHL_ABGELAUFEN + ANZAHL_VERSCHWUNDEN)) -gt 0 ]; then
  printf '%s\n%s\n' "$ABGELAUFEN" "$VERSCHWUNDEN" | grep '.' | sort | uniq -c | while read -r count source; do
    log "  ${PRAEFIX}davon $count x $source"
  done
fi
