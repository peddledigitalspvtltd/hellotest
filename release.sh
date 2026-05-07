#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/scripts/docker-common.sh"

usage() {
  cat <<EOF
Usage: ./release.sh [options]

Builds and pushes the backend + frontend + Test Engine + Mobile Engine Docker images.
It refreshes the docker-compose.full.yml stack by default and can also
refresh the standalone Test Engine deployment on the current host.

Options:
  --no-deploy     Build and push images only. Skip docker compose refresh.
  --deploy        Force stack refresh after push. This is the default.
  --deploy-testengine-local  Refresh the local standalone Test Engine deployment too.
  --help          Show this help message.

Environment variables:
  DOCKER_NAMESPACE      Docker Hub namespace. Default: jayarajumetta
  IMAGE_TAG             Image tag for all app images. Default: latest
  PLATFORM              Docker build platform. Default: linux/amd64
  NO_CACHE              Set to 0 to allow Docker layer cache. Default: 1
  QAIRA_BACKEND_IMAGE   Full backend image ref override
  QAIRA_FRONTEND_IMAGE  Full frontend image ref override
  QAIRA_TESTENGINE_IMAGE Full Test Engine image ref override
  QAIRA_MOBILE_ENGINE_IMAGE Full Mobile Engine image ref override

Examples:
  ./release.sh
  IMAGE_TAG=v1.2.0 ./release.sh
  DOCKER_NAMESPACE=myuser NO_CACHE=0 ./release.sh
  ./release.sh --no-deploy
  ./release.sh --deploy-testengine-local
EOF
}

DEPLOY_STACK=1
DEPLOY_TESTENGINE_LOCAL=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-deploy)
      DEPLOY_STACK=0
      ;;
    --deploy)
      DEPLOY_STACK=1
      ;;
    --deploy-testengine-local)
      DEPLOY_TESTENGINE_LOCAL=1
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

DOCKER_NAMESPACE="${DOCKER_NAMESPACE:-jayarajumetta}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"
NO_CACHE="${NO_CACHE:-1}"

BACKEND_IMAGE="${QAIRA_BACKEND_IMAGE:-${DOCKER_NAMESPACE}/qaira-backend:${IMAGE_TAG}}"
FRONTEND_IMAGE="${QAIRA_FRONTEND_IMAGE:-${DOCKER_NAMESPACE}/qaira-frontend:${IMAGE_TAG}}"
TESTENGINE_IMAGE="${QAIRA_TESTENGINE_IMAGE:-${DOCKER_NAMESPACE}/qaira-testengine:${IMAGE_TAG}}"
MOBILE_ENGINE_IMAGE="${QAIRA_MOBILE_ENGINE_IMAGE:-${DOCKER_NAMESPACE}/qaira-mobile-engine:${IMAGE_TAG}}"

if [ "$NO_CACHE" = "0" ]; then
  NO_CACHE_FLAG=""
else
  NO_CACHE_FLAG="--no-cache"
fi

echo "Releasing QAIra images"
echo "Root: $SCRIPT_DIR"
echo "Backend image: $BACKEND_IMAGE"
echo "Frontend image: $FRONTEND_IMAGE"
echo "Test Engine image: $TESTENGINE_IMAGE"
echo "Mobile Engine image: $MOBILE_ENGINE_IMAGE"
echo "Platform: $PLATFORM"
echo "No cache: $NO_CACHE"

echo
echo "Checking Docker daemon..."
ensure_docker

echo
echo "Building backend image..."
docker build $NO_CACHE_FLAG --platform "$PLATFORM" -t "$BACKEND_IMAGE" "$SCRIPT_DIR/backend"

echo
echo "Building frontend image..."
docker build $NO_CACHE_FLAG --platform "$PLATFORM" -t "$FRONTEND_IMAGE" "$SCRIPT_DIR/frontend"

echo
echo "Building Test Engine image..."
docker build $NO_CACHE_FLAG --platform "$PLATFORM" -t "$TESTENGINE_IMAGE" -f "$SCRIPT_DIR/testengine/backend/Dockerfile" "$SCRIPT_DIR/testengine/backend"

echo
echo "Building Mobile Engine image..."
docker build $NO_CACHE_FLAG --platform "$PLATFORM" -t "$MOBILE_ENGINE_IMAGE" "$SCRIPT_DIR/local-run/mobile-engine"

echo
echo "Pushing backend image..."
docker push "$BACKEND_IMAGE"

echo
echo "Pushing frontend image..."
docker push "$FRONTEND_IMAGE"

echo
echo "Pushing Test Engine image..."
docker push "$TESTENGINE_IMAGE"

echo
echo "Pushing Mobile Engine image..."
docker push "$MOBILE_ENGINE_IMAGE"

if [ "$DEPLOY_STACK" = "1" ]; then
  echo
  echo "Refreshing full stack..."
  QAIRA_BACKEND_IMAGE="$BACKEND_IMAGE" \
  QAIRA_FRONTEND_IMAGE="$FRONTEND_IMAGE" \
  QAIRA_TESTENGINE_IMAGE="$TESTENGINE_IMAGE" \
  QAIRA_MOBILE_ENGINE_IMAGE="$MOBILE_ENGINE_IMAGE" \
    compose_cmd -f "$SCRIPT_DIR/docker-compose.full.yml" pull
  QAIRA_BACKEND_IMAGE="$BACKEND_IMAGE" \
  QAIRA_FRONTEND_IMAGE="$FRONTEND_IMAGE" \
  QAIRA_TESTENGINE_IMAGE="$TESTENGINE_IMAGE" \
  QAIRA_MOBILE_ENGINE_IMAGE="$MOBILE_ENGINE_IMAGE" \
    compose_cmd -f "$SCRIPT_DIR/docker-compose.full.yml" up -d --force-recreate

  echo
  echo "Current stack:"
  QAIRA_BACKEND_IMAGE="$BACKEND_IMAGE" \
  QAIRA_FRONTEND_IMAGE="$FRONTEND_IMAGE" \
  QAIRA_TESTENGINE_IMAGE="$TESTENGINE_IMAGE" \
  QAIRA_MOBILE_ENGINE_IMAGE="$MOBILE_ENGINE_IMAGE" \
    compose_cmd -f "$SCRIPT_DIR/docker-compose.full.yml" ps
fi

if [ "$DEPLOY_TESTENGINE_LOCAL" = "1" ]; then
  echo
  echo "Refreshing standalone Test Engine deployment..."
  QAIRA_TESTENGINE_IMAGE="$TESTENGINE_IMAGE" \
    compose_cmd -f "$SCRIPT_DIR/testengine/docker-compose.deploy.yml" pull testengine
  QAIRA_TESTENGINE_IMAGE="$TESTENGINE_IMAGE" \
    compose_cmd -f "$SCRIPT_DIR/testengine/docker-compose.deploy.yml" up -d --force-recreate testengine

  echo
  echo "Current Test Engine deployment:"
  QAIRA_TESTENGINE_IMAGE="$TESTENGINE_IMAGE" \
    compose_cmd -f "$SCRIPT_DIR/testengine/docker-compose.deploy.yml" ps testengine
fi

echo
echo "Release complete."
echo "Frontend: http://localhost:8080"
echo "Backend: http://localhost:3000"
echo "Test Engine image: $TESTENGINE_IMAGE"
echo "Mobile Engine image: $MOBILE_ENGINE_IMAGE"
