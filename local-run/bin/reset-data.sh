#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LOCAL_RUN_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${HELLOTEST_LOCAL_COMPOSE_FILE:-docker-compose.yml}

cd "$LOCAL_RUN_DIR"
[ -f .env ] || cp .env.example .env

echo "This removes only the local-run Postgres and Test Engine artifact volumes."
docker compose --env-file .env -f "$COMPOSE_FILE" down -v
docker compose --env-file .env -f "$COMPOSE_FILE" up -d --build
