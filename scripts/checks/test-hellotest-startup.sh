#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
TEST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/hellotest-startup.XXXXXX")
trap 'rm -rf "$TEST_DIR"' EXIT HUP INT TERM

mkdir -p "$TEST_DIR/bin"
cat > "$TEST_DIR/bin/docker" <<'EOF'
#!/bin/sh
set -eu

case "$1" in
  ps) exit 0 ;;
  inspect) printf 'attached\n'; exit 0 ;;
  image)
    [ "$2" = inspect ] || exit 92
    [ "${MOCK_MINIO_PRESENT:-1}" = 1 ] && exit 0
    exit 1 ;;
  build)
    printf '%s\n' 'minio source build' >> "$MOCK_DOCKER_TRACE"
    exit "${MOCK_MINIO_BUILD_STATUS:-0}" ;;
  compose) shift ;;
  *) echo "Unexpected Docker command: $*" >&2; exit 90 ;;
esac

[ "$1" != "version" ] || exit 0
MOCK_IS_OPS=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file) shift 2 ;;
    -f) case "$2" in */docker-compose.ops.yml) MOCK_IS_OPS=1 ;; esac; shift 2 ;;
    *) break ;;
  esac
done

if [ "$MOCK_IS_OPS" = 1 ]; then
  printf 'ops %s\n' "$*" >> "$MOCK_DOCKER_TRACE"
  [ "$1" != up ] || exit "${MOCK_OPS_STATUS:-0}"
  exit 0
fi

if [ "$1" = config ]; then
  [ "$2" = --services ] || exit 93
  [ "${MOCK_STORAGE_REQUIRED:-1}" = 0 ] || printf '%s\n' minio
  printf '%s\n' api frontend
  exit 0
fi

printf '%s\n' "$*" >> "$MOCK_DOCKER_TRACE"
case "$1" in
  pull)
    if [ "${MOCK_PULL_STATUS:-0}" != "0" ]; then
      echo 'Registry unavailable for runtime image' >&2
      exit "$MOCK_PULL_STATUS"
    fi
    ;;
  build) exit "${MOCK_BUILD_STATUS:-0}" ;;
  up|ps) ;;
  *) echo "Unexpected Compose command: $*" >&2; exit 91 ;;
esac
EOF
chmod +x "$TEST_DIR/bin/docker"

# Reproduce a VPS with no usable host Node executable.
cat > "$TEST_DIR/bin/node" <<'EOF'
#!/bin/sh
printf 'Unexpected host Node invocation\n' >> "$MOCK_DOCKER_TRACE"
exit 127
EOF
chmod +x "$TEST_DIR/bin/node"
export PATH="$TEST_DIR/bin:$PATH"
export HELLOTEST_OPS_ENABLED=false
export HELLOTEST_ENV_DIR="$TEST_DIR/config"
export MOCK_DOCKER_TRACE="$TEST_DIR/docker.trace"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

reset_case() {
  : > "$MOCK_DOCKER_TRACE"
  export MOCK_PULL_STATUS=0 MOCK_BUILD_STATUS=0 MOCK_OPS_STATUS=0
  export MOCK_MINIO_PRESENT=1 MOCK_MINIO_BUILD_STATUS=0 MOCK_STORAGE_REQUIRED=1
}

assert_trace() {
  actual=$(cat "$MOCK_DOCKER_TRACE")
  [ "$actual" = "$1" ] || {
    printf 'Expected Compose calls:\n%s\nActual Compose calls:\n%s\n' "$1" "$actual" >&2
    fail "$2"
  }
  printf 'PASS: %s\n' "$2"
}

reset_case
TESTENGINE_WEB_REPLICAS=1 "$ROOT_DIR/hellotest.sh" up --build --stack local --no-cache > "$TEST_DIR/output" 2>&1
assert_trace 'pull --ignore-buildable --include-deps --policy missing
build --no-cache
up -d' 'runtime images are ready before an uncached build and startup'

reset_case
export MOCK_MINIO_PRESENT=0
"$ROOT_DIR/hellotest.sh" up --build --stack local > "$TEST_DIR/output" 2>&1
assert_trace 'minio source build
pull --ignore-buildable --include-deps --policy missing
up -d --build' 'missing default MinIO is built before runtime pulls and application startup'

reset_case
export MOCK_MINIO_PRESENT=0 MOCK_MINIO_BUILD_STATUS=18
if "$ROOT_DIR/hellotest.sh" up --build --stack local > "$TEST_DIR/output" 2>&1; then
  fail 'failed MinIO source build must prevent startup'
fi
assert_trace 'minio source build' 'a failed MinIO build cannot proceed to pulls or startup'

reset_case
export MOCK_MINIO_PRESENT=0
if "$ROOT_DIR/hellotest.sh" up --build --stack local --skip-image-pull > "$TEST_DIR/output" 2>&1; then
  fail 'offline startup must reject an absent default MinIO image'
fi
assert_trace '' 'offline startup never downloads or compiles a missing MinIO image'
grep -F 'npm run build:minio' "$TEST_DIR/output" >/dev/null || fail 'offline failure must explain how to prepare MinIO'

reset_case
export MOCK_MINIO_PRESENT=0 MOCK_STORAGE_REQUIRED=0
"$ROOT_DIR/hellotest.sh" up --build --stack local redis > "$TEST_DIR/output" 2>&1
assert_trace 'pull --ignore-buildable --include-deps --policy missing redis
up -d --build redis' 'a scoped service without MinIO does not build it'

reset_case
export MOCK_MINIO_PRESENT=0
MINIO_IMAGE=registry.example.test/minio:custom "$ROOT_DIR/hellotest.sh" up --build --stack local > "$TEST_DIR/output" 2>&1
assert_trace 'pull --ignore-buildable --include-deps --policy missing
up -d --build' 'custom MinIO registry images are never replaced by a source build'

reset_case
"$ROOT_DIR/hellotest.sh" up --build --stack local frontend > "$TEST_DIR/output" 2>&1
assert_trace 'pull --ignore-buildable --include-deps --policy missing frontend
up -d --build frontend' 'cached builds preserve service scope and include dependencies in preflight'

reset_case
export MOCK_PULL_STATUS=17
if "$ROOT_DIR/hellotest.sh" up --build --stack local --no-cache > "$TEST_DIR/output" 2>&1; then
  fail 'failed dependency pull must return failure'
fi
assert_trace 'pull --ignore-buildable --include-deps --policy missing' 'failed dependency pull prevents build and startup'
grep -F 'Registry unavailable for runtime image' "$TEST_DIR/output" >/dev/null \
  || fail 'the original pull error must remain visible'
grep -F 'no application build or startup was attempted' "$TEST_DIR/output" >/dev/null \
  || fail 'pull failure must explain that build and startup were skipped'
if grep -F 'HelloTest is starting' "$TEST_DIR/output" >/dev/null; then
  fail 'failed startup must not report success'
fi

reset_case
export MOCK_BUILD_STATUS=18
if "$ROOT_DIR/hellotest.sh" up --build --stack local --no-cache > "$TEST_DIR/output" 2>&1; then
  fail 'failed source build must return failure'
fi
assert_trace 'pull --ignore-buildable --include-deps --policy missing
build --no-cache' 'failed source build still prevents startup'

reset_case
export MOCK_PULL_STATUS=17
"$ROOT_DIR/hellotest.sh" up --build --stack local --no-cache --skip-image-pull --service api > "$TEST_DIR/output" 2>&1
assert_trace 'build --no-cache api
up -d api' 'skip-image-pull bypasses preflight and forwards explicit service targets'

reset_case
"$ROOT_DIR/hellotest.sh" deploy --build --stack local --no-cache --skip-git-pull --yes frontend > "$TEST_DIR/output" 2>&1
assert_trace 'pull --ignore-buildable --include-deps --policy missing frontend
build --no-cache frontend
up -d --force-recreate frontend
ps' 'deployment prepares dependencies before uncached build and recreation'

reset_case
"$ROOT_DIR/hellotest.sh" deploy --build --stack local --skip-git-pull --yes api > "$TEST_DIR/output" 2>&1
assert_trace 'pull --ignore-buildable --include-deps --policy missing api
up -d --build --force-recreate api
ps' 'deployment prepares dependencies before cached build and recreation'

reset_case
export MOCK_PULL_STATUS=17
if "$ROOT_DIR/hellotest.sh" deploy --build --stack local --no-cache --skip-git-pull --yes > "$TEST_DIR/output" 2>&1; then
  fail 'deployment must fail when a dependency cannot be pulled'
fi
assert_trace 'pull --ignore-buildable --include-deps --policy missing' 'failed deployment preflight prevents build and recreation'

reset_case
export MOCK_PULL_STATUS=17
"$ROOT_DIR/hellotest.sh" deploy --build --stack local --skip-git-pull --skip-image-pull --yes api > "$TEST_DIR/output" 2>&1
assert_trace 'up -d --build --force-recreate api
ps' 'deployment honors skip-image-pull'

printf 'MINIO_IMAGE=registry.example.test/minio:custom\nAPI_STARTUP_TIMEOUT_MS=240000\nHELLOTEST_INSTANCE_SETUP_MODULES=workspace,planning\n' > "$TEST_DIR/override.env"
(
  unset MINIO_IMAGE API_STARTUP_TIMEOUT_MS HELLOTEST_INSTANCE_SETUP_MODULES
  "$ROOT_DIR/hellotest.sh" config --stack local --config "$TEST_DIR/override.env" > "$TEST_DIR/output"
)
grep -Fx 'MINIO_IMAGE=registry.example.test/minio:custom' "$HELLOTEST_ENV_DIR/local.env" >/dev/null \
  || fail 'custom MinIO image must reach the generated Compose environment'
printf 'PASS: custom MinIO image reaches the generated Compose environment\n'
grep -Fx 'API_STARTUP_TIMEOUT_MS=240000' "$HELLOTEST_ENV_DIR/local.env" >/dev/null \
  || fail 'custom API startup timeout must reach the generated Compose environment'
printf 'PASS: custom API startup timeout reaches the generated Compose environment\n'
grep -Fx 'HELLOTEST_INSTANCE_SETUP_MODULES=workspace,planning' "$HELLOTEST_ENV_DIR/local.env" >/dev/null \
  || fail 'instance setup selection must reach the generated Compose environment'
printf 'PASS: instance setup selection reaches the generated Compose environment\n'

reset_case
unset HELLOTEST_OPS_ENABLED
TESTENGINE_WEB_REPLICAS=1 "$ROOT_DIR/hellotest.sh" up --build --stack local --no-cache > "$TEST_DIR/output" 2>&1
assert_trace 'pull --ignore-buildable --include-deps --policy missing
build --no-cache
up -d
ops up -d
ops ps' 'the exact local startup command includes ops without host Node'

grep -E '^GRAFANA_ADMIN_PASSWORD=[0-9a-f]{64}$' "$HELLOTEST_ENV_DIR/ops.env" >/dev/null || fail 'ops must prepare random credentials without Node'
prepared_ops_password=$(sed -n 's/^GRAFANA_ADMIN_PASSWORD=//p' "$HELLOTEST_ENV_DIR/ops.env")
grep -Fx "OPS_GRAFANA_PASSWORD=$prepared_ops_password" "$HELLOTEST_ENV_DIR/local.env" >/dev/null || fail 'API configuration must receive prepared Grafana credentials'

reset_case
export MOCK_OPS_STATUS=19
"$ROOT_DIR/hellotest.sh" up --stack local > "$TEST_DIR/output" 2>&1
assert_trace 'up -d
ops up -d' 'monitoring startup failure does not fail application startup'
grep -F 'Warning: monitoring could not complete' "$TEST_DIR/output" >/dev/null || fail 'ops failure must be reported'

reset_case
HELLOTEST_OPS_ENABLED=false "$ROOT_DIR/hellotest.sh" up --stack local > "$TEST_DIR/output" 2>&1
assert_trace 'up -d' 'local monitoring can be explicitly disabled'

reset_case
"$ROOT_DIR/hellotest.sh" status --stack local > "$TEST_DIR/output" 2>&1
assert_trace 'ps
ops ps' 'local status includes monitoring'

printf 'Startup regression checks completed without contacting Docker or starting services.\n'
