# QAira Local Run Bundle

This folder is intentionally self-contained for local setup commands. It does
not replace or edit the existing root scripts or compose files.

## Files

- `.env.example`: local defaults you can copy to `.env`.
- `docker-compose.yml`: source-build local stack for Postgres, API, frontend, and Test Engine.
- `docker-compose.images.yml`: image-based duplicate of the local stack.
- `RECORDER_LOCAL_SETUP.md`: local recorder setup and QAira integration checklist.
- `bin/start.sh`: start the local stack.
- `bin/start-host-recorder.sh`: start a visible host-side Playwright recorder on `localhost:4311` on macOS/Linux.
- `bin/start-host-recorder.cmd`: start the visible host recorder on Windows, preferring `bin/qaira-host-recorder.exe` when present.
- `bin/stop.sh`: stop the local stack.
- `bin/status.sh`: show container status.
- `bin/logs.sh`: follow logs.
- `bin/health.sh`: check local service health endpoints.
- `bin/fix-recorder-integration.sh`: patch an existing local DB volume so the API container reaches the Test Engine and the browser gets localhost live-view URLs.
- `bin/reset-data.sh`: remove only the `local-run` Postgres volume and restart.

## Quick Start

```bash
cd local-run
cp .env.example .env
bin/start.sh
bin/start-host-recorder.sh
bin/health.sh
```

On Windows, product installs can place `qaira-host-recorder.exe` in
`local-run\bin` and use:

```bat
bin\start-host-recorder.cmd
```

Open:

- QAira frontend: `http://localhost:8080`
- QAira API: `http://localhost:3000`
- Host recorder: `http://localhost:4311`
- Test Engine: `http://localhost:4301`
- Test Engine OPS board: `http://localhost:4301/ops-telemetry`

Seed login:

- `admin@testiny.ai` / `admin123`
- `member@testiny.ai` / `member123`

## Source Build vs Image Run

Default source build:

```bash
bin/start.sh
```

Image-based duplicate stack:

```bash
QAIRA_LOCAL_COMPOSE_FILE=docker-compose.images.yml bin/start.sh
```

## Polling

The local Test Engine now runs behind a fixed Docker Compose gateway at
`http://localhost:4301`. The actual queue workers are split by execution class
and can be scaled without changing the browser/API URL:

- `testengine-api-worker` leases API-only jobs.
- `testengine-web-worker` leases jobs with web steps, including Web+API unified flows.
- `testengine-android-worker` leases jobs with Android steps.

The local Test Engine defaults to:

- `TESTENGINE_API_REPLICAS=0`
- `TESTENGINE_WEB_REPLICAS=0`
- `TESTENGINE_ANDROID_REPLICAS=0`
- `TESTENGINE_AUTOSCALE=true`
- `TESTENGINE_AUTOSCALE_MAX_WORKERS=3`
- `TESTENGINE_API_POLL_INTERVAL_MS=1000`
- `TESTENGINE_WEB_POLL_INTERVAL_MS=1000`
- `TESTENGINE_ANDROID_POLL_INTERVAL_MS=1000`
- `TESTENGINE_API_POLL_CONCURRENCY=8`
- `TESTENGINE_WEB_POLL_CONCURRENCY=2`
- `TESTENGINE_ANDROID_POLL_CONCURRENCY=1`

That means the Test Engine gateway stays available while worker containers are
created only when QAira has queued execution work. The local autoscaler checks
queue depth every 15 seconds, scales each pool independently from zero, caps each
pool at 3 workers by default, and removes obsolete stopped containers after
scale-down. API bursts can scale up without starting extra browsers or mobile
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
part of this low-footprint local stack. Use QAira's integration settings for a
remote LLM provider when AI generation is needed.

## AI Generation

`Automate case with AI` no longer depends on a Docker-side local LLM or local
generator agent in this bundle. That keeps local machines from pulling large
model images or running background generation workers by default.

## Recorder

Read `RECORDER_LOCAL_SETUP.md`. In short, start this stack, run
`bin/start-host-recorder.sh` for visible desktop recording, then use the local
recorder from QAira.

For packaged desktop installs, place the host recorder binary at
`local-run/bin/qaira-host-recorder.exe` on Windows or
`local-run/bin/qaira-host-recorder` on macOS/Linux. The launchers use the binary
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
