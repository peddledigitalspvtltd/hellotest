# HelloTest Test Engine

`testengine/` is the API, browser and native execution service for HelloTest. The product workspace remains the system of record for authoring, runs, evidence history and review. The engine also exposes a diagnostic telemetry board. For host development and breakpoints, use [CONTRIBUTING.md](../CONTRIBUTING.md) and the [debugging runbook](../docs/development/debugging.md).

This is the sole HelloTest execution runtime. The redundant prototype has been
removed after a [capability comparison](../docs/architecture/testengine.md).
Develop, build, test, and deploy execution features from this directory.

The product boundary is:

- HelloTest frontend and backend: control plane
- Test Engine: scalable Docker worker plane

## Why This Exists

HelloTest already owns:

- requirements, suites, test cases, Shared Step Groups, environments, and data
- run creation and run status
- case snapshots and step snapshots
- manual result review and preserved history

TestEngine owns the execution runtime that can:

- execute browser, API, and mobile automation inside Docker/Kubernetes
- scale independently from the main app
- reuse attached automation scripts on repeat runs
- retry configured browser steps and preserve each attempt’s evidence
- emit artifact bundles without bloating the core app server

That belongs in a separate backend service, not a separate product frontend.

## Product Boundary

HelloTest control plane:

- user clicks Run from the existing HelloTest UI
- HelloTest creates the run with `/executions`
- HelloTest snapshots cases, steps, environment, configuration, and data
- HelloTest hands automated cases to Test Engine
- HelloTest records run status, case result, and evidence history
- HelloTest remains the review surface for agent-generated code and retry findings

Test Engine worker plane:

- continuously leases queued automated jobs from HelloTest
- splits workers by engine class: API, Web, and Android
- executes attached code produced by manual authoring, recording, keywords, or the automation build agent
- executes API requests, Playwright browser steps, and Android/iOS Appium handoffs
- retries unchanged browser code only when retries are configured; no runtime LLM repair is implemented
- captures configured browser trace/video, failure screenshots, console/network diagnostics, and API request/assertion summaries
- calls back into HelloTest with case result and step evidence payloads

## Execution trust boundary

Saved web/mobile scripts execute through `AsyncFunction` in the worker process. Treat automation authors and code as trusted; this is not an arbitrary-code sandbox. Run workers with limited OS privileges, target-specific credentials and appropriate network isolation. The MCP inspection destination policy is distinct from authored execution and does not make all test-target requests SSRF-safe.

## Worker Pools

Each step carries an `engine_class`. The queued case also carries an
`orchestration_class`, which is the safest worker pool to coordinate the ordered
flow:

- `api`: API-only jobs. These are lightweight and should scale aggressively.
- `web`: any job containing Web steps. Web+API unified flows stay in this pool so runtime variables can move from API extractors into browser steps.
- `android`: the shared native mobile pool for Android and iOS steps. The authored platform remains distinct and selects UiAutomator2 or XCUITest. This pool is capped lower because devices, simulators, and Appium sessions are scarce resources.

Each worker sets `TESTENGINE_WORKER_CLASS` and only leases matching orchestration
jobs. HelloTest queue stats expose both `by_orchestration_class` for scaling current
worker deployments and `by_step_engine_class` for step-level demand visibility.
Mixed cases therefore remain ordered and safe, while the model still records
that API, Web, Android, and iOS capabilities are step-level concerns.

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

Step statuses, notes, diagnostics and evidence references are persisted through the existing structured `execution_results.logs` contract. Keep queue reports, direct callbacks and the product result view compatible with that contract.

## Evidence storage

Case outcomes and durations live in `execution_results`; structured logs retain step statuses, notes, API/browser diagnostics, captures and automation operation outcomes. Step evidence can refer to an authenticated attachment or a bounded inline image. Product attachments store metadata in PostgreSQL and file bytes in configured object storage.

Browser trace/video bundles and their manifests also depend on the engine's artifact directory and configured policy. Retain that storage for as long as its references are needed. A worker restart, a passing step or a disabled capture policy does not promise every artifact exists. Native screenshots are supported for configured failures; native per-line traces and device video are not implemented.

## Core Decisions

- Runtime: Playwright for Web, native REST for API, WebdriverIO/Appium for Android and iOS
- Primary language: TypeScript
- Packaging: Docker for deployment; Node/TypeScript host processes for development
- Execution policy: the automation build agent produces reviewable code; runs execute saved code deterministically
- Retry scope: configured retries execute unchanged browser code, preserving attempt numbers
- Assertion policy: business assertions never change silently
- Review policy: generated code and retry findings are reviewed in HelloTest

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

From the repository root, start the standalone development execution stack:

```sh
docker compose -f testengine/docker-compose.yml up --build
```

Its local defaults are documented in [.env.example](.env.example); Compose does not load that example file automatically. Supply overrides through your environment or an explicit `--env-file`. Development credentials must match the local HelloTest API and must not be used for hosted deployments.

To build only the engine image, the Dockerfile and context are:

```sh
docker build -f testengine/backend/Dockerfile -t hellotest-testengine ./testengine/backend
```

For a standalone image-based host deployment, use:

```bash
./hellotest.sh deploy --stack testengine
```

Use `--config <file>` or environment variables to override the HelloTest API URL,
published engine URL, image tag, Selenium binds, and shared secret:

```bash
HELLOTEST_API_BASE_URL=https://hellotest.example.com/api \
ENGINE_PUBLIC_URL=https://engine.example.com \
./hellotest.sh deploy --stack testengine --yes
```

For a separate Test Engine host that should also align its OPS settings with the
active HelloTest integrations and expose the local telemetry board on the same host,
prefer:

```bash
HELLOTEST_API_BASE_URL=https://hellotest.example.com/api \
HELLOTEST_AUTH_TOKEN=replace-with-a-hellotest-token \
HELLOTEST_PROJECT_ID=replace-with-project-id \
./start-testengine-ops.sh
```

Configure a matching TestEngine secret on both the API and worker. Development fallbacks apply only outside production; generated standalone deployment credentials must match the control plane. The OPS lookup script does not establish authorization merely by discovering an integration.

If you do not want integration lookup, set `ENGINE_PUBLIC_URL` directly instead.
When the stack is up, the Test Engine host serves:

- `GET /health/live` (process liveness only)
- `GET /health/ready` (shared-secret and queue-worker readiness)
- `GET /health` (legacy compatibility status)
- `GET /api/v1/capabilities`
- `GET /api/v1/events`
- `POST /api/v1/events`
- `GET /api/v1/ops-telemetry/services`
- `DELETE /api/v1/events/projects/:projectId`
- `GET /ops-telemetry`

Every `/api/v1/runs` read, create, and retry route requires the Test Engine
shared secret as `X-HelloTest-TestEngine-Secret`, `X-TestEngine-Secret`, or a
Bearer token. The HelloTest API direct dispatcher sends this header
automatically. Production requires a non-default secret of at least 32
characters; local development retains the existing development fallback.
Browser origins are denied by default in production and can be explicitly
allowed with the comma-separated `TESTENGINE_CORS_ORIGINS` setting.

The Mobile Engine is a separate trust boundary. Every `/api/v1/mobile/*` route
requires `MOBILE_ENGINE_SHARED_SECRET` in
`X-HelloTest-Mobile-Engine-Secret`; health and capabilities stay public. The
Android worker adds that header automatically, and the standalone Compose stack
starts the independently deployable Mobile Engine with the same generated
operator secret. Production rejects missing, known-development, and
shorter-than-32-character values.

Before applying `testengine/k8s/testengine-workers.yaml`, create independent
control-plane and Mobile Engine secrets (use a secret manager or sealed-secret
workflow in production):

```bash
kubectl create secret generic hellotest-testengine-secret --from-literal=shared-secret="$(openssl rand -hex 32)"
kubectl create secret generic hellotest-mobile-engine-secret --from-literal=shared-secret="$(openssl rand -hex 32)"
kubectl apply -f testengine/k8s/testengine-workers.yaml
```

The `/ops-telemetry` board lets operators filter captured execution hierarchy
events by `service_name`, status, event type, and execution identifiers.

Telemetry event and service reads accept an optional `project_id` query. Scoped
responses echo that exact `project_id`; event totals and service counts include
only matching project records, excluding host events with no project. An
explicitly empty or invalid project scope returns `400`.

HelloTest's **OPS telemetry → TestGrid telemetry** tab reads these
project-scoped events and a separate administrator-only list of shared worker
activity. The engine's `include_workers=true` event query adds up to 50 unscoped
`testengine.queue.*` events without changing project totals. The HelloTest API
requires administrator access for this option. A successful integration connection checks reachability;
deploying an idle engine does not create project execution history. Execute an
automated test through TestEngine for the selected project to produce events.
Use **Infrastructure logs** for container startup and worker diagnostics. Events
without a project ID are deliberately excluded from project execution events, and old
events expire according to the configured retention and size limits.

Workers sharing `OPS_TELEMETRY_STORE_PATH` refresh event and service reads from
that store, so a web gateway can display API or Android worker events. Reads
reuse a bounded snapshot only while the file is unchanged; concurrent reads are
coalesced. Unreadable storage returns `503` instead of a misleading empty result.
Separately deployed workers must share the store or publish to a common telemetry
endpoint to make their events available through one gateway.

The HelloTest API uses `DELETE /api/v1/events/projects/:projectId` to clear one
project's events. The same suffix is registered on a configured custom event
path, without a trailing slash before `/projects`. A successful scoped clear
returns `{ "ok": true, "project_id": "…", "deleted": 3 }` and preserves other
projects and unscoped host events in memory and durable storage. The dedicated
route makes older engines reject the request rather than ignore a query filter.
Direct engine operators retain unfiltered reads and `DELETE /api/v1/events`
for the whole store; the existing delete route also accepts `project_id`.
All these routes retain the existing OPS telemetry authentication policy and
configured `OPS_TELEMETRY_API_KEY`; project filtering does not replace access
checks in the HelloTest API.

Queue pull mode polls HelloTest for eligible API, web and native jobs every 5
minutes by default. Configure `queue_poll_interval_minutes` on the active
Test Engine integration in HelloTest; `start-testengine-ops.sh` resolves that value
into `TESTENGINE_POLL_INTERVAL_MINUTES` / `TESTENGINE_POLL_INTERVAL_MS` for the
standalone worker. When the queue is empty, the worker does not emit job events.
The first successful queue check and subsequent five-minute summaries produce
polling activity, including counts of successful checks and leased jobs. Recovery
after a failed poll is reported immediately. Summaries use the existing bounded
event store instead of retaining every lease attempt.
Worker startup, poll failures, execution crashes, and failure-reporting issues
are captured on the local OPS telemetry board.
`TESTENGINE_SHUTDOWN_TIMEOUT_MS` controls the bounded drain window (30 seconds
by default), and `TESTENGINE_HELLOTEST_REQUEST_TIMEOUT_MS` bounds each queue API
request (15 seconds by default).

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

- [HelloTest background operations strategy](../docs/architecture/background-operations.md)
- [HelloTest product operating model](../docs/architecture/automation-workflow.md)
- [Architecture](ARCHITECTURE.md)
- [HelloTest handoff contract](backend/src/contracts/hellotest.ts)

## Automation build and playback capabilities

`POST /api/v1/automation/mcp` exposes the authenticated browser tools used by the automation build agent. Initialization accepts the application start URL and explicit browser-interaction setting. Sessions are isolated, limited to two concurrent browsers, expire after five idle minutes, and close through `DELETE` with `Mcp-Session-Id`. Navigation stays within the configured application origin and the inspection proxy validates browser destinations. Private applications need the existing explicit inspection-host configuration or a local recorder.

Web code uses the native Playwright page and locator APIs, retrying Playwright assertions, and the application’s parameter/repository bindings. Code may be a step body, one `test(...)` wrapper importing `test` and `expect`, or an exported async function. Configure multi-case suites and before/after hooks in the application; inline runner suites, fixtures, and arbitrary static module imports are rejected. Awaited operations record executed source lines, status, duration, and attempt; synchronous assertion failures also record their failing line. This is operation evidence, not a claim that every source line is an assertion.

API execution produces request/response assertions and captures. Android and iOS use native Appium sessions that survive intervening API steps and setup/cleanup groups, with separate sessions per platform. Device execution requires a reachable Mobile Engine, its shared credential, an Appium server and driver, and a configured device/application. XCUITest requires a macOS Appium host with an iOS simulator or device. Native failures can attach screenshots when `screenshot_on_failure` is enabled; native per-line traces and device video are not implemented. Browser trace/video policies apply to owned Playwright contexts; attachments larger than the inline limit require accessible engine artifact storage.

`web.aiStep`, `android.aiStep`, `ios.aiStep`, and `mobile.aiStep` fail explicitly when an instruction has no executable code. They do not perform runtime AI interpretation. Legacy `healing_attempted` / `healing_succeeded` callback fields currently describe configured browser retries, not autonomous code or locator repair.
