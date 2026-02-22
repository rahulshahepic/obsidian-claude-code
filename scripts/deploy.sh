#!/usr/bin/env bash
# Deploy latest code to the VPS.
# Run from the repo root on the VPS after pulling changes.
# Usage: bash scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

[ -f .env ] || { echo "ERROR: .env not found — run scripts/setup.sh first"; exit 1; }

# Inject a secret into .env, safe against special characters in the value.
# Removes any existing line for the key and appends the new one.
inject_secret() {
  local key="$1" value="$2"
  [ -z "$value" ] && return
  # Remove existing line (if any), then append — avoids sed special-char issues.
  grep -v "^${key}=" .env > .env.tmp || true
  mv .env.tmp .env
  printf '%s=%s\n' "$key" "$value" >> .env
}

echo "=== Pulling latest code ==="
git pull

# Inject GitHub-managed secrets AFTER git pull so this logic is always up to date
# on subsequent runs (first run uses the function already defined above).
inject_secret GOOGLE_CLIENT_ID     "${GOOGLE_CLIENT_ID:-}"
inject_secret GOOGLE_CLIENT_SECRET "${GOOGLE_CLIENT_SECRET:-}"
inject_secret ALLOWED_EMAIL        "${ALLOWED_EMAIL:-}"

echo "=== Building and restarting containers ==="
docker compose up -d --build

echo "=== Done ==="
docker compose ps
