# Developer onboarding and VS Code debugging

Follow this guide to run HelloTest from source, stop at a breakpoint, make a change and prepare it for review. The recommended debugging setup runs Node and Vite on your workstation, with PostgreSQL and MinIO in Docker. Use [README.md](README.md) to operate the complete Docker stack and [CONTRIBUTING.md](CONTRIBUTING.md) for engineering standards, source ownership, migrations and release rules.

## 1. Prepare the workstation

| Requirement | Check | Purpose |
| --- | --- | --- |
| Git and repository access | `git --version` | Obtain the checkout and create a branch |
| Node.js 22.18+ with npm | `node --version` and `npm --version` | Run services and TypeScript-importing tests |
| Docker with Compose v2 or later | `docker info` and `docker compose version` | Run the database/object store; Docker must be running |
| VS Code and Chrome | Open the repository folder in VS Code | Built-in JavaScript/TypeScript and browser debugging |
| macOS/Linux, or Windows through WSL2 | Run all commands in the same environment | The supplied shell tasks require a POSIX shell |

On Windows, open the checkout in VS Code's WSL environment and use WSL Node/npm plus Docker's WSL integration. Do not mix Windows and WSL `node_modules`. Native iOS execution needs a compatible macOS device/simulator host or a remote provider; Appium is optional for ordinary API/Web development.

Clone your organization's repository URL and open its **root**, containing `package.json`, `hellotest.sh` and `.vscode`. All commands below run from this root unless a block explicitly changes directory. Use a feature branch according to your team's naming policy. Keep existing local changes when switching tasks.

The checked-in debug settings use VS Code's built-in debugger. A HelloTest extension is not required. Existing `hellotest.*` settings belong to an optional extension; review its destinations and network options before invoking that extension. They do not configure the application services.

## 2. Install the dependencies

```sh
npm run setup
npm run doctor
```

`setup` installs the API, product/admin frontend, TestEngine, native worker and capability workspace links. A root-only `npm install` does not install all runtime packages. Repeat the applicable `setup:*` command when its lockfile changes; use `npm run setup` when several runtimes changed.

**Checkpoint:** required doctor checks pass. Doctor checks tooling and installed dependencies; it does not connect to the Docker daemon, database or execution providers. A warning for missing Docker must be resolved before using the infrastructure tasks in this guide.

Install Chromium for Web execution when needed. The subshell returns you to the repository root:

```sh
(cd testengine/backend && npx playwright install chromium)
```

Linux may also need Playwright's system libraries; use the engine's documented Docker runtime when that is preferable. Browser binaries are unnecessary for a pure API execution test, but Chrome is needed for the VS Code frontend launch profile.

## 3. Create the private development configuration

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

Leave a common `PORT` out of the file: each debug profile sets its own port. VS Code server profiles read `envFile`; ordinary Node commands need `--env-file` explicitly. The Vite tasks do not load this backend file. Their default `/api` proxy already reaches port 3000, so copying a frontend environment file is unnecessary. See [configuration ownership](CONTRIBUTING.md#configuration-ownership) before overriding endpoints.

Start VS Code from a terminal without stale application environment overrides. Shell values can override Compose and Node `--env-file` settings; `DATABASE_URL` or `POSTGRES_URL` overrides `PG*` configuration. Do not print a complete resolved environment into a bug report.

An existing PostgreSQL volume retains its original users/passwords. Editing this file does not rotate them or reset the administrator. Use the matching existing credentials or an intentional database administration procedure. The backend development Compose file publishes 5432/9000/9001 on host interfaces; use this configuration on a private workstation with appropriate network controls. Inspector ports in the checked-in profiles bind only to loopback.

## 4. Start the API and confirm readiness

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

## 5. Start the product UI and trace one request

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

## 6. Debug executions and optional native providers

For API/Web automation, keep the API running and launch **Test Engine**. The template enables development queue polling every second and makes unavailable queue configuration affect engine readiness:

```sh
curl -i --max-time 5 http://localhost:4301/health/ready
```

**Checkpoint:** readiness succeeds after a successful API connection. Configure the product's TestEngine integration with `http://localhost:4301` and the matching service secret. Use a small case against a development target, set the intended run configuration/data, and create a run. Break in `executeQueuedJob` in [queueWorker.ts](testengine/backend/src/lib/queueWorker.ts), then follow the API/Web adapter. Verify the saved result and configured evidence in the product after resuming. Queue execution and direct engine requests follow different entry points; see the [execution diagnosis guide](docs/development/debugging.md#diagnose-a-queued-execution).

Pausing the worker does not stop lease expiry or other workers. Use only your isolated development queue; inspect job state before retrying. A unit test is a better place for a long pause while investigating a lease-sensitive function.

For Android/iOS, configure Appium, its platform driver, the device/simulator and application first, then launch **Mobile Engine**. The template requires reachable provider readiness. Inspect `http://localhost:4312/health/ready`, then run a case with the matching platform/device configuration. Starting this profile does not install Appium or create a device. Use the [native setup instructions](CONTRIBUTING.md#host-testengine-and-native-worker) and [local recorder guide](local-run/RECORDER_LOCAL_SETUP.md) when relevant.

Once individual processes work, stop those debug sessions and select **Full Stack Debug** to launch API + TestEngine + product UI together, or **API + Test Engine Debug** for backend work. Compounds start their application sessions concurrently, so a frontend/worker may briefly report API unavailability during startup. Recheck readiness before reproducing a failure. Admin UI and native workers remain separately selectable.

## 7. Implement and test a change

Find the owning capability in [source ownership](CONTRIBUTING.md#source-ownership-and-dependency-rules). Keep request validation/authorization in the route, orchestration in the service and reusable policy in focused modules. Preserve existing contracts, error codes, cancellation, permissions and evidence handling. Add a behavior test when the change merits one; avoid tests that only restate the implementation.

For a focused test with a breakpoint:

1. Open the actual Node test file in the editor, such as [httpBoundaryRecovery.test.js](services/platform/backend/test/httpBoundaryRecovery.test.js).
2. Set a breakpoint in the test or the code it calls.
3. Select **Node Test (Current File)** and start debugging. It runs the active file once using Node's test runner with `NODE_ENV=test`.
4. Use **TypeScript Test (Current File)** for a TypeScript Node test needing the TestEngine's `tsx` loader. Tests that import `dist` require `npm run build:testengine` first. The profile's working directory is `testengine/backend`; the JavaScript profile uses the repository root.

These profiles do not provision a database or run a browser fixture harness. They load the local development environment: inspect a selected integration test's requirements before running it. PostgreSQL integration tests require a separate disposable database and explicit opt-in flags, described in [tests and verification](CONTRIBUTING.md#tests-and-verification).

Run the checks for your change, for example:

```sh
node --test services/platform/backend/test/httpBoundaryRecovery.test.js
npm run test:frontend
npm run check:boundaries
git diff --check
```

For changes across the application, run `npm test` and `npm run build`; for native changes also run `npm --prefix local-run/mobile-engine test`. Root tests do not automatically exercise nested browser/PostgreSQL suites or real external providers. The [verification matrix](CONTRIBUTING.md#tests-and-verification) lists scope and additional gates.

## 8. Stop, restart and hand off

Stop the debug session with **Stop** (`Shift+F5`). Stopping a compound stops its application debug sessions. Node watch mode restarts processes on source changes; restart a session after changing its environment file.

Vite background tasks and Docker infrastructure have separate lifecycles. Run **Tasks: Terminate Task** for `frontend:dev` / `frontend:admin:dev` when finished. After stopping the API/worker, use **Tasks: Run Task → debug:infra:stop** to stop PostgreSQL and MinIO while retaining their volumes. Do not use volume deletion as routine cleanup.

Before opening a pull request, review the diff, run the applicable checks and update relevant docs/configuration examples. State the problem, resulting behavior, owner/contracts affected, tests actually run, migration/rollback needs and any unverified browser/LLM/device behavior. Include sanitized request/trace/job IDs for defects. Follow the [review standards](CONTRIBUTING.md#repository-hygiene-and-review); do not commit private environments, generated evidence or logs.

For failed startup, missing breakpoints, API errors or stuck runs, use the [debugging runbook](docs/development/debugging.md). It includes a terminal-only attach workflow, request/log correlation and recovery steps that preserve data.
