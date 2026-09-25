#!/usr/bin/env sh
# Sourced by local-run/bin entry points after SCRIPT_DIR is resolved.
LOCAL_RUN_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${HELLOTEST_LOCAL_COMPOSE_FILE:-docker-compose.yml}
. "$LOCAL_RUN_DIR/../scripts/lib/docker.sh"
cd "$LOCAL_RUN_DIR"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created local-run/.env from .env.example"
fi
local_compose() {
  compose_cmd --env-file .env -f "$COMPOSE_FILE" "$@"
}
