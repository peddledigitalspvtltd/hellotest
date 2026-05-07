#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LOCAL_RUN_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
REPO_DIR=$(CDPATH= cd -- "$LOCAL_RUN_DIR/.." && pwd)
ENGINE_DIR="$REPO_DIR/testengine/backend"
BROWSER_DIR="${QAIRA_PLAYWRIGHT_BROWSERS_PATH:-$LOCAL_RUN_DIR/.playwright-browsers}"
ARTIFACT_DIR="${QAIRA_HOST_RECORDER_ARTIFACT_ROOT:-$LOCAL_RUN_DIR/artifacts/host-recorder}"
PORT="${QAIRA_HOST_RECORDER_PORT:-4311}"

mkdir -p "$BROWSER_DIR" "$ARTIFACT_DIR"

cd "$ENGINE_DIR"

if [ ! -d node_modules ]; then
  npm install
fi

PLAYWRIGHT_BROWSERS_PATH="$BROWSER_DIR" npx playwright install chromium
npm run build

echo "Starting QAira host recorder"
echo "  Browser URL: http://localhost:$PORT"
echo "  API/container URL: http://host.docker.internal:$PORT"
echo "  Browser binaries: $BROWSER_DIR"
echo

PORT="$PORT" \
ENGINE_NAME="${ENGINE_NAME:-qaira-host-recorder}" \
ENGINE_PUBLIC_URL="http://localhost:$PORT" \
ARTIFACT_ROOT="$ARTIFACT_DIR" \
RECORDER_HEADLESS=false \
PLAYWRIGHT_BROWSERS_PATH="$BROWSER_DIR" \
node dist/server.js
