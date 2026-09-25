#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/../lib/compose.sh"

set -a
. ./.env
set +a

local_compose exec -T postgres psql \
  -U "${POSTGRES_USER:-hellotest}" \
  -d "${POSTGRES_DB:-hellotest}" \
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
local_compose restart api
