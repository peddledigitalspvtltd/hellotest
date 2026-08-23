#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

usage() {
  cat <<EOF
Usage: deploymentscripts/aws-status.sh [options]

Shows HelloTest container status and flags common AWS deployment mistakes.

Options:
  --stack <app|testengine|all>  Scope to inspect. Default: all.
  --help                       Show this help message.

Examples:
  deploymentscripts/aws-status.sh
  deploymentscripts/aws-status.sh --stack app
  deploymentscripts/aws-status.sh --stack testengine
EOF
}

STACK="all"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --stack)
      [ "$#" -ge 2 ] || die "Missing value for --stack"
      STACK="$2"
      shift
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
  app|testengine|all) ;;
  *) die "Unsupported stack: $STACK. Expected app, testengine, or all." ;;
esac

ensure_docker

info "HelloTest containers on this host:"
print_container_table

info
info "Compose view:"
if [ "$STACK" = "app" ] || [ "$STACK" = "all" ]; then
  info "App/platform plane:"
  compose_cmd -f "$REPO_ROOT/docker-compose.platform.yml" ps || true
fi

if [ "$STACK" = "testengine" ] || [ "$STACK" = "all" ]; then
  info
  info "Test Engine worker plane:"
  compose_cmd -f "$REPO_ROOT/testengine/docker-compose.deploy.yml" ps || true
fi

info
info "Deployment audit:"

if container_exists hellotest-api && container_exists hellotest-testengine; then
  warn "App/API and Test Engine are both present on this host. For AWS production, prefer separate EC2 instances."
fi

if container_exists hellotest-api; then
  info "- hellotest-api is the backend/API service. A separate backend container is not expected."
else
  [ "$STACK" = "testengine" ] || warn "hellotest-api is not present."
fi

if container_exists hellotest-frontend; then
  FRONTEND_PORTS="$(docker port hellotest-frontend 80 2>/dev/null || true)"
  if [ -n "$FRONTEND_PORTS" ]; then
    warn "hellotest-frontend publishes a host port directly: $FRONTEND_PORTS. In platform mode, traffic should normally enter through hellotest-haproxy."
  fi
fi

if container_exists hellotest-selenium-hub; then
  GRID_PORTS="$(docker port hellotest-selenium-hub 4444 2>/dev/null || true)"
  case "$GRID_PORTS" in
    *0.0.0.0*|*:::*)
      warn "Selenium Grid is publicly bound: $GRID_PORTS. Prefer SELENIUM_GRID_BIND=127.0.0.1."
      ;;
  esac
fi

if container_exists hellotest-selenium-node-chrome; then
  VNC_PORTS="$(docker port hellotest-selenium-node-chrome 7900 2>/dev/null || true)"
  case "$VNC_PORTS" in
    *0.0.0.0*|*:::*)
      warn "Selenium VNC is publicly bound: $VNC_PORTS. Prefer SELENIUM_VNC_BIND=127.0.0.1."
      ;;
  esac
fi

if container_exists hellotest-postgres; then
  POSTGRES_PORTS="$(docker port hellotest-postgres 5432 2>/dev/null || true)"
  case "$POSTGRES_PORTS" in
    *0.0.0.0*|*:::*)
      warn "Postgres is publicly bound: $POSTGRES_PORTS. Prefer HELLOTEST_POSTGRES_BIND=127.0.0.1 or move to RDS."
      ;;
  esac
fi

if container_exists hellotest-api; then
  API_PORTS="$(docker port hellotest-api 3000 2>/dev/null || true)"
  case "$API_PORTS" in
    *0.0.0.0*|*:::*)
      warn "API is publicly bound: $API_PORTS. Prefer HAProxy/ALB as the only public app entrypoint."
      ;;
  esac
fi

info
info "Useful next commands:"
info "  deploymentscripts/aws-logs.sh --stack $STACK --tail 160"
info "  docker ps --format 'table {{.Names}}\t{{.Ports}}'"
