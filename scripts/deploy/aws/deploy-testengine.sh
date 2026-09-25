#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/aws-runtime.sh"

usage() {
  cat <<EOF
Usage: scripts/deploy/aws/deploy-testengine.sh [options]

Deploys the HelloTest Test Engine worker plane on an AWS EC2 host.
Run this on the separate Test Engine host.

Required:
  HELLOTEST_API_BASE_URL       Public HelloTest API base, for example https://hellotest.qualipal.in/api

Options:
  --api-base-url <url>     Same as HELLOTEST_API_BASE_URL.
  --public-url <url>       Same as ENGINE_PUBLIC_URL.
  --port <port>            Host port for Test Engine. Default: 4301.
  --bind <address>         Host bind address for Test Engine. Default: 0.0.0.0.
  --no-pull                Reuse locally cached images.
  --help                   Show this help message.

AWS defaults:
  - exposes Test Engine on TESTENGINE_BIND:TESTENGINE_PORT
  - binds Selenium Grid and VNC to 127.0.0.1
  - auto-builds ENGINE_PUBLIC_URL from EC2 public IPv4 when possible

Examples:
  HELLOTEST_API_BASE_URL=https://hellotest.qualipal.in/api scripts/deploy/aws/deploy-testengine.sh
  scripts/deploy/aws/deploy-testengine.sh --api-base-url https://hellotest.qualipal.in/api --public-url http://13.55.32.201:4301
EOF
}

NO_PULL=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --api-base-url)
      [ "$#" -ge 2 ] || die "Missing value for --api-base-url"
      HELLOTEST_API_BASE_URL="$2"
      export HELLOTEST_API_BASE_URL
      shift
      ;;
    --public-url)
      [ "$#" -ge 2 ] || die "Missing value for --public-url"
      ENGINE_PUBLIC_URL="$2"
      export ENGINE_PUBLIC_URL
      shift
      ;;
    --port)
      [ "$#" -ge 2 ] || die "Missing value for --port"
      TESTENGINE_PORT="$2"
      export TESTENGINE_PORT
      shift
      ;;
    --bind)
      [ "$#" -ge 2 ] || die "Missing value for --bind"
      TESTENGINE_BIND="$2"
      export TESTENGINE_BIND
      shift
      ;;
    --no-pull)
      NO_PULL=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
  shift
done

export TESTENGINE_PORT="${TESTENGINE_PORT:-4301}"
export TESTENGINE_BIND="${TESTENGINE_BIND:-0.0.0.0}"
export SELENIUM_GRID_BIND="${SELENIUM_GRID_BIND:-127.0.0.1}"
export SELENIUM_VNC_BIND="${SELENIUM_VNC_BIND:-127.0.0.1}"

if [ -z "${HELLOTEST_API_BASE_URL:-}" ]; then
  die "HELLOTEST_API_BASE_URL is required, for example https://hellotest.qualipal.in/api"
fi

case "$HELLOTEST_API_BASE_URL" in
  */api|*/api/|http://*:3000|https://*:3000)
    ;;
  *)
    warn "HELLOTEST_API_BASE_URL usually needs the /api suffix when it points at the public HelloTest web entrypoint."
    warn "Use a bare origin only when that origin proxies directly to hellotest-api."
    ;;
esac

if [ -z "${ENGINE_PUBLIC_URL:-}" ]; then
  PUBLIC_IPV4="$(aws_public_ipv4)"
  if [ -n "$PUBLIC_IPV4" ]; then
    ENGINE_PUBLIC_URL="http://${PUBLIC_IPV4}:${TESTENGINE_PORT}"
    export ENGINE_PUBLIC_URL
  fi
fi

if [ -z "${ENGINE_PUBLIC_URL:-}" ]; then
  die "ENGINE_PUBLIC_URL is required when EC2 public IPv4 metadata is unavailable."
fi

info "Deploying HelloTest Test Engine worker plane for AWS"
info "HelloTest API base: $HELLOTEST_API_BASE_URL"
info "Engine public URL: $ENGINE_PUBLIC_URL"
info "Engine bind: ${TESTENGINE_BIND}:${TESTENGINE_PORT}"
info "Selenium Grid bind: ${SELENIUM_GRID_BIND}:${SELENIUM_GRID_PORT:-4444}"
info "Selenium VNC bind: ${SELENIUM_VNC_BIND}:${SELENIUM_VNC_PORT:-7900}"

if [ "$NO_PULL" = "1" ]; then
  "$REPO_ROOT/start-testengine-ops.sh" --no-pull
else
  "$REPO_ROOT/start-testengine-ops.sh"
fi

require_url "http://127.0.0.1:${TESTENGINE_PORT}/health" "Test Engine health endpoint"
require_url "http://127.0.0.1:${TESTENGINE_PORT}/api/v1/capabilities" "Test Engine capabilities endpoint"

info
info "Test Engine deployment complete."
info "Hosted OPS board: ${ENGINE_PUBLIC_URL}/ops-telemetry"
info "Run scripts/deploy/aws/status.sh --stack testengine to audit containers."
