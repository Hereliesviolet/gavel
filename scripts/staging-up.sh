#!/usr/bin/env bash
# Startet den isolierten Staging-Stack (eigene Volumes, Port 3001).
# Niemals docker-compose.prod.yml dazumischen.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.staging}"
COMPOSE_FILE="$ROOT/infra/docker/docker-compose.staging.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Staging-Env fehlt: $ENV_FILE (Kopie von .env.example nach .env.staging)." >&2
  exit 1
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build

echo "[staging] Stack läuft. Web: http://127.0.0.1:3001  Postgres: localhost:5435"
echo "[staging] Migrationen: PG_CONTAINER=gavel_staging_postgres ./scripts/migrate.sh"
