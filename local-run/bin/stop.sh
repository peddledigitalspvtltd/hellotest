#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/../lib/compose.sh"

"$SCRIPT_DIR/autoscale-testengine.sh" stop || true
local_compose down
