#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LOCAL_RUN_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${QAIRA_LOCAL_COMPOSE_FILE:-docker-compose.yml}

cd "$LOCAL_RUN_DIR"
[ -f .env ] || cp .env.example .env

set -a
. ./.env
set +a

docker compose --env-file .env -f "$COMPOSE_FILE" exec -T postgres psql \
  -U "${POSTGRES_USER:-qaira}" \
  -d "${POSTGRES_DB:-qaira}" \
  < db/03-local-integrations.sql

echo "Updated local admin integrations:"
echo "  API/container base URL: http://testengine:4301"
echo "  Browser recorder URL:   http://localhost:4301"
echo "  Browser OPS board URL:  http://localhost:4301/ops-telemetry"
echo "  Mobile engine URL:      http://localhost:4312 / http://mobile-engine:4312"
echo "  Web execution engine:   playwright/chromium"
echo "  Queue polling:          0.5 minutes"
echo
echo "Restarting API container."
docker compose --env-file .env -f "$COMPOSE_FILE" restart api
