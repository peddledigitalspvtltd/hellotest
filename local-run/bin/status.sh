#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LOCAL_RUN_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${QAIRA_LOCAL_COMPOSE_FILE:-docker-compose.yml}

cd "$LOCAL_RUN_DIR"
[ -f .env ] || cp .env.example .env
docker compose --env-file .env -f "$COMPOSE_FILE" ps
