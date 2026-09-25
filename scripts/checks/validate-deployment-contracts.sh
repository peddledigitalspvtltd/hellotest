#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
. "$SCRIPT_DIR/../lib/docker.sh"

# Production manifests intentionally fail closed when required secrets are not
# supplied. These process-local values exist only so static Compose validation
# can render the manifests; no containers are started by this script.
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-hellotest-contract-postgres-password}"
export SESSION_SECRET="${SESSION_SECRET:-hellotest-contract-session-secret-0000000000000000}"
export HELLOTEST_TESTENGINE_SECRET="${HELLOTEST_TESTENGINE_SECRET:-hellotest-contract-engine-secret-0000000000000000}"
export TESTENGINE_SHARED_SECRET="${TESTENGINE_SHARED_SECRET:-$HELLOTEST_TESTENGINE_SECRET}"
export MOBILE_ENGINE_SHARED_SECRET="${MOBILE_ENGINE_SHARED_SECRET:-hellotest-contract-mobile-secret-0000000000000000}"
export MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-hellotest-contract-minio-password}"
export MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-$MINIO_ROOT_PASSWORD}"
export GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-hellotest-contract-grafana-password}"
export ADMIN_BOOTSTRAP_PASSWORD="${ADMIN_BOOTSTRAP_PASSWORD:-hellotest-contract-bootstrap-password}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

require_line() {
  expected=$1
  content=$2
  printf '%s\n' "$content" | grep -Fx "$expected" >/dev/null || fail "missing expected line: $expected"
}

file_mode() {
  target=$1
  if stat -c '%a' "$target" >/dev/null 2>&1; then
    stat -c '%a' "$target"
  else
    stat -f '%Lp' "$target"
  fi
}

validate_compose_contract() {
  compose_file=$1
  require_observability=$2
  expected_mode=$3

  compose_cmd -f "$compose_file" config --quiet
  compose_cmd -f "$compose_file" config --format json | node -e '
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => raw += chunk);
    process.stdin.on("end", () => {
      const config = JSON.parse(raw);
      const api = config.services?.api;
      const minio = config.services?.minio;
      if (!api || !minio) throw new Error("api and minio services are required");
      const expectedMinioImage = process.env.MINIO_IMAGE || "quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z";
      if (minio.image !== expectedMinioImage) throw new Error("minio must use its pinned Quay image or the configured MINIO_IMAGE override");
      const apiProbe = JSON.stringify(api.healthcheck?.test || []);
      const minioProbe = JSON.stringify(minio.healthcheck?.test || []);
      if (!apiProbe.includes("/health/ready")) throw new Error("api healthcheck must use /health/ready");
      const startupTimeoutMs = Number(process.env.API_STARTUP_TIMEOUT_MS || 180000);
      if (Number(api.environment?.API_STARTUP_TIMEOUT_MS) !== startupTimeoutMs) throw new Error("api must receive its configured startup timeout");
      const grace = String(api.healthcheck?.start_period || "");
      const graceMs = [...grace.matchAll(/([\d.]+)(ms|s|m|h)/g)].reduce((total, match) => total + Number(match[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2]]), 0);
      if (graceMs < startupTimeoutMs) throw new Error("api healthcheck grace period must cover its startup timeout");
      if (!minioProbe.includes("/minio/health/ready")) throw new Error("minio readiness healthcheck is required");
      if (api.depends_on?.minio?.condition !== "service_healthy") throw new Error("api must wait for healthy minio");
      if (process.argv[1] === "true" && String(api.environment?.ENABLE_OBSERVABILITY) !== "true") {
        throw new Error("api observability must be explicitly enabled when OTLP is bundled");
      }
      if (String(api.environment?.APP_MODE) !== process.argv[2]) {
        throw new Error(`api APP_MODE must be ${process.argv[2]}`);
      }
      if (!String(api.environment?.MOBILE_ENGINE_SHARED_SECRET || "").trim()) {
        throw new Error("api must receive the Mobile Engine shared secret");
      }
    });
  ' "$require_observability" "$expected_mode"

  pass "$(basename "$compose_file") readiness contract"
}

cd "$ROOT_DIR"

for script in \
  hellotest.sh \
  start-testengine-ops.sh \
  scripts/deploy/aws/deploy-app.sh \
  scripts/deploy/aws/deploy-testengine.sh \
  scripts/deploy/provider-stack.sh
do
  sh -n "$script"
done
pass "deployment shell syntax"

for compose_file in \
  docker-compose.full.yml \
  docker-compose.platform.yml \
  docker-compose.microservices.yml \
  docker-compose.ops.yml \
  services/platform/backend/docker-compose.yml \
  services/platform/frontend/docker-compose.yml \
  local-run/docker-compose.yml \
  local-run/docker-compose.images.yml \
  testengine/docker-compose.yml \
  testengine/docker-compose.deploy.yml
do
  compose_cmd -f "$compose_file" config --quiet
done
pass "all checked-in Compose manifests parse"

compose_cmd -f docker-compose.microservices.yml config --format json | node scripts/checks/validate-microservices-contracts.mjs

validate_compose_contract "$ROOT_DIR/docker-compose.full.yml" true docker
validate_compose_contract "$ROOT_DIR/docker-compose.platform.yml" true aws
validate_compose_contract "$ROOT_DIR/services/platform/backend/docker-compose.yml" false docker
validate_compose_contract "$ROOT_DIR/local-run/docker-compose.yml" true local
validate_compose_contract "$ROOT_DIR/local-run/docker-compose.images.yml" false local

testengine_services=$(compose_cmd -f testengine/docker-compose.deploy.yml config --services)
for service in testengine-api testengine-web testengine-android mobile-engine selenium-hub selenium-node-chrome
do
  require_line "$service" "$testengine_services"
done
if printf '%s\n' "$testengine_services" | grep -Fx testengine >/dev/null; then
  fail "standalone Test Engine Compose unexpectedly exposes the obsolete testengine service"
fi

configured_targets=$(sed -n 's/^TESTENGINE_SERVICES="\([^"]*\)"$/\1/p' start-testengine-ops.sh)
for service in testengine-api testengine-web testengine-android selenium-hub selenium-node-chrome
do
  printf '%s\n' "$configured_targets" | tr ' ' '\n' | grep -Fx "$service" >/dev/null \
    || fail "start-testengine-ops.sh does not target $service"
done
pass "standalone Test Engine service targets"

compose_cmd --env-file local-run/.env.example -f local-run/docker-compose.images.yml config --format json | node -e '
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => raw += chunk);
  process.stdin.on("end", () => {
    const config = JSON.parse(raw);
    const replicas = Number(config.services?.["testengine-web-worker"]?.deploy?.replicas || 0);
    if (replicas < 1) throw new Error("the local image stack needs at least one Web worker");
  });
'
grep -Eq '^TESTENGINE_WEB_MIN_WORKERS=([1-9][0-9]*)$' local-run/.env.example \
  || fail "the local autoscaler must keep at least one Web worker"
pass "local image gateway has a warm Web worker"

for compose_file in local-run/docker-compose.yml local-run/docker-compose.images.yml
do
  compose_cmd --env-file local-run/.env.example -f "$compose_file" config --format json | node -e '
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => raw += chunk);
    process.stdin.on("end", () => {
      const config = JSON.parse(raw);
      for (const [serviceName, service] of Object.entries(config.services || {})) {
        for (const published of service.ports || []) {
          if (published.host_ip !== "127.0.0.1") {
            throw new Error(`${serviceName} published port ${published.published} is not loopback-bound`);
          }
        }
      }
    });
  '
done
pass "local published ports are loopback-bound by default"

VALIDATION_TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/hellotest-deployment-contracts.XXXXXX")
trap 'rm -rf "$VALIDATION_TMP_DIR"' EXIT HUP INT TERM

SECRET_SENTINEL=hellotest-contract-secret-do-not-print
REDACTED_OUTPUT="$VALIDATION_TMP_DIR/redacted.out"
REVEALED_OUTPUT="$VALIDATION_TMP_DIR/revealed.out"
CONFIG_DIR="$VALIDATION_TMP_DIR/config"

HELLOTEST_ENV_DIR="$CONFIG_DIR" \
DATABASE_URL="postgresql://hellotest:${SECRET_SENTINEL}@postgres:5432/hellotest" \
SESSION_SECRET="$SECRET_SENTINEL" \
HELLOTEST_TESTENGINE_SECRET="$SECRET_SENTINEL" \
TESTENGINE_SHARED_SECRET="$SECRET_SENTINEL" \
MOBILE_ENGINE_SHARED_SECRET="$SECRET_SENTINEL" \
MINIO_ROOT_PASSWORD="$SECRET_SENTINEL" \
MINIO_SECRET_KEY="$SECRET_SENTINEL" \
  ./hellotest.sh config --stack full > "$REDACTED_OUTPUT"

if grep -F "$SECRET_SENTINEL" "$REDACTED_OUTPUT" >/dev/null; then
  fail "default config output disclosed a secret"
fi
grep -F 'SESSION_SECRET=[REDACTED]' "$REDACTED_OUTPUT" >/dev/null \
  || fail "default config output did not show a redaction marker"
[ "$(file_mode "$CONFIG_DIR")" = "700" ] || fail "resolved config directory must be mode 700"
[ "$(file_mode "$CONFIG_DIR/full.env")" = "600" ] || fail "resolved env file must be mode 600"

HELLOTEST_ENV_DIR="$CONFIG_DIR" \
DATABASE_URL="postgresql://hellotest:${SECRET_SENTINEL}@postgres:5432/hellotest" \
SESSION_SECRET="$SECRET_SENTINEL" \
HELLOTEST_TESTENGINE_SECRET="$SECRET_SENTINEL" \
TESTENGINE_SHARED_SECRET="$SECRET_SENTINEL" \
MOBILE_ENGINE_SHARED_SECRET="$SECRET_SENTINEL" \
MINIO_ROOT_PASSWORD="$SECRET_SENTINEL" \
MINIO_SECRET_KEY="$SECRET_SENTINEL" \
  ./hellotest.sh config --stack full --show-secrets > "$REVEALED_OUTPUT" 2>/dev/null
grep -F "SESSION_SECRET=$SECRET_SENTINEL" "$REVEALED_OUTPUT" >/dev/null \
  || fail "--show-secrets did not reveal the explicitly requested value"
pass "resolved config permissions and redacted-by-default output"

PLATFORM_CONFIG_DIR="$VALIDATION_TMP_DIR/platform-config"
(
  unset POSTGRES_PASSWORD SESSION_SECRET HELLOTEST_TESTENGINE_SECRET TESTENGINE_SHARED_SECRET MOBILE_ENGINE_SHARED_SECRET
  unset MINIO_ROOT_PASSWORD MINIO_SECRET_KEY GRAFANA_ADMIN_PASSWORD ADMIN_BOOTSTRAP_PASSWORD
  HELLOTEST_ENV_DIR="$PLATFORM_CONFIG_DIR" ./hellotest.sh config --stack platform > /dev/null
)
first_platform_session=$(sed -n 's/^SESSION_SECRET=//p' "$PLATFORM_CONFIG_DIR/platform.env")
first_platform_engine=$(sed -n 's/^HELLOTEST_TESTENGINE_SECRET=//p' "$PLATFORM_CONFIG_DIR/platform.env")
first_platform_mobile=$(sed -n 's/^MOBILE_ENGINE_SHARED_SECRET=//p' "$PLATFORM_CONFIG_DIR/platform.env")
(
  unset POSTGRES_PASSWORD SESSION_SECRET HELLOTEST_TESTENGINE_SECRET TESTENGINE_SHARED_SECRET MOBILE_ENGINE_SHARED_SECRET
  unset MINIO_ROOT_PASSWORD MINIO_SECRET_KEY GRAFANA_ADMIN_PASSWORD ADMIN_BOOTSTRAP_PASSWORD
  HELLOTEST_ENV_DIR="$PLATFORM_CONFIG_DIR" ./hellotest.sh config --stack platform > /dev/null
)
second_platform_session=$(sed -n 's/^SESSION_SECRET=//p' "$PLATFORM_CONFIG_DIR/platform.env")
second_platform_engine=$(sed -n 's/^HELLOTEST_TESTENGINE_SECRET=//p' "$PLATFORM_CONFIG_DIR/platform.env")
second_platform_mobile=$(sed -n 's/^MOBILE_ENGINE_SHARED_SECRET=//p' "$PLATFORM_CONFIG_DIR/platform.env")
[ "${#first_platform_session}" -ge 32 ] || fail "platform session secret was not generated strongly"
[ "${#first_platform_engine}" -ge 32 ] || fail "platform Test Engine secret was not generated strongly"
[ "${#first_platform_mobile}" -ge 32 ] || fail "platform Mobile Engine secret was not generated strongly"
[ "$first_platform_session" = "$second_platform_session" ] || fail "platform session secret did not persist"
[ "$first_platform_engine" = "$second_platform_engine" ] || fail "platform Test Engine secret did not persist"
[ "$first_platform_mobile" = "$second_platform_mobile" ] || fail "platform Mobile Engine secret did not persist"
pass "platform credentials are strong, generated, and stable across operator runs"

HELLOTEST_ISOLATED_OUT_DIR="$VALIDATION_TMP_DIR/isolated" \
  scripts/deploy/provider-stack.sh compose config >/dev/null
grep -F '/health/ready' "$VALIDATION_TMP_DIR/isolated/docker-compose.isolated.yml" >/dev/null \
  || fail "generated isolated Compose API must use the readiness endpoint"
pass "generated isolated Compose contract"

"$SCRIPT_DIR/test-hellotest-startup.sh"

echo "Deployment contract validation completed without starting services."
