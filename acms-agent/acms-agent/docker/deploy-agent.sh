#!/usr/bin/env bash
# Redeploy the ACMS Agent working copy. Run from the repo root on the server:
#   bash docker/deploy-agent.sh
#
# Same as docker/deploy.sh but for the isolated `acms-agent` project, and with no
# `git pull` — this copy is not a git clone. Push source changes here first
# (rsync/scp from the dev machine), then run this.
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker/docker-compose.yml -f docker/docker-compose.agent.yml --env-file .env"

echo "==> Building images"
$COMPOSE build

echo "==> Recreating containers"
$COMPOSE up -d --force-recreate

echo "==> Waiting for API health"
for i in $(seq 1 40); do
  if curl -sf --max-time 5 "http://100.122.6.64:4010/api/health/ready" >/dev/null 2>&1; then
    echo "    API healthy"
    break
  fi
  sleep 3
done

echo "==> Status"
$COMPOSE ps
curl -s "http://100.122.6.64:4010/api/health/ready" && echo
