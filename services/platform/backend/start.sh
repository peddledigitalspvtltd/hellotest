#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"

. "$SCRIPT_DIR/../../../scripts/lib/docker.sh"
ensure_docker

echo "Starting PostgreSQL and API service..."
echo "Working directory: $SCRIPT_DIR"

cd "$SCRIPT_DIR"

compose_cmd up --build
