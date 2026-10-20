# Development debugging runbook

For development setup, VS Code configuration, engineering standards and terminal startup commands, use [CONTRIBUTING.md](../../CONTRIBUTING.md). Use this runbook to choose a debugger, trace a failure and recover without losing data. Commands below assume that dependencies, infrastructure and the private root `.env.development.local` are configured.

## Debug the existing Docker local stack

Use the existing running local stack. If it is stopped, start it normally:

```sh
./hellotest.sh up --stack local
```

Check the selected process without mutation with `./scripts/debug/chatbot.sh --check`. MCP attaches to the same combined API using `mcp.sh`; the quality worker uses `testengine-quality-worker.sh` on 9245. Inspector attachment requires no container rebuild.

Select **Local Docker: Chatbot UI + Backend** in VS Code's Run and Debug dropdown and press F5. This opens the existing Docker UI on `http://localhost:8080` and attaches to the API already running in Docker. It does not restart containers, launch another API or start Vite. Sign in in the debugger's browser, select a project, open Ask HelloTest, and send a message.

Set breakpoints in `services/chatbot/frontend/components/GroundedAssistant.tsx` at `submitPrompt` and the response normalization; in `services/chatbot/frontend/api.client.ts` at `fetch`; and in `services/chatbot/backend/routes/chatbot.routes.js` at `prepareTurn(req, reply)` inside the `/messages/stream` handler. For retrieval and LLM calls, use `retrieveContext` and `response = await request()` in `services/chatbot/backend/services/knowledgeAssistant.service.js`. Continue with F5 between UI and backend sessions; F10 steps over, F11 steps into. Long pauses can exhaust the existing 120-second turn deadline.

Local Docker builds include inline browser source maps. Other Docker builds keep them disabled by default. Images built before this change can attach backend debugging immediately, but frontend TypeScript breakpoints need the normal build command above to pick up source maps. No extra container recreation command is required.

For other services, select their **Local Docker: <service>** profile. Capability backend profiles all attach to the combined `api` process. Workers and mobile attach to their own existing processes. PostgreSQL, Redis, Qdrant, MinIO, Tika, Nginx and HAProxy do not have a Node inspector. See [debug scripts](../../scripts/debug/README.md) for standalone attachment, replica selection, ports and cleanup. Older host launch profiles below remain available for host development.

## Establish the process and topology

Record the commit, browser URL, selected project/application, capability profile and failing operation. Determine whether the API and TestEngine are host processes, the combined local stack, or separate capability profiles.

| Process | Default port | Source |
| --- | ---: | --- |
| Product Vite | 5173 | [vite.config.ts](../../services/platform/frontend/vite.config.ts) |
| Administration Vite | 5174 | [vite.admin.config.ts](../../services/platform/frontend/vite.admin.config.ts) |
| Combined API | 3000 | [server.js](../../services/platform/backend/src/server.js) |
| TestEngine | 4301 | [server.ts](../../testengine/backend/src/server.ts) |
| Mobile provider | 4312 | [server.js](../../local-run/mobile-engine/src/server.js) |
| Host recorder launcher | 4313 | [local recorder setup](../../local-run/RECORDER_LOCAL_SETUP.md) |
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

When a code-only refresh reaches the API's startup deadline while replaying
compatibility backfills, inspect schema receipts and migration logs first. After
confirming the required main and observability versions and that the change has
no schema migration, restart with `HELLOTEST_SCHEMA_MODE=verify`. The launcher
passes this existing application mode to local, full and platform API stacks and
retains the choice in its private generated environment. Verification still fails
closed when a required receipt is missing or outdated. Use
`HELLOTEST_SCHEMA_MODE=migrate` for initial setup and schema upgrades; the default
remains `migrate`. Do not interrupt a healthy in-progress migration merely to
change modes.

If the local gateway returns `503` / `NOSRV` while its worker is healthy, compare
direct worker readiness with gateway readiness and HAProxy's check log. Under
measured host pressure, valid responses took 2.5–3.1 seconds and exceeded
HAProxy's implicit two-second check deadline. The local gateway now sets a
five-second check timeout, matching the worker's Docker check budget, with
five-second intervals, three failures to mark down and two successes to recover.
This still rejects an actual readiness failure; it does not change MCP action
deadlines. See [HAProxy's check timeout contract](https://docs.haproxy.org/2.9/configuration.html#timeout%20check).

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

TestOps AI calls and agent model-call details have separate Copy request and Copy response actions. They copy the displayed sanitized capture under the existing trace content permission. A missing response disables its copy action; a browser clipboard denial leaves the visible payload available for manual selection.

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

## Account changes, stale data and scrolling

For a session race, set breakpoints in `src/auth/AuthContext.tsx` at the authentication intent check and storage-event handler, and in `src/auth/SessionQueryBoundary.tsx` before query cancellation/clear. Paths are relative to `services/platform/frontend`. Confirm that a delayed login cannot replace a later login or restore a logged-out account. A second tab's logout must immediately remove the first tab's protected workspace. For an account switch, verify that old project records never flash before the new user's requests complete.

Inspect React Query Devtools or the Network panel without copying bearer tokens into reports. The transport cache and React Query cache have separate ownership: `readRequestSession` partitions short-lived HTTP reuse; `SessionQueryBoundary` cancels and clears workspace queries on access changes. Do not disable these checks to diagnose a permission error.

For scroll jumps, inspect `.workspace-main` computed `overflow-y`, `clientHeight`, and `scrollTop`. `platform/lib/workspaceScroll.ts` chooses the scroll owner; `useWorkspaceScrollRestoration` owns route history and cancellation. Query-string filter changes preserve position. User/project changes have separate positions. Resize-driven restoration is scheduled once per animation frame and is cancelled by wheel, touch, pointer or keyboard input.

A stuck recorder counter is not proof that recording stopped. Inspect `shared/hooks/useRecorderStatus.ts`: requests run sequentially with a five-second deadline and pause in hidden tabs. The backend finish operation remains authoritative. Never change recording origin/profile values to recover a display-only polling failure.

Known security boundary: browser session tokens currently live in localStorage and expire after 12 hours. Logout clears browser state; it does not revoke an already copied bearer token server-side. Server-side session revocation and an HttpOnly-cookie migration require coordinated backend/storage/client contracts. Fresh server user/permission checks and distinct project-bound MCP credentials remain required; this review does not certify the entire application against XSS.

## LLM context and knowledge build diagnostics

For Smart Context, inspect `/knowledge/search`: the UI must send `intent_aware: true`. Set breakpoints in `knowledgeIntentPlanning.service.js` (`planIntent`), `knowledgeRetrieval.service.js` (`retrieveDirect`), and `src/mcp/gateway.js` (`contextCall`). Service paths are relative to `services/knowledge/backend/services`; the gateway is in `services/platform/backend`. Check the server-derived user/project, selected integration scope, `intent_planning_mode`, `intent_model_calls`, source filters and remaining budgets. `standard` is an explicit planner fallback, not a successful LLM plan. An absent model must be configured in Integrations; do not replace a user's identity or permissions to make context available.

For ingestion, break after canonical index activation in `knowledgeRag.service.js`, then in `knowledgeEnrichment.service.js`. The document must remain searchable if the model is unavailable. `metadata.llm_context_profile` records `llm` or `standard`, a safe failure code and source-anchored excerpts. Generated hints never replace the source text. Current source revision/activation checks reject late enrichment for a superseded source. No bulk reindex is performed by this code change.

For agent output, compare the specialist's `outputInstructions` in `services/agentic/shared/workflowSpecialists.json` with the response. Test Design should contain a rationale and actual cases, not only a scenario suggestion list. Provider output-limit termination is an error; oversized review fields are rejected rather than silently clipped. The shared `FormattedText` renderer handles Markdown tables/lists/code as escaped React text. Scroll the complete brief to its final paragraph and verify both light and dark themes.

## Local execution versus inspection

The repository inspection agent occupies 4311. Start the host Playwright execution/recorder on 4313 with `local-run/bin/start-host-recorder.sh`. Its `/health` and `/api/v1/capabilities` must identify Playwright support; an inspection-agent listener on 4311 is not an execution engine. The API default is `HELLOTEST_LOCAL_RUN_ENGINE_URL=http://host.docker.internal:4313`, while browser-facing connections use `http://localhost:4313`. Override both runner and API ports together. Test Runs leaves local resolution to the server; it must not point local execution at remote port 4301. Live sessions come from dispatched, project-bound run metadata and include a run ID; they do not fall back to another active browser.

For an isolated live-link database check, use `EXECUTION_LIVE_POSTGRES=1 node --test services/automation/test/backend/executionLiveSessions.postgres.test.js` with matching `DATABASE_URL` and `OBS_DATABASE_URL` pointing to an empty disposable database named `agent_verify_live_sessions_*`. The test uses the native schema and verifies project/run isolation, URL sanitization and completed-session removal. Real provider smoke checks must use controlled targets; they do not establish that a customer's saved steps, selectors or target credentials are valid.

## Automation source, options and callback verification

Main schema version 7 separates `TC_` manual IDs from `AT_` automation IDs and
retains old automation display IDs in `legacy_display_ids`. Run the normal migration
before starting the API in schema-verify mode. Identity is immutable; use explicit
automation/manual links rather than changing `automated` on an existing case.
`test_case_effective_results` derives linked coverage from actual source receipts;
`execution_results` remains the original execution evidence. Derived result IDs
are read-only and include source provenance. Investigate the source automation
case for logs, attachments and per-row failures.

Automation Engineer restores its step workspace through the permission-scoped
agent activity endpoint. Select a manual step or section to inspect its validated
draft and the actual browser evidence captured during generation. Protected
preview/evidence artifacts remain separate from ordinary transaction metadata;
older activities may have no retained draft. Model request and Model response
tabs beside Instructions/Source show the selected draft's originating section-attempt
calls (or the original complete-case scope for legacy activities), subject to
existing trace permissions. Events remain retained server-side;
the workspace omits separate log and outcome panels. A generated
or partial activity is not an execution pass. The completion loop performs at
most three correction attempts per current section for browser or linked manual
builds, within the shared case deadline/tool budget; other builds use three case attempts.
Each validated section is saved to Plan while the case remains incomplete. Later
failures preserve those saved sections; final coverage and output validation are
required before the case becomes ready. Only the current section is requested;
future rows stay queued. Browser tool batches and expected-result assertions finish
before accepting the interactive section. Browser actions, validated drafts and
saved Plan sections have separate receipt-based counters.

If the model returns fill/click code without performing it, inspect
`allow_browser_actions` and `browser_interaction_mode` in the retained build.
New Engineer forms default visibly to **Perform steps in browser**. An explicit
source-only selection stays read-only. Code-only output in interactive mode gets
`AUTOMATION_BROWSER_EXECUTION_REQUIRED` feedback until actual current-section
actions and a subsequent `browser_assert` succeed. A later failed assertion requires a real corrected
check; a code-only revision cannot reuse an earlier successful assertion. Startup
diagnostics are retained as bounded, redacted transaction artifacts with MIME
`application/vnd.hellotest.automation-browser-diagnostic+json`. Their download
requires the existing project and automation content permissions.
Missing test inputs are reported
as dependencies before dispatch; mailbox/OTP evidence must be configured rather
than invented. Inspect `automation.agent.section.saved` and row
`instruction_status: saved` for actual Plan persistence. A later failed activity
must not downgrade those rows or hide the saved Plan. Partial prepared automation
IDs remain in activity outputs so latest/history lookup from the AT case works.
An observed action followed by a provider error stops automatic whole-case retry.
Published final output schemas apply to the assembled result, allowing intermediate
tool requests without treating them as a complete case outcome.

For a build that fails before its first model request, inspect the browser setup
phase. `AUTOMATION_BROWSER_STARTUP_FAILED` preserves MCP's confirmed
`not_attempted` startup receipt. The same session retries startup once after
cleanup; two failed starts stop automatic retries rather than multiplying them
through the durable queue. The bounded diagnostic includes the fatal log tail;
ordinary Chromium DBus warnings alone do not establish the cause. All four local
TestEngine worker containers use `init: true` to reap exited browser children.
Navigation/readiness failures and unknown outcomes do not receive a startup retry.
The workspace displays the sanitized failure reason and offers **Refresh activity**;
switching back to the tab resumes bounded latest-activity discovery. A changed URL
pauses queued mutations while allowing read-only snapshots and assertions. A failed
tool stops the rest of the batch. Both retain completed actions and request current
browser evidence before continuing.

`automation_action_reconciliation` is host feedback, not a second MCP action.
It references a confirmed action ID when a corrected linear section repeats that
same target and value. Inspect the original receipt; the browser action count
must not increase. Navigation resets, changed values and additional action
instances cannot use this shortcut. A failed assertion remains unresolved until
a subsequent real assertion succeeds. When controls disappear after a submit,
inspect the current snapshot's visible result text and locator candidates rather
than an older page's inputs.

When the browser opens but a build exhausts model turns, compare actual tool
receipts with model responses. Repeated code-only replies are not browser startup
failures. `automation_program_tools` records bounded AST-to-MCP planning for
supported linear code; only subsequent real MCP receipts substantiate actions.
`automation_source_validation` asks for specific syntax corrections before any
proposed actions run. A corrected source can reuse exact completed prefix
receipts, including navigation and parameter references, without repeating a
submission. Native text-content/title assertion capabilities must be advertised
by the selected runner; `AUTOMATION_MCP_CAPABILITY_MISSING` identifies an old runner.

Empty-case builds use `automation.agent.flow.planning` and the configurable
`automationFlowPlanning.instructions` block before developing sections. A `flow_plan`
model trace is a manual specification draft, not an instruction or execution
receipt. Check case revision, linked sources and parameters on
`AUTOMATION_FLOW_BASELINE_CHANGED`; the draft transaction preserves concurrent
edits and rolls back on access or lease loss. The next UI row requires a durable
`development_status: completed` receipt under the strict progression policy.
Test-data display reads the protected build snapshot: public values are fixed for
one build and private values remain masked. Unset authored inputs open a review
dialog and may continue as empty strings for one case. Full unscoped `@name`
inputs use an existing `r.name`, otherwise inherited `t.name`; explicit scopes
never borrow another namespace. The host records the chosen scope before replay.

Main schema version 9 adds the nullable, versioned `automation_start_url` field.
New browser cases, Engineer builds and retries require an explicit or saved
HTTP(S) target; existing legacy records can still be viewed and edited without
inventing a URL. Review the case's Start URL and the activity's browser entry
source when a build opens the wrong application. Queued jobs capture the reviewed
target per case. A target edit or replacement after submission stops the job with
`AUTOMATION_START_URL_CHANGED`; it must not overwrite the newer URL or instructions.
An old browser job without a captured target must be resubmitted with a URL.

If model output mentions an unrelated site such as Heroku while browser evidence
shows the correct target, inspect the repository screens included in the model
request. Older builds supplied application-wide recordings. Browser generation
now excludes web screen records whose origins do not match the selected Start
URL, including records without a usable page identity. Retrieved links, old
source and parameter values do not independently authorize another origin.
MCP evidence is returned only after document load and bounded interface readiness;
HTTP/navigation failures and unfinished loading block subsequent actions. A
post-action readiness failure has an unknown outcome and must not replay a
possibly completed click or submission. Continuous background polling alone does
not prevent a settled page from becoming ready.

Linked manual parameter defaults are projected separately from raw automation
overrides on the scoped case-detail endpoint, with `data.view` required for values.
Inspect `inherited_parameter_values`, `effective_parameter_values` and
`parameter_sources` when a value differs between manual and automation cases.
An explicit automation key wins even when empty; reset removes the key. New
execution snapshots freeze effective values, while existing runs retain their
original data. Exact parameter references in browser input tools are resolved
inside the authorized tool wrapper, never by exposing private values to the model.
For a build, public generators and aliases materialize once and supply the prompt,
step labels and browser inputs. The first completed section saves public generated
case values atomically with its instructions; later sections reuse those defaults.
A failed save rolls back its own code, defaults and history without losing earlier
committed sections. Source manual templates remain unchanged. Inspect
`metadata.build_data_artifacts[caseId]` and the scoped
`/test-cases/automation/jobs/:transactionId/build-data/:artifactId` endpoint for
retained resolved labels. It also requires `data.view`; ordinary metadata contains
no actual parameter data. Optional artifact failure falls back to authored labels,
not new random values. Observation `active_step_id` / `active_manual_step_ids`
distinguish selected-step evidence from other-step and legacy observations.

If newly linked automation appears to miss recently entered manual Test Params,
check the parameter save before the navigation to `/automation?create=1&manual=…`.
That action flushes only pending parameter edits and waits for the revision-checked
save; save failures stay on the manual screen. Detail-cache updates must match the
scoped query prefix, including its user/execution variants. The creation-route
consumer prevents stale URL state from reopening the dialog after success/cancel.
Bound runtime parameter names also accompany generation feedback, allowing the
validator to correct false parameter-only dependency reports without exposing
values or hiding genuinely missing external context.

`POST /test-cases/:id/automation/parameter-plan` returns authorized public values,
private/deferred names, missing names and authored bound-empty names. It does not
materialize random generators. The primary build reviews missing or empty inputs;
**Review data & build** also reviews configured public values. The receipt is an
opaque HMAC over the specification and selected sources, not plaintext values.
`AUTOMATION_PARAMETER_PLAN_CHANGED` requires a fresh review. The save boundary
locks and rechecks selected source data; a concurrent edit cannot commit stale
instructions. The build refreshes its own baseline after committing overrides.

Reviewed inputs persist as authored automation values and bounded name-only
`test_data_options.parameter_overrides` metadata. These values survive selected
environment/configuration/data-set defaults in runtime and export; explicit run
input and captures retain their existing precedence. Missing-input empty defaults
and reviewed changes save atomically with accepted source. An unknown reference
invented by the model still fails before a browser action. A missing external
source is separate from an empty form input.

When a build and later run differ, inspect `effective_test_data_set_ids` alongside
the authored `test_data_set_ids`. The primary linked manual mapping is a fallback
only when automation has no own mapping. Generation, new-run snapshots and run
planning share the same scoped resolver; a frozen run never rereads a changed
manual mapping when its options are updated.

For `AUTOMATION_DEPENDENCY_MISSING`, inspect the activity's required-context card and configure the named mailbox/source/parameters before retrying. A supplied verification code cannot establish that an inbox was checked. For a save-phase `25P01` / `SAVEPOINT can only be used in transaction blocks`, check the shared PostgreSQL adapter's active-context lifecycle: detached background work must not reuse the client of a completed transaction. A successful model response does not mean its code was saved or executed.

Automation readers can inspect saved actions and expected results without
`automation.code.view`. Scoped Test Step reads withhold executable source and API
request contracts when that permission or its feature is unavailable, returning
`automation_source_hidden: true`. Source, generated keywords and runnable exports
remain subject to source access.

The Engineer build actions explicitly select `ai.agentic.automation-engineer`.
That feature key survives batch queueing and governs model selection, context
policy and model settings. Engineer and Repair share configurable browser protocol
blocks with automation generation; agent-specific published overrides take
precedence. Shared native-generation templates still define the section mapping
contract. A compiled mapping is not a passing execution receipt.

Failed current-section checks also appear in `current.latest_failure`, outside
compactable observation history. URL checks identify the address bar as their
subject without exposing expected private values. The configurable
`automationBrowserAgent.recovery` block distinguishes URL requirements from
visible-state checks; an explicit required route must never be weakened to a
heading assertion. A failed final tool batch reports
`AUTOMATION_BROWSER_EXECUTION_INCOMPLETE` and retains previously saved sections.

If a high-level manual action refers to a screen that is not open, inspect the
current snapshot and its observed navigation controls. `sectionIntent` allows
necessary intermediate navigation in the same manual section; the Start URL is
only the entry point. Generated-source failures also populate `latest_failure`
and include a bounded previous draft for correction. Repeated invalid source
selects `inspect_and_act_before_source`; no invalid source is executed. Final
source must include an executable expected-result check even if development
`browser_assert` calls already passed. The step's Build Error tab retains safe
failure codes and attempts without copying input values or raw provider errors.

`automation.agent.output.normalized` records when a bare native asynchronous
matcher was joined with `await`. Compare the raw model response with the saved
canonical source; locator, polarity and expected values must match. Awaited
`locator.waitFor` and `page.waitForSelector` visibility checks use real MCP
assertions. Attached/detached states and dynamic wait options are not approximated.

Interactive Engineer requests use `automationBrowserAgent.actor` and the
structured actor task instead of the source-only request template. Keep an
explicit JSON-output instruction in that configurable block: JSON-object
providers can reject the request before generation when messages omit the word
JSON. `automation.agent.source.compiled` identifies source compiled from actual
confirmed operations. Model drafts and serialized/redacted activity history
cannot manufacture that host ledger. Actor `occurrence` is a cumulative
execution ordinal, not a retry counter; failed checks reuse confirmed actions.

`AUTOMATION_PARAMETER_REFERENCE_REQUIRED` means a display redaction mask was
proposed as input. No browser action has run for that request. The loop returns
safe scoped reference names so the model can correct the input in the same
session; do not replace private values with literal mask text in task context.
`AUTOMATION_NAVIGATION_ALREADY_REACHED` skips reopening an already-ready current
URL. Intentional reloads use `navigation_intent: "reload"`. After a real failed
navigation, an earlier snapshot or satisfied check cannot establish completion.

For a successful model response followed by an assertion/locator failure,
compare `current_snapshot.accessibility` with the exact proposed candidate.
`Email *` in DOM label text can differ from accessible name `Email` when the
asterisk is `aria-hidden`. `automationSnapshotLocators` validates each advertised
candidate against the captured node; do not change a correct application label
to accommodate an incorrect role locator. `browser_validate_locator` with
`match_count: 0` or `unique: false` is unsuccessful even if JSON-RPC succeeded.
The model's current failure and recent receipts retain those facts.
`AUTOMATION_BROWSER_REPEATED_CHECK` stops repeated unchanged unsuccessful probes.
`AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED` is a browser-stage failure, with
`tool_calls`, `tool_call_limit` and the last browser code; successful provider
calls must not be labelled model failures. A completion-only turn can save
already-observed work but cannot dispatch new browser operations.

For `BROWSER_TOOL_INVALID_ARGUMENTS`, inspect the discovered assertion schema and
safe `assertion_contract`. State checks (`visible`, `hidden`, checked/enabled
variants) require `locator` and forbid `value`; text/value/count checks need both;
page URL/title checks require `value` and forbid `locator`. Correct the argument
shape without weakening the manual expected result. Host schema feedback excludes
input values, and server rejection happens before browser execution.

An input-preflight `AUTOMATION_DEPENDENCY_MISSING` lists missing authored test or
suite values before the browser opens. `generation_provider_requests: 0` applies
to Engineer completion calls; optional Knowledge intent planning can already
have used a model. Review inherited manual values and explicit automation
overrides before retrying. A missing run capture is not a static-input blocker.

Section options are read only from a leading `// @hellotest-options` comment.
Quoted text inside executable source does not change section execution. Direct
and queued runners honor `skip`, `optional` and `screenshotOnFailure`, including
API/native sections and hooks. An optional failure remains visible with its
original error and a skipped/warning result; required sections must still pass.
An entirely skipped case cannot pass. Standalone Playwright exports retain those
options and resolve native `page.*` parameter/repository references as well as
`web.*` keywords.

Queued lifecycle callbacks serialize on the persisted job row. Replayed completion
returns the original receipt rather than inserting another result or artifact.
Final ledgers must account for the frozen sections, and a failed required section
cannot be hidden by a blocked/passed completion. Mixed runs remain open while a
manual case is pending, paused or running. Signed direct final callbacks serialize
by engine run ID; a later delivery cannot replace a terminal receipt for that
attempt. A newly dispatched attempt has its own engine run ID.

Focused verification:

```sh
node --test services/automation/test/backend/queuedExecutionLifecycle.test.js services/automation/test/backend/testEngineResultLedger.test.js
node --test services/testing/test/backend/testStepReadAccess.test.js services/testing/test/backend/automationBatchBrowserActions.test.js
node --test services/automation/test/frontend/*.test.mjs
npm --prefix testengine/backend run build
node --test testengine/backend/test/browser/automationExecutionOptions.test.mjs
```

The opt-in `queuedExecutionLifecycle.postgres.test.js` requires an empty disposable
`agent_verify_automation_*` database. Never point it at the workspace database.
