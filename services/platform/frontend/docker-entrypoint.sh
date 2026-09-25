#!/bin/sh

set -eu

API_BASE_URL="${HELLOTEST_API_BASE_URL:-/api}"
SERVICE_URLS="${HELLOTEST_SERVICE_URLS:-}"
if [ -z "$SERVICE_URLS" ]; then SERVICE_URLS='{}'; fi

CAPABILITY_UI_URLS="${HELLOTEST_CAPABILITY_UI_URLS:-}"
if [ -z "$CAPABILITY_UI_URLS" ]; then CAPABILITY_UI_URLS='{}'; fi

# Serialize configuration as data. Invalid maps fail startup before either UI
# receives a partial or syntactically invalid JavaScript configuration.
RUNTIME_CONFIG=$(jq -cn --arg base "$API_BASE_URL" --argjson urls "$SERVICE_URLS" --argjson ui "$CAPABILITY_UI_URLS" '
  if ($urls | type) != "object" then error("SERVICE_URLS must be an object")
  elif any($urls[]; type != "string") then error("Service URLs must be strings")
  elif ($ui | type) != "object" or any($ui[]; type != "string" or (startswith("/") | not) or startswith("//")) then error("Capability UI URLs must be same-origin paths")
  else {API_BASE_URL: $base, SERVICE_URLS: $urls, CAPABILITY_UI_URLS: $ui} end
')

cat > /usr/share/nginx/html/runtime-config.js <<EOF
window.__HELLOTEST_CONFIG__ = window.__HELLOTEST_CONFIG__ || {};
Object.assign(window.__HELLOTEST_CONFIG__, ${RUNTIME_CONFIG});
EOF

cat > /usr/share/nginx/admin/runtime-config.js <<EOF
window.__HELLOTEST_CONFIG__ = window.__HELLOTEST_CONFIG__ || {};
Object.assign(window.__HELLOTEST_CONFIG__, ${RUNTIME_CONFIG});
EOF
