# HelloTest Local Run Bundle

This folder contains the source-build local stack, host recorder helpers and native provider. The root [README](../README.md) is the application entry point; [CONTRIBUTING](../CONTRIBUTING.md) and the [debugging runbook](../docs/development/debugging.md) cover host development, environment loading and troubleshooting.

## Files

- `.env.example`: local defaults you can copy to `.env`.
- `docker-compose.yml`: source-build local stack for Postgres, MinIO, API, frontend, and Test Engine.
- `docker-compose.images.yml`: image-based duplicate of the local stack.
- `RECORDER_LOCAL_SETUP.md`: local recorder setup and HelloTest integration checklist.
- `bin/start.sh`: start the local stack.
- `bin/start-host-recorder.sh`: start a visible host-side Playwright recorder on `localhost:4311` on macOS/Linux.
- `bin/start-host-recorder.cmd`: start the visible host recorder on Windows, preferring `bin/hellotest-host-recorder.exe` when present.
- `bin/stop.sh`: stop the local stack.
- `bin/status.sh`: show container status.
- `bin/logs.sh`: follow logs.
- `bin/health.sh`: check local service health endpoints.
- `bin/fix-recorder-integration.sh`: patch an existing local DB volume so the API container reaches the Test Engine and the browser gets localhost live-view URLs.
- `bin/reset-data.sh`: destructive local PostgreSQL reset; use only after an intentional backup/disposable-data decision, never for routine recovery.

## Quick Start

```bash
cd local-run
cp .env.example .env
bin/start.sh
bin/start-host-recorder.sh
bin/health.sh
```

On Windows, product installs can place `hellotest-host-recorder.exe` in
`local-run\bin` and use:

```bat
bin\start-host-recorder.cmd
```

Open:

- HelloTest frontend: `http://localhost:8080`
- HelloTest API: `http://localhost:3000`
- MinIO API: `http://localhost:9000`
- MinIO console: `http://localhost:9001`
- Host recorder: `http://localhost:4311`
- Test Engine: `http://localhost:4301`
- Test Engine OPS board: `http://localhost:4301/ops-telemetry`

Published development ports bind to `127.0.0.1` by default so seeded accounts,
databases, object storage, and execution services are not exposed to the LAN.
Use the matching `*_BIND` setting in `.env` only when another trusted host must
connect (for example, `API_BIND=0.0.0.0`). Apply host firewall rules before
opening a bind.

For a new local database with unchanged API runtime defaults, administration bootstrap is `admin` / `admin` and requires password replacement. Existing accounts retain their credentials. Optional sample records are installed through Administration → Instance setup or `HELLOTEST_INSTANCE_SETUP_MODULES`; old sample email/password pairs are not a supported login contract. The local Compose API currently uses its runtime bootstrap defaults; use the configured bootstrap identity for other deployment stacks.

## Optional monitoring

The root command `./hellotest.sh up --build --stack local --no-cache` starts all eight monitoring services automatically, without requiring host Node.js or npm. Use `HELLOTEST_OPS_ENABLED=false` to opt out. When using `bin/start.sh` or Docker Compose directly, run `sh scripts/ops/stack.sh up` from the repository root after starting or recreating the application. This attaches the API and frontend to the independently managed monitoring network. With Node.js installed, the existing `npm run ops:up` command also works; `npm run ops:verify` checks data flow. See [the ops runbook](../docs/ops-operations.md) for resource limits and recovery. The source-build bundle's previous standalone Jaeger is opt-in through `--profile legacy-tracing`; use the consolidated stack for Test Ops monitoring.

## Source Build vs Image Run

From the repository root, build and start with:

```bash
TESTENGINE_WEB_REPLICAS=1 ./hellotest.sh up --build --stack local --no-cache
```

The root operator prepares runtime images before building application images;
`bin/start.sh` also prepares the default MinIO image automatically.
MinIO is compiled from the pinned [official source release](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z)
into `hellotest/minio:RELEASE.2025-10-15T17-29-55Z` when missing locally. The first
build needs network access, available Docker CPU/memory and several minutes;
later starts reuse that image. No `MINIO_IMAGE` override is needed. Remove old
Quay/Docker Hub overrides from your selected environment or set the new local
tag. An intentional private mirror remains supported and skips source building.
Existing MinIO data volumes and credentials are preserved.
The root launcher's `--skip-image-pull` requires that image to be cached already;
it will fail with preparation instructions instead of downloading source.

Before using Docker Compose directly, run this from the repository root:

```bash
npm run build:minio
```

If MinIO reports `unauthorized` and parallel pulls are `Canceled`, fix the image
selection/build first and rerun. Logging into a registry does not restore a
withdrawn public image, and deleting volumes cannot fix the download.

The API allows up to three minutes for database initialization before startup
fails. It logs each initialization phase and stays unready until setup completes.
Set `API_STARTUP_TIMEOUT_MS` (10000–600000) to adjust this deadline; Compose uses
the same duration as its healthcheck startup grace period.

Default source build:

```bash
bin/start.sh
```

Image-based duplicate stack:

```bash
HELLOTEST_LOCAL_COMPOSE_FILE=docker-compose.images.yml bin/start.sh
```

## Polling

The local Test Engine now runs behind a fixed Docker Compose gateway at
`http://localhost:4301`. The actual queue workers are split by execution class
and can be scaled without changing the browser/API URL:

- `testengine-api-worker` leases API-only jobs.
- `testengine-web-worker` leases jobs with web steps, including Web+API unified flows.
- `testengine-android-worker` leases native Android and iOS jobs; each authored platform uses its own device session.

Browser quality agents use a separate `testengine-quality-worker` at one replica.
The gateway routes `/api/v1/quality-agents` exclusively to this worker so run
polling, cancellation, artifacts and reviewed baselines keep their owning
runtime. Its `hellotest-local-quality-data` named volume survives container
recreation; it does not poll ordinary automation queues or participate in the
autoscaler. In `.env`, `QUALITY_AGENT_ALLOWED_PRIVATE_HOSTS` permits exact private
QA hosts and `QUALITY_AGENT_ALLOWED_ORIGINS` permits additional exact resource
origins. Both are empty by default. To test a host application from the
container, use `host.docker.internal` and explicitly allow that private hostname.
See [the engine guide](../docs/architecture/quality-agent-engine.md) for actual agent
scopes, evidence limits and baseline review.

The local Test Engine defaults to:

- `TESTENGINE_API_REPLICAS=0`
- `TESTENGINE_WEB_REPLICAS=1`
- `TESTENGINE_ANDROID_REPLICAS=0`
- `TESTENGINE_AUTOSCALE=true`
- `TESTENGINE_WEB_MIN_WORKERS=1`
- `TESTENGINE_AUTOSCALE_MAX_WORKERS=3`
- `TESTENGINE_API_POLL_INTERVAL_MS=1000`
- `TESTENGINE_WEB_POLL_INTERVAL_MS=1000`
- `TESTENGINE_ANDROID_POLL_INTERVAL_MS=1000`
- `TESTENGINE_API_POLL_CONCURRENCY=8`
- `TESTENGINE_WEB_POLL_CONCURRENCY=2`
- `TESTENGINE_ANDROID_POLL_CONCURRENCY=1`

That keeps one Web worker warm so the Test Engine gateway and recorder endpoints
remain healthy. The local autoscaler checks queue depth every 15 seconds, scales
the API and Android pools independently from zero, scales Web above its one-worker
floor, caps each pool at 3 workers by default, and removes obsolete stopped
containers after scale-down. API bursts can scale up without starting extra mobile
device sessions. To force API workers manually:

```bash
TESTENGINE_API_REPLICAS=3 bin/start.sh
```

or, for an already running stack:

```bash
docker compose --env-file .env -f docker-compose.yml up -d --scale testengine-api-worker=3 testengine-api-worker testengine
```

To run a one-time autoscale decision without the daemon:

```bash
bin/autoscale-testengine.sh once
```

Local LLM and local automation-generator agent services are intentionally not
part of this low-footprint local stack. Use HelloTest's integration settings for a
remote LLM provider when AI generation is needed.

## Mobile Engine Health

The mobile engine exposes `/health/live` for process liveness and
`/health/ready` for dependency readiness. With the default
`MOBILE_PROVIDER=local-appium`, readiness probes the configured Appium `/status`
endpoint with a two-second ceiling. Because Appium is an on-demand local device
dependency and is not bundled, an unavailable provider is reported as
`degraded` without preventing the base stack from starting. Set
`MOBILE_REQUIRE_PROVIDER_READY=true` when Android capacity is mandatory; in that
mode readiness fails closed until Appium is available. The legacy `/health`
endpoint remains available for older integrations.

All `/api/v1/mobile/*` operations are authenticated with the dedicated
`MOBILE_ENGINE_SHARED_SECRET`; health and capabilities remain public for
orchestration probes. The API and Android worker send the credential
automatically. Recorder live views use a random token scoped to one recorder
session, never the service credential. Production rejects missing, default, or
shorter-than-32-character mobile secrets. The checked-in `.env.example` value
is development-only.

Remote file pushes default to a 15-second download deadline and a 25 MiB limit.
Override `MOBILE_REMOTE_DOWNLOAD_TIMEOUT_MS` or
`MOBILE_REMOTE_DOWNLOAD_MAX_BYTES` in `.env` when a controlled environment needs
different bounded values.

## AI Generation

`Automate case with AI` no longer depends on a Docker-side local LLM or local
generator agent in this bundle. That keeps local machines from pulling large
model images or running background generation workers by default.

## Recorder

Read `RECORDER_LOCAL_SETUP.md`. In short, start this stack, run
`bin/start-host-recorder.sh` for visible desktop recording, then use the local
recorder from HelloTest.

For packaged desktop installs, place the host recorder binary at
`local-run/bin/hellotest-host-recorder.exe` on Windows or
`local-run/bin/hellotest-host-recorder` on macOS/Linux. The launchers use the binary
first and fall back to the source-build developer flow only when the binary is
not present.

To generate the current platform binary from the repo:

```bash
cd ../testengine/backend
npm run package:host-recorder
```

For visible host recording, the recommended local recorder values are:

- Engine base URL: `http://host.docker.internal:4311`
- Recorder public base URL: `http://localhost:4311`

For Docker embedded fallback, use:

- Engine base URL: `http://testengine:4301`
- Recorder public base URL: `http://localhost:4301`

If you already started local-run before these files existed, patch the existing
local database volume:

```bash
bin/fix-recorder-integration.sh
```


## Non-destructive troubleshooting

Use `bin/status.sh`, `bin/health.sh` and `bin/logs.sh` first. `bin/stop.sh` stops the stack without deleting the named data volumes. Restart only the affected service after diagnosing the failure; changed environment settings require a recreated container. Do not use `bin/reset-data.sh` or Compose `down -v` to apply a schema update or repair an unavailable provider.

For host recording, install the dependencies described in [CONTRIBUTING](../CONTRIBUTING.md), then use the launcher appropriate to the host OS. Container URLs such as `http://testengine:4301` are for API-to-engine traffic inside Compose; browser live views need a host-reachable URL. For mobile execution, the provider still needs a separate Appium server, driver and configured device/application; starting the local stack does not create them.
