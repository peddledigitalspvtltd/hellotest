#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/../lib/compose.sh"

set -a
. ./.env
set +a

echo "Using compose file: $COMPOSE_FILE"

local_compose up -d --build

if [ "${TESTENGINE_AUTOSCALE:-true}" = "true" ]; then
  "$SCRIPT_DIR/autoscale-testengine.sh" start
fi

echo
echo "HelloTest local stack is starting."
echo "Frontend:    http://localhost:${FRONTEND_PORT:-8080}"
echo "API:         http://localhost:${API_PORT:-3000}"
echo "TestEngine:  http://localhost:${TESTENGINE_PORT:-4301}"
echo "OPS board:   http://localhost:${TESTENGINE_PORT:-4301}/ops-telemetry"
