#!/bin/sh
# Build the pinned upstream source without depending on withdrawn MinIO images.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
DEFAULT_MINIO_IMAGE=hellotest/minio:RELEASE.2025-10-15T17-29-55Z
MINIO_IMAGE=${MINIO_IMAGE:-$DEFAULT_MINIO_IMAGE}
OFFLINE=0
case "${1:-}" in
  --help|-h)
    printf '%s\n' 'Usage: sh scripts/build/minio.sh [--offline]' \
      'Build the default MinIO image from pinned official source if absent locally.' \
      'Custom MINIO_IMAGE references are left to Docker/Compose; no retagging or fallback.' \
      '--offline: require a cached image; never build or download.'
    exit 0 ;;
  --offline) OFFLINE=1 ;;
  "") ;;
  *) printf '%s\n' 'Unknown MinIO build option. Use --help.' >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { printf '%s\n' 'Too many MinIO build arguments.' >&2; exit 2; }

# An operator-selected registry image must never be replaced by our source build.
[ "$MINIO_IMAGE" = "$DEFAULT_MINIO_IMAGE" ] || exit 0
. "$ROOT_DIR/scripts/lib/docker.sh"
ensure_docker
if docker image inspect "$MINIO_IMAGE" >/dev/null 2>&1; then
  printf '%s\n' 'Using cached HelloTest MinIO source image.'
  exit 0
fi
if [ "$OFFLINE" = 1 ]; then
  printf '%s\n' 'The default MinIO source image is not cached. Run npm run build:minio before using --skip-image-pull.' >&2
  exit 1
fi

printf '%s\n' 'Building MinIO from pinned official source. The first build downloads compiler dependencies and may take several minutes.'
docker build --tag "$MINIO_IMAGE" --file "$ROOT_DIR/ops/minio/Dockerfile" "$ROOT_DIR/ops/minio"
