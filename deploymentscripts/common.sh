#!/bin/sh

set -eu

DEPLOYMENT_SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$DEPLOYMENT_SCRIPT_DIR/.." && pwd)"

. "$REPO_ROOT/scripts/docker-common.sh"

die() {
  echo "Error: $*" >&2
  exit 1
}

warn() {
  echo "Warning: $*" >&2
}

info() {
  echo "$*"
}

ensure_git() {
  if ! command -v git >/dev/null 2>&1; then
    die "Git is required but was not found in PATH."
  fi
}

container_exists() {
  docker inspect "$1" >/dev/null 2>&1
}

container_is_running() {
  [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || echo false)" = "true" ]
}

wait_for_url() {
  url="$1"
  label="$2"

  if ! command -v curl >/dev/null 2>&1; then
    warn "Skipping ${label} readiness check because curl is not installed."
    return 0
  fi

  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      info "${label} is responding at ${url}"
      return 0
    fi

    attempt=$((attempt + 1))
    sleep 2
  done

  warn "${label} did not respond at ${url} within 60 seconds."
}

require_url() {
  url="$1"
  label="$2"

  if ! command -v curl >/dev/null 2>&1; then
    die "curl is required for ${label} readiness checks."
  fi

  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      info "${label} is responding at ${url}"
      return 0
    fi

    attempt=$((attempt + 1))
    sleep 2
  done

  die "${label} did not respond at ${url} within 60 seconds."
}

aws_public_ipv4() {
  if ! command -v curl >/dev/null 2>&1; then
    return 0
  fi

  token="$(curl -fsS --max-time 2 -X PUT \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 60" \
    http://169.254.169.254/latest/api/token 2>/dev/null || true)"

  if [ -n "$token" ]; then
    curl -fsS --max-time 2 \
      -H "X-aws-ec2-metadata-token: $token" \
      http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true
    return 0
  fi

  curl -fsS --max-time 2 \
    http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true
}

print_container_table() {
  docker ps -a \
    --filter "name=hellotest" \
    --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
}
