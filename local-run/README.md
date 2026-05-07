# QAira Local Run Bundle

This folder is intentionally self-contained for local setup commands. It does
not replace or edit the existing root scripts or compose files.

## Files

- `.env.example`: local defaults you can copy to `.env`.
- `docker-compose.yml`: source-build local stack for Postgres, API, frontend, and Test Engine.
- `agent/`: local LLM automation generator agent that leases generator jobs from QAira.
- `docker-compose.images.yml`: image-based duplicate of the local stack.
- `RECORDER_LOCAL_SETUP.md`: local recorder setup and QAira integration checklist.
- `bin/start.sh`: start the local stack.
- `bin/start-host-recorder.sh`: start a visible host-side Playwright recorder on `localhost:4311`.
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

Open:

- QAira frontend: `http://localhost:8080`
- QAira API: `http://localhost:3000`
- Host recorder: `http://localhost:4311`
- Test Engine: `http://localhost:4301`
- Test Engine OPS board: `http://localhost:4301/ops-telemetry`
- Local LLM API: `http://localhost:11434`

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
`http://localhost:4301`. The actual queue workers are the `testengine-worker`
service and can be scaled without changing the browser/API URL.

The local Test Engine defaults to:

- `TESTENGINE_REPLICAS=1`
- `TESTENGINE_AUTOSCALE=true`
- `TESTENGINE_POLL_INTERVAL_MS=30000`
- `TESTENGINE_POLL_CONCURRENCY=4`

That means it checks QAira every 30 seconds and can process up to four queued
automation jobs in parallel per worker. The local autoscaler checks queue depth
every 15 seconds and scales `testengine-worker` from one to three containers
when the queued automated backlog grows. To force three workers manually:

```bash
TESTENGINE_REPLICAS=3 bin/start.sh
```

or, for an already running stack:

```bash
docker compose --env-file .env -f docker-compose.yml up -d --scale testengine-worker=3 testengine-worker testengine
```

To run a one-time autoscale decision without the daemon:

```bash
bin/autoscale-testengine.sh once
```

The local automation generator agent also polls every 30 seconds. It is separate
from TestEngine execution jobs: clicking `Automate case with AI` queues a
generator job, the local agent leases it, asks the local LLM for a build plan,
then uses QAira/TestEngine automation-building APIs to create the automation.

Default local LLM settings:

- `LLM_BASE_URL=http://llm:11434`
- `LLM_MODEL=llama3.2`
- `GENERATOR_POLL_INTERVAL_MS=30000`

The Ollama container starts with an empty model cache. Pull a model once:

```bash
docker exec qaira-local-llm ollama pull llama3.2
```

If the model is not available yet, the agent falls back to a deterministic
build plan so queued generator jobs still move through the lane.

## Recorder

Read `RECORDER_LOCAL_SETUP.md`. In short, start this stack, run
`bin/start-host-recorder.sh` for visible desktop recording, then use the local
recorder from QAira.

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
