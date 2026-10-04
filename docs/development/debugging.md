# Development debugging runbook

For development setup, VS Code configuration, engineering standards and terminal startup commands, use [CONTRIBUTING.md](../../CONTRIBUTING.md). Use this runbook to choose a debugger, trace a failure and recover without losing data. Commands below assume that dependencies, infrastructure and the private root `.env.development.local` are configured.

## Establish the process and topology

Record the commit, browser URL, selected project/application, capability profile and failing operation. Determine whether the API and TestEngine are host processes, the combined local stack, or separate capability profiles.

| Process | Default port | Source |
| --- | ---: | --- |
| Product Vite | 5173 | [vite.config.ts](../../services/platform/frontend/vite.config.ts) |
| Administration Vite | 5174 | [vite.admin.config.ts](../../services/platform/frontend/vite.admin.config.ts) |
| Combined API | 3000 | [server.js](../../services/platform/backend/src/server.js) |
| TestEngine | 4301 | [server.ts](../../testengine/backend/src/server.ts) |
| Mobile provider | 4312 | [server.js](../../local-run/mobile-engine/src/server.js) |
| Host recorder launcher | 4311 | [local recorder setup](../../local-run/RECORDER_LOCAL_SETUP.md) |
| Appium, when separately installed | 4723 | Native provider configuration |

Docker frontend ports are 8080/8081. Separate profile API ports differ; consult [backend architecture](../architecture/backend.md). The checked-in VS Code tasks use fixed Vite ports and `--strictPort`; manually started Vite can choose another port unless you supply that flag. API and mobile HTTP servers currently bind all interfaces; a loopback inspector does not change their HTTP listener.

Read-only first checks:

```sh
npm run doctor
./hellotest.sh status --stack local
curl -i --max-time 5 http://localhost:3000/health/live
curl -i --max-time 5 http://localhost:3000/health/ready
curl -i --max-time 5 http://localhost:4301/health/ready
curl -i --max-time 5 http://localhost:4312/health/ready
```

Run only the checks for processes you intended to start. API liveness does not establish database readiness; engine readiness includes its configured queue state; mobile readiness depends on whether provider readiness is required. Authenticated **Administration → Service health** / `/admin/health` reports optional provider degradation. Do not substitute a container's “running” state for a ready endpoint or a completed case.

## Attach a debugger

Open the repository root in VS Code, then choose a profile in **Run and Debug** and press **F5**. Start individual profiles first so each dependency can reach readiness. Do not launch another copy of a process that already owns the same HTTP/inspector port.

| Profile in Run and Debug | Starts or connects to | Prerequisite / behavior |
| --- | --- | --- |
| `Backend API` | API on 3000, inspector on 9230 | Runs `minio:prepare` then `postgres:up`; waits for PostgreSQL and MinIO health |
| `Test Engine` | Execution worker on 4301, inspector on 9231 | API ready; browser installed for Web execution |
| `Mobile Engine` | Native provider on 4312, inspector on 9232 | Appium, platform driver and device configured; selected separately |
| `Frontend` | Chrome and product Vite on 5173 | API ready; starts background `frontend:dev` task |
| `Admin Frontend` | Chrome and admin Vite on 5174 at `/admin/` | API ready; starts background `frontend:admin:dev` task |
| `Backend API (Attach 9230)` | An already running API inspector | Start with the terminal command below |
| `Test Engine (Attach 9231)` | An already running engine inspector | Does not start the API or infrastructure |
| `Mobile Engine (Attach 9232)` | An already running native inspector | Does not start Appium |
| `Node Test (Current File)` | Active JS/MJS Node test | Runs once from repository root; no infrastructure startup |
| `TypeScript Test (Current File)` | Active Node test with `tsx` | Runs once from `testengine/backend`; installed engine dependencies required |
| `Full Stack Debug` | API + TestEngine + product frontend | Compound sessions start concurrently; admin/native remain optional |
| `API + Test Engine Debug` | API + TestEngine | Useful without a browser |

The [launch configurations](../../.vscode/launch.json) load the private root environment file for Node launches, then override `NODE_ENV`, each server's `PORT` and the engine's artifact path where applicable. Attach profiles use the environment of the existing process. Test profiles also load this file, so only run an integration test after selecting its intended disposable database. See VS Code's [environment-file behavior](https://code.visualstudio.com/docs/nodejs/nodejs-debugging#_load-environment-variables-from-external-file).

The [tasks](../../.vscode/tasks.json) use the same file for infrastructure Compose interpolation. They start PostgreSQL/MinIO on demand, not on folder open. Vite tasks use the frontend directory and their own process environment; they do not load the backend environment file. A background task's readiness matcher releases the frontend debugger when the expected Vite URL appears, as described in [VS Code background tasks](https://code.visualstudio.com/docs/debugtest/tasks#_background-watching-tasks).

The [workspace settings](../../.vscode/settings.json) keep consistent line endings and exclude dependencies, generated builds, evidence and caches from unnecessary watching/searching. Existing optional `hellotest.*` extension preferences are separate from application configuration. No additional debugger extension is required for the supplied Node/Chrome profiles.

**Stop** ends launch sessions; **Disconnect** from an attached process normally leaves that process running. Terminate Vite with **Tasks: Terminate Task**, and stop infrastructure with **Tasks: Run Task → debug:infra:stop** after stopping dependent processes. Neither operation deletes named volumes. The `Full Stack Debug` compound does not install Appium/devices or provision optional AI, cache, parsing or telemetry services.

### Terminal-only launch and attach

For manual loopback-only inspector processes, use the environment file from the contributor guide:

```sh
# Repository root: API inspector on 9230, HTTP on 3000.
node --env-file=.env.development.local --inspect=127.0.0.1:9230 --watch services/platform/backend/src/server.js
```

```sh
# Separate terminal: engine inspector on 9231, HTTP on 4301.
cd testengine/backend
HELLOTEST_API_BASE_URL=http://localhost:3000 \
ARTIFACT_ROOT=../../local-run/artifacts \
TESTENGINE_POLL_INTERVAL_MS=1000 \
node --env-file=../../.env.development.local --inspect=127.0.0.1:9231 --import tsx --watch src/server.ts
```

```sh
# Separate terminal, only for native provider work.
cd local-run/mobile-engine
APPIUM_SERVER_URL=http://localhost:4723 \
node --env-file=../../.env.development.local --inspect=127.0.0.1:9232 --watch src/server.js
```

Attach VS Code or Chrome Node DevTools to the matching inspector. Use `--inspect-brk` instead of `--inspect` to pause before startup. Keep inspector listeners on loopback; they permit code execution in the process. `--watch` restarts a process when dependencies change, so save during an idle run when possible.

Each `cd` block above belongs in a **new terminal opened at the repository root**. Stop a terminal-launched process with `Ctrl+C` when finished. Attach profiles do not inject environment values into it; restart the process to apply configuration changes.

For frontend breakpoints, open the Vite URL and use the source-mapped files in browser DevTools, or launch the Frontend debug configuration. Capability components are outside `src` but resolved through [vite.feature-sources.ts](../../services/platform/frontend/vite.feature-sources.ts). The Network tab shows the **resolved** API origin and route, which can differ from the path written in a feature's client.

Useful breakpoint chain:

1. `services/<owner>/frontend/api.client.ts`, then [httpClient.ts](../../services/platform/frontend/src/lib/httpClient.ts) for routing, caching and cancellation.
2. The owner's `backend/routes/*.routes.js`, then its application service.
3. [execution.service.js](../../services/testing/backend/services/execution.service.js) for frozen run scope; [testEngineDispatch.service.js](../../services/automation/backend/services/testEngineDispatch.service.js) for dispatch and queued result persistence.
4. [queueWorker.ts](../../testengine/backend/src/lib/queueWorker.ts) or [executor.ts](../../testengine/backend/src/lib/executor.ts) for queued/direct execution; the corresponding API/web/mobile adapter for provider behavior.
5. [testEngineCallback.service.js](../../services/automation/backend/services/testEngineCallback.service.js) for direct callback persistence.

Pausing a queue worker does not pause lease expiry or another worker. Use an isolated development queue and check the durable job state before resuming or retrying a mutation.

## Breakpoint and task troubleshooting

1. **Confirm the process and file.** Select the intended session in Call Stack. Frontend code needs the Chrome session; routes need Backend API; queue execution needs Test Engine. Break in original `.js`/`.ts`/`.tsx` source. Tests importing compiled engine `dist` need a current build; the server launch uses source through `tsx`.
2. **Load the code path.** A hollow breakpoint may belong to a module the browser has not loaded yet. Navigate to the feature, then reload if React Query or the HTTP client cache prevents the request. The [Projects walkthrough](../../CONTRIBUTING.md#2-example-debug-a-projects-request) gives a known read path.
3. **Check source mapping.** Inspect the breakpoint tooltip and loaded scripts. Vite uses `@fs` paths for capability code outside the shell directory. Open the workspace root and use its checked-in source-map settings before inventing path overrides. Clear stale browser assets by reloading, and remove only relevant generated build output if a stale build is confirmed.
4. **Inspect the task terminal.** A missing `.env.development.local`, stopped Docker daemon, failed MinIO build, unhealthy PostgreSQL or occupied Vite port prevents launch. Fix that reported prerequisite and rerun. Do not select “Debug Anyway” when infrastructure failed.
5. **Check the launch environment.** Use the VS Code terminal to check `node --version` and `docker compose version`. A GUI-started editor may have a different PATH from your shell. Restart it from the configured development environment when tools are missing. Stop and relaunch a Node session after changing the environment file.
6. **Account for real deadlines.** Paused requests can time out in the browser, provider or gateway. Resume and reproduce once; use a focused test for long inspection. Pauses do not suspend queue leases or device session timeouts. Do not increase production deadlines to accommodate a local debugger.

Use a conditional breakpoint such as `req.query?.projection === "summary"` in the Projects route to reduce noise. A logpoint avoids pausing but still prints data: limit it to sanitized IDs/status. To debug an early startup error, use the attach command with `--inspect-brk`, set the breakpoint and continue startup. Use **Uncaught Exceptions** for crashes before enabling noisy caught-exception pauses.

## Follow a request and its error

In browser DevTools, preserve the failing request and record its method, route, HTTP status, timestamp and response headers:

- `X-Request-ID`: the API request correlation ID.
- `X-Trace-ID`: the trace correlation ID.
- `traceparent`: W3C trace context for propagation.
- `Retry-After`: bounded retry guidance for applicable failures.

The API error envelope includes `success: false`, `code`, `message`, `requestId`, `traceId` and `retryable`; revision conflicts can also include `current_revision`. The frontend's `HelloTestApiError` exposes status/code and correlation IDs and adds a support reference to its message. Gateway errors or other external services may have a different envelope.

The authoritative response ID is the one returned by the API; do not assume a supplied `X-Request-ID` was preserved. Trace IDs can exist even when OpenTelemetry export is disabled or no span was sampled.

Follow API logs without dumping environment configuration:

```sh
./hellotest.sh logs --stack local --tail 100 --follow api
```

For host processes, inspect their terminal output. Existing API completion logs use `event=http_request_completed`, `request_id`, `trace_id`, `method`, `route`, `status_code` and `duration_ms`. Failures use `event=request_failed`, `error_code`, `error_type` and redacted diagnostic fields. Inspect the implementation when adding fields; do not invent another naming scheme for one route.

Errors and slow requests are retained while noisy successful health/lease polls are sampled. Prometheus counters remain unsampled. Temporarily set `NOISY_REQUEST_LOG_SAMPLE_RATE=1` when investigating a poll, then restore normal sampling. `LOG_LEVEL=debug` does not itself create log events in code that never emits them.

With monitoring running, search the trace ID in Test Ops → Telemetry / Jaeger and correlate logs in Grafana/Loki. `ENABLE_OBSERVABILITY=true` and a reachable `OTEL_EXPORTER_OTLP_ENDPOINT` enable trace export; missing export must not block the feature request. Use `npm run ops:status` and `npm run ops:verify` for the already configured OPS stack.

Never attach a raw HAR, environment file, bearer token, private prompt or complete test dataset to a bug report. Copy the minimal sanitized route/error details and IDs. Known-field redaction is a safeguard, not a guarantee that arbitrary nested data is safe to log.

## Diagnose a queued execution

A build transaction, queued execution job and saved case result are different records. Capture their IDs from the UI before investigating.

1. Confirm the run was created with the expected frozen cases, steps, hooks, configuration and data row. Later authoring edits should not silently change it.
2. Check the TestEngine integration URL and matching secret without printing their values. `localhost` inside a container points to that container.
3. Inspect engine `/health/ready`: queue configuration, last poll, consecutive failures and active jobs distinguish an idle queue from a disconnected worker.
4. Confirm `TESTENGINE_WORKER_CLASS` can lease the job's orchestration class. Native iOS jobs use the shared `android` pool. Mixed Web+API jobs use Web orchestration.
5. Check that progress reports and final completion reach the owning Automation API. A callback/report failure must not be reported as a passed case.
6. Inspect the selected data iteration and setup/teardown results, then statement outcomes, provider diagnostics and evidence. Evidence capture depends on configured artifact policy; a missing optional video is not proof a step never ran.
7. For native work, inspect mobile readiness, the Appium endpoint, driver, selected platform/device and app. An Android session cannot stand in for iOS.

Durable queue state belongs to the product API; local engine files are artifacts and local diagnostics, not a replacement results database. Do not manually force a terminal status to hide a reporting failure. Generated-code building can use an LLM/MCP, but execution runs saved code and configured retries; do not assume an agent repairs a failing run.

For engine service-call errors, a valid upstream response `X-Request-ID` is authoritative; failures before response headers retain the generated outbound ID. Invalid or oversized response IDs are ignored.

Engine-to-API queue calls, direct callbacks and Mobile Engine control calls use a bounded service transport with a 16 MiB JSON response limit. It rejects credential-bearing URLs and redirects instead of forwarding service credentials to a new origin. These limits do not redefine the target API engine or sandbox user-authored code. `EngineHttpError` retains a safe code/service/request ID/status for diagnosis, excluding raw upstream bodies and URLs.

## Common failures and safe recovery

| Symptom | Check first | Recovery |
| --- | --- | --- |
| `EADDRINUSE` | Docker and host processes using the same port | Stop the intended duplicate or choose a different explicit port; do not kill unrelated processes |
| API never becomes ready | PostgreSQL connection, schema receipt and startup log phase | Correct environment; run the intended migration if required; retain the volume |
| `OBS_DATABASE_URL` rejected | Product and execution adapter database identities | Point both at the same host/database; separate users are allowed |
| 401 / 403 | Session, API-key scope, feature availability and project/source permissions | Sign in or correct the actual grant; enabling a feature does not grant permission |
| Feature missing | Deployment ceiling, profile, feature snapshot and endpoint map | Deploy the owner/dependencies or restore permitted configuration |
| 404 / proxy 502 | Resolved client origin, `/api` rewrite, selected profile | Correct the gateway/endpoint mapping instead of routing to another capability |
| Browser still shows old data | Scope/session cache keys, successful mutation invalidation and Network requests | Reproduce with a fresh view; fix ownership/invalidation rather than only refreshing the page |
| Request hangs or cancels | Frontend abort, backend deadline, provider deadline and queue status | Inspect the first failure; preserve user input; avoid stacking retries |
| Engine queue stays idle | Worker class, poll interval, credentials and lease state | Correct configuration and inspect the next poll; five minutes is the unconfigured interval |
| Playwright launch fails | Matching browser install and OS libraries | Install the browser in the engine package or use its Docker image |
| MinIO pull returns `unauthorized` / `401`; other pulls say `Canceled` | Selected `MINIO_IMAGE` in the shell and chosen environment file | Remove an obsolete Quay/Docker Hub override or use `hellotest/minio:RELEASE.2025-10-15T17-29-55Z`; prepare it with `npm run build:minio`, then retry. Peer cancellation can follow the failed pull; it does not establish a separate image failure |
| MinIO source build stalls or fails | First failing build step, Docker resources and access to source/dependency/base-image hosts | Restore connectivity/resources and rerun; the initial compile takes minutes and subsequent starts reuse the image. Keep the data volume |
| Attachments fail | MinIO endpoint, bucket/authentication and size limits | Restore object-storage access; database rows alone do not contain the file bytes |
| AI or repository action fails | Integration access, provider deadline, authorized context and transaction error | Correct provider/scope and retry the recorded operation; do not fabricate a success |
| Native provider degraded | Appium connectivity and readiness requirement | Start/configure the provider and device; inspect Android/iOS capability mismatch |

MinIO's [official release instructions](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z) direct container users to build from source. Registry login does not restore the withdrawn public image. The root launcher builds the default local image when needed; direct Compose requires `npm run build:minio` first. An intentional private-mirror `MINIO_IMAGE` is preserved and skips the source helper. Do not delete volumes or credentials to repair an image download/build failure.

Restart only the affected local service after fixing configuration:

```sh
./hellotest.sh restart --stack local api
```

To stop application containers while keeping their named volumes:

```sh
./hellotest.sh down --stack local
```

Do not add `-v` or use a reset-data script as routine recovery. A changed environment generally needs a recreated process/container, not just a restart of unchanged container configuration; use the documented `up` command after reviewing that environment. Back up data before any intentional destructive reset. PostgreSQL integration tests need a separate disposable database; browser cache clearing and application restarts must not erase persisted results or evidence.

A useful bug report states the expected/actual behavior, minimal steps, owner/profile, request/trace/job IDs, sanitized error, relevant configuration **names**, and checks performed. Explicitly separate mocked tests from live API, browser, LLM and device validation.
