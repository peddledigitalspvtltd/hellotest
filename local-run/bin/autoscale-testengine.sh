#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LOCAL_RUN_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${QAIRA_LOCAL_COMPOSE_FILE:-docker-compose.yml}
PID_FILE="$LOCAL_RUN_DIR/.testengine-autoscaler.pid"

cd "$LOCAL_RUN_DIR"
[ -f .env ] || cp .env.example .env

set -a
. ./.env
set +a

API_URL=${QAIRA_AUTOSCALER_API_URL:-http://localhost:${API_PORT:-3000}}
SECRET=${TESTENGINE_SHARED_SECRET:-${QAIRA_TESTENGINE_SECRET:-qaira-testengine-dev-secret}}
INTERVAL_SECONDS=${TESTENGINE_AUTOSCALE_INTERVAL_SECONDS:-15}
API_MAX_WORKERS=${TESTENGINE_API_MAX_WORKERS:-${TESTENGINE_AUTOSCALE_MAX_WORKERS:-3}}
WEB_MAX_WORKERS=${TESTENGINE_WEB_MAX_WORKERS:-${TESTENGINE_AUTOSCALE_MAX_WORKERS:-3}}
ANDROID_MAX_WORKERS=${TESTENGINE_ANDROID_MAX_WORKERS:-${TESTENGINE_AUTOSCALE_MAX_WORKERS:-3}}
API_MIN_WORKERS=${TESTENGINE_API_MIN_WORKERS:-${TESTENGINE_AUTOSCALE_MIN_WORKERS:-0}}
WEB_MIN_WORKERS=${TESTENGINE_WEB_MIN_WORKERS:-${TESTENGINE_AUTOSCALE_MIN_WORKERS:-0}}
ANDROID_MIN_WORKERS=${TESTENGINE_ANDROID_MIN_WORKERS:-${TESTENGINE_AUTOSCALE_MIN_WORKERS:-0}}

scale_to() {
  service=$1
  desired=$2
  docker compose --env-file .env -f "$COMPOSE_FILE" up -d --scale "$service=$desired" "$service" testengine >/dev/null
  docker compose --env-file .env -f "$COMPOSE_FILE" rm -f "$service" >/dev/null 2>&1 || true
}

current_workers() {
  service=$1
  docker compose --env-file .env -f "$COMPOSE_FILE" ps --status running -q "$service" \
    | wc -l \
    | tr -d ' '
}

recommended_workers() {
  engine_class=$1
  min_workers=$2
  max_workers=$3
  ENGINE_CLASS="$engine_class" MIN_WORKERS="$min_workers" MAX_WORKERS="$max_workers" node -e '
    const http = require("http");
    const apiUrl = process.env.API_URL;
    const secret = process.env.SECRET;
    const engineClass = process.env.ENGINE_CLASS;
        const min = Math.max(0, Number(process.env.MIN_WORKERS || 0));
        const max = Math.max(min, Number(process.env.MAX_WORKERS || min));
    const request = http.get(`${apiUrl}/testengine/internal/jobs/queue-stats`, {
      headers: { "x-qaira-testengine-secret": secret }
    }, (response) => {
      let body = "";
      response.on("data", (chunk) => body += chunk);
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          console.log(String(min));
          return;
        }
        const stats = JSON.parse(body || "{}");
        const pools = stats.by_orchestration_class || stats.by_engine_class || {};
        const scoped = pools[engineClass] || {};
        const recommended = Number(scoped.recommended_workers ?? min);
        console.log(String(Math.max(min, Math.min(max, recommended))));
      });
    });
    request.on("error", () => console.log(String(min)));
    request.setTimeout(5000, () => {
      request.destroy();
      console.log(String(min));
    });
  '
}

scale_pool() {
  service=$1
  engine_class=$2
  min_workers=$3
  max_workers=$4
  desired=$(API_URL="$API_URL" SECRET="$SECRET" recommended_workers "$engine_class" "$min_workers" "$max_workers")
  current=$(current_workers "$service")
  if [ "$desired" != "$current" ]; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) scaling $service from $current to $desired"
    scale_to "$service" "$desired"
  fi
  echo "$service replicas: $desired"
}

case "${1:-run}" in
  start)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "Test Engine autoscaler already running with PID $(cat "$PID_FILE")"
      exit 0
    fi
    nohup "$0" run > "$LOCAL_RUN_DIR/.testengine-autoscaler.log" 2>&1 &
    echo $! > "$PID_FILE"
    echo "Started Test Engine autoscaler with PID $(cat "$PID_FILE")"
    ;;
  stop)
    if [ -f "$PID_FILE" ]; then
      kill "$(cat "$PID_FILE")" 2>/dev/null || true
      rm -f "$PID_FILE"
    fi
    ;;
  run)
    while true; do
      scale_pool testengine-api-worker api "$API_MIN_WORKERS" "$API_MAX_WORKERS"
      scale_pool testengine-web-worker web "$WEB_MIN_WORKERS" "$WEB_MAX_WORKERS"
      scale_pool testengine-android-worker android "$ANDROID_MIN_WORKERS" "$ANDROID_MAX_WORKERS"
      sleep "$INTERVAL_SECONDS"
    done
    ;;
  once)
    scale_pool testengine-api-worker api "$API_MIN_WORKERS" "$API_MAX_WORKERS"
    scale_pool testengine-web-worker web "$WEB_MIN_WORKERS" "$WEB_MAX_WORKERS"
    scale_pool testengine-android-worker android "$ANDROID_MIN_WORKERS" "$ANDROID_MAX_WORKERS"
    ;;
  *)
    echo "Usage: $0 [start|stop|run|once]" >&2
    exit 2
    ;;
esac
