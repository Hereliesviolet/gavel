#!/usr/bin/env bash
set -euo pipefail

# Recreate prefect-worker only when Daily/KI den Heavy-Lock nicht halten.
# Kill während Portal/KI war die Ursache für halbe Tagesläufe.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(
  docker compose
  --env-file "$ROOT/.env"
  -f "$ROOT/infra/docker/docker-compose.prod.yml"
)
if [[ "${USE_SHARED_CADDY:-0}" == "1" ]]; then
  COMPOSE+=(-f "$ROOT/infra/docker/docker-compose.shared-caddy.yml")
fi

held="$(docker exec -i gavel_postgres psql -U immopulse -d immopulse -tAc \
  "SELECT pg_try_advisory_lock(hashtext('gavel-heavy-worker'))")"

if [[ "$held" != "t" ]]; then
  echo "Worker-Recreate verweigert: Daily oder Worker-KI hält gavel-heavy-worker." >&2
  exit 2
fi

docker exec -i gavel_postgres psql -U immopulse -d immopulse -c \
  "SELECT pg_advisory_unlock(hashtext('gavel-heavy-worker'))" >/dev/null

"${COMPOSE[@]}" up -d --no-deps --no-build prefect-worker
echo "prefect-worker neu gestartet"
