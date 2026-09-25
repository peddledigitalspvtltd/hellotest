#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
HELLOTEST_API_BASE_URL="${HELLOTEST_API_BASE_URL:-/api}"

. "$SCRIPT_DIR/../../../scripts/lib/docker.sh"
ensure_docker

echo "Starting frontend service..."
echo "Working directory: $SCRIPT_DIR"
echo "Backend API URL: $HELLOTEST_API_BASE_URL"

cd "$SCRIPT_DIR"

export HELLOTEST_API_BASE_URL

compose_cmd up --build
