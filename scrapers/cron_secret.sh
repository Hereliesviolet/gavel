# Gemeinsame Audience-Auflösung für Host-Cron-Skripte.
# Ist das scoped Secret in $ENV_FILE gesetzt, gilt nur dieses; sonst CRON_SECRET.

cron_secret_for_audience() {
  local scoped_name="$1"
  local scoped=""
  local shared=""
  if [ -f "${ENV_FILE:-}" ]; then
    scoped=$(grep -E "^${scoped_name}=" "$ENV_FILE" | head -1 | cut -d= -f2-)
    shared=$(grep -E '^CRON_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  fi
  if [ -n "${scoped:-}" ]; then
    printf '%s' "$scoped"
  else
    printf '%s' "${shared:-}"
  fi
}
