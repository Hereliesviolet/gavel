#!/usr/bin/env bash
# Produktions-Deploy mit Migration-Check, Image-Snapshot und Smoke-Test.
# Bei fehlgeschlagenem Smoke wird automatisch scripts/rollback.sh aufgerufen.
#
#   ./scripts/deploy.sh
#   APPLY_MIGRATIONS=1 ./scripts/deploy.sh   # offene Migrationen zuerst anwenden
#   USE_SHARED_CADDY=1 ./scripts/deploy.sh   # zusätzlich docker-compose.shared-caddy.yml
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
COMPOSE_DIR="$ROOT/infra/docker"
STATE_DIR="${DEPLOY_STATE_DIR:-/var/lib/gavel/deploy}"
SMOKE_TRIES="${SMOKE_TRIES:-30}"

COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml)
# Attach web and minio to an existing reverse proxy's network (see docs/DEPLOYMENT.md).
if [[ "${USE_SHARED_CADDY:-0}" == "1" ]]; then
  COMPOSE+=(-f docker-compose.shared-caddy.yml)
fi

log() { echo "[deploy] $*"; }

[[ -f "$ENV_FILE" ]] || { echo "ENV-Datei fehlt: $ENV_FILE" >&2; exit 1; }
mkdir -p "$STATE_DIR"

cd "$COMPOSE_DIR"

if [[ "${APPLY_MIGRATIONS:-0}" == "1" ]]; then
  log "Migrationen anwenden"
  "$ROOT/scripts/migrate.sh"
else
  log "Migrationen prüfen"
  "$ROOT/scripts/migrate.sh" --check
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
for img in gavel_web gavel_scraper; do
  if docker image inspect "${img}:latest" >/dev/null 2>&1; then
    docker tag "${img}:latest" "${img}:prev"
    docker tag "${img}:latest" "${img}:${STAMP}"
    log "Snapshot ${img}:latest → ${img}:prev / ${img}:${STAMP}"
  else
    log "Kein bestehendes Image ${img}:latest — erster Deploy"
  fi
done
echo "$STAMP" > "$STATE_DIR/pending"

log "Build und Recreate"
"${COMPOSE[@]}" up -d --build web scraper prefect-worker

smoke_ok=0
for i in $(seq 1 "$SMOKE_TRIES"); do
  if docker exec gavel_web node -e \
    "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1 \
    && docker exec gavel_scraper python -c \
    "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/internal/health', timeout=4)" \
    >/dev/null 2>&1; then
    smoke_ok=1
    break
  fi
  log "Smoke wartet (${i}/${SMOKE_TRIES})"
  sleep 2
done

if (( smoke_ok == 0 )); then
  log "Smoke fehlgeschlagen — Rollback"
  "$ROOT/scripts/rollback.sh"
  exit 1
fi

echo "$STAMP" > "$STATE_DIR/last-good"
rm -f "$STATE_DIR/pending"
log "Fertig. Stand $STAMP. Rollback: ./scripts/rollback.sh"
