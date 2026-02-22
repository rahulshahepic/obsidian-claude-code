#!/usr/bin/env bash
# Deploy latest code to the VPS.
# Run from the repo root on the VPS after pulling changes.
# Usage: bash scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

[ -f .env ] || { echo "ERROR: .env not found — run scripts/setup.sh first"; exit 1; }

# Inject secrets forwarded from GitHub Actions (if present in the environment).
# Each variable is written into .env, updating an existing line or appending.
inject_secret() {
  local key="$1" value="$2"
  [ -z "$value" ] && return
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    echo "${key}=${value}" >> .env
  fi
}

inject_secret GOOGLE_CLIENT_ID     "${GOOGLE_CLIENT_ID:-}"
inject_secret GOOGLE_CLIENT_SECRET "${GOOGLE_CLIENT_SECRET:-}"
inject_secret ALLOWED_EMAIL        "${ALLOWED_EMAIL:-}"

echo "=== Pulling latest code ==="
git pull

echo "=== Building and restarting containers ==="
docker compose up -d --build

echo "=== Done ==="
docker compose ps
