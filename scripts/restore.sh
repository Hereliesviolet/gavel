#!/usr/bin/env bash
# Wiederherstellung aus scripts/backup.sh.
#
# Standard: Restore-Test in eine Wegwerf-DB (gavel_restoretest).
# Produktiv überschreiben nur mit LIVE=1 CONFIRM=OVERWRITE_PROD.
set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/gavel}"
DUMP="${DUMP:-}"
LIVE="${LIVE:-0}"

if [[ -z "$DUMP" ]]; then
  DUMP="$(ls -1dt "$BACKUP_ROOT"/*/postgres/immopulse.dump 2>/dev/null | head -1 || true)"
fi
if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "[restore] Kein Dump unter $BACKUP_ROOT gefunden." >&2
  exit 1
fi

echo "[restore] dump=$DUMP"

if [[ "$LIVE" == "1" ]]; then
  if [[ "${CONFIRM:-}" != "OVERWRITE_PROD" ]]; then
    echo "[restore] LIVE=1 braucht CONFIRM=OVERWRITE_PROD" >&2
    exit 1
  fi
  echo "[restore] überschreibe gavel"
  docker exec -i gavel_postgres pg_restore -U immopulse -d immopulse \
    --clean --if-exists --no-owner < "$DUMP"
  echo "[restore] produktiv wiederhergestellt"
  exit 0
fi

docker exec gavel_postgres psql -U immopulse -d postgres \
  -c "DROP DATABASE IF EXISTS gavel_restoretest;"
docker exec gavel_postgres psql -U immopulse -d postgres \
  -c "CREATE DATABASE gavel_restoretest OWNER immopulse;"
docker exec -i gavel_postgres pg_restore -U immopulse \
  -d gavel_restoretest --no-owner < "$DUMP"
echo "[restore] testdb=gavel_restoretest"
echo "[restore] danach: docker exec gavel_postgres psql -U immopulse -d postgres -c \"DROP DATABASE gavel_restoretest;\""
