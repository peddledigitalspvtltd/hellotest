#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$ROOT_DIR/scripts/docker-common.sh"

ENV_DIR="$ROOT_DIR/.qaira"

usage() {
  cat <<EOF
Usage: ./qaira.sh <command> [options] [services...]

Single QAira operator entrypoint for image release, service relation config,
and careful Docker Compose deployment.

Commands:
  config          Generate and print the resolved service relation env file.
  build           Build QAira images locally.
  push            Build and push QAira images. Does not deploy.
  deploy          Pull/build as requested and refresh a stack after confirmation.
  up              Start a stack or selected services.
  down            Stop a stack.
  restart         Restart selected services, or the whole stack.
  status          Show stack containers.
  logs            Show stack logs. Pass service names to limit output.

Options:
  --stack <local|full|platform|testengine>
                  local=source-build local-run stack
                  full=image app stack
                  platform=image app+observability+haproxy stack
                  testengine=standalone worker stack
                  Default: full
  --mode <local|docker|aws|k8s>
                  APP_MODE value. Default follows stack.
  --config <file> Load overrides before resolving defaults.
  --service <name>
                  Add a service target. You can also pass services at the end.
  --branch <name> For deploy: git branch to pull.
  --skip-git-pull For deploy: do not pull git changes.
  --skip-image-pull
                  For deploy/up: do not pull images.
  --build         For deploy/up: build compose services instead of pulling.
  --no-build      For deploy/up: do not build compose services.
  --no-cache      Build images with --no-cache.
  --yes           Do not prompt before deploy.
  --follow        Follow logs.
  --tail <n>      Log line count. Default: 160.
  --help          Show this message.

High-value overrides:
  QAIRA_PUBLIC_URL           Public frontend origin.
  QAIRA_API_PUBLIC_URL       Public API origin.
  QAIRA_API_BASE_URL         Frontend API base. Default: /api.
  QAIRA_API_INTERNAL_URL     Internal API URL for workers.
  QAIRA_WORKER_API_BASE_URL  Local worker API URL override.
  ENGINE_PUBLIC_URL          Public Test Engine URL.
  TESTENGINE_PORT            Test Engine host port.
  QAIRA_BACKEND_IMAGE        Backend image ref.
  QAIRA_FRONTEND_IMAGE       Frontend image ref.
  QAIRA_TESTENGINE_IMAGE     Test Engine image ref.
  QAIRA_MOBILE_ENGINE_IMAGE  Mobile Engine image ref.

Examples:
  ./qaira.sh config --stack local
  ./qaira.sh up --stack local
  ./qaira.sh push
  ./qaira.sh deploy --stack platform --yes
  QAIRA_PUBLIC_URL=https://qaira.example.com ./qaira.sh deploy --stack platform
  QAIRA_API_BASE_URL=https://qaira.example.com/api ./qaira.sh deploy --stack testengine --yes
EOF
}

die() {
  echo "Error: $*" >&2
  exit 1
}

info() {
  printf '%s\n' "$*"
}

origin_with_port() {
  scheme="$1"
  host="$2"
  port="$3"

  if { [ "$scheme" = "http" ] && [ "$port" = "80" ]; } || { [ "$scheme" = "https" ] && [ "$port" = "443" ]; }; then
    printf '%s://%s' "$scheme" "$host"
  else
    printf '%s://%s:%s' "$scheme" "$host" "$port"
  fi
}

load_config_file() {
  file="$1"
  [ -f "$file" ] || die "Config file not found: $file"
  # shellcheck disable=SC1090
  . "$file"
}

resolve_stack() {
  case "$STACK" in
    local)
      COMPOSE_FILE="$ROOT_DIR/local-run/docker-compose.yml"
      DEFAULT_MODE="local"
      ;;
    full)
      COMPOSE_FILE="$ROOT_DIR/docker-compose.full.yml"
      DEFAULT_MODE="docker"
      ;;
    platform)
      COMPOSE_FILE="$ROOT_DIR/docker-compose.platform.yml"
      DEFAULT_MODE="aws"
      ;;
    testengine)
      COMPOSE_FILE="$ROOT_DIR/testengine/docker-compose.deploy.yml"
      DEFAULT_MODE="aws"
      ;;
    *)
      die "Unsupported stack: $STACK"
      ;;
  esac

  APP_MODE="${APP_MODE:-${MODE:-$DEFAULT_MODE}}"
}

resolve_defaults() {
  DOCKER_NAMESPACE="${DOCKER_NAMESPACE:-jayarajumetta}"
  IMAGE_TAG="${IMAGE_TAG:-latest}"
  PLATFORM="${PLATFORM:-linux/amd64}"
  NO_CACHE="${NO_CACHE:-0}"

  QAIRA_BACKEND_IMAGE="${QAIRA_BACKEND_IMAGE:-${DOCKER_NAMESPACE}/qaira-backend:${IMAGE_TAG}}"
  QAIRA_FRONTEND_IMAGE="${QAIRA_FRONTEND_IMAGE:-${DOCKER_NAMESPACE}/qaira-frontend:${IMAGE_TAG}}"
  QAIRA_TESTENGINE_IMAGE="${QAIRA_TESTENGINE_IMAGE:-${DOCKER_NAMESPACE}/qaira-testengine:${IMAGE_TAG}}"
  QAIRA_MOBILE_ENGINE_IMAGE="${QAIRA_MOBILE_ENGINE_IMAGE:-${DOCKER_NAMESPACE}/qaira-mobile-engine:${IMAGE_TAG}}"

  POSTGRES_DB="${POSTGRES_DB:-qaira}"
  POSTGRES_USER="${POSTGRES_USER:-qaira}"
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-qaira}"
  SESSION_SECRET="${SESSION_SECRET:-qaira-dev-secret}"
  QAIRA_TESTENGINE_SECRET="${QAIRA_TESTENGINE_SECRET:-qaira-testengine-dev-secret}"
  TESTENGINE_SHARED_SECRET="${TESTENGINE_SHARED_SECRET:-$QAIRA_TESTENGINE_SECRET}"

  PUBLIC_SCHEME="${QAIRA_PUBLIC_SCHEME:-http}"
  PUBLIC_HOST="${QAIRA_PUBLIC_HOST:-localhost}"
  FRONTEND_PORT="${FRONTEND_PORT:-8080}"
  API_PORT="${API_PORT:-3000}"
  QAIRA_HTTP_PORT="${QAIRA_HTTP_PORT:-80}"
  TESTENGINE_PORT="${TESTENGINE_PORT:-4301}"
  MOBILE_ENGINE_PORT="${MOBILE_ENGINE_PORT:-4312}"
  REDIS_PORT="${REDIS_PORT:-6379}"
  STORAGE_PROVIDER="${STORAGE_PROVIDER:-minio}"
  MINIO_ENDPOINT="${MINIO_ENDPOINT:-minio}"
  MINIO_PORT="${MINIO_PORT:-9000}"
  MINIO_USE_SSL="${MINIO_USE_SSL:-false}"
  MINIO_ROOT_USER="${MINIO_ROOT_USER:-qaira}"
  MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-qaira-minio-dev-secret}"
  MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-$MINIO_ROOT_USER}"
  MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-$MINIO_ROOT_PASSWORD}"
  MINIO_BUCKET="${MINIO_BUCKET:-qaira-attachments}"
  MINIO_REGION="${MINIO_REGION:-us-east-1}"
  MAX_ATTACHMENT_BYTES="${MAX_ATTACHMENT_BYTES:-104857600}"

  case "$STACK" in
    platform)
      QAIRA_PUBLIC_URL="${QAIRA_PUBLIC_URL:-$(origin_with_port "$PUBLIC_SCHEME" "$PUBLIC_HOST" "$QAIRA_HTTP_PORT")}"
      QAIRA_API_PUBLIC_URL="${QAIRA_API_PUBLIC_URL:-$QAIRA_PUBLIC_URL/api}"
      ;;
    testengine)
      QAIRA_PUBLIC_URL="${QAIRA_PUBLIC_URL:-$(origin_with_port "$PUBLIC_SCHEME" "$PUBLIC_HOST" "$FRONTEND_PORT")}"
      QAIRA_API_PUBLIC_URL="${QAIRA_API_PUBLIC_URL:-$(origin_with_port "$PUBLIC_SCHEME" "$PUBLIC_HOST" "$API_PORT")}"
      ;;
    *)
      QAIRA_PUBLIC_URL="${QAIRA_PUBLIC_URL:-$(origin_with_port "$PUBLIC_SCHEME" "$PUBLIC_HOST" "$FRONTEND_PORT")}"
      QAIRA_API_PUBLIC_URL="${QAIRA_API_PUBLIC_URL:-$(origin_with_port "$PUBLIC_SCHEME" "$PUBLIC_HOST" "$API_PORT")}"
      ;;
  esac

  ENGINE_PUBLIC_URL="${ENGINE_PUBLIC_URL:-$(origin_with_port "$PUBLIC_SCHEME" "$PUBLIC_HOST" "$TESTENGINE_PORT")}"
  MOBILE_ENGINE_URL="${MOBILE_ENGINE_URL:-http://mobile-engine:4312}"
  APPIUM_SERVER_URL="${APPIUM_SERVER_URL:-http://host.docker.internal:4723}"
  CORS_ORIGIN="${CORS_ORIGIN:-$QAIRA_PUBLIC_URL,http://localhost:5173,http://localhost:8080}"

  DATABASE_URL="${DATABASE_URL:-postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}}"
  OBS_DATABASE_URL="${OBS_DATABASE_URL:-$DATABASE_URL}"
  REDIS_URL="${REDIS_URL:-redis://redis:6379}"

  ENABLE_OBSERVABILITY="${ENABLE_OBSERVABILITY:-}"
  if [ -z "$ENABLE_OBSERVABILITY" ]; then
    if [ "$STACK" = "platform" ]; then
      ENABLE_OBSERVABILITY=true
    else
      ENABLE_OBSERVABILITY=false
    fi
  fi

  if [ "$STACK" = "testengine" ]; then
    QAIRA_API_BASE_URL="${QAIRA_API_BASE_URL:-$QAIRA_API_PUBLIC_URL}"
    QAIRA_API_INTERNAL_URL="${QAIRA_API_INTERNAL_URL:-$QAIRA_API_BASE_URL}"
  else
    QAIRA_API_BASE_URL="${QAIRA_API_BASE_URL:-/api}"
    QAIRA_API_INTERNAL_URL="${QAIRA_API_INTERNAL_URL:-http://api:3000}"
  fi
  QAIRA_WORKER_API_BASE_URL="${QAIRA_WORKER_API_BASE_URL:-$QAIRA_API_INTERNAL_URL}"
}

write_env_file() {
  mkdir -p "$ENV_DIR"
  RESOLVED_ENV_FILE="$ENV_DIR/${STACK}.env"

  {
    printf 'APP_MODE=%s\n' "$APP_MODE"
    printf 'QAIRA_PUBLIC_URL=%s\n' "$QAIRA_PUBLIC_URL"
    printf 'QAIRA_API_PUBLIC_URL=%s\n' "$QAIRA_API_PUBLIC_URL"
    printf 'QAIRA_API_BASE_URL=%s\n' "$QAIRA_API_BASE_URL"
    printf 'QAIRA_API_INTERNAL_URL=%s\n' "$QAIRA_API_INTERNAL_URL"
    printf 'QAIRA_WORKER_API_BASE_URL=%s\n' "$QAIRA_WORKER_API_BASE_URL"
    printf 'ENGINE_PUBLIC_URL=%s\n' "$ENGINE_PUBLIC_URL"
    printf 'MOBILE_ENGINE_URL=%s\n' "$MOBILE_ENGINE_URL"
    printf 'APPIUM_SERVER_URL=%s\n' "$APPIUM_SERVER_URL"
    printf 'DATABASE_URL=%s\n' "$DATABASE_URL"
    printf 'OBS_DATABASE_URL=%s\n' "$OBS_DATABASE_URL"
    printf 'REDIS_URL=%s\n' "$REDIS_URL"
    printf 'POSTGRES_DB=%s\n' "$POSTGRES_DB"
    printf 'POSTGRES_USER=%s\n' "$POSTGRES_USER"
    printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_PASSWORD"
    printf 'SESSION_SECRET=%s\n' "$SESSION_SECRET"
    printf 'CORS_ORIGIN=%s\n' "$CORS_ORIGIN"
    printf 'QAIRA_TESTENGINE_SECRET=%s\n' "$QAIRA_TESTENGINE_SECRET"
    printf 'TESTENGINE_SHARED_SECRET=%s\n' "$TESTENGINE_SHARED_SECRET"
    printf 'ENABLE_OBSERVABILITY=%s\n' "$ENABLE_OBSERVABILITY"
    printf 'QAIRA_BACKEND_IMAGE=%s\n' "$QAIRA_BACKEND_IMAGE"
    printf 'QAIRA_FRONTEND_IMAGE=%s\n' "$QAIRA_FRONTEND_IMAGE"
    printf 'QAIRA_TESTENGINE_IMAGE=%s\n' "$QAIRA_TESTENGINE_IMAGE"
    printf 'QAIRA_MOBILE_ENGINE_IMAGE=%s\n' "$QAIRA_MOBILE_ENGINE_IMAGE"
    printf 'FRONTEND_PORT=%s\n' "$FRONTEND_PORT"
    printf 'API_PORT=%s\n' "$API_PORT"
    printf 'TESTENGINE_PORT=%s\n' "$TESTENGINE_PORT"
    printf 'MOBILE_ENGINE_PORT=%s\n' "$MOBILE_ENGINE_PORT"
    printf 'REDIS_PORT=%s\n' "$REDIS_PORT"
    printf 'STORAGE_PROVIDER=%s\n' "$STORAGE_PROVIDER"
    printf 'MINIO_ENDPOINT=%s\n' "$MINIO_ENDPOINT"
    printf 'MINIO_PORT=%s\n' "$MINIO_PORT"
    printf 'MINIO_USE_SSL=%s\n' "$MINIO_USE_SSL"
    printf 'MINIO_ROOT_USER=%s\n' "$MINIO_ROOT_USER"
    printf 'MINIO_ROOT_PASSWORD=%s\n' "$MINIO_ROOT_PASSWORD"
    printf 'MINIO_ACCESS_KEY=%s\n' "$MINIO_ACCESS_KEY"
    printf 'MINIO_SECRET_KEY=%s\n' "$MINIO_SECRET_KEY"
    printf 'MINIO_BUCKET=%s\n' "$MINIO_BUCKET"
    printf 'MINIO_REGION=%s\n' "$MINIO_REGION"
    printf 'MAX_ATTACHMENT_BYTES=%s\n' "$MAX_ATTACHMENT_BYTES"
    printf 'QAIRA_HTTP_PORT=%s\n' "$QAIRA_HTTP_PORT"
    printf 'QAIRA_HTTP_BIND=%s\n' "${QAIRA_HTTP_BIND:-0.0.0.0}"
    printf 'QAIRA_API_BIND=%s\n' "${QAIRA_API_BIND:-127.0.0.1}"
    printf 'QAIRA_POSTGRES_BIND=%s\n' "${QAIRA_POSTGRES_BIND:-127.0.0.1}"
    printf 'QAIRA_HAPROXY_STATS_BIND=%s\n' "${QAIRA_HAPROXY_STATS_BIND:-127.0.0.1}"
    printf 'QAIRA_PROMETHEUS_BIND=%s\n' "${QAIRA_PROMETHEUS_BIND:-127.0.0.1}"
    printf 'QAIRA_LOKI_BIND=%s\n' "${QAIRA_LOKI_BIND:-127.0.0.1}"
    printf 'QAIRA_GRAFANA_BIND=%s\n' "${QAIRA_GRAFANA_BIND:-127.0.0.1}"
    printf 'QAIRA_OTEL_GRPC_BIND=%s\n' "${QAIRA_OTEL_GRPC_BIND:-127.0.0.1}"
    printf 'QAIRA_OTEL_HTTP_BIND=%s\n' "${QAIRA_OTEL_HTTP_BIND:-127.0.0.1}"
    printf 'QAIRA_OTEL_METRICS_BIND=%s\n' "${QAIRA_OTEL_METRICS_BIND:-127.0.0.1}"
    printf 'TESTENGINE_BIND=%s\n' "${TESTENGINE_BIND:-0.0.0.0}"
    printf 'SELENIUM_GRID_BIND=%s\n' "${SELENIUM_GRID_BIND:-127.0.0.1}"
    printf 'SELENIUM_VNC_BIND=%s\n' "${SELENIUM_VNC_BIND:-127.0.0.1}"
  } > "$RESOLVED_ENV_FILE"
}

compose() {
  compose_cmd --env-file "$RESOLVED_ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

build_images() {
  ensure_docker
  if [ "$NO_CACHE" = "1" ]; then
    NO_CACHE_FLAG="--no-cache"
  else
    NO_CACHE_FLAG=""
  fi

  info "Building images"
  info "Backend: $QAIRA_BACKEND_IMAGE"
  info "Frontend: $QAIRA_FRONTEND_IMAGE"
  info "Test Engine: $QAIRA_TESTENGINE_IMAGE"
  info "Mobile Engine: $QAIRA_MOBILE_ENGINE_IMAGE"

  docker build $NO_CACHE_FLAG --platform "$PLATFORM" -t "$QAIRA_BACKEND_IMAGE" "$ROOT_DIR/backend"
  docker build $NO_CACHE_FLAG --platform "$PLATFORM" -t "$QAIRA_FRONTEND_IMAGE" "$ROOT_DIR/frontend"
  docker build $NO_CACHE_FLAG --platform "$PLATFORM" -t "$QAIRA_TESTENGINE_IMAGE" -f "$ROOT_DIR/testengine/backend/Dockerfile" "$ROOT_DIR/testengine/backend"
  docker build $NO_CACHE_FLAG --platform "$PLATFORM" -t "$QAIRA_MOBILE_ENGINE_IMAGE" "$ROOT_DIR/local-run/mobile-engine"
}

push_images() {
  build_images
  docker push "$QAIRA_BACKEND_IMAGE"
  docker push "$QAIRA_FRONTEND_IMAGE"
  docker push "$QAIRA_TESTENGINE_IMAGE"
  docker push "$QAIRA_MOBILE_ENGINE_IMAGE"
}

maybe_git_pull() {
  [ "$SKIP_GIT_PULL" = "0" ] || return 0
  command -v git >/dev/null 2>&1 || die "Git is required for deploy unless --skip-git-pull is used."

  CURRENT_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
  [ "$CURRENT_BRANCH" != "HEAD" ] || CURRENT_BRANCH="main"
  BRANCH="${BRANCH:-$CURRENT_BRANCH}"

  git -C "$ROOT_DIR" fetch origin "$BRANCH"
  git -C "$ROOT_DIR" pull --ff-only origin "$BRANCH"
}

confirm_deploy() {
  [ "$ASSUME_YES" = "1" ] && return 0
  [ "${QAIRA_ASSUME_YES:-0}" = "1" ] && return 0

  info
  info "Deployment plan"
  info "Stack: $STACK"
  info "Compose: $COMPOSE_FILE"
  info "Env file: $RESOLVED_ENV_FILE"
  info "Frontend: $QAIRA_PUBLIC_URL"
  info "API public: $QAIRA_API_PUBLIC_URL"
  info "API internal: $QAIRA_API_INTERNAL_URL"
  info "Test Engine: $ENGINE_PUBLIC_URL"
  info
  printf 'Proceed with deployment? [y/N] '
  read answer
  case "$answer" in
    y|Y|yes|YES)
      ;;
    *)
      die "Deployment cancelled."
      ;;
  esac
}

run_up() {
  ensure_docker
  if [ "$BUILD_COMPOSE" = "1" ]; then
    compose up -d --build "$@"
    return
  fi

  if [ "$SKIP_IMAGE_PULL" = "0" ] && [ "$STACK" != "local" ]; then
    compose pull "$@"
  fi

  compose up -d "$@"
}

run_deploy() {
  maybe_git_pull
  confirm_deploy
  ensure_docker

  if [ "$BUILD_COMPOSE" = "1" ]; then
    compose up -d --build --force-recreate "$@"
  else
    if [ "$SKIP_IMAGE_PULL" = "0" ] && [ "$STACK" != "local" ]; then
      compose pull "$@"
    fi
    compose up -d --force-recreate "$@"
  fi

  compose ps
}

COMMAND="${1:-}"
[ -n "$COMMAND" ] || {
  usage
  exit 1
}
shift

STACK="${STACK:-full}"
MODE="${MODE:-}"
CONFIG_FILE=""
SERVICES=""
SKIP_GIT_PULL=0
SKIP_IMAGE_PULL=0
BUILD_COMPOSE=0
ASSUME_YES=0
FOLLOW_LOGS=0
TAIL_LINES=160
BRANCH="${BRANCH:-}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --stack)
      [ "$#" -ge 2 ] || die "Missing value for --stack"
      STACK="$2"
      shift
      ;;
    --mode)
      [ "$#" -ge 2 ] || die "Missing value for --mode"
      MODE="$2"
      shift
      ;;
    --config)
      [ "$#" -ge 2 ] || die "Missing value for --config"
      CONFIG_FILE="$2"
      shift
      ;;
    --service)
      [ "$#" -ge 2 ] || die "Missing value for --service"
      SERVICES="$SERVICES $2"
      shift
      ;;
    --branch)
      [ "$#" -ge 2 ] || die "Missing value for --branch"
      BRANCH="$2"
      shift
      ;;
    --skip-git-pull)
      SKIP_GIT_PULL=1
      ;;
    --skip-image-pull|--no-pull)
      SKIP_IMAGE_PULL=1
      ;;
    --build)
      BUILD_COMPOSE=1
      ;;
    --no-build)
      BUILD_COMPOSE=0
      ;;
    --no-cache)
      NO_CACHE=1
      ;;
    --yes|-y)
      ASSUME_YES=1
      ;;
    --follow|-f)
      FOLLOW_LOGS=1
      ;;
    --tail)
      [ "$#" -ge 2 ] || die "Missing value for --tail"
      TAIL_LINES="$2"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*)
      die "Unknown option: $1"
      ;;
    *)
      SERVICES="$SERVICES $1"
      ;;
  esac
  shift
done

[ -z "$CONFIG_FILE" ] || load_config_file "$CONFIG_FILE"
resolve_stack
resolve_defaults
write_env_file

case "$COMMAND" in
  config)
    info "Resolved QAira service relation config: $RESOLVED_ENV_FILE"
    cat "$RESOLVED_ENV_FILE"
    ;;
  build)
    build_images
    ;;
  push)
    push_images
    ;;
  deploy)
    # shellcheck disable=SC2086
    run_deploy $SERVICES
    ;;
  up)
    # shellcheck disable=SC2086
    run_up $SERVICES
    ;;
  down)
    ensure_docker
    compose down
    ;;
  restart)
    ensure_docker
    # shellcheck disable=SC2086
    compose restart $SERVICES
    ;;
  status|ps)
    ensure_docker
    compose ps
    ;;
  logs)
    ensure_docker
    if [ "$FOLLOW_LOGS" = "1" ]; then
      # shellcheck disable=SC2086
      compose logs -f --tail "$TAIL_LINES" $SERVICES
    else
      # shellcheck disable=SC2086
      compose logs --tail "$TAIL_LINES" $SERVICES
    fi
    ;;
  *)
    die "Unknown command: $COMMAND"
    ;;
esac
