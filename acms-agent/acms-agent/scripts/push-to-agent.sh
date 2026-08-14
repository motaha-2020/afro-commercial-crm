#!/usr/bin/env bash
# Push this working copy to the ACMS Agent staging stack on the Afro server and
# redeploy it. Run from the repo root in Git Bash:
#   bash scripts/push-to-agent.sh
#
# Only touches ~/acms-agent (compose project `acms-agent`). The live `acms` stack
# under ~mohamed.taha is never involved.
set -euo pipefail

SERVER=mohamed.adel@100.122.6.64
REMOTE=acms-agent

cd "$(dirname "$0")/.."

echo "==> Syncing source to $SERVER:~/$REMOTE"
# .env and build artifacts stay on the server; node_modules is never shipped.
tar --exclude=node_modules \
    --exclude=.next \
    --exclude=dist \
    --exclude=.git \
    --exclude=.env \
    -czf - . | ssh "$SERVER" "tar -xzf - -C ~/$REMOTE"

echo "==> Redeploying"
ssh "$SERVER" "cd ~/$REMOTE && bash docker/deploy-agent.sh"

echo "==> Done — http://100.122.6.64:3110"
