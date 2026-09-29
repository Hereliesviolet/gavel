#!/usr/bin/env bash
# Host-Backup für Postgres + MinIO (Enterprise P2).
#
# Cron (siehe docs/DEPLOYMENT.md):
#   15 3 * * *  SKIP_MINIO=1 .../backup.sh   # täglich, nur Postgres (~10 MB)
#   30 3 * * 0  .../backup.sh                # sonntags zusätzlich MinIO (~4 GB)
#
# MinIO wird bewusst NICHT täglich gesichert: das Volume ist mehrere GB groß,
# ändert sich nur langsam und würde die Host-Platte innerhalb weniger Tage
# füllen. Deshalb eigene, kurze Aufbewahrung über KEEP_MINIO_COPIES.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/gavel}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_ROOT/$STAMP"
KEEP_DAYS="${KEEP_DAYS:-14}"
KEEP_MINIO_COPIES="${KEEP_MINIO_COPIES:-2}"
SKIP_MINIO="${SKIP_MINIO:-0}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

mkdir -p "$DEST/postgres"

echo "[backup] start $STAMP"

docker exec gavel_postgres pg_dump -U immopulse -d immopulse -Fc \
  > "$DEST/postgres/immopulse.dump"

if [[ "$SKIP_MINIO" != "1" ]]; then
  mkdir -p "$DEST/minio"
  # Volume-Tar direkt vom Volume - kein mc mirror in /data, sonst landet die
  # Spiegelung im Live-Volume und wächst mit jedem Lauf in die nächste Sicherung.
  docker run --rm \
    -v "${MINIO_VOLUME:-gavel_minio_data}":/data:ro \
    -v "$DEST/minio":/backup \
    alpine:3.20 \
    tar -czf /backup/minio-data.tgz -C /data .
fi

echo "$STAMP" > "$DEST/OK"

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +

# MinIO-Tars separat und knapper halten (mehrere GB pro Kopie)
while read -r old_tar; do
  [[ -n "$old_tar" ]] || continue
  echo "[backup] entferne alten MinIO-Tar: $old_tar"
  rm -f "$old_tar"
done < <(ls -1dt "$BACKUP_ROOT"/*/minio/minio-data.tgz 2>/dev/null | tail -n +$((KEEP_MINIO_COPIES + 1)))

echo "[backup] done -> $DEST"
echo "[backup] restore tip:"
echo "  docker exec -i gavel_postgres pg_restore -U immopulse -d immopulse --clean --if-exists < $DEST/postgres/immopulse.dump"
