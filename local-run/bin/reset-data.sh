#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/../lib/compose.sh"

echo "This removes ALL volumes declared by the selected local stack, including database, cache, object storage, vector data and engine artifacts."
local_compose down -v
local_compose up -d --build
