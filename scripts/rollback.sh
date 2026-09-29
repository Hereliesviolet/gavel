#!/usr/bin/env bash
# Startet die zuletzt gesicherten Images gavel_web:prev und
# gavel_scraper:prev erneut. Wird von deploy.sh bei fehlgeschlagenem
# Smoke aufgerufen oder manuell nach einem schlechten Deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
COMPOSE_DIR="$ROOT/infra/docker"

COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml)
if [[ "${USE_SHARED_CADDY:-0}" == "1" ]]; then
  COMPOSE+=(-f docker-compose.shared-caddy.yml)
fi

log() { echo "[rollback] $*"; }

for img in gavel_web gavel_scraper; do
  if ! docker image inspect "${img}:prev" >/dev/null 2>&1; then
    echo "Kein Rollback-Image ${img}:prev vorhanden." >&2
    exit 1
  fi
  docker tag "${img}:prev" "${img}:latest"
  log "Stelle ${img}:prev als latest wieder her"
done

cd "$COMPOSE_DIR"
"${COMPOSE[@]}" up -d --no-build web scraper prefect-worker
log "Vorherige Images gestartet."
