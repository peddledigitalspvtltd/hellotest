# HelloTest Test Engine

`testengine/` is a backend-only Playwright execution plane for HelloTest. HelloTest remains the only frontend, the only operator surface, and the system of record for authoring, runs, evidence history, and review.

There should not be a second UI here. The right split is:

- HelloTest frontend and backend: control plane
- Test Engine: scalable Docker worker plane

## Why This Exists

HelloTest already owns:

- requirements, suites, test cases, Shared Step Groups, environments, and data
- run creation and run status
- case snapshots and step snapshots
- manual result review and preserved history

What HelloTest does not yet own is an isolated execution runtime that can:

- execute browser, API, and mobile automation inside Docker/Kubernetes
- scale independently from the main app
- reuse attached automation scripts on repeat runs
- attempt constrained self-healing on failure
- emit artifact bundles without bloating the core app server

That belongs in a separate backend service, not a separate product frontend.

## Product Boundary

HelloTest control plane:

- user clicks Run from the existing HelloTest UI
- HelloTest creates the run with `/executions`
- HelloTest snapshots cases, steps, environment, configuration, and data
- HelloTest hands automated cases to Test Engine
- HelloTest records run status, case result, and evidence history
- HelloTest remains the review surface for promoted healing patches

Test Engine worker plane:

- continuously leases queued automated jobs from HelloTest
- splits workers by engine class: API, Web, and Android
- resolves attached script versus manual handover generation
- executes API requests, Playwright browser steps, and Android/Appium handoffs deterministically first
- performs constrained repair only after failure
- captures trace, screenshots, console, network, DOM, and summary artifacts
- calls back into HelloTest with case result and step evidence payloads

## Worker Pools

Each step carries an `engine_class`. The queued case also carries an
`orchestration_class`, which is the safest worker pool to coordinate the ordered
flow:

- `api`: API-only jobs. These are lightweight and should scale aggressively.
- `web`: any job containing Web steps. Web+API unified flows stay in this pool so runtime variables can move from API extractors into browser steps.
- `android`: any job containing Android steps. This pool is capped lower because real devices, emulators, and Appium sessions are scarce resources.

Each worker sets `TESTENGINE_WORKER_CLASS` and only leases matching orchestration
jobs. HelloTest queue stats expose both `by_orchestration_class` for scaling current
worker deployments and `by_step_engine_class` for step-level demand visibility.
Mixed cases therefore remain ordered and safe, while the model still records
that API, Web, and Android capabilities are step-level concerns.

Recommended integration config keys:

```json
{
  "max_api_workers": 3,
  "max_web_workers": 3,
  "max_android_workers": 3,
  "active_web_engine": "playwright",
  "headless": true
}
```

For Kubernetes, use `testengine/k8s/testengine-workers.yaml` as the base
deployment shape. In production, pair these deployments with KEDA or an external
metrics adapter that reads HelloTest's `/testengine/internal/jobs/queue-stats`
endpoint and scales each deployment from the matching `by_orchestration_class`
value. Idle pools should scale to zero; queued/running work keeps the matching
pool alive until execution settles.

## Current HelloTest API Mapping

HelloTest already has the core APIs needed to make this work:

- `POST /executions`
  - open a run from HelloTest
- `POST /executions/:id/start`
  - mark the run as active when engine processing begins
- `GET /executions/:id`
  - fetch the snapped cases and snapped steps for the run
- `POST /execution-results`
  - create the first case result record
- `PUT /execution-results/:id`
  - update the case result as more step data arrives
- `POST /executions/:id/complete`
  - finish the run after all automated cases settle

The important compatibility detail is that HelloTest already stores step-level statuses, notes, and image evidence inside `execution_results.logs` as structured JSON. Test Engine should use that shape first instead of inventing a second evidence model for the first integration pass.

## Evidence Strategy

Near-term compatibility path:

- inline step status in `logs.stepStatuses`
- inline step notes in `logs.stepNotes`
- inline step screenshot preview in `logs.stepEvidence`
- case status and duration in `execution_results`

Scale path for larger artifacts:

- keep full trace, HAR, video, DOM, and console bundles in Test Engine artifact storage
- send HelloTest a manifest plus an optional preview image per failed step
- add a dedicated HelloTest artifact table later when we need durable large-object storage

## Core Decisions

- Runtime: Playwright for Web, native REST for API, Appium handoff for Android
- Primary language: TypeScript
- Packaging: Docker only
- Execution policy: deterministic first, AI fallback second
- Healing scope: locator, wait, popup, navigation recovery
- Assertion policy: business assertions never change silently
- Review policy: healed patches are proposed to HelloTest before promotion

## Folder Layout

```text
testengine/
  backend/
    src/
      contracts/
      lib/
      server.ts
    Dockerfile
    package.json
    tsconfig.json
  docker-compose.yml
  ARCHITECTURE.md
```

## Running In Docker

The Playwright engine already has a separate Docker image definition at `testengine/backend/Dockerfile`.

Build and run it directly:

```bash
docker build -f testengine/backend/Dockerfile -t hellotest-testengine ./testengine/backend
docker run --rm -p 4301:4301 -e PORT=4301 -e ARTIFACT_ROOT=/artifacts hellotest-testengine
```

Or use Compose for local source builds:

```bash
docker compose -f testengine/docker-compose.yml up --build
```

For a standalone image-based host deployment, use:

```bash
./hellotest.sh deploy --stack testengine
```

Use `--config <file>` or environment variables to override the HelloTest API URL,
published engine URL, image tag, Selenium binds, and shared secret:

```bash
HELLOTEST_API_BASE_URL=https://hellotest.qualipal.in/api \
ENGINE_PUBLIC_URL=http://13.55.32.201:4301 \
./hellotest.sh deploy --stack testengine --yes
```

For a separate Test Engine host that should also align its OPS settings with the
active HelloTest integrations and expose the local telemetry board on the same host,
prefer:

```bash
HELLOTEST_API_BASE_URL=https://hellotest.qualipal.in/api \
HELLOTEST_AUTH_TOKEN=replace-with-a-hellotest-token \
HELLOTEST_PROJECT_ID=replace-with-project-id \
./start-testengine-ops.sh
```

`HELLOTEST_TESTENGINE_SECRET` is optional for this script. If omitted, the Test
Engine uses the same development fallback as the HelloTest API.

If you do not want integration lookup, set `ENGINE_PUBLIC_URL` directly instead.
When the stack is up, the Test Engine host serves:

- `GET /health`
- `GET /api/v1/capabilities`
- `GET /api/v1/events`
- `POST /api/v1/events`
- `GET /ops-telemetry`

The `/ops-telemetry` board lets operators filter captured execution hierarchy
events by `service_name`, status, event type, and execution identifiers.

Queue pull mode polls HelloTest for queued automated API and web jobs every 5
minutes by default. Configure `queue_poll_interval_minutes` on the active
Test Engine integration in HelloTest; `start-testengine-ops.sh` resolves that value
into `TESTENGINE_POLL_INTERVAL_MINUTES` / `TESTENGINE_POLL_INTERVAL_MS` for the
standalone worker. When the queue is empty, the worker does not emit job events.
Worker startup, poll failures, execution crashes, and failure-reporting issues
are captured on the local OPS telemetry board.

On Apple Silicon or other ARM64 hosts, HelloTest defaults the Selenium browser node to
`selenium/node-chromium:4.22.0` because Selenium's official Chrome node images are
AMD64-only. If you want to override the Grid images explicitly, set:

```bash
HELLOTEST_SELENIUM_HUB_IMAGE=selenium/hub:4.22.0 \
HELLOTEST_SELENIUM_NODE_IMAGE=selenium/node-chromium:4.22.0 \
./hellotest.sh up --stack testengine
```

On an AMD64 host, you can opt back into Chrome with:

```bash
HELLOTEST_SELENIUM_NODE_IMAGE=selenium/node-chrome:4.22.0 ./hellotest.sh up --stack testengine
```

For image-based deployments, Selenium Grid and VNC bind to `127.0.0.1` by
default. Override `SELENIUM_GRID_BIND` or `SELENIUM_VNC_BIND` only for temporary
debugging behind restrictive network rules.

## See Also

- [HelloTest background operations strategy](../HELLOTEST_BACKGROUND_OPERATIONS_STRATEGY.md)
- [HelloTest product operating model](../HELLOTEST_PRODUCT_OPERATING_MODEL.md)
- [Architecture](./ARCHITECTURE.md)
- [HelloTest handoff contract](./backend/src/contracts/hellotest.ts)
