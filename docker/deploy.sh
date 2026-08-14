#!/usr/bin/env bash
# One-command redeploy for the Afro server. Run from the repo root on the server:
#   bash docker/deploy.sh
#
# Pulls latest, rebuilds, recreates, applies migrations (via the api entrypoint),
# and prints health. Seeding is separate and only needed once — see DEPLOY.md.
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml --env-file .env"

# .env reaches the containers through --env-file, but not this shell. Without
# it BIND_IP fell back to 127.0.0.1 while the API publishes on the Tailscale
# address only, so the health check asked an address nothing was listening on
# and every successful deploy ended by reporting a connection failure.
set -a
# shellcheck disable=SC1091
. ./.env
set +a

HEALTH="http://${BIND_IP:-127.0.0.1}:${API_PORT:-4000}/api/health"

echo "==> Pulling latest"
git pull --ff-only

echo "==> Building images"
$COMPOSE build

echo "==> Recreating containers"
$COMPOSE up -d --force-recreate

echo "==> Waiting for API health"
healthy=0
for _ in $(seq 1 40); do
  if curl -sf --max-time 5 "$HEALTH" >/dev/null 2>&1; then
    echo "    API healthy"
    healthy=1
    break
  fi
  sleep 3
done

# Said out loud. The loop used to fall through silently after two minutes and
# the deploy carried on printing status, so a container that never came up
# looked the same as one that did.
if [ "$healthy" -eq 0 ]; then
  echo "!!! API did not become healthy within 120s — check: $COMPOSE logs api" >&2
  $COMPOSE ps
  exit 1
fi

echo "==> Status"
$COMPOSE ps
curl -s "$HEALTH" && echo
