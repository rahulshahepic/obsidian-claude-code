#!/usr/bin/env bash
# Deploy latest code to the VPS.
# Run from the repo root on the VPS after pulling changes.
# Usage: bash scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

[ -f .env ] || { echo "ERROR: .env not found — run scripts/setup.sh first"; exit 1; }

# Inject a secret into .env, safe against special characters in the value.
# Removes any existing line for the key and appends the new one.
# Prints SET or SKIP for each key so CI logs show exactly what happened.
inject_secret() {
  local key="$1" value="$2"
  if [ -z "$value" ]; then
    echo "  SKIP  $key  (not in environment — keeping existing .env value)"
    return
  fi
  grep -v "^${key}=" .env > .env.tmp || true
  mv .env.tmp .env
  printf '%s=%s\n' "$key" "$value" >> .env
  echo "  SET   $key"
}

# Print a summary of all keys in .env — names only, never values.
print_env_summary() {
  echo ""
  echo "  Key                       Status"
  echo "  ─────────────────────     ──────"
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
    if [ -n "$value" ]; then
      printf "  %-25s set\n" "$key"
    else
      printf "  %-25s ** EMPTY **\n" "$key"
    fi
  done < .env
  echo ""
}

echo "=== Pulling latest code ==="
git pull

echo ""
echo "=== Injecting secrets ==="
# Inject GitHub-managed secrets AFTER git pull so this logic is always up to date
# on subsequent runs (first run uses the function already defined above).
inject_secret GOOGLE_CLIENT_ID     "${GOOGLE_CLIENT_ID:-}"
inject_secret GOOGLE_CLIENT_SECRET "${GOOGLE_CLIENT_SECRET:-}"
inject_secret ALLOWED_EMAIL        "${ALLOWED_EMAIL:-}"

echo ""
echo "=== .env summary (keys only) ==="
print_env_summary

echo "=== Building and restarting containers ==="
docker compose up -d --build

echo ""
echo "=== Container status ==="
docker compose ps
