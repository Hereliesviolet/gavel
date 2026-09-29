#!/bin/bash
# Täglicher Cron-Job: extrahiert fehlende Wohnflächen aus den hinterlegten
# Gutachten nach. Läuft bewusst täglich in kleinen Portionen, weil das
# Vision-Modell ein Tages-Tokenbudget hat und neue Objekte laufend dazukommen.
#
# Dokumente, die nur die Bekanntmachung samt Hinweis auf ein kostenpflichtiges
# Gutachten enthalten, überspringt das Skript ohne LLM-Aufruf — dort steht die
# Wohnfläche nicht und wird auch nie dort stehen.
#
# Einrichtung (crontab -e):
#   15 4 * * * /path/to/gavel/scrapers/wohnflaeche_backfill.sh >> /var/log/gavel-wohnflaeche.log 2>&1

set -euo pipefail

LIMIT="${1:-40}"

echo "$(date '+%Y-%m-%d %H:%M:%S'): Start (limit $LIMIT)"
docker exec gavel_scraper python3 /app/backfill_wohnflaeche.py --limit "$LIMIT" 2>&1 \
  | grep -E "Objekte ohne Wohnflaeche|Fertig:|m2 \(" \
  | tail -50
echo "$(date '+%Y-%m-%d %H:%M:%S'): Ende"
