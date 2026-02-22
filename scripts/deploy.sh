#!/usr/bin/env bash
# Deploy latest code to the VPS.
# Run from the repo root on the VPS after pulling changes.
# Usage: bash scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

[ -f .env ] || { echo "ERROR: .env not found — run scripts/setup.sh first"; exit 1; }

echo "=== Pulling latest code ==="
git pull

echo "=== Building and restarting containers ==="
docker compose up -d --build

echo "=== Done ==="
docker compose ps
