#!/usr/bin/env bash
# Wendet die Drizzle-Migrationen gegen den Prod-Postgres an und protokolliert sie
# in drizzle.__drizzle_migrations - identisches Format wie `drizzle-kit migrate`
# (hash = sha256 der SQL-Datei, created_at = "when" aus meta/_journal.json),
# damit beide Wege denselben Stand sehen.
#
# Läuft bewusst über `docker exec ... psql` statt über drizzle-kit: Postgres ist
# in Prod nicht auf den Host gemappt und das Runner-Image enthält kein
# drizzle-kit (devDependency).
#
# Modi:
#   ./scripts/migrate.sh              Offene Migrationen anwenden
#   ./scripts/migrate.sh --check      Nur prüfen; Exit 1 wenn etwas offen ist
#   ./scripts/migrate.sh --baseline   Als angewendet markieren, OHNE auszuführen
#                                     (einmalig für die bestehende Prod-DB)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/apps/web/drizzle/migrations"
JOURNAL="$MIGRATIONS_DIR/meta/_journal.json"
PG_CONTAINER="${PG_CONTAINER:-gavel_postgres}"
PG_USER="${PG_USER:-immopulse}"
PG_DB="${PG_DB:-immopulse}"

MODE="apply"
case "${1:-}" in
  --check) MODE="check" ;;
  --baseline) MODE="baseline" ;;
  "") ;;
  *) echo "Unbekannte Option: $1" >&2; exit 2 ;;
esac

[[ -f "$JOURNAL" ]] || { echo "Journal fehlt: $JOURNAL" >&2; exit 1; }

psql_run() { docker exec -i "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB" "$@"; }

psql_run -q <<'SQL'
SET client_min_messages = warning;
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
SQL

pending=0
applied=0

# Journal vorab einlesen: `docker exec -i` unten würde sonst den stdin der
# Schleife konsumieren und nach dem ersten Eintrag abbrechen.
mapfile -t entries < <(python3 -c "
import json
with open('$JOURNAL') as f:
    journal = json.load(f)
for entry in sorted(journal['entries'], key=lambda e: e['idx']):
    print(entry['tag'], entry['when'])
")

for entry in "${entries[@]}"; do
  read -r tag when <<<"$entry"
  file="$MIGRATIONS_DIR/$tag.sql"
  [[ -f "$file" ]] || { echo "Migration fehlt: $file" >&2; exit 1; }
  hash="$(sha256sum "$file" | cut -d' ' -f1)"

  if [[ -n "$(psql_run -tAc "SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '$hash' LIMIT 1")" ]]; then
    continue
  fi

  pending=$((pending + 1))

  case "$MODE" in
    check)
      echo "offen: $tag"
      ;;
    baseline)
      psql_run -q -c "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('$hash', $when);"
      echo "baseline: $tag"
      applied=$((applied + 1))
      ;;
    apply)
      echo "anwenden: $tag"
      {
        echo "BEGIN;"
        cat "$file"
        echo ";"
        echo "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('$hash', $when);"
        echo "COMMIT;"
      } | psql_run -q
      applied=$((applied + 1))
      ;;
  esac
done

if [[ "$MODE" == "check" ]]; then
  if (( pending > 0 )); then
    echo "$pending Migration(en) offen - Deploy stoppen und ./scripts/migrate.sh ausführen." >&2
    exit 1
  fi
  echo "Schema aktuell, keine offenen Migrationen."
  exit 0
fi

echo "Fertig: $applied verarbeitet, Schema auf Journal-Stand."
