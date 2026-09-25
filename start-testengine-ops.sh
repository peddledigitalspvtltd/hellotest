#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/scripts/lib/docker.sh"

usage() {
  cat <<EOF
Usage: ./start-testengine-ops.sh [options]

Starts the standalone Test Engine stack and aligns its OPS telemetry settings with the
current HelloTest integrations whenever auth is available.

Options:
  --no-pull       Reuse current local image references and skip docker pull.
  --help          Show this help message.

Required environment variables:
  HELLOTEST_API_BASE_URL       HelloTest public API base URL, for example https://hellotest.qualipal.in/api

Optional environment variables:
  HELLOTEST_TESTENGINE_IMAGE   Default: jayarajumetta/hellotest-testengine:latest
  HELLOTEST_TESTENGINE_SECRET  Shared secret for HelloTest queue APIs. Defaults to the HelloTest dev fallback.
  HELLOTEST_PROJECT_ID         Resolve project-scoped Test Engine and OPS integrations first
  HELLOTEST_AUTH_TOKEN         Read active integrations from HelloTest with this bearer token
  HELLOTEST_AUTH_EMAIL         Login email used when HELLOTEST_AUTH_TOKEN is not provided
  HELLOTEST_AUTH_PASSWORD      Login password paired with HELLOTEST_AUTH_EMAIL
  ENGINE_PUBLIC_URL        Public URL of this Test Engine host. Falls back to active integration, then localhost
  TESTENGINE_PORT          Host port for the engine container. Default: 4301
  TESTENGINE_POLL_INTERVAL_MINUTES
                         Queue pull cadence. Defaults to the active Test Engine integration or 5.
  TESTENGINE_POLL_INTERVAL_MS
                         Lower-level queue pull cadence override in milliseconds.
  OPS_OTLP_ENDPOINT        Optional OTLP endpoint to inject as OTEL_EXPORTER_OTLP_ENDPOINT
  OTEL_EXPORTER_OTLP_ENDPOINT
  OTEL_SERVICE_NAME        Defaults to the active OPS service_name or hellotest-testengine
  OTEL_RESOURCE_ATTRIBUTES Defaults to service.name + deployment.environment
  OPS_ENVIRONMENT          Defaults to the active OPS environment or production
  OPS_TELEMETRY_EVENTS_PATH
  OPS_TELEMETRY_BOARD_PATH
  OPS_TELEMETRY_API_KEY
  OPS_TELEMETRY_API_KEY_HEADER
  OPS_TELEMETRY_API_KEY_PREFIX
  OPS_TELEMETRY_MAX_EVENTS Default: 2000
  OPS_TELEMETRY_STORE_PATH Default: /artifacts/ops-telemetry-events.ndjson
  HELLOTEST_SELENIUM_HUB_IMAGE
  HELLOTEST_SELENIUM_NODE_IMAGE
  SELENIUM_GRID_PORT
  LOG_LEVEL

Example:
  HELLOTEST_API_BASE_URL=https://hellotest.qualipal.in/api \\
  HELLOTEST_AUTH_TOKEN=replace-with-a-hellotest-token \\
  HELLOTEST_PROJECT_ID=replace-with-project-id \\
  ./start-testengine-ops.sh
EOF
}

print_block() {
  prefix="$1"
  text="$2"

  if [ -z "$text" ]; then
    return 0
  fi

  printf '%s\n' "$text" | while IFS= read -r line; do
    if [ -n "$line" ]; then
      echo "${prefix}${line}"
    fi
  done
}

normalize_path() {
  value="$1"
  fallback="$2"

  if [ -z "$value" ]; then
    value="$fallback"
  fi

  case "$value" in
    /*) printf '%s' "$value" ;;
    *) printf '/%s' "$value" ;;
  esac
}

wait_for_url() {
  url="$1"
  label="$2"

  if ! command -v curl >/dev/null 2>&1; then
    echo "Skipping ${label} readiness check because curl is not installed."
    return 0
  fi

  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      echo "${label} is responding at ${url}"
      return 0
    fi

    attempt=$((attempt + 1))
    sleep 2
  done

  echo "Warning: ${label} did not respond at ${url} within 60 seconds."
  return 0
}

resolve_from_integrations() {
  if ! command -v node >/dev/null 2>&1; then
    if [ -n "${HELLOTEST_AUTH_TOKEN:-}${HELLOTEST_AUTH_EMAIL:-}${HELLOTEST_AUTH_PASSWORD:-}${HELLOTEST_PROJECT_ID:-}" ]; then
      echo "Node.js is required to resolve Test Engine and OPS settings from HelloTest integrations."
      exit 1
    fi
    return 0
  fi

  eval "$(node "$SCRIPT_DIR/scripts/ops/resolve-testengine-config.mjs")"

  print_block "Integration: " "${RESOLVED_INFO_TEXT:-}"
  print_block "Warning: " "${RESOLVED_WARNING_TEXT:-}"
}

PULL_IMAGE=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-pull)
      PULL_IMAGE=0
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo
      usage
      exit 1
      ;;
  esac
  shift
done

HELLOTEST_API_BASE_URL="${HELLOTEST_API_BASE_URL:-}"
PROVIDED_TESTENGINE_SECRET="${HELLOTEST_TESTENGINE_SECRET:-${TESTENGINE_SHARED_SECRET:-}}"
HELLOTEST_TESTENGINE_SECRET="${PROVIDED_TESTENGINE_SECRET:-hellotest-testengine-dev-secret}"
HELLOTEST_TESTENGINE_IMAGE="${HELLOTEST_TESTENGINE_IMAGE:-jayarajumetta/hellotest-testengine:latest}"
TESTENGINE_PORT="${TESTENGINE_PORT:-4301}"
OPS_ENVIRONMENT="${OPS_ENVIRONMENT:-}"
OTEL_EXPORTER_OTLP_ENDPOINT="${OPS_OTLP_ENDPOINT:-${OTEL_EXPORTER_OTLP_ENDPOINT:-}}"
OPS_TELEMETRY_MAX_EVENTS="${OPS_TELEMETRY_MAX_EVENTS:-2000}"

if [ -z "$HELLOTEST_API_BASE_URL" ]; then
  echo "HELLOTEST_API_BASE_URL is required."
  echo "Example: HELLOTEST_API_BASE_URL=https://hellotest.qualipal.in/api ./start-testengine-ops.sh"
  exit 1
fi

if [ -z "$PROVIDED_TESTENGINE_SECRET" ]; then
  echo "Warning: HELLOTEST_TESTENGINE_SECRET was not set; using the HelloTest dev fallback secret."
  echo "Warning: This works only when the HelloTest API host also uses its default fallback."
fi

resolve_from_integrations

DEFAULT_ENGINE_PUBLIC_URL="http://localhost:${TESTENGINE_PORT}"
ENGINE_PUBLIC_URL="${ENGINE_PUBLIC_URL:-${RESOLVED_ENGINE_PUBLIC_URL:-$DEFAULT_ENGINE_PUBLIC_URL}}"
TESTENGINE_POLL_INTERVAL_MINUTES="${TESTENGINE_POLL_INTERVAL_MINUTES:-${RESOLVED_TESTENGINE_POLL_INTERVAL_MINUTES:-5}}"
TESTENGINE_POLL_INTERVAL_MS="${TESTENGINE_POLL_INTERVAL_MS:-${RESOLVED_TESTENGINE_POLL_INTERVAL_MS:-}}"
OPS_TELEMETRY_EVENTS_PATH="${OPS_TELEMETRY_EVENTS_PATH:-${RESOLVED_OPS_EVENTS_PATH:-/api/v1/events}}"
OPS_TELEMETRY_BOARD_PATH="${OPS_TELEMETRY_BOARD_PATH:-${RESOLVED_OPS_BOARD_PATH:-/ops-telemetry}}"
OPS_ENVIRONMENT="${OPS_ENVIRONMENT:-${RESOLVED_OPS_ENVIRONMENT:-production}}"
OTEL_SERVICE_NAME="${OTEL_SERVICE_NAME:-${RESOLVED_OPS_SERVICE_NAME:-hellotest-testengine}}"
OPS_TELEMETRY_SERVICE_NAME="${OPS_TELEMETRY_SERVICE_NAME:-$OTEL_SERVICE_NAME}"
OPS_TELEMETRY_ENVIRONMENT="${OPS_TELEMETRY_ENVIRONMENT:-$OPS_ENVIRONMENT}"
OPS_TELEMETRY_API_KEY="${OPS_TELEMETRY_API_KEY:-${RESOLVED_OPS_API_KEY:-}}"
OPS_TELEMETRY_API_KEY_HEADER="${OPS_TELEMETRY_API_KEY_HEADER:-${RESOLVED_OPS_API_KEY_HEADER:-Authorization}}"
OTEL_RESOURCE_ATTRIBUTES="${OTEL_RESOURCE_ATTRIBUTES:-service.name=${OTEL_SERVICE_NAME},deployment.environment=${OPS_ENVIRONMENT}}"

if [ "${OPS_TELEMETRY_API_KEY_PREFIX+x}" = "x" ]; then
  OPS_TELEMETRY_API_KEY_PREFIX="$OPS_TELEMETRY_API_KEY_PREFIX"
elif [ "${RESOLVED_OPS_API_KEY_PREFIX+x}" = "x" ]; then
  OPS_TELEMETRY_API_KEY_PREFIX="$RESOLVED_OPS_API_KEY_PREFIX"
else
  OPS_TELEMETRY_API_KEY_PREFIX="Bearer"
fi

if [ "$ENGINE_PUBLIC_URL" = "$DEFAULT_ENGINE_PUBLIC_URL" ] && [ -z "${RESOLVED_ENGINE_PUBLIC_URL:-}" ]; then
  echo "Warning: Using the fallback engine URL ${ENGINE_PUBLIC_URL}. Set ENGINE_PUBLIC_URL or provide HelloTest auth if the active Test Engine integration already points at a hosted URL."
fi

LOCAL_OPS_EVENTS_PATH="$(normalize_path "$OPS_TELEMETRY_EVENTS_PATH" "/api/v1/events")"
LOCAL_OPS_BOARD_PATH="$(normalize_path "$OPS_TELEMETRY_BOARD_PATH" "/ops-telemetry")"
LOCAL_HEALTH_URL="http://127.0.0.1:${TESTENGINE_PORT}/health"
LOCAL_EVENTS_URL="http://127.0.0.1:${TESTENGINE_PORT}${LOCAL_OPS_EVENTS_PATH}"
LOCAL_BOARD_URL="http://127.0.0.1:${TESTENGINE_PORT}${LOCAL_OPS_BOARD_PATH}"
PUBLIC_OPS_TRANSPORT_HOST="${RESOLVED_OPS_TRANSPORT_HOST:-$ENGINE_PUBLIC_URL}"
PUBLIC_OPS_HEALTH_URL="${RESOLVED_OPS_HEALTH_URL:-${ENGINE_PUBLIC_URL}/health}"
PUBLIC_OPS_EVENTS_URL="${RESOLVED_OPS_EVENTS_URL:-${PUBLIC_OPS_TRANSPORT_HOST}${LOCAL_OPS_EVENTS_PATH}}"
PUBLIC_OPS_BOARD_URL="${RESOLVED_OPS_BOARD_URL:-${PUBLIC_OPS_TRANSPORT_HOST}${LOCAL_OPS_BOARD_PATH}}"

export HELLOTEST_TESTENGINE_IMAGE
export HELLOTEST_API_BASE_URL
export HELLOTEST_TESTENGINE_SECRET
export ENGINE_PUBLIC_URL
export TESTENGINE_PORT
export TESTENGINE_POLL_INTERVAL_MINUTES
export TESTENGINE_POLL_INTERVAL_MS
export OTEL_EXPORTER_OTLP_ENDPOINT
export OTEL_SERVICE_NAME
export OTEL_RESOURCE_ATTRIBUTES
export OPS_TELEMETRY_ENABLED="${OPS_TELEMETRY_ENABLED:-true}"
export OPS_TELEMETRY_EVENTS_PATH
export OPS_TELEMETRY_BOARD_PATH
export OPS_TELEMETRY_SERVICE_NAME
export OPS_TELEMETRY_ENVIRONMENT
export OPS_TELEMETRY_STORE_PATH="${OPS_TELEMETRY_STORE_PATH:-/artifacts/ops-telemetry-events.ndjson}"
export OPS_TELEMETRY_MAX_EVENTS
export OPS_TELEMETRY_API_KEY
export OPS_TELEMETRY_API_KEY_HEADER
export OPS_TELEMETRY_API_KEY_PREFIX

ensure_docker

TESTENGINE_SERVICES="testengine-api testengine-web testengine-android selenium-hub selenium-node-chrome"

echo "Starting Test Engine + OPS telemetry stack..."
echo "HelloTest API base: $HELLOTEST_API_BASE_URL"
if [ -n "${RESOLVED_ENGINE_INTEGRATION_NAME:-}" ]; then
  echo "Active Test Engine integration: ${RESOLVED_ENGINE_INTEGRATION_NAME}"
fi
if [ -n "${RESOLVED_OPS_INTEGRATION_NAME:-}" ]; then
  echo "Active OPS integration: ${RESOLVED_OPS_INTEGRATION_NAME}"
fi
echo "Engine public URL: $ENGINE_PUBLIC_URL"
if [ -n "$TESTENGINE_POLL_INTERVAL_MS" ]; then
  echo "Queue poll interval: ${TESTENGINE_POLL_INTERVAL_MS} ms"
else
  echo "Queue poll interval: ${TESTENGINE_POLL_INTERVAL_MINUTES} minute(s)"
fi
echo "OPS service label: $OPS_TELEMETRY_SERVICE_NAME"
echo "OPS environment: $OPS_TELEMETRY_ENVIRONMENT"
echo "OPS transport host: $PUBLIC_OPS_TRANSPORT_HOST"
echo "OPS event route: $PUBLIC_OPS_EVENTS_URL"
echo "OPS board route: $PUBLIC_OPS_BOARD_URL"
if [ -n "$OTEL_EXPORTER_OTLP_ENDPOINT" ]; then
  echo "OPS OTLP endpoint: $OTEL_EXPORTER_OTLP_ENDPOINT"
else
  echo "OPS OTLP endpoint: not configured"
fi

if [ "$PULL_IMAGE" = "1" ]; then
  # shellcheck disable=SC2086
  compose_cmd -f "$SCRIPT_DIR/testengine/docker-compose.deploy.yml" pull $TESTENGINE_SERVICES
fi

# shellcheck disable=SC2086
compose_cmd -f "$SCRIPT_DIR/testengine/docker-compose.deploy.yml" up -d $TESTENGINE_SERVICES
compose_cmd -f "$SCRIPT_DIR/testengine/docker-compose.deploy.yml" ps

wait_for_url "$LOCAL_HEALTH_URL" "Test Engine health endpoint"
wait_for_url "$LOCAL_EVENTS_URL" "OPS telemetry event route"

echo
echo "Test Engine stack is running."
echo "Health: $LOCAL_HEALTH_URL"
echo "Capabilities: http://127.0.0.1:${TESTENGINE_PORT}/api/v1/capabilities"
echo "OPS events: $LOCAL_EVENTS_URL"
echo "OPS board: $LOCAL_BOARD_URL"
echo "Hosted OPS board: $PUBLIC_OPS_BOARD_URL"
