#!/usr/bin/env bash
# One-command redeploy for the Afro server. Run from the repo root on the server:
#   bash docker/deploy.sh
#
# Pulls latest, rebuilds, recreates, applies migrations (via the api entrypoint),
# and prints health. Seeding is separate and only needed once — see DEPLOY.md.
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml --env-file .env"

echo "==> Pulling latest"
git pull --ff-only

echo "==> Building images"
$COMPOSE build

echo "==> Recreating containers"
$COMPOSE up -d --force-recreate

echo "==> Waiting for API health"
for i in $(seq 1 40); do
  if curl -sf --max-time 5 "http://${BIND_IP:-127.0.0.1}:${API_PORT:-4000}/api/health" >/dev/null 2>&1; then
    echo "    API healthy"
    break
  fi
  sleep 3
done

echo "==> Status"
$COMPOSE ps
curl -s "http://${BIND_IP:-127.0.0.1}:${API_PORT:-4000}/api/health" && echo
