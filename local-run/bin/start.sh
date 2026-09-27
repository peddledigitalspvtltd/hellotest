#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/../lib/compose.sh"

# An exported override has the same precedence as it does in Compose itself.
minio_image_was_set=${MINIO_IMAGE+x}
minio_image_override=${MINIO_IMAGE-}
set -a
. ./.env
set +a
if [ "$minio_image_was_set" = x ]; then
  MINIO_IMAGE=$minio_image_override
  export MINIO_IMAGE
fi

echo "Using compose file: $COMPOSE_FILE"

required_services=$(local_compose config --services)
for service in $required_services; do
  if [ "$service" = minio ]; then
    resolved_minio_image=$(local_compose config --images minio)
    (cd "$LOCAL_RUN_DIR/.." && MINIO_IMAGE="$resolved_minio_image" sh scripts/build/minio.sh)
    break
  fi
done

local_compose up -d --build

if [ "${TESTENGINE_AUTOSCALE:-true}" = "true" ]; then
  "$SCRIPT_DIR/autoscale-testengine.sh" start
fi

echo
echo "HelloTest local stack is starting."
echo "Frontend:    http://localhost:${FRONTEND_PORT:-8080}"
echo "API:         http://localhost:${API_PORT:-3000}"
echo "TestEngine:  http://localhost:${TESTENGINE_PORT:-4301}"
echo "OPS board:   http://localhost:${TESTENGINE_PORT:-4301}/ops-telemetry"
