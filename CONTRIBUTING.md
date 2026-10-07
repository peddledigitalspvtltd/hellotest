# Contributing to HelloTest

Use this guide to set up a development environment, debug each runtime, implement a change and prepare it for review. The VS Code workflow runs Node and Vite on your workstation, with PostgreSQL and MinIO in Docker. For operating the complete application, start with [README.md](README.md); for failed startup, missing breakpoints or stuck executions, use the [debugging runbook](docs/development/debugging.md).

- [Prerequisites and dependency installation](#prerequisites-and-dependency-installation)
- [Private development configuration](#private-development-configuration)
- [VS Code setup and service debugging](#vs-code-debugging)
- [Terminal workflows](#choose-one-local-workflow)
- [Configuration ownership](#configuration-ownership)
- [Source ownership and implementation rules](#source-ownership-and-dependency-rules)
- [Schema and capability releases](#schema-and-capability-releases)
- [Tests and verification](#tests-and-verification)
- [Repository hygiene and review](#repository-hygiene-and-review)

<a id="5-prerequisites-and-first-setup"></a>

## Prerequisites and dependency installation

Use Node.js **22.18+** for development. Package engines permit Node 20, but frontend tests import TypeScript directly using Node's native support. Use npm and Docker with Compose v2. Python is required for applicable agent tools and packaging; an Appium server and devices are required only for native execution.

For VS Code debugging, also install Git, VS Code and Chrome, and keep Docker running. Check the tools in VS Code's integrated terminal:

```sh
git --version
node --version
npm --version
docker info
docker compose version
```

Open the **repository root**, containing `package.json`, `hellotest.sh` and `.vscode`. On Windows, open the checkout in VS Code's WSL2 environment and use WSL Node/npm with Docker's WSL integration; the supplied shell tasks require a POSIX shell. Keep Windows and WSL dependencies separate. Use a feature branch according to your team's naming policy and preserve existing local changes.

Run commands from the repository root unless a block explicitly changes directory:

```sh
npm run setup
npm run doctor
```

This installs API, frontend and TestEngine dependencies with their lockfiles, installs the mobile worker with `npm install --ignore-scripts`, then creates root `services/*` workspace links. Use `npm --prefix` for the nested Platform runtimes, TestEngine and mobile worker. Use `--workspace @hellotest/<owner>` for capability packages. Do not substitute a root-only `npm install` for all runtime installs.

The repository's [.gitattributes](.gitattributes) keeps text files at LF on every platform, including Windows checkouts with `core.autocrlf=true`. Native `.bat` and `.cmd` files use CRLF on checkout; binary assets are excluded from conversion. [.editorconfig](.editorconfig) applies the same policy in supporting editors. Keep shell scripts as UTF-8 without a BOM: a CRLF or BOM in the shebang can stop a Linux container from launching the script. These rules do not rewrite existing copied folders or Docker images; normalize an affected local copy before rebuilding its image. A fresh Git checkout applies the attributes automatically.

`npm run doctor` reports tooling, dependency manifests and workspace links. `npm run --silent doctor -- --json` emits `{ schemaVersion: 1, ok, checks }` for automation; `--help` lists options without probing. Required missing dependencies/tooling exit 1, invalid arguments exit 2, and optional Docker/Compose absence is a warning. It checks both the runtime manifest minimum and the required Node 22.18+ development version for TypeScript-importing tests. Doctor does not import application modules, read `.env` contents, contact Docker's daemon/databases/providers, install dependencies or start processes. A passing report is setup evidence, not runtime readiness.

For browser execution, install the matching Playwright browser if it is missing:

```sh
(cd testengine/backend && npx playwright install chromium)
```

On Linux, the browser may also require system libraries; the TestEngine Docker image already supplies its browser runtime. Keep generated browser artifacts outside tracked source.

## Private development configuration

On first setup, copy the checked-in template. If the destination already exists, merge the required settings into it instead of overwriting it.

```sh
cp docs/development/development.env.example .env.development.local
chmod 600 .env.development.local
git check-ignore .env.development.local
```

**Checkpoint:** the last command prints `.env.development.local`. This file is private and ignored by Git. The [template](docs/development/development.env.example) contains public credentials for an isolated development machine; use your organization's secret management for shared environments.

Review these relationships before starting:

| Configuration | Required relationship |
| --- | --- |
| `POSTGRES_DB/USER/PASSWORD` and `PGDATABASE/PGUSER/PGPASSWORD` | The Compose initializer and host API must agree; `PGHOST=localhost` |
| `MINIO_ROOT_USER/PASSWORD` and `MINIO_ACCESS_KEY/SECRET_KEY` | The object store and API storage client must agree |
| `TESTENGINE_SHARED_SECRET` | Same value in the API and TestEngine |
| `MOBILE_ENGINE_SHARED_SECRET` | Same value in the API, TestEngine and optional mobile provider |
| `HELLOTEST_API_BASE_URL` / `ENGINE_PUBLIC_URL` | Host API `http://localhost:3000` / engine `http://localhost:4301` |
| `MOBILE_ENGINE_URL` / `APPIUM_SERVER_URL` | Optional mobile worker `http://localhost:4312` / Appium `http://localhost:4723` |

Leave a common `PORT` out of the file: each debug profile sets its own port. VS Code server profiles read `envFile`; ordinary Node commands need `--env-file` explicitly. The Vite tasks do not load this backend file. Their default `/api` proxy already reaches port 3000, so copying a frontend environment file is unnecessary. See [configuration ownership](#configuration-ownership) before overriding endpoints.

Start VS Code from a terminal without stale application environment overrides. Shell values can override Compose and Node `--env-file` settings; `DATABASE_URL` or `POSTGRES_URL` overrides `PG*` configuration. Do not print a complete resolved environment into a bug report.

An existing PostgreSQL volume retains its original users/passwords. Editing this file does not rotate them or reset the administrator. Use the matching existing credentials or an intentional database administration procedure. The backend development Compose file publishes 5432/9000/9001 on host interfaces; use this configuration on a private workstation with appropriate network controls. Inspector ports in the checked-in profiles bind only to loopback.

## VS Code debugging

Complete the dependency installation and private environment setup above before pressing F5. The three files in [.vscode](.vscode) are already checked in; keep them in the repository root so `${workspaceFolder}` resolves correctly. VS Code's built-in JavaScript/TypeScript debugger supports these profiles; a HelloTest extension is not required.

| File | What to configure |
| --- | --- |
| [settings.json](.vscode/settings.json) | Workspace editor defaults: LF line endings, final newlines, and search/watcher exclusions for generated output. Existing `hellotest.*` entries belong to an optional extension; they do not configure application services. |
| [tasks.json](.vscode/tasks.json) | Infrastructure preparation and the product/admin Vite commands. Run individual tasks with **Tasks: Run Task**. Tasks run on demand, not on opening the folder. |
| [launch.json](.vscode/launch.json) | Runtime entry points, working directories, `envFile`, HTTP/inspector ports, frontend source maps and compounds selected in **Run and Debug**. |

Put service credentials and endpoints in the ignored `.env.development.local`, not workspace settings. If you change a port, update the corresponding launch profile, Vite task/URL and API proxy or engine endpoint together. Restart affected sessions after environment changes.

### Choose the service or UI to debug

| Profile | Entry point / source | HTTP port | Inspector / prerequisites |
| --- | --- | --- | --- |
| **Backend API** | [Platform server](services/platform/backend/src/server.js), loading capability routes | 3000 | Loopback 9230; prepares PostgreSQL and MinIO before launch |
| **Test Engine** | [Engine server](testengine/backend/src/server.ts) | 4301 | Loopback 9231; API ready, matching secret; Playwright for browser execution |
| **Mobile Engine** | [Native provider](local-run/mobile-engine/src/server.js) | 4312 | Loopback 9232; configured Appium, driver and device for native execution |
| **Frontend** | [Product shell](services/platform/frontend/src) and capability frontend sources | 5173 | Starts Vite and opens Chrome; API ready for requests |
| **Admin Frontend** | [Administration UI](services/platform/frontend/admin) | 5174 (`/admin/`) | Starts admin Vite and opens Chrome; API ready for requests |
| **Node Test (Current File)** | Active JavaScript Node test | — | Runs once at repository root with `NODE_ENV=test` |
| **TypeScript Test (Current File)** | Active TypeScript Node test | — | Runs once from `testengine/backend` with the `tsx` loader |

The development template sets `HELLOTEST_SERVICE_PROFILE=all` and `HELLOTEST_ENABLED_CAPABILITIES=all`. Under **Backend API**, you can debug **platform, testing, manual, dashboard, automation, ai, agentic, knowledge, chatbot, integration and trace** without launching eleven API processes. Use the [source ownership table](#source-ownership-and-dependency-rules) to find the service:

- Backend: put breakpoints in `services/<owner>/backend/routes` or `services/<owner>/backend/services` and select the **Backend API** session.
- Product UI: put breakpoints in `services/<owner>/frontend` and select the **Frontend** Chrome session. Shared shell controls live in `services/platform/frontend/src`.
- For example, Chatbot's request handling is in [chatbot.routes.js](services/chatbot/backend/routes/chatbot.routes.js) and [knowledgeAssistant.service.js](services/chatbot/backend/services/knowledgeAssistant.service.js); its UI is [GroundedAssistant.tsx](services/chatbot/frontend/components/GroundedAssistant.tsx). Those use **Backend API** and **Frontend**, respectively.

Separate capability deployments select a narrower service profile and require their gateway/dependencies; see [service deployment](services/README.md) before changing the combined development topology.

**Backend API (Attach 9230)**, **Test Engine (Attach 9231)** and **Mobile Engine (Attach 9232)** connect to processes you have already started with the matching loopback inspector. They do not launch the service or provision infrastructure. Use the [terminal attach commands](docs/development/debugging.md#attach-a-debugger) for that workflow.

### Example service settings: Backend API

This is the existing **Backend API** object in `launch.json`'s `configurations` array; review or edit that object instead of replacing the whole file:

```json
{
  "name": "Backend API",
  "type": "pwa-node",
  "request": "launch",
  "cwd": "${workspaceFolder}/services/platform/backend",
  "runtimeExecutable": "node",
  "runtimeArgs": [
    "--watch",
    "--inspect=127.0.0.1:9230"
  ],
  "program": "${workspaceFolder}/services/platform/backend/src/server.js",
  "console": "integratedTerminal",
  "outputCapture": "std",
  "autoAttachChildProcesses": true,
  "skipFiles": [
    "<node_internals>/**"
  ],
  "preLaunchTask": "postgres:up",
  "envFile": "${workspaceFolder}/.env.development.local",
  "env": {
    "NODE_ENV": "development",
    "PORT": "3000"
  }
}
```

`program` starts the shared API runtime, `cwd` resolves backend resources, and `envFile` supplies database/provider settings. `env.PORT` sets the HTTP listener independently of the inspector in `runtimeArgs`. `autoAttachChildProcesses` keeps the debugger connected through Node watch restarts. `preLaunchTask` runs `minio:prepare` followed by `postgres:up`; despite its name, the latter starts both PostgreSQL and MinIO.

### 1. Start the API and confirm readiness

Stop any previous Docker or host application instance using ports 3000, 4301, 5173 or 5174 before selecting this workflow. The complete stack and development infrastructure can also share container names; inspect existing containers before switching. For a root-managed local stack, `./hellotest.sh down --stack local` preserves its named volumes.

1. Open **Run and Debug** in VS Code (`Ctrl+Shift+D`, or `Cmd+Shift+D` on macOS).
2. Select **Backend API** and press **F5** / **Start Debugging**.
3. Watch the Tasks terminal: `minio:prepare` prepares the pinned source image, then `postgres:up` starts **PostgreSQL and MinIO** and waits for their health checks. The first MinIO build needs network access and may take several minutes; later launches reuse the image. The historical task name `postgres:up` now covers both services.
4. Watch the API terminal for initialization and its listener on port 3000. Compose initializes the base schema on a fresh PostgreSQL volume; the local `migrate` schema mode applies runtime compatibility updates. Do not interrupt startup with a breakpoint until the baseline is ready.
5. In a separate terminal, verify both endpoints:

```sh
curl -i --max-time 5 http://localhost:3000/health/live
curl -i --max-time 5 http://localhost:3000/health/ready
```

**Checkpoint:** both return HTTP 200. If readiness fails, inspect the API startup error and database configuration before launching more components. The task does not start Redis, Tika, monitoring, LLMs or Appium. Optional providers can appear degraded; use the complete Docker workflow when investigating those integrations.

Select **Admin Frontend** and start another debug session. VS Code starts Vite on `http://localhost:5174/admin/` and opens Chrome. On a fresh database with unchanged template credentials, sign in with `admin` / `admin`, then replace the password in **Security**. Existing users/passwords are preserved. Install only the sample modules you need from **Administration → Instance setup**, or create your own development project through the workspace.

### 2. Example: debug a Projects request

Keep the API session running. Select **Frontend**, start it, and sign in at `http://localhost:5173`. Product login uses an **email address**: the bootstrap account is `bootstrap.admin@hellotest.local`, with the password you set in Administration. The administration and product UIs use separate browser session namespaces. This profile starts Vite with a strict port: if 5173 is occupied, fix the duplicate process instead of browsing an automatically changed port.

Trace the Projects read flow without modifying project data:

1. Open [ProjectsPage.tsx](services/platform/frontend/pages/ProjectsPage.tsx) and place a breakpoint on the `api.projects.catalog({ signal })` query function. Open [api.client.ts](services/platform/frontend/api.client.ts) and locate `projects.catalog` to see its `/projects/catalog?projection=summary` route.
2. In [projects.routes.js](services/platform/backend/routes/projects.routes.js), place a breakpoint inside `fastify.get("/projects/catalog", ...)`, after authentication. In [project.service.js](services/platform/backend/services/project.service.js), place one inside `getProjectCatalog`.
3. Open the workspace **Projects** view. Reload that view if an existing query cache prevents a new request. Chrome DevTools → **Network** should show `/api/projects/catalog?projection=summary` when using the default Vite proxy.
4. At the frontend breakpoint, inspect the query arguments. Press **Continue** to let the request reach the API. At the API breakpoint inspect `req.id`, `req.query.projection` and the authenticated user's ID; do not copy session tokens or credentials.
5. Use **Step Into** to enter the service or **Continue** to its breakpoint. Inspect the projection, scope and result, then continue so the response completes. Keep pauses short because request deadlines still run.
6. Confirm the Network response is successful and the view displays the returned projects. An empty catalog on a fresh workspace can be valid. Capture the response `X-Request-ID` / `X-Trace-ID` when investigating an error.

**Checkpoint:** a UI action stops in both frontend and API source, then completes successfully. Use **Call Stack** to select the right debug session; **Step Over** advances within it and **Continue** resumes it. Enable **Uncaught Exceptions** in the Breakpoints pane for an unexpected crash; enabling caught exceptions may pause on normal rejection paths.

If a breakpoint stays hollow, follow the [breakpoint troubleshooting steps](docs/development/debugging.md#breakpoint-and-task-troubleshooting). Capability frontend sources live under `services/<owner>/frontend`, outside the shell's `src`; edit the TypeScript/TSX source rather than generated `dist` files.

### 3. Debug executions and optional native providers

For API/Web automation, keep the API running and launch **Test Engine**. The template enables development queue polling every second and makes unavailable queue configuration affect engine readiness:

```sh
curl -i --max-time 5 http://localhost:4301/health/ready
```

**Checkpoint:** readiness succeeds after a successful API connection. Configure the product's TestEngine integration with `http://localhost:4301` and the matching service secret. Use a small case against a development target, set the intended run configuration/data, and create a run. Break in `executeQueuedJob` in [queueWorker.ts](testengine/backend/src/lib/queueWorker.ts), then follow the API/Web adapter. Verify the saved result and configured evidence in the product after resuming. Queue execution and direct engine requests follow different entry points; see the [execution diagnosis guide](docs/development/debugging.md#diagnose-a-queued-execution).

Pausing the worker does not stop lease expiry or other workers. Use only your isolated development queue; inspect job state before retrying. A unit test is a better place for a long pause while investigating a lease-sensitive function.

For Android/iOS, configure Appium, its platform driver, the device/simulator and application first, then launch **Mobile Engine**. The template requires reachable provider readiness. Inspect `http://localhost:4312/health/ready`, then run a case with the matching platform/device configuration. Starting this profile does not install Appium or create a device. Use the [native setup instructions](#host-testengine-and-native-worker) and [local recorder guide](local-run/RECORDER_LOCAL_SETUP.md) when relevant.

Once individual processes work, stop those debug sessions and select **Full Stack Debug** to launch API + TestEngine + product UI together, or **API + Test Engine Debug** for backend work. Compounds start their application sessions concurrently, so a frontend/worker may briefly report API unavailability during startup. Recheck readiness before reproducing a failure. Admin UI and native workers remain separately selectable.

### 4. Debug a focused test

1. Open the actual Node test file in the editor, such as [httpBoundaryRecovery.test.js](services/platform/backend/test/httpBoundaryRecovery.test.js).
2. Set a breakpoint in the test or the code it calls.
3. Select **Node Test (Current File)** and start debugging. It runs the active file once using Node's test runner with `NODE_ENV=test`.
4. Use **TypeScript Test (Current File)** for a TypeScript Node test needing the TestEngine's `tsx` loader. Tests that import `dist` require `npm run build:testengine` first. The profile's working directory is `testengine/backend`; the JavaScript profile uses the repository root.

These profiles do not provision a database or run a browser fixture harness. They load the local development environment: inspect a selected integration test's requirements before running it. PostgreSQL integration tests require a separate disposable database and explicit opt-in flags, described in [tests and verification](#tests-and-verification).

### 5. Stop and restart the debugging environment

Stop the debug session with **Stop** (`Shift+F5`). Stopping a compound stops its application debug sessions. Node watch mode restarts processes on source changes; restart a session after changing its environment file.

Vite background tasks and Docker infrastructure have separate lifecycles. Run **Tasks: Terminate Task** for `frontend:dev` / `frontend:admin:dev` when finished. After stopping the API/worker, use **Tasks: Run Task → debug:infra:stop** to stop PostgreSQL and MinIO while retaining their volumes. Do not use volume deletion as routine cleanup.

Continue with the [implementation rules](#source-ownership-and-dependency-rules), run the applicable [verification checks](#tests-and-verification), and follow the [review standards](#repository-hygiene-and-review) before handing off your change.

## Choose one local workflow

### Prepare MinIO for direct Compose

The default MinIO image is built locally from the pinned [official source release](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z), following upstream's container-build guidance. The root launcher prepares `hellotest/minio:RELEASE.2025-10-15T17-29-55Z` automatically when absent. The first build requires a running Docker daemon, network access for source/dependencies/base images, available CPU/memory and several minutes. Later starts reuse the local image.

When invoking Compose directly, prepare the image first from the repository root:

```sh
npm run build:minio
```

The helper reuses the default local image if present and skips source building for a custom `MINIO_IMAGE`. No override is required for the default. If an existing shell or selected environment file pins the withdrawn Quay/Docker Hub image, remove that override or set `MINIO_IMAGE=hellotest/minio:RELEASE.2025-10-15T17-29-55Z`. A private mirror is supported when you intentionally supply its image reference and access. Logging into the registry does not restore a withdrawn public image. This change preserves MinIO credentials and data volumes; it is not a data reset.

`npm run build:minio -- --offline` requires the default image to exist locally and fails with preparation instructions if it is missing. The launcher's `--skip-image-pull` uses this mode, so it cannot trigger a source download. Prepare the image while connected before using that option.

### Frontend against the Docker stack

```sh
./hellotest.sh up --build --stack local
npm --prefix services/platform/frontend run dev -- --host localhost --strictPort
```

Open `http://localhost:5173`. For administration UI work, start a separate terminal with `npm --prefix services/platform/frontend run dev:admin -- --host localhost --strictPort` and open `http://localhost:5174/admin/`.

Vite proxies `/api` to `http://localhost:3000`. Set `VITE_DEV_API_PROXY_TARGET` in Vite's process environment before starting it to change that target; the Vite config reads `process.env` directly. The client resolves its API base from `window.__HELLOTEST_CONFIG__.API_BASE_URL`, then `VITE_API_BASE_URL`, then `/api`. The checked-in [browser runtime configuration](services/platform/frontend/public/runtime-config.js) supplies `/api`, which takes priority over the direct origin in the [frontend environment example](services/platform/frontend/.env.example). Check the actual Network request before changing either setting. Keep provider secrets out of every `VITE_*` variable and browser runtime configuration.

Do not start a host API on port 3000 while the Docker API owns that port. If you need both topologies, assign separate ports, databases, credentials and worker queues explicitly.

### Host API with local infrastructure

Create the ignored root `.env.development.local` from [development.env.example](docs/development/development.env.example), as described in [private development configuration](#private-development-configuration). If that file exists, review and merge changes instead of overwriting it. This keeps Compose initializer credentials, API credentials and engine secrets consistent.

For terminal-only development, prepare the configured MinIO image and start infrastructure with the same environment file:

```sh
MINIO_IMAGE="$(docker compose --env-file .env.development.local -f services/platform/backend/docker-compose.yml config --images minio)" npm run build:minio
docker compose --env-file .env.development.local -f services/platform/backend/docker-compose.yml up -d --wait postgres minio
node --env-file=.env.development.local --watch services/platform/backend/src/server.js
```

The backend Compose file publishes PostgreSQL on 5432 and MinIO on 9000/9001 on host interfaces. Its Redis service is internal to the Compose network; starting it does not publish a host Redis endpoint. The host API can operate with the optional cache unavailable. To exercise Redis behavior, configure a reachable local `REDIS_URL` or use the complete Docker stack.

The API listens on 3000 by default. Neither the API nor the engine implicitly loads `.env`; shell environment variables take precedence over Node's `--env-file` values. The supplied environment template is for host processes plus infrastructure only: its `localhost` endpoints are unsuitable for application containers. Do not copy another developer's private configuration.

On an empty Compose PostgreSQL volume, the mounted SQL initializes the base schema; the API's `migrate` mode applies compatibility updates and initializes the bootstrap administrator. An externally provisioned empty database needs the [migration command](#schema-and-capability-releases) first. With unchanged local defaults, Administration accepts `admin` / `admin` and requires password replacement. Product sign-in uses the bootstrap email `bootstrap.admin@hellotest.local` and that account's current password. Existing users are preserved. Production bootstrap is disabled by the raw runtime default; when explicitly enabled, it requires a non-default identity and a strong one-time password. Stack Compose files can override these settings: inspect the selected file, not an unrelated stack's example. Sample accounts are not a reliable login contract.

Samples are optional and installed through Administration → Instance setup, or queued by `HELLOTEST_INSTANCE_SETUP_MODULES=all` / a comma-separated module selection. Sample setup is durable and retryable; it is not a reason to recreate the database.

### Host TestEngine and native worker

After the API is running, open another terminal:

```sh
cd testengine/backend
HELLOTEST_API_BASE_URL=http://localhost:3000 \
ARTIFACT_ROOT=../../local-run/artifacts \
TESTENGINE_POLL_INTERVAL_MS=1000 \
node --env-file=../../.env.development.local --import tsx --watch src/server.ts
```

The engine listens on 4301. The shared secret must match the API's TestEngine secret. In HelloTest's TestEngine integration, use the engine URL reachable from the API process. Host processes can use `http://localhost:4301`; containers need their Compose service name or a configured host gateway. The browser-facing live-view URL must also be reachable from the browser.

The queue worker starts polling when `HELLOTEST_API_BASE_URL` is configured. Its unconfigured default poll interval is five minutes; the example reduces it for local work. `TESTENGINE_WORKER_CLASS=api`, `web` or `android` restricts the leased orchestration class. With no class restriction, the worker is hybrid. The `android` pool also coordinates iOS; the authored step platform remains distinct. `TESTENGINE_QUEUE_REQUIRED=true` makes unavailable queue configuration affect readiness. Point debugging workers only at your intended development queue.

For Android/iOS work, start the provider in another terminal:

```sh
cd local-run/mobile-engine
APPIUM_SERVER_URL=http://localhost:4723 \
MOBILE_REQUIRE_PROVIDER_READY=true \
node --env-file=../../.env.development.local --watch src/server.js
```

The mobile worker listens on 4312. Set `MOBILE_ENGINE_URL=http://localhost:4312` in the **TestEngine** environment and restart it; both processes need the same `MOBILE_ENGINE_SHARED_SECRET`. Appium itself, the appropriate driver and the target device/simulator are separate prerequisites. Android uses UiAutomator2; iOS uses XCUITest and needs a compatible macOS/Appium host or remote provider. Configure the application and device in the test configuration. Native provider readiness is optional by default; the example enables it so a missing Appium server is visible at `/health/ready`.

A running worker does not establish that a browser, device or target application can execute a case. Verify a small representative run and its saved results. The [automation workflow](docs/architecture/automation-workflow.md) describes current runtime and evidence limits.

## Configuration ownership

| Setting | Meaning and implementation |
| --- | --- |
| `PORT`, `APP_MODE`, `DATABASE_URL` or `PG*` | API listener and database in [config.js](services/platform/backend/src/config.js) |
| `OBS_DATABASE_URL` | Optional separate pool credentials for the **same host/database**; a physically separate database is rejected |
| `SESSION_SECRET`, bootstrap settings | Authentication and [runtime secret policy](services/platform/backend/src/security/runtimeSecrets.js) |
| `HELLOTEST_SERVICE_PROFILE` | API route/worker owner; `all` is the combined default |
| `HELLOTEST_ENABLED_CAPABILITIES` | Deployment ceiling applied to profiles, features and permissions |
| `HELLOTEST_SCHEMA_MODE` | `migrate` for compatible single-process startup; `verify` after a separate migration job |
| `HTTP_*`, `API_STARTUP_TIMEOUT_MS` | Bounded admission, body and timeout limits in [httpConfig.js](services/platform/backend/src/runtime/httpConfig.js) |
| `MINIO_IMAGE` | Optional deployment image override; the default local source build is prepared by [build:minio](scripts/build/minio.sh) |
| `REDIS_URL`, `MINIO_*`, `KNOWLEDGE_*` | Cache, evidence and document/vector providers; see [config.js](services/platform/backend/src/config.js) |
| `LOG_LEVEL`, `SLOW_REQUEST_LOG_MS`, `NOISY_REQUEST_LOG_SAMPLE_RATE` | Structured logging and completion-log sampling |
| `ENABLE_OBSERVABILITY`, `OTEL_EXPORTER_OTLP_ENDPOINT` | Trace export; correlation IDs alone do not guarantee exported spans |
| `HELLOTEST_API_BASE_URL`, `TESTENGINE_SHARED_SECRET` | Worker-to-API queue/authentication contract |
| `TESTENGINE_WORKER_CLASS`, `TESTENGINE_POLL_*` | Queue selection and bounded concurrency |
| `MOBILE_ENGINE_URL`, `MOBILE_ENGINE_SHARED_SECRET` | TestEngine-to-mobile connection |

Use the nearest checked-in configuration as the source of truth. `hellotest.sh config` creates a resolved, private `.hellotest/<stack>.env`; its normal terminal output redacts secrets. It is a configuration write, not a dry run. Never include unredacted resolved configuration in an issue or PR.

The root launcher, host debugger and Vite have separate configuration loaders. The launcher manages `.hellotest/<stack>.env`; VS Code Node launches read `.env.development.local` and apply profile-specific `env` values; terminal Node launches require `--env-file`; Vite uses its own environment/runtime configuration. Keep values literal in the shared development file, because Compose, Node and the debugger do not share identical expansion rules. Existing shell `DATABASE_URL`/`POSTGRES_URL` values override the API's `PG*` settings even when those fields came from a file. Changing a file requires a process restart or container recreation as appropriate.

<a id="1-architecture-and-current-limits"></a>
<a id="2-repository-map"></a>
<a id="3-find-the-owner-of-a-feature"></a>
<a id="4-request-ai-and-execution-flows"></a>
<a id="enforced-dependency-boundaries"></a>

## Source ownership and dependency rules

| Owner | Scope |
| --- | --- |
| Platform | Auth, projects, administration, settings, shell and shared runtime adapters |
| Testing | Cases, suites, groups/shared steps, data, environments, configurations, runs, results and defects |
| Manual | Stories, planning, releases and work-item relationships |
| Dashboard | Analytics, Release Readiness and Custom Dashboard |
| Automation | Code authoring, recording, build agent orchestration and engine dispatch/callbacks |
| AI | Story/case/defect assistance, assurance and impact analysis |
| Agentic | Agent workflows, repository analysis and inspection |
| Knowledge | Source ingestion, search, retrieval and grounding |
| Chatbot | Conversations, intent, answers and citations |
| Integration | Provider configuration, prompt templates and external synchronization |
| Trace | Operational telemetry, provider health and monitoring gateways |

Feature source and tests live in `services/<owner>`. Shared runtime code lives in `services/platform/backend/src`; shared controls live in `services/platform/frontend/src/shared`. Workspace composition may connect multiple owners. The compatibility API facade is [src/lib/api.ts](services/platform/frontend/src/lib/api.ts); focused new code should import the owning `api.client.ts` instead of eagerly loading every feature client.

```text
route: validate input + authenticate + authorize
  → application service: coordinate one use case
    → pure domain policy
    → explicit repository/provider collaborator
      → PostgreSQL, storage, engine or external service
```

Cross-owner imports must use an explicit `@hellotest/<owner>/<export>` and a declared package dependency. Do not reach into another owner's private files with relative paths. Routes must not become persistence layers, and shared UI must not import feature policy. Use Platform's public project/application access contracts when crossing that boundary. Keep dynamic imports, route manifests, worker registration and capability entry points visible to the architecture checks.

Apply SOLID with concrete boundaries: isolate transport from business decisions; extend an existing provider contract; preserve each adapter's result, cancellation and error behavior; pass narrow collaborators instead of a universal client. Extract cohesive policies and repeated behavior where it improves testing or ownership. A wrapper, extra network hop or new registry needs an actual requirement. Preserve valid product relationships instead of copying implementations to hide dependencies.

Capability profiles select processes and routes. Packages still share runtime adapters, database schemas and some exported implementation services. They are private monorepo workspaces, not independently installable products with fully isolated data. See [implementation boundaries](docs/architecture/implementation-boundaries.md) and [capability packaging](docs/architecture/capability-packaging.md).

<a id="6-how-to-implement-a-change"></a>

Large automation authoring and execution screens still contain substantial orchestration, and the builder retains browser/provider coordination. Current extractions isolate transport/error policy, request reuse, mobile recording plans and transactional persistence; they do not claim a complete decomposition of every feature. The [refactor assessment](docs/architecture/refactor-review.md) records the folder review, implemented boundaries and remaining work. Prefer further incremental changes with behavior and resource-use evidence.

### Change a route or workflow

1. Find its owner through `frontend/api.client.ts`, `frontend/index.ts`, `backend/service.manifest.js` and its route handler.
2. Authenticate and authorize each referenced source before loading its content; a submitted project ID does not prove access.
3. Keep orchestration with the owner of the persisted artifact, even when the action calls an LLM.
4. Validate external/model output before persistence. Preserve source IDs and reject fabricated citations or unsupported runtime changes.
5. Update OpenAPI, types, permissions, feature ownership, worker declarations and gateways when their contracts change.
6. Test observable behavior, including a meaningful failure/denial path and the actual cache or persistence boundary affected.

For frontend changes, reuse shared controls/tokens; preserve loading, empty, unavailable and retry states. Scope query keys and caches by user/project/application as appropriate. Do not fetch denied or unopened feature data. Keep user drafts through recoverable failures, and invalidate changed records after successful writes.

<a id="9-resource-use-failures-and-security"></a>

## Performance, errors and logging

Measure before and after a performance refactor. Bound result sets, concurrency, provider responses, buffers and cache cardinality. Prefer batching and paginated queries over one lookup per record. Use existing streaming helpers for artifacts. Preserve ordering and atomicity when changing sequential work to concurrency.

Pass cancellation through the transport and provider layers. A shared request must not be cancelled by an unrelated observer. Use deadlines and retry classification; retries of mutations need idempotency or a durable lease. Do not combine browser, API and provider retries into an unbounded loop. Optional LLM, storage or telemetry outages must produce accurate degraded behavior without falsely reporting success.

The API error handler translates known domain/provider/database errors to a public code, message, request/trace IDs and retryability. Use explicit `statusCode`/stable error codes for expected rejection and [ServiceBoundaryError](services/platform/backend/src/utils/serviceErrors.js) for provider failures; do not depend on error-message substring classification in new code. Generic server errors must not expose SQL, credentials, private paths or upstream response bodies. Preserve causes for redacted server diagnosis. A revision conflict remains 409 and should preserve the user's draft rather than silently overwriting another edit.

Use structured fields and stable event names, not stringified request objects. The shared API logger and error sanitizer redact known secrets, but redaction is not permission to log arbitrary payloads. Never log tokens, cookies, provider headers, database URLs with credentials, private prompts, test-data values or screenshot/video bytes. Correlate with request/trace/job IDs and bounded metadata. See the [logging runbook](docs/development/debugging.md#follow-a-request-and-its-error) for fields and searches.

Saved web/mobile automation executes in the worker process through `AsyncFunction`; it is trusted code, not a sandbox for arbitrary untrusted authors. Limit worker OS privileges, network access and credentials to the target environment. MCP inspection destination policy is a separate boundary and does not restrict every request an authored script can make.

Fatal process failures must drain resources and exit; do not swallow an uncaught exception and continue serving. Recurring tasks register in the owner's `backend/workers.js`; the runtime guards overlap and drains work. Durable job claims, leases, heartbeats and conditional terminal transitions provide multi-process correctness. A process-local boolean is not a distributed lock.

<a id="11-select-customer-capabilities-and-debug-boundaries"></a>
<a id="12-develop-and-release-one-capability"></a>

## Schema and capability releases

Keep the [canonical schema](services/platform/backend/instance-setup-data/schema-setup/schema.sql), runtime compatibility bootstrap and schema receipts consistent. Plan rolling compatibility before changing a shared table. In separated-profile deployments, run the one-shot migration before APIs start in verification mode:

```sh
node --env-file=.env.development.local services/platform/backend/src/migrate.js
```

Only run a migration against the intended database. Bootstrap SQL mounted into PostgreSQL executes on an empty data directory; restarting an existing volume does not rerun it. Do not instruct contributors to delete volumes to apply a schema change.

Optional setup records live in [instance-setup-data](services/platform/backend/instance-setup-data). Update manifest checksums when records change and keep source relationships, portable exports, knowledge offsets and hashes coherent. Follow its [dataset guide](services/platform/backend/instance-setup-data/README.md).

Inspect a selected deployment without changing containers:

```sh
npm run services:up -- --capabilities automation --print
```

To develop one capability using its existing runtime:

```sh
npm run dev --workspace @hellotest/dashboard
# Separate terminal with the intended database/session environment loaded:
npm run dev:api --workspace @hellotest/dashboard
npm test --workspace @hellotest/dashboard
npm run build --workspace @hellotest/dashboard
```

The `dev` command uses the shared Vite shell; `dev:api` selects that API profile. It does not start all dependent APIs or change the frontend endpoint map automatically. Use the selected Compose topology for integrated multi-profile development. Capability metadata originates in `services/<owner>/package.json#hellotest`; regenerate it with `npm run generate:capabilities` and keep [catalog.json](services/catalog.json) aligned.

Compatible capability releases can supply their own UI assets through the gateway. Preserve protocol/export props and API compatibility; retain existing hashed assets during rolling deployment. New shell menus or extension points require a shell release. Follow [capability packaging](docs/architecture/capability-packaging.md).

<a id="7-verification-matrix"></a>

## Tests and verification

Start with checks that cover the changed behavior, then run the broader gates appropriate to its scope.

| Command | Scope |
| --- | --- |
| `npm run doctor` | Local tooling/dependency presence; no live service probes |
| `npm run test:backend` | Central and capability-owned direct backend test directories |
| `npm run test:frontend` | Central and capability-owned direct frontend test directories |
| `npm run test:testengine` | Engine TypeScript build and direct engine tests |
| `npm --prefix local-run/mobile-engine test` | Native worker tests; separate from root `npm test` |
| `npm test --workspace @hellotest/testing` | Owner tests plus central contracts that reference that owner |
| `npm run build` | Workspace/admin builds and TestEngine compilation |
| `npm run build:capabilities` | Independent capability UI assets |
| `npm run check:boundaries` | Declared package exports/dependencies and forbidden import directions |
| `npm run audit:modules` | Resolution, reachability, cycles and disconnected source/CSS |
| `npm run audit:source-layout` | Ownership, generated-source policy and documentation links |
| `npm run validate:architecture` | Catalog/profile/deployment consistency |
| `npm run test:architecture` | Metadata parity and architecture-check regression tests |
| `npm run audit:clones` | Advisory function duplication report |
| `npm --prefix services/platform/frontend run check:previews` | Preview fixture types |

`npm test` combines backend, frontend, engine and architecture/layout gates; it does not include native worker tests, browser fixture directories or nested PostgreSQL integration suites. Successful compilation is not an end-to-end run.

Focused examples:

```sh
node --test services/platform/backend/test/httpBoundaryRecovery.test.js
node --test services/testing/test/backend/executionHookSnapshots.test.js
node --test services/testing/test/frontend/executionHookResults.test.mjs
npm --prefix testengine/backend run build
node --test testengine/backend/test/queueHooks.test.mjs
```

### Browser fixtures

Start Vite separately. Read each fixture's environment variables; most use `VITE_TEST_URL`, while some use `BROWSER_TEST_BASE_URL` and another port. Run fixtures sequentially because creating temporary HTML/TSX can reload other tabs:

```sh
VITE_TEST_URL=http://127.0.0.1:5173 \
node --test --test-concurrency=1 services/testing/test/browser/runStepViews.test.mjs
```

`CHROME_EXECUTABLE` can select an installed browser; `PLAYWRIGHT_MODULE` is supported by applicable tests. Fixtures must clean up files and close browsers on failure. Mocked browser fixtures verify interaction/layout; they do not establish real API, model or device connectivity. See the [browser test guide](services/platform/frontend/test/browser/README.md).

### PostgreSQL and provider checks

Nested tests under `services/platform/backend/test/integration` require their own opt-in flags and disposable database naming guards. Read the selected test before enabling it. For example, `runDataJourney.postgres.test.js` requires `RUN_DATA_POSTGRES=1` and an **empty**, separately provisioned database named `agent_verify_run_data_<suffix>`. Do not point it at your application database. Report a skipped integration suite as skipped, not passed against PostgreSQL.

`npm run test:service-gateway` and `sh scripts/checks/validate-deployment-contracts.sh` cover additional deployment contracts. `npm run ops:verify` requires an already running monitoring stack. Real browser execution, LLM/MCP actions and Android/iOS sessions require configured providers and an authorized target application; record exactly which were exercised.

<a id="8-orphans-naming-and-repository-hygiene"></a>
<a id="10-documentation-and-pull-requests"></a>

## Repository hygiene and review

Before moving/deleting a file, inspect static/dynamic imports, HTML and route manifests, worker registration, packaging scripts, tests and external callers. A static orphan report is a review lead, not proof a file is unused. Rewrite affected imports, source-inspection tests, docs and setup records; then verify Docker retains the runtime paths. Do not create compatibility copies just to satisfy an old test path.

Keep `node_modules`, builds, private environments, database dumps, logs and generated evidence out of commits. Existing `.gitignore` rules do not automatically untrack previously committed artifacts. Run `git diff --check` and inspect the actual changed files.

A reviewable PR states the concrete problem and resulting behavior, affected owner/contracts, meaningful test results, migration/deployment needs and any unverified external dependency. Distinguish measured performance from an expected improvement. State the remaining shared-database or provider limitations plainly. Documentation should describe implemented commands and behavior, with examples checked against the current scripts and runtime.

## Session, performance and refactoring checks

Keep authentication lifecycle, cache ownership, transport and domain policy separate. `AuthProvider` owns verified identity and login intent; `SessionQueryBoundary` owns private query lifecycle; capability components own their forms and domain actions. Shared infrastructure must not choose a user, project or permission on a caller's behalf. Prefer narrow ports such as the workspace scroll adapter over passing whole UI/service objects.

When changing session handling, run:

```sh
node --test services/platform/frontend/test/authRefreshIsolation.test.mjs services/platform/frontend/test/requestSessionIsolation.test.mjs services/platform/frontend/test/workspaceScroll.test.mjs
npm run test:product-ux -- --filter sessionQueryIsolation
npm run test:product-ux -- --filter workspaceDiscoveryFlow
```

Preserve foreground drafts on transient session-check failures. Test logout during a pending login, competing logins, cross-tab logout/account replacement, permission changes, and delayed old-user query completion. Never share private query data across an access revision. Signing in changes neither server authorization nor MCP delegation rules.

For performance work, record the page, data volume, viewport, network conditions, and observed timings. Use bounded page requests, lazy detail queries, shared cancellation/deadlines and serial polling. Avoid synchronous scroll-event layout reads and competing nested scroll owners. Do not trade away readiness checks, fresh permission checks or execution snapshots to improve a benchmark.

Run architecture/module audits after browser fixtures have cleaned up temporary entries. Clone reports identify candidates, not safe automatic deletions: semantically different capability callbacks may have identical syntax. Delete truly unreachable sources with their obsolete tests and imports; retain externally supported protocol contracts. Update runtime packaging and these runbooks when ownership changes.
