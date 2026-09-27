#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"

. "$SCRIPT_DIR/../../../scripts/lib/docker.sh"
ensure_docker

echo "Starting PostgreSQL and API service..."
echo "Working directory: $SCRIPT_DIR"

cd "$SCRIPT_DIR"

required_services=$(compose_cmd config --services)
for service in $required_services; do
  if [ "$service" = minio ]; then
    resolved_minio_image=$(compose_cmd config --images minio)
    (cd "$SCRIPT_DIR/../../.." && MINIO_IMAGE="$resolved_minio_image" sh scripts/build/minio.sh)
    break
  fi
done

compose_cmd up --build
