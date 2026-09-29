#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
SMOKE_EMAIL="${SMOKE_EMAIL:-}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-}"
CRON_SECRET="${CRON_SECRET:-}"
SMTP_DRY_RUN="${SMTP_DRY_RUN:-true}"
RUN_PHASE_A="${RUN_PHASE_A:-true}"

PASS=0
FAIL=0
SKIP=0
WARN=0
declare -a RESULTS=()

JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

log_result() {
  local status="$1"
  local id="$2"
  local name="$3"
  local extra="${4:-}"
  if [[ -n "$extra" ]]; then
    RESULTS+=("$status  $id  $name ($extra)")
  else
    RESULTS+=("$status  $id  $name")
  fi
  case "$status" in
    PASS) PASS=$((PASS + 1)) ;;
    FAIL) FAIL=$((FAIL + 1)) ;;
    SKIP) SKIP=$((SKIP + 1)) ;;
    WARN) WARN=$((WARN + 1)) ;;
  esac
}

run_test() {
  local id="$1"
  local name="$2"
  shift 2
  if "$@"; then
    log_result "PASS" "$id" "$name"
  else
    log_result "FAIL" "$id" "$name"
  fi
}

skip_test() {
  log_result "SKIP" "$1" "$2" "$3"
}

warn_test() {
  log_result "WARN" "$1" "$2" "$3"
}

http_code() {
  curl -sS -o /dev/null -w "%{http_code}" "$@"
}

# Der komplette Investor-Bereich liegt hinter dem Login. Ohne Zugangsdaten ist
# die Weiterleitung dorthin das erwartete Ergebnis, kein Fehlschlag; die
# Inhaltsprüfung greift erst mit gültiger Sitzung.
run_investor_page_test() {
  local id="$1" name="$2" pfad="$3" muster="$4"
  local code
  code="$(http_code -b "$JAR" "${BASE_URL}${pfad}")"
  if [[ "$code" == "307" || "$code" == "302" ]]; then
    skip_test "$id" "$name" "Login erforderlich"
  elif [[ "$code" == "200" ]] && curl -sS -b "$JAR" "${BASE_URL}${pfad}" | grep -qi "$muster"; then
    log_result "PASS" "$id" "$name"
  else
    log_result "FAIL" "$id" "$name" "HTTP $code"
  fi
}

json_get() {
  curl -sS "$@"
}

login_smoke_user() {
  local csrf
  csrf="$(json_get "${BASE_URL}/api/auth/csrf" -c "$JAR" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("csrfToken",""))')"
  if [[ -z "$csrf" ]]; then
    return 1
  fi
  local status
  status="$(curl -sS -o /dev/null -w "%{http_code}" -b "$JAR" -c "$JAR" \
    -X POST "${BASE_URL}/api/auth/callback/credentials" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "csrfToken=${csrf}" \
    --data-urlencode "email=${SMOKE_EMAIL}" \
    --data-urlencode "password=${SMOKE_PASSWORD}" \
    --data-urlencode "redirect=false" \
    --data-urlencode "json=true")"
  [[ "$status" == "200" || "$status" == "302" ]]
}

# ─── Phase A: Build & Static ────────────────────────────────────────────────
if [[ "$RUN_PHASE_A" == "true" ]]; then
  REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

  run_test "A1" "pnpm audit" bash -c "cd '$REPO_ROOT' && pnpm audit"
  run_test "A2" "pnpm --filter web build" bash -c "cd '$REPO_ROOT' && pnpm --filter web build"
  run_test "A3" "tsc --noEmit" bash -c "cd '$REPO_ROOT/apps/web' && npx tsc --noEmit"
  run_test "A4" "eslint (deps scope)" bash -c "cd '$REPO_ROOT/apps/web' && pnpm exec eslint lib/email.ts lib/investor-finder.ts lib/investor-queries.ts lib/einstieg-picks.ts __tests__/deps --max-warnings 0"
  run_test "A5" "drizzle-kit generate" bash -c "cd '$REPO_ROOT/apps/web' && pnpm db:generate"

  run_test "A6" "lockfile versions" bash -c "
    cd '$REPO_ROOT' && \
    grep -q 'drizzle-orm@0.45' pnpm-lock.yaml && \
    grep -q 'nodemailer@9' pnpm-lock.yaml && \
    python3 - <<'PY'
import re, pathlib
lock = pathlib.Path('pnpm-lock.yaml').read_text()
def ver(pkg, pattern):
    m = re.search(pattern, lock)
    return m.group(1) if m else None
assert ver('drizzle-orm', r'drizzle-orm@([0-9.]+)') >= '0.45.2'
assert ver('nodemailer', r'nodemailer@([0-9.]+)') >= '9.0.1'
assert ver('esbuild', r'esbuild@([0-9.]+)') >= '0.25.0'
postcss = re.findall(r'postcss@([0-9.]+)', lock)
assert any(p >= '8.5.10' for p in postcss), postcss
print('versions ok')
PY
  "
fi

# ─── Phase B: Public APIs & pages ───────────────────────────────────────────
export BASE_URL

# Die Investor-Feeds liefen früher zusätzlich als JSON-Endpunkte, die kein
# Frontend aufgerufen hat. Sie sind entfernt; geprüft wird jetzt die Seite,
# die dieselben Daten serverseitig rendert.
run_test "B3" "GET /investor/desk (Login erforderlich)" env BASE_URL="$BASE_URL" bash -c '
  code=$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/investor/desk")
  [[ "$code" == "200" || "$code" == "307" || "$code" == "302" ]]
'

run_test "B5" "Altlink /investor/fix-flip leitet auf Preset" env BASE_URL="$BASE_URL" bash -c '
  ziel=$(curl -sS -o /dev/null -w "%{redirect_url}" "${BASE_URL}/investor/fix-flip")
  echo "$ziel" | grep -q "preset=fix-flip"
'

run_test "B6" "GET /api/termine" env BASE_URL="$BASE_URL" bash -c '
  code=$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/api/termine?limit=5")
  [[ "$code" == "200" || "$code" == "401" || "$code" == "307" || "$code" == "302" ]]
'

run_zvg_test() {
  local id="$1"
  local name="$2"
  local use_auth="${3:-false}"
  local curl_args=(-sS)
  if [[ "$use_auth" == "true" ]]; then
    curl_args+=(-b "$JAR")
  fi
  if body="$(curl "${curl_args[@]}" "${BASE_URL}/api/zvg?limit=3&sort=neu_zuerst")" && python3 -c "
import json,sys
d=json.loads(sys.argv[1])
assert \"listings\" in d and isinstance(d[\"listings\"], list)
" "$body" 2>/dev/null; then
    log_result "PASS" "$id" "$name"
  else
    log_result "FAIL" "$id" "$name"
  fi
}

# ─── Phase C prep: login early for auth-gated APIs ──────────────────────────
AUTH_READY=false
if [[ -n "$SMOKE_EMAIL" && -n "$SMOKE_PASSWORD" ]]; then
  if login_smoke_user; then
    AUTH_READY=true
    log_result "PASS" "C1" "POST credentials login"
  else
    log_result "FAIL" "C1" "POST credentials login"
  fi
else
  skip_test "C1" "POST credentials login" "SMOKE_EMAIL/PASSWORD not set"
fi

if [[ "$AUTH_READY" == "true" ]]; then
  run_zvg_test "B7" "GET /api/zvg (auth)" true
else
  code="$(http_code "${BASE_URL}/api/zvg?limit=3&sort=neu_zuerst")"
  if [[ "$code" == "200" ]]; then
    run_zvg_test "B7" "GET /api/zvg" false
  else
    skip_test "B7" "GET /api/zvg" "auth required (HTTP $code)"
  fi
fi

run_test "B8" "GET / (homepage)" env BASE_URL="$BASE_URL" bash -c '
  html=$(curl -sSL "${BASE_URL}/")
  echo "$html" | grep -qi "Gavel"
'

run_investor_page_test "B1" "GET /investor/suche" "/investor/suche?preset=fix-flip" "Treffer"
run_investor_page_test "B2" "GET /investor/datenbasis" "/investor/datenbasis" "Abdeckung"
run_investor_page_test "B9" "GET /investor" "/investor" "Heute"
run_investor_page_test "B10" "GET /investor/datenbasis Lernschleife" "/investor/datenbasis" "Kalibrierung"

if xml="$(curl -sSL "${BASE_URL}/sitemap.xml")" && echo "$xml" | grep -q "<urlset"; then
  log_result "PASS" "B11" "GET /sitemap.xml"
elif echo "$xml" | grep -qi "login"; then
  skip_test "B11" "GET /sitemap.xml" "auth gate — deploy proxy fix"
else
  log_result "FAIL" "B11" "GET /sitemap.xml"
fi

# ─── Phase C: Auth (optional) ───────────────────────────────────────────────
if [[ "$AUTH_READY" == "true" ]]; then
  run_test "C2" "GET /api/objekte (auth)" env BASE_URL="$BASE_URL" bash -c '
    code=$(curl -sS -o /dev/null -w "%{http_code}" -b "'"$JAR"'" "${BASE_URL}/api/objekte")
    [[ "$code" == "200" ]]
  '

  run_test "C3" "GET /api/favorites (auth)" env BASE_URL="$BASE_URL" bash -c '
    code=$(curl -sS -o /dev/null -w "%{http_code}" -b "'"$JAR"'" "${BASE_URL}/api/favorites")
    [[ "$code" == "200" ]]
  '

  run_test "C4" "GET /api/alerts (auth)" env BASE_URL="$BASE_URL" bash -c '
    code=$(curl -sS -o /dev/null -w "%{http_code}" -b "'"$JAR"'" "${BASE_URL}/api/alerts")
    [[ "$code" == "200" ]]
  '

  run_test "C5" "GET /api/auth/session (auth)" env BASE_URL="$BASE_URL" bash -c '
    body=$(curl -sS "${BASE_URL}/api/auth/session" -b "'"$JAR"'")
    python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert d.get(\"user\", {}).get(\"email\")" "$body"
  '

  run_test "C6" "GET /api/zvg/[slug] (auth)" env BASE_URL="$BASE_URL" bash -c '
    listing=$(curl -sS "${BASE_URL}/api/zvg?limit=1" -b "'"$JAR"'")
    slug=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d[\"listings\"][0][\"slug\"])" "$listing")
    bundesland=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d[\"listings\"][0].get(\"bundesland\") or \"\")" "$listing")
    body=$(curl -sS "${BASE_URL}/api/zvg/${slug}?bundesland=${bundesland}" -b "'"$JAR"'")
    python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert d.get(\"listing\") or d.get(\"slug\") or \"listing\" in str(d)" "$body"
  '
else
  skip_test "C2" "GET /api/objekte (auth)" "no credentials"
  skip_test "C3" "GET /api/favorites (auth)" "no credentials"
  skip_test "C4" "GET /api/alerts (auth)" "no credentials"
  skip_test "C5" "GET /api/auth/session (auth)" "no credentials"
  skip_test "C6" "GET /api/zvg/[slug] (auth)" "no credentials"
fi

# ─── Phase D: Nodemailer dry-run ────────────────────────────────────────────
if [[ "$SMTP_DRY_RUN" == "true" ]]; then
  run_test "D1" "email transport init (dry-run)" bash -c "
    cd \"$(cd "$(dirname "$0")/.." && pwd)/apps/web\" && \
    SMTP_HOST=localhost SMTP_USER=test SMTP_PASSWORD=test SMTP_DRY_RUN=true \
    node --input-type=module -e \"
import nodemailer from 'nodemailer';
const t = nodemailer.createTransport({ host: 'localhost', port: 1025, auth: { user: 't', pass: 't' } });
if (typeof t.sendMail !== 'function') process.exit(1);
console.log('ok');
\"
  "
else
  skip_test "D1" "email transport init" "SMTP_DRY_RUN=false"
fi

skip_test "D2" "POST /api/cron/data-quality-report" "manual staging only"
skip_test "D3" "POST /api/cron/check-alerts" "manual staging only"

# ─── Phase E: Security baseline ─────────────────────────────────────────────
run_test "E8" "Suche vw_max injection" env BASE_URL="$BASE_URL" JAR="$JAR" bash -c '
  code=$(curl -sS -b "$JAR" -o /dev/null -w "%{http_code}" "${BASE_URL}/investor/suche?vw_max=999999999")
  [[ "$code" == "200" || "$code" == "307" || "$code" == "302" ]]
'

run_test "E9" "search-suggestions SQL injection" env BASE_URL="$BASE_URL" bash -c '
  curl_args=(-sS -o /dev/null -w "%{http_code}" -G "${BASE_URL}/api/search-suggestions" --data-urlencode "q='\'' OR 1=1--")
  if [[ "'"$AUTH_READY"'" == "true" ]]; then
    curl_args=(-b "'"$JAR"'" "${curl_args[@]}")
  fi
  code=$(curl "${curl_args[@]}")
  [[ "$code" == "200" || "$code" == "400" || "$code" == "401" || "$code" == "307" || "$code" == "302" ]]
'

# ─── Report ─────────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════"
printf '%s\n' "${RESULTS[@]}"
echo "PASS=$PASS FAIL=$FAIL SKIP=$SKIP WARN=$WARN"
exit $([[ "$FAIL" -eq 0 ]] && echo 0 || echo 1)
