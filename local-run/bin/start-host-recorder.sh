#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LOCAL_RUN_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
REPO_DIR=$(CDPATH= cd -- "$LOCAL_RUN_DIR/.." && pwd)
ENGINE_DIR="$REPO_DIR/testengine/backend"
BROWSER_DIR="${QAIRA_PLAYWRIGHT_BROWSERS_PATH:-$LOCAL_RUN_DIR/.playwright-browsers}"
ARTIFACT_DIR="${QAIRA_HOST_RECORDER_ARTIFACT_ROOT:-$LOCAL_RUN_DIR/artifacts/host-recorder}"
PORT="${QAIRA_HOST_RECORDER_PORT:-4311}"
HOST_RECORDER_BIN="${QAIRA_HOST_RECORDER_BIN:-$LOCAL_RUN_DIR/bin/qaira-host-recorder}"
SOURCE_NEWER_THAN_RECORDER=false

if [ -x "$HOST_RECORDER_BIN" ] && [ -f "$ENGINE_DIR/src/lib/recorder.ts" ] && [ "$ENGINE_DIR/src/lib/recorder.ts" -nt "$HOST_RECORDER_BIN" ]; then
  SOURCE_NEWER_THAN_RECORDER=true
fi

mkdir -p "$BROWSER_DIR" "$ARTIFACT_DIR"

if command -v curl >/dev/null 2>&1 && curl -fsS "http://localhost:$PORT/health" >/dev/null 2>&1; then
  echo "QAira host recorder is already running"
  echo "  Browser URL: http://localhost:$PORT"
  echo "  API/container URL: http://host.docker.internal:$PORT"
  if [ "$SOURCE_NEWER_THAN_RECORDER" = "true" ]; then
    echo "  Updated Inspect source is available; restart this host recorder to load it."
  fi
  exit 0
fi

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use, but it does not look like the QAira host recorder."
  echo
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN || true
  echo
  echo "Stop that process, or start the recorder on another port:"
  echo "  QAIRA_HOST_RECORDER_PORT=4312 bin/start-host-recorder.sh"
  exit 1
fi

USE_PACKAGED_RECORDER=true
if [ "$SOURCE_NEWER_THAN_RECORDER" = "true" ]; then
  USE_PACKAGED_RECORDER=false
  echo "Recorder source is newer than the packaged binary; using the current source build."
  echo "  Run npm run package:host-recorder from testengine/backend to refresh the distributed binary."
  echo
fi

if [ -x "$HOST_RECORDER_BIN" ] && [ "$USE_PACKAGED_RECORDER" = "true" ]; then
  echo "Starting QAira host recorder from packaged binary"
  echo "  Binary: $HOST_RECORDER_BIN"
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
  "$HOST_RECORDER_BIN"
  exit $?
fi

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
