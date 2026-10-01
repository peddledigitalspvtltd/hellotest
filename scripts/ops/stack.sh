#!/bin/sh

# Docker-only monitoring entrypoint; no host Node.js or npm is required.
set -eu
umask 077

OPS_ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
. "$OPS_ROOT_DIR/scripts/lib/docker.sh"
OPS_COMMAND=${1:-status}
case "$OPS_COMMAND" in
  up|status|down|prepare) ;;
  *) echo "Use scripts/ops/stack.sh up, status, down or prepare" >&2; exit 1 ;;
esac

OPS_ENV_DIR=${HELLOTEST_ENV_DIR:-$OPS_ROOT_DIR/.hellotest}
mkdir -p "$OPS_ENV_DIR"
OPS_ENV_DIR=$(CDPATH= cd -- "$OPS_ENV_DIR" && pwd)
OPS_ENV_FILE="$OPS_ENV_DIR/ops.env"
if [ ! -f "$OPS_ENV_FILE" ]; then
  OPS_NEW_PASSWORD=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  [ "${#OPS_NEW_PASSWORD}" -eq 64 ] || { echo "Could not generate Grafana credentials." >&2; exit 1; }
  # Do not replace credentials created by another launcher at the same time.
  if ! (set -C; printf 'GRAFANA_ADMIN_PASSWORD=%s\n' "$OPS_NEW_PASSWORD" > "$OPS_ENV_FILE") 2>/dev/null; then
    [ -f "$OPS_ENV_FILE" ] || { echo "Could not create $OPS_ENV_FILE" >&2; exit 1; }
  fi
  unset OPS_NEW_PASSWORD
fi
chmod 600 "$OPS_ENV_FILE"
[ "$OPS_COMMAND" != prepare ] || exit 0

# The ops file owns these credentials, even if app defaults are exported.
unset GRAFANA_ADMIN_PASSWORD GRAFANA_ADMIN_USER
cd "$OPS_ROOT_DIR"
ops_compose() {
  compose_cmd --env-file "$OPS_ENV_FILE" -f "$OPS_ROOT_DIR/docker-compose.ops.yml" "$@"
}
attach_application() {
  if ! OPS_ATTACHED=$(docker inspect --format '{{if index .NetworkSettings.Networks "hellotest-ops"}}attached{{end}}' "$1" 2>/dev/null); then
    printf 'Application container %s is not attached; start it and run sh scripts/ops/stack.sh up again.\n' "$1" >&2
  elif [ "$OPS_ATTACHED" != attached ]; then
    if ! docker network connect --alias "$2" hellotest-ops "$1"; then
      printf 'Application container %s could not attach to monitoring; retry sh scripts/ops/stack.sh up.\n' "$1" >&2
    fi
  fi
}

case "$OPS_COMMAND" in
  down)
    # Keep the shared network and all telemetry volumes intact.
    ops_compose stop
    ;;
  up)
    if [ "${HELLOTEST_OPS_SKIP_IMAGE_PULL:-0}" = 1 ]; then
      ops_compose up -d --pull never
    else
      ops_compose up -d
    fi
    attach_application "${OPS_API_CONTAINER:-hellotest-local-api}" api
    attach_application "${OPS_FRONTEND_CONTAINER:-hellotest-local-frontend}" frontend
    printf 'Ops started. Grafana credentials are in %s (owner-readable only).\n' "$OPS_ENV_FILE"
    ;;
esac
ops_compose ps
