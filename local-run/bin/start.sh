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

docker compose --env-file .env -f "$COMPOSE_FILE" up -d --build

echo
echo "QAira local stack is starting."
echo "Frontend:    http://localhost:${FRONTEND_PORT:-8080}"
echo "API:         http://localhost:${API_PORT:-3000}"
echo "TestEngine:  http://localhost:${TESTENGINE_PORT:-4301}"
echo "OPS board:   http://localhost:${TESTENGINE_PORT:-4301}/ops-telemetry"
