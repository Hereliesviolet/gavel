#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$ROOT/apps/web"

PASS=0
FAIL=0
declare -a VIOLATIONS=()

check() {
  local name="$1"
  local pattern="$2"
  shift 2
  local matches
  if matches=$(rg -n "$pattern" "$WEB" "$@" 2>/dev/null); then
    VIOLATIONS+=("FAIL  $name")
    while IFS= read -r line; do
      VIOLATIONS+=("      $line")
    done <<< "$matches"
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
}

check "rounded-2xl / rounded-xl" 'rounded-2xl|rounded-xl' --glob '*.{tsx,ts}'
check "max-w-7xl" 'max-w-7xl'
check "legacy theme system" 'color-theme|ColorTheme|next-themes|useTheme|ThemeToggle|data-color-theme'
check "IBM Plex font" 'IBM Plex'
check "legacy theme names" 'violett|ozean|smaragd|bernstein' --glob '!**/drizzle/**'
check "rounded-lg on TSX" 'rounded-lg' --glob '*.tsx'
check "rounded-md on TSX" 'rounded-md' --glob '*.tsx'
check "rounded-sm on TSX" 'rounded-sm' --glob '*.tsx'
check "tailwind blue/indigo/amber colors" 'blue-[0-9]|indigo-[0-9]|amber-[0-9]' --glob '*.{tsx,ts,css}'
check "tailwind emerald/red/green colors" 'emerald-[0-9]|red-5\d\d|green-5\d\d' --glob '*.{tsx,ts,css}'

echo "Design Drift Check — Neon-only"
echo "=============================="
echo "PASS: $PASS"
echo "FAIL: $FAIL"
echo

if [[ ${#VIOLATIONS[@]} -gt 0 ]]; then
  printf '%s\n' "${VIOLATIONS[@]}"
  echo
  echo "Drift check FAILED."
  exit 1
fi

echo "All checks passed."
exit 0
