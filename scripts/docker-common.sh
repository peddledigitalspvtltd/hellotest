#!/bin/sh

set -eu

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required but was not found in PATH."
    exit 1
  fi

  if ! docker ps >/dev/null 2>&1; then
    echo "Docker daemon is not reachable. Start Docker Desktop, then rerun the command." >&2
    exit 1
  fi
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
    return
  fi

  echo "Docker Compose is required but was not found."
  exit 1
}
