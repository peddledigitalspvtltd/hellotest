#!/bin/sh

set -eu
umask 077

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$ROOT_DIR/scripts/docker-common.sh"

ENV_DIR="${HELLOTEST_ENV_DIR:-$ROOT_DIR/.hellotest}"

usage() {
  cat <<EOF
Usage: ./hellotest.sh <command> [options] [services...]

Single HelloTest operator entrypoint for image release, service relation config,
and careful Docker Compose deployment.

Commands:
  config          Generate and print the resolved service relation env file.
  build           Build HelloTest images locally.
  push            Build and push HelloTest images. Does not deploy.
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
  --show-secrets  With config only, explicitly print unredacted secret values.
  --help          Show this message.

High-value overrides:
  HELLOTEST_PUBLIC_URL           Public frontend origin.
  HELLOTEST_API_PUBLIC_URL       Public API origin.
  HELLOTEST_ADMIN_URL            Administration portal URL.
  HELLOTEST_API_BASE_URL         Frontend API base. Default: /api.
  HELLOTEST_API_INTERNAL_URL     Internal API URL for workers.
  ADMIN_FRONTEND_INTERNAL_URL
                             Internal administration UI URL for the API gateway.
  HELLOTEST_WORKER_API_BASE_URL  Local worker API URL override.
  ENGINE_PUBLIC_URL          Public Test Engine URL.
  TESTENGINE_PORT            Test Engine host port.
  HELLOTEST_BACKEND_IMAGE        Backend image ref.
  HELLOTEST_FRONTEND_IMAGE       Frontend image ref.
  HELLOTEST_TESTENGINE_IMAGE     Test Engine image ref.
  HELLOTEST_MOBILE_ENGINE_IMAGE  Mobile Engine image ref.

Examples:
  ./hellotest.sh config --stack local
  ./hellotest.sh up --stack local
  ./hellotest.sh push
  ./hellotest.sh deploy --stack platform --yes
  HELLOTEST_PUBLIC_URL=https://hellotest.example.com ./hellotest.sh deploy --stack platform
  HELLOTEST_API_BASE_URL=https://hellotest.example.com/api ./hellotest.sh deploy --stack testengine --yes
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

generated_env_value() {
  key="$1"
  generated_file="$ENV_DIR/${STACK}.env"
  [ -f "$generated_file" ] || return 1

  awk -v key="$key" '
    index($0, key "=") == 1 {
      print substr($0, length(key) + 2)
      exit
    }
  ' "$generated_file"
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi

  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

secure_default() {
  key="$1"
  development_value="$2"
  persisted_value="$(generated_env_value "$key" || true)"

  case "$STACK" in
    platform|testengine)
      case "$persisted_value" in
        ""|admin|hellotest|hellotest-dev-secret|hellotest-local-dev-secret|hellotest-testengine-dev-secret|hellotest-mobile-engine-dev-secret|hellotest-minio-dev-secret)
          random_secret
          ;;
        *)
          if [ "${#persisted_value}" -ge 32 ]; then
            printf '%s' "$persisted_value"
          else
            random_secret
          fi
          ;;
      esac
      ;;
    *)
      printf '%s' "$development_value"
      ;;
  esac
}

require_strong_secret() {
  key="$1"
  value="$2"
  minimum_length="$3"

  case "$value" in
    ""|admin|hellotest|hellotest-dev-secret|hellotest-local-dev-secret|hellotest-testengine-dev-secret|hellotest-mobile-engine-dev-secret|hellotest-minio-dev-secret|change-me)
      die "$key must not use a development/default credential for the $STACK stack"
      ;;
  esac

  [ "${#value}" -ge "$minimum_length" ] \
    || die "$key must contain at least $minimum_length characters for the $STACK stack"
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

  HELLOTEST_BACKEND_IMAGE="${HELLOTEST_BACKEND_IMAGE:-${DOCKER_NAMESPACE}/hellotest-backend:${IMAGE_TAG}}"
  HELLOTEST_FRONTEND_IMAGE="${HELLOTEST_FRONTEND_IMAGE:-${DOCKER_NAMESPACE}/hellotest-frontend:${IMAGE_TAG}}"
  HELLOTEST_TESTENGINE_IMAGE="${HELLOTEST_TESTENGINE_IMAGE:-${DOCKER_NAMESPACE}/hellotest-testengine:${IMAGE_TAG}}"
  HELLOTEST_MOBILE_ENGINE_IMAGE="${HELLOTEST_MOBILE_ENGINE_IMAGE:-${DOCKER_NAMESPACE}/hellotest-mobile-engine:${IMAGE_TAG}}"

  POSTGRES_DB="${POSTGRES_DB:-hellotest}"
  POSTGRES_USER="${POSTGRES_USER:-hellotest}"
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(secure_default POSTGRES_PASSWORD hellotest)}"
  SESSION_SECRET="${SESSION_SECRET:-$(secure_default SESSION_SECRET hellotest-dev-secret)}"
  HELLOTEST_TESTENGINE_SECRET="${HELLOTEST_TESTENGINE_SECRET:-$(secure_default HELLOTEST_TESTENGINE_SECRET hellotest-testengine-dev-secret)}"
  TESTENGINE_SHARED_SECRET="${TESTENGINE_SHARED_SECRET:-$HELLOTEST_TESTENGINE_SECRET}"
  MOBILE_ENGINE_SHARED_SECRET="${MOBILE_ENGINE_SHARED_SECRET:-$(secure_default MOBILE_ENGINE_SHARED_SECRET hellotest-mobile-engine-dev-secret)}"

  PUBLIC_SCHEME="${HELLOTEST_PUBLIC_SCHEME:-http}"
  PUBLIC_HOST="${HELLOTEST_PUBLIC_HOST:-localhost}"
  FRONTEND_PORT="${FRONTEND_PORT:-8080}"
  HELLOTEST_ADMIN_PORT="${HELLOTEST_ADMIN_PORT:-8081}"
  API_PORT="${API_PORT:-3000}"
  HELLOTEST_HTTP_PORT="${HELLOTEST_HTTP_PORT:-80}"
  TESTENGINE_PORT="${TESTENGINE_PORT:-4301}"
  MOBILE_ENGINE_PORT="${MOBILE_ENGINE_PORT:-4312}"
  REDIS_PORT="${REDIS_PORT:-6379}"
  STORAGE_PROVIDER="${STORAGE_PROVIDER:-minio}"
  MINIO_ENDPOINT="${MINIO_ENDPOINT:-minio}"
  MINIO_PORT="${MINIO_PORT:-9000}"
  MINIO_USE_SSL="${MINIO_USE_SSL:-false}"
  MINIO_ROOT_USER="${MINIO_ROOT_USER:-hellotest}"
  MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-$(secure_default MINIO_ROOT_PASSWORD hellotest-minio-dev-secret)}"
  MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-$MINIO_ROOT_USER}"
  MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-$MINIO_ROOT_PASSWORD}"
  MINIO_BUCKET="${MINIO_BUCKET:-hellotest-attachments}"
  MINIO_REGION="${MINIO_REGION:-us-east-1}"
  MAX_ATTACHMENT_BYTES="${MAX_ATTACHMENT_BYTES:-104857600}"
  GRAFANA_ADMIN_USER="${GRAFANA_ADMIN_USER:-admin}"
  GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-$(secure_default GRAFANA_ADMIN_PASSWORD admin)}"
  ADMIN_BOOTSTRAP_ENABLED="${ADMIN_BOOTSTRAP_ENABLED:-true}"
  ADMIN_BOOTSTRAP_USERNAME="${ADMIN_BOOTSTRAP_USERNAME:-bootstrap-admin}"
  ADMIN_BOOTSTRAP_PASSWORD="${ADMIN_BOOTSTRAP_PASSWORD:-$(secure_default ADMIN_BOOTSTRAP_PASSWORD admin)}"

  case "$STACK" in
    platform)
      require_strong_secret POSTGRES_PASSWORD "$POSTGRES_PASSWORD" 16
      require_strong_secret SESSION_SECRET "$SESSION_SECRET" 32
      require_strong_secret HELLOTEST_TESTENGINE_SECRET "$HELLOTEST_TESTENGINE_SECRET" 32
      require_strong_secret MOBILE_ENGINE_SHARED_SECRET "$MOBILE_ENGINE_SHARED_SECRET" 32
      require_strong_secret MINIO_ROOT_PASSWORD "$MINIO_ROOT_PASSWORD" 16
      require_strong_secret GRAFANA_ADMIN_PASSWORD "$GRAFANA_ADMIN_PASSWORD" 16
      require_strong_secret ADMIN_BOOTSTRAP_PASSWORD "$ADMIN_BOOTSTRAP_PASSWORD" 16
      [ "$(printf '%s' "$ADMIN_BOOTSTRAP_USERNAME" | tr '[:upper:]' '[:lower:]')" != "admin" ] \
        || die "ADMIN_BOOTSTRAP_USERNAME must not use the default admin identity for the platform stack"
      ;;
    testengine)
      require_strong_secret HELLOTEST_TESTENGINE_SECRET "$HELLOTEST_TESTENGINE_SECRET" 32
      require_strong_secret TESTENGINE_SHARED_SECRET "$TESTENGINE_SHARED_SECRET" 32
      require_strong_secret MOBILE_ENGINE_SHARED_SECRET "$MOBILE_ENGINE_SHARED_SECRET" 32
      ;;
  esac

  case "$STACK" in
    platform)
      HELLOTEST_PUBLIC_URL="${HELLOTEST_PUBLIC_URL:-$(origin_with_port "$PUBLIC_SCHEME" "$PUBLIC_HOST" "$HELLOTEST_HTTP_PORT")}"
      HELLOTEST_API_PUBLIC_URL="${HELLOTEST_API_PUBLIC_URL:-$HELLOTEST_PUBLIC_URL/api}"
      HELLOTEST_ADMIN_URL="${HELLOTEST_ADMIN_URL:-${HELLOTEST_PUBLIC_URL%/}/admin}"
      ;;
    testengine)
      HELLOTEST_PUBLIC_URL="${HELLOTEST_PUBLIC_URL:-$(origin_with_port "$PUBLIC_SCHEME" "$PUBLIC_HOST" "$FRONTEND_PORT")}"
      HELLOTEST_API_PUBLIC_URL="${HELLOTEST_API_PUBLIC_URL:-$(origin_with_port "$PUBLIC_SCHEME" "$PUBLIC_HOST" "$API_PORT")}"
      HELLOTEST_ADMIN_URL="${HELLOTEST_ADMIN_URL:-${HELLOTEST_API_PUBLIC_URL%/}/admin}"
      ;;
    *)
      HELLOTEST_PUBLIC_URL="${HELLOTEST_PUBLIC_URL:-$(origin_with_port "$PUBLIC_SCHEME" "$PUBLIC_HOST" "$FRONTEND_PORT")}"
      HELLOTEST_API_PUBLIC_URL="${HELLOTEST_API_PUBLIC_URL:-$(origin_with_port "$PUBLIC_SCHEME" "$PUBLIC_HOST" "$API_PORT")}"
      HELLOTEST_ADMIN_URL="${HELLOTEST_ADMIN_URL:-${HELLOTEST_API_PUBLIC_URL%/}/admin}"
      ;;
  esac

  ENGINE_PUBLIC_URL="${ENGINE_PUBLIC_URL:-$(origin_with_port "$PUBLIC_SCHEME" "$PUBLIC_HOST" "$TESTENGINE_PORT")}"
  MOBILE_ENGINE_URL="${MOBILE_ENGINE_URL:-http://mobile-engine:4312}"
  APPIUM_SERVER_URL="${APPIUM_SERVER_URL:-http://host.docker.internal:4723}"
  CORS_ORIGIN="${CORS_ORIGIN:-$HELLOTEST_PUBLIC_URL,http://localhost:5173,http://localhost:5174,http://localhost:8080,http://localhost:8081}"
  ADMIN_FRONTEND_INTERNAL_URL="${ADMIN_FRONTEND_INTERNAL_URL:-http://frontend:81}"

  DATABASE_URL="${DATABASE_URL:-postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}}"
  OBS_DATABASE_URL="${OBS_DATABASE_URL:-$DATABASE_URL}"
  REDIS_URL="${REDIS_URL:-redis://redis:6379}"

  ENABLE_OBSERVABILITY="${ENABLE_OBSERVABILITY:-}"
  if [ -z "$ENABLE_OBSERVABILITY" ]; then
    case "$STACK" in
      local|full|platform) ENABLE_OBSERVABILITY=true ;;
      *) ENABLE_OBSERVABILITY=false ;;
    esac
  fi

  if [ "$STACK" = "testengine" ]; then
    HELLOTEST_API_BASE_URL="${HELLOTEST_API_BASE_URL:-$HELLOTEST_API_PUBLIC_URL}"
    HELLOTEST_API_INTERNAL_URL="${HELLOTEST_API_INTERNAL_URL:-$HELLOTEST_API_BASE_URL}"
  else
    HELLOTEST_API_BASE_URL="${HELLOTEST_API_BASE_URL:-/api}"
    HELLOTEST_API_INTERNAL_URL="${HELLOTEST_API_INTERNAL_URL:-http://api:3000}"
  fi
  HELLOTEST_WORKER_API_BASE_URL="${HELLOTEST_WORKER_API_BASE_URL:-$HELLOTEST_API_INTERNAL_URL}"
}

write_env_file() {
  mkdir -p "$ENV_DIR"
  chmod 700 "$ENV_DIR"
  RESOLVED_ENV_FILE="$ENV_DIR/${STACK}.env"

  {
    printf 'APP_MODE=%s\n' "$APP_MODE"
    printf 'HELLOTEST_PUBLIC_URL=%s\n' "$HELLOTEST_PUBLIC_URL"
    printf 'HELLOTEST_API_PUBLIC_URL=%s\n' "$HELLOTEST_API_PUBLIC_URL"
    printf 'HELLOTEST_ADMIN_URL=%s\n' "$HELLOTEST_ADMIN_URL"
    printf 'HELLOTEST_API_BASE_URL=%s\n' "$HELLOTEST_API_BASE_URL"
    printf 'HELLOTEST_API_INTERNAL_URL=%s\n' "$HELLOTEST_API_INTERNAL_URL"
    printf 'HELLOTEST_WORKER_API_BASE_URL=%s\n' "$HELLOTEST_WORKER_API_BASE_URL"
    printf 'ADMIN_FRONTEND_INTERNAL_URL=%s\n' "$ADMIN_FRONTEND_INTERNAL_URL"
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
    printf 'HELLOTEST_TESTENGINE_SECRET=%s\n' "$HELLOTEST_TESTENGINE_SECRET"
    printf 'TESTENGINE_SHARED_SECRET=%s\n' "$TESTENGINE_SHARED_SECRET"
    printf 'MOBILE_ENGINE_SHARED_SECRET=%s\n' "$MOBILE_ENGINE_SHARED_SECRET"
    printf 'ENABLE_OBSERVABILITY=%s\n' "$ENABLE_OBSERVABILITY"
    printf 'HELLOTEST_BACKEND_IMAGE=%s\n' "$HELLOTEST_BACKEND_IMAGE"
    printf 'HELLOTEST_FRONTEND_IMAGE=%s\n' "$HELLOTEST_FRONTEND_IMAGE"
    printf 'HELLOTEST_TESTENGINE_IMAGE=%s\n' "$HELLOTEST_TESTENGINE_IMAGE"
    printf 'HELLOTEST_MOBILE_ENGINE_IMAGE=%s\n' "$HELLOTEST_MOBILE_ENGINE_IMAGE"
    printf 'FRONTEND_PORT=%s\n' "$FRONTEND_PORT"
    printf 'HELLOTEST_ADMIN_PORT=%s\n' "$HELLOTEST_ADMIN_PORT"
    printf 'ADMIN_PORTAL_PORT=%s\n' "$HELLOTEST_ADMIN_PORT"
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
    printf 'GRAFANA_ADMIN_USER=%s\n' "$GRAFANA_ADMIN_USER"
    printf 'GRAFANA_ADMIN_PASSWORD=%s\n' "$GRAFANA_ADMIN_PASSWORD"
    printf 'ADMIN_BOOTSTRAP_ENABLED=%s\n' "$ADMIN_BOOTSTRAP_ENABLED"
    printf 'ADMIN_BOOTSTRAP_USERNAME=%s\n' "$ADMIN_BOOTSTRAP_USERNAME"
    printf 'ADMIN_BOOTSTRAP_PASSWORD=%s\n' "$ADMIN_BOOTSTRAP_PASSWORD"
    printf 'HELLOTEST_HTTP_PORT=%s\n' "$HELLOTEST_HTTP_PORT"
    printf 'HELLOTEST_HTTP_BIND=%s\n' "${HELLOTEST_HTTP_BIND:-0.0.0.0}"
    printf 'HELLOTEST_API_BIND=%s\n' "${HELLOTEST_API_BIND:-127.0.0.1}"
    printf 'HELLOTEST_POSTGRES_BIND=%s\n' "${HELLOTEST_POSTGRES_BIND:-127.0.0.1}"
    printf 'HELLOTEST_HAPROXY_STATS_BIND=%s\n' "${HELLOTEST_HAPROXY_STATS_BIND:-127.0.0.1}"
    printf 'HELLOTEST_PROMETHEUS_BIND=%s\n' "${HELLOTEST_PROMETHEUS_BIND:-127.0.0.1}"
    printf 'HELLOTEST_LOKI_BIND=%s\n' "${HELLOTEST_LOKI_BIND:-127.0.0.1}"
    printf 'HELLOTEST_GRAFANA_BIND=%s\n' "${HELLOTEST_GRAFANA_BIND:-127.0.0.1}"
    printf 'HELLOTEST_JAEGER_BIND=%s\n' "${HELLOTEST_JAEGER_BIND:-127.0.0.1}"
    printf 'HELLOTEST_OTEL_GRPC_BIND=%s\n' "${HELLOTEST_OTEL_GRPC_BIND:-127.0.0.1}"
    printf 'HELLOTEST_OTEL_HTTP_BIND=%s\n' "${HELLOTEST_OTEL_HTTP_BIND:-127.0.0.1}"
    printf 'HELLOTEST_OTEL_METRICS_BIND=%s\n' "${HELLOTEST_OTEL_METRICS_BIND:-127.0.0.1}"
    if [ "$STACK" = "testengine" ]; then
      printf 'TESTENGINE_BIND=%s\n' "${TESTENGINE_BIND:-0.0.0.0}"
    else
      printf 'TESTENGINE_BIND=%s\n' "${TESTENGINE_BIND:-127.0.0.1}"
    fi
    printf 'MOBILE_ENGINE_BIND=%s\n' "${MOBILE_ENGINE_BIND:-127.0.0.1}"
    printf 'SELENIUM_GRID_BIND=%s\n' "${SELENIUM_GRID_BIND:-127.0.0.1}"
    printf 'SELENIUM_VNC_BIND=%s\n' "${SELENIUM_VNC_BIND:-127.0.0.1}"
  } > "$RESOLVED_ENV_FILE"
  chmod 600 "$RESOLVED_ENV_FILE"
}

print_redacted_env_file() {
  awk -F= '
    {
      key = $1
      if (key ~ /DATABASE_URL$/ || key ~ /(PASSWORD|SECRET|TOKEN|API_KEY|ACCESS_KEY)/) {
        print key "=[REDACTED]"
      } else {
        print
      }
    }
  ' "$RESOLVED_ENV_FILE"
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
  info "Backend: $HELLOTEST_BACKEND_IMAGE"
  info "Frontend: $HELLOTEST_FRONTEND_IMAGE"
  info "Test Engine: $HELLOTEST_TESTENGINE_IMAGE"
  info "Mobile Engine: $HELLOTEST_MOBILE_ENGINE_IMAGE"

  docker build $NO_CACHE_FLAG --platform "$PLATFORM" -t "$HELLOTEST_BACKEND_IMAGE" "$ROOT_DIR/backend"
  docker build $NO_CACHE_FLAG --platform "$PLATFORM" -t "$HELLOTEST_FRONTEND_IMAGE" "$ROOT_DIR/frontend"
  docker build $NO_CACHE_FLAG --platform "$PLATFORM" -t "$HELLOTEST_TESTENGINE_IMAGE" -f "$ROOT_DIR/testengine/backend/Dockerfile" "$ROOT_DIR/testengine/backend"
  docker build $NO_CACHE_FLAG --platform "$PLATFORM" -t "$HELLOTEST_MOBILE_ENGINE_IMAGE" "$ROOT_DIR/local-run/mobile-engine"
}

push_images() {
  build_images
  docker push "$HELLOTEST_BACKEND_IMAGE"
  docker push "$HELLOTEST_FRONTEND_IMAGE"
  docker push "$HELLOTEST_TESTENGINE_IMAGE"
  docker push "$HELLOTEST_MOBILE_ENGINE_IMAGE"
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
  [ "${HELLOTEST_ASSUME_YES:-0}" = "1" ] && return 0

  info
  info "Deployment plan"
  info "Stack: $STACK"
  info "Compose: $COMPOSE_FILE"
  info "Env file: $RESOLVED_ENV_FILE"
  info "Frontend: $HELLOTEST_PUBLIC_URL"
  info "API public: $HELLOTEST_API_PUBLIC_URL"
  info "Administration: $HELLOTEST_ADMIN_URL"
  info "API internal: $HELLOTEST_API_INTERNAL_URL"
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
    if [ "$NO_CACHE" = "1" ]; then
      compose build --no-cache "$@"
      compose up -d "$@"
    else
      compose up -d --build "$@"
    fi
  else
    if [ "$SKIP_IMAGE_PULL" = "0" ] && [ "$STACK" != "local" ]; then
      compose pull "$@"
    fi

    compose up -d "$@"
  fi

  info
  info "HelloTest is starting"
  info "Workspace: $HELLOTEST_PUBLIC_URL"
  info "API: $HELLOTEST_API_PUBLIC_URL"
  info "Administration: $HELLOTEST_ADMIN_URL"
}

run_deploy() {
  maybe_git_pull
  confirm_deploy
  ensure_docker

  if [ "$BUILD_COMPOSE" = "1" ]; then
    if [ "$NO_CACHE" = "1" ]; then
      compose build --no-cache "$@"
      compose up -d --force-recreate "$@"
    else
      compose up -d --build --force-recreate "$@"
    fi
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
case "$COMMAND" in
  help|--help|-h)
    usage
    exit 0
    ;;
esac
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
SHOW_SECRETS=0
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
    --show-secrets)
      SHOW_SECRETS=1
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

if [ "$SHOW_SECRETS" = "1" ] && [ "$COMMAND" != "config" ]; then
  die "--show-secrets is supported only with the config command"
fi

[ -z "$CONFIG_FILE" ] || load_config_file "$CONFIG_FILE"
resolve_stack
resolve_defaults
write_env_file

case "$COMMAND" in
  config)
    info "Resolved HelloTest service relation config: $RESOLVED_ENV_FILE"
    if [ "$SHOW_SECRETS" = "1" ]; then
      printf '%s\n' "Warning: printing unredacted deployment secrets by explicit request." >&2
      cat "$RESOLVED_ENV_FILE"
    else
      print_redacted_env_file
      info "Secret values are redacted. Re-run with --show-secrets only in a private terminal when the raw values are required."
    fi
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
