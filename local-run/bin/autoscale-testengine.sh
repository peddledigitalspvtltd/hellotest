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
MAX_WORKERS=${TESTENGINE_AUTOSCALE_MAX_WORKERS:-3}
MIN_WORKERS=${TESTENGINE_AUTOSCALE_MIN_WORKERS:-1}

scale_to() {
  desired=$1
  docker compose --env-file .env -f "$COMPOSE_FILE" up -d --scale "testengine-worker=$desired" testengine-worker testengine >/dev/null
}

current_workers() {
  docker compose --env-file .env -f "$COMPOSE_FILE" ps -q testengine-worker \
    | wc -l \
    | tr -d ' '
}

recommended_workers() {
  node -e '
    const http = require("http");
    const apiUrl = process.env.API_URL;
    const secret = process.env.SECRET;
    const min = Math.max(1, Number(process.env.MIN_WORKERS || 1));
    const max = Math.max(min, Math.min(3, Number(process.env.MAX_WORKERS || 3)));
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
        const recommended = Number(stats.recommended_workers || min);
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
      desired=$(API_URL="$API_URL" SECRET="$SECRET" MIN_WORKERS="$MIN_WORKERS" MAX_WORKERS="$MAX_WORKERS" recommended_workers)
      current=$(current_workers)
      if [ "$desired" != "$current" ]; then
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) scaling testengine-worker from $current to $desired"
        scale_to "$desired"
      fi
      sleep "$INTERVAL_SECONDS"
    done
    ;;
  once)
    desired=$(API_URL="$API_URL" SECRET="$SECRET" MIN_WORKERS="$MIN_WORKERS" MAX_WORKERS="$MAX_WORKERS" recommended_workers)
    current=$(current_workers)
    if [ "$desired" != "$current" ]; then
      scale_to "$desired"
    fi
    echo "testengine-worker replicas: $desired"
    ;;
  *)
    echo "Usage: $0 [start|stop|run|once]" >&2
    exit 2
    ;;
esac
