#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

usage() {
  cat <<EOF
Usage: deploymentscripts/aws-logs.sh [options]

Shows logs for HelloTest app and Test Engine containers on the current host.

Options:
  --stack <app|testengine|all>  Log scope. Default: all.
  --tail <lines>                Lines per container. Default: 160.
  --follow                      Follow logs. Best used with one stack at a time.
  --help                        Show this help message.

Examples:
  deploymentscripts/aws-logs.sh --stack app
  deploymentscripts/aws-logs.sh --stack testengine --tail 300
  deploymentscripts/aws-logs.sh --stack app --follow
EOF
}

STACK="all"
TAIL="160"
FOLLOW=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --stack)
      [ "$#" -ge 2 ] || die "Missing value for --stack"
      STACK="$2"
      shift
      ;;
    --tail)
      [ "$#" -ge 2 ] || die "Missing value for --tail"
      TAIL="$2"
      shift
      ;;
    --follow|-f)
      FOLLOW=1
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

case "$STACK" in
  app)
    CONTAINERS="hellotest-api hellotest-frontend hellotest-haproxy hellotest-postgres hellotest-prometheus hellotest-grafana hellotest-loki hellotest-promtail hellotest-otel-collector"
    ;;
  testengine)
    CONTAINERS="hellotest-testengine hellotest-selenium-hub hellotest-selenium-node-chrome"
    ;;
  all)
    CONTAINERS="hellotest-api hellotest-frontend hellotest-haproxy hellotest-postgres hellotest-prometheus hellotest-grafana hellotest-loki hellotest-promtail hellotest-otel-collector hellotest-testengine hellotest-selenium-hub hellotest-selenium-node-chrome"
    ;;
  *)
    die "Unsupported stack: $STACK. Expected app, testengine, or all."
    ;;
esac

ensure_docker

LOG_ARGS="--tail $TAIL"
if [ "$FOLLOW" = "1" ]; then
  LOG_ARGS="$LOG_ARGS -f"
fi

for container in $CONTAINERS; do
  if ! container_exists "$container"; then
    continue
  fi

  echo
  echo "===== $container ====="
  # shellcheck disable=SC2086
  docker logs $LOG_ARGS "$container" 2>&1 || true

  if [ "$FOLLOW" = "1" ]; then
    break
  fi
done

if [ "$FOLLOW" = "1" ]; then
  echo
  echo "Follow mode attaches to the first matching container. Use docker logs -f <name> for another service."
fi
