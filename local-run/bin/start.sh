#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LOCAL_RUN_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${QAIRA_LOCAL_COMPOSE_FILE:-docker-compose.yml}

cd "$LOCAL_RUN_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created local-run/.env from .env.example"
fi

set -a
. ./.env
set +a

echo "Using compose file: $COMPOSE_FILE"

docker compose --env-file .env -f "$COMPOSE_FILE" up -d --build

if [ "${TESTENGINE_AUTOSCALE:-true}" = "true" ]; then
  "$SCRIPT_DIR/autoscale-testengine.sh" start
fi

echo
echo "QAira local stack is starting."
echo "Frontend:    http://localhost:${FRONTEND_PORT:-8080}"
echo "API:         http://localhost:${API_PORT:-3000}"
echo "TestEngine:  http://localhost:${TESTENGINE_PORT:-4301}"
echo "OPS board:   http://localhost:${TESTENGINE_PORT:-4301}/ops-telemetry"
echo "LLM:         http://localhost:${LLM_PORT:-11434}"
echo "AI agent:    polls ${QAIRA_AGENT_API_BASE_URL:-http://api:3000} and ${LLM_BASE_URL:-http://llm:11434}"
