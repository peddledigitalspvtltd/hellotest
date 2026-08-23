#!/bin/sh

set -eu

API_BASE_URL="${HELLOTEST_API_BASE_URL:-/api}"

cat > /usr/share/nginx/html/runtime-config.js <<EOF
window.__HELLOTEST_CONFIG__ = window.__HELLOTEST_CONFIG__ || {};
window.__HELLOTEST_CONFIG__.API_BASE_URL = "${API_BASE_URL}";
EOF

cat > /usr/share/nginx/admin/runtime-config.js <<EOF
window.__HELLOTEST_CONFIG__ = window.__HELLOTEST_CONFIG__ || {};
window.__HELLOTEST_CONFIG__.API_BASE_URL = "${API_BASE_URL}";
EOF
