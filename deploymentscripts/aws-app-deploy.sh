#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

usage() {
  cat <<EOF
Usage: deploymentscripts/aws-app-deploy.sh [options]

Deploys the QAira application/platform plane on an AWS EC2 host.
This is the preferred EC2 entrypoint for the app host.

Options:
  --branch <name>          Git branch to pull. Default: current branch/main.
  --http-port <port>       Host port for HAProxy. Default: 8081.
  --http-bind <address>    Host bind address for HAProxy. Default: 0.0.0.0.
  --skip-git-pull          Reuse the current checkout.
  --skip-image-pull        Reuse locally cached images.
  --help                   Show this help message.

AWS defaults:
  - publishes only HAProxy broadly by default
  - binds API, Postgres, Grafana, Prometheus, Loki, OTel, and HAProxy stats to 127.0.0.1
  - use an AWS security group or same-host reverse proxy to expose the public entrypoint

Examples:
  deploymentscripts/aws-app-deploy.sh
  deploymentscripts/aws-app-deploy.sh --http-port 80
  QAIRA_HTTP_BIND=127.0.0.1 deploymentscripts/aws-app-deploy.sh --http-port 8081
EOF
}

BRANCH_ARG=""
SKIP_GIT_PULL=0
SKIP_IMAGE_PULL=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --branch)
      [ "$#" -ge 2 ] || die "Missing value for --branch"
      BRANCH_ARG="$2"
      shift
      ;;
    --http-port)
      [ "$#" -ge 2 ] || die "Missing value for --http-port"
      QAIRA_HTTP_PORT="$2"
      export QAIRA_HTTP_PORT
      shift
      ;;
    --http-bind)
      [ "$#" -ge 2 ] || die "Missing value for --http-bind"
      QAIRA_HTTP_BIND="$2"
      export QAIRA_HTTP_BIND
      shift
      ;;
    --skip-git-pull)
      SKIP_GIT_PULL=1
      ;;
    --skip-image-pull)
      SKIP_IMAGE_PULL=1
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

export QAIRA_HTTP_PORT="${QAIRA_HTTP_PORT:-8081}"
export QAIRA_HTTP_BIND="${QAIRA_HTTP_BIND:-0.0.0.0}"
export QAIRA_API_BIND="${QAIRA_API_BIND:-127.0.0.1}"
export QAIRA_POSTGRES_BIND="${QAIRA_POSTGRES_BIND:-127.0.0.1}"
export QAIRA_HAPROXY_STATS_BIND="${QAIRA_HAPROXY_STATS_BIND:-127.0.0.1}"
export QAIRA_PROMETHEUS_BIND="${QAIRA_PROMETHEUS_BIND:-127.0.0.1}"
export QAIRA_LOKI_BIND="${QAIRA_LOKI_BIND:-127.0.0.1}"
export QAIRA_GRAFANA_BIND="${QAIRA_GRAFANA_BIND:-127.0.0.1}"
export QAIRA_OTEL_GRPC_BIND="${QAIRA_OTEL_GRPC_BIND:-127.0.0.1}"
export QAIRA_OTEL_HTTP_BIND="${QAIRA_OTEL_HTTP_BIND:-127.0.0.1}"
export QAIRA_OTEL_METRICS_BIND="${QAIRA_OTEL_METRICS_BIND:-127.0.0.1}"

DEPLOY_ARGS="--stack platform"

if [ -n "$BRANCH_ARG" ]; then
  DEPLOY_ARGS="$DEPLOY_ARGS --branch $BRANCH_ARG"
fi

if [ "$SKIP_GIT_PULL" = "1" ]; then
  DEPLOY_ARGS="$DEPLOY_ARGS --skip-git-pull"
fi

if [ "$SKIP_IMAGE_PULL" = "1" ]; then
  DEPLOY_ARGS="$DEPLOY_ARGS --skip-image-pull"
fi

info "Deploying QAira app/platform plane for AWS"
info "Public entrypoint bind: ${QAIRA_HTTP_BIND}:${QAIRA_HTTP_PORT}"
info "Internal service binds: 127.0.0.1 by default"

# shellcheck disable=SC2086
"$REPO_ROOT/qaira.sh" deploy $DEPLOY_ARGS --yes

require_url "http://127.0.0.1:${QAIRA_HTTP_PORT}/health" "QAira API through HAProxy"
require_url "http://127.0.0.1:${QAIRA_HTTP_PORT}/" "QAira frontend through HAProxy"

info
info "App/platform deployment complete."
info "Local health: http://127.0.0.1:${QAIRA_HTTP_PORT}/health"
info "Public entrypoint: ${QAIRA_HTTP_BIND}:${QAIRA_HTTP_PORT}"
info "Run deploymentscripts/aws-status.sh --stack app to audit containers."
