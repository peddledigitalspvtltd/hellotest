#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
HELLOTEST_API_BASE_URL="${HELLOTEST_API_BASE_URL:-/api}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but was not found in PATH."
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  echo "Docker Compose is required but was not found."
  exit 1
fi

echo "Starting frontend service..."
echo "Working directory: $SCRIPT_DIR"
echo "Backend API URL: $HELLOTEST_API_BASE_URL"

cd "$SCRIPT_DIR"

export HELLOTEST_API_BASE_URL

exec sh -c "$COMPOSE_CMD up --build"
