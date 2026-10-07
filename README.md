# HelloTest

HelloTest combines project planning, test authoring, automation, execution evidence, knowledge retrieval, and AI Agent Studio. The [agentic V2 release guide](docs/redesign-v2-2026-10/README.md) describes the imported feature baseline; current behavior and verification are recorded in the [architecture review](docs/architecture/refactor-review.md).

HelloTest is a QA workspace for stories, manual and automated cases, reusable steps, test data, suites, runs and evidence. Its React workspace and administration portal use a Fastify API. TestEngine executes structured API requests, Playwright browser automation and Android/iOS flows through a native provider.

| Your task | Start here |
| --- | --- |
| Run and administer a local application | Follow the Docker startup below |
| Set up development, debug services or contribute code | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Diagnose a failing request, build or run | [Debugging runbook](docs/development/debugging.md) |
| Plan a shared deployment or capability release | [Platform deployment](docs/PLATFORM_STACK.md), [service deployment](services/README.md), [release contracts](docs/architecture/capability-packaging.md) |

## Prerequisites and execution boundaries

Run commands from the repository root. The examples use a POSIX shell on macOS/Linux; Windows needs a compatible Docker/Linux shell environment, rather than pasting these commands into PowerShell.

| Workflow | Prerequisites |
| --- | --- |
| Docker application | Docker with a running daemon, Compose v2, a POSIX shell, Git checkout and curl; network access for initial images/source/dependencies and Docker resources for compilation |
| Default local monitoring | Docker, Compose and a POSIX shell; host Node.js/npm are not required. Enabled by the root launcher unless `HELLOTEST_OPS_ENABLED=false` |
| Source development | Node.js **22.18+**, npm and the dependencies installed by `npm run setup`; infrastructure appropriate to the feature |
| Real browser, AI or native execution | Configured target application and provider credentials; matching Playwright browser, LLM integration or Appium/device as applicable |

Runtime package manifests permit Node 20; contribution tests import TypeScript directly and require the newer development runtime. iOS execution needs a compatible macOS/Appium host or remote device provider. Starting the application does not provision a model account or physical devices. See the [automation workflow](docs/architecture/automation-workflow.md) for authoring and evidence limits.

## Start the Docker application

1. **Check the tools and Docker daemon.** These commands should succeed before you start the stack:

   ```sh
   docker --version
   docker compose version
   docker info --format '{{.ServerVersion}}'
   ```

   Docker application and monitoring startup do not require Node.js on the host. If you intentionally omit monitoring, prefix the startup command with `HELLOTEST_OPS_ENABLED=false`.

2. **Build and start the local stack.**

   ```sh
   ./hellotest.sh up --build --stack local
   ```

   The stack includes the application, PostgreSQL, object storage and execution services. The first run downloads and compiles dependencies; allow it to finish before investigating readiness. A monitoring warning is separate from application readiness. Do not use `--no-cache` for routine startup.

3. **Confirm readiness.** A started container alone is not the checkpoint:

   ```sh
   ./hellotest.sh status --stack local
   curl --fail --max-time 5 http://localhost:3000/health/ready
   curl --fail --max-time 5 http://localhost:4301/health/ready
   curl --fail --max-time 5 http://localhost:9000/minio/health/ready
   ```

   Expect HTTP success from the intended services. The API stays unready during initialization. `/health/live` checks process liveness; `/health/ready` checks that service's configured dependencies. A ready API does not establish LLM, device or application-under-test connectivity.

4. **Sign in and complete instance setup.** Open the administration URL below. For a **fresh local database with unchanged API defaults**, sign in with `admin` / `admin` and replace the password in **Security**. Then sign in to the product workspace with email `bootstrap.admin@hellotest.local` and the new password; the portals use separate sessions. Existing databases retain their users. Other deployment stacks use their configured bootstrap identity. Sample content is optional through **Administration → Instance setup**, or `HELLOTEST_INSTANCE_SETUP_MODULES` before API startup; it is separate from schema initialization.

| Surface | Default local URL |
| --- | --- |
| Workspace | http://localhost:8080 |
| Administration | http://localhost:8081 or http://localhost:3000/admin |
| API | http://localhost:3000 |
| TestEngine gateway | http://localhost:4301 |
| MinIO console | http://localhost:9001 |

These are local-stack defaults. The bundle binds published development ports to loopback; other stacks and explicit overrides can differ. Complete a small representative test and inspect its saved result/evidence before treating an execution provider as verified.

### MinIO on the first start

The launcher builds `hellotest/minio:RELEASE.2025-10-15T17-29-55Z` from pinned official source when the local image is absent, following [upstream container-build guidance](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z). The first build needs network access, Docker CPU/memory and several minutes; later starts reuse the image. No `MINIO_IMAGE` override is required.

Remove an obsolete Quay/Docker Hub override or set the local tag above. An intentional private-mirror override remains supported. Direct Compose users must first run `npm run build:minio`; use `sh scripts/build/minio.sh` if working without npm. `--skip-image-pull` requires the default image to be cached and does not download source. Image preparation preserves existing MinIO credentials and volumes. Registry login and volume deletion do not repair a withdrawn public image.

## Develop and verify changes

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, service debugging, engineering rules and verification. For frontend work against the running Docker API:

```sh
npm run setup
npm run doctor
npm --prefix services/platform/frontend run dev -- --host localhost --strictPort
```

The workspace dev server uses **5173** and proxies `/api` to **3000**. Start administration with `npm --prefix services/platform/frontend run dev:admin -- --host localhost --strictPort`, then open `http://localhost:5174/admin/`. These commands fail on an occupied port so you can resolve the duplicate process. Do not start a second API on port 3000 while Docker owns it. Node servers do not implicitly load `.env`; the walkthrough supplies explicit environment-loading commands.

`npm run doctor` checks local tooling, installed package manifests and workspace links without reading environment-file contents or probing live services. A passing report is the setup checkpoint, not an end-to-end test.

Before handing off a code change, run the applicable focused tests and the broader checks required by [CONTRIBUTING.md](CONTRIBUTING.md#tests-and-verification):

```sh
npm test
npm run build
npm --prefix local-run/mobile-engine test
```

Root tests include backend, frontend, TestEngine and architecture gates. Native tests are separate; browser fixtures, live PostgreSQL integrations, models and devices need their own prerequisites. Record what was exercised and what remains unverified.

### VS Code debugging

Follow the [VS Code setup and debugging section](CONTRIBUTING.md#vs-code-debugging) for the checked-in workspace settings, tasks, launch profiles and service ports. It includes a complete Backend API configuration and a step-by-step Projects request walkthrough, from the frontend breakpoint to the route and service. The same guide covers TestEngine, native execution, focused tests and stopping background tasks while retaining data.

## Topology and source ownership

`testengine/backend` is the sole supported execution worker implementation; the mobile worker supplies its native provider.

Capability profiles select API processes and routes. They share PostgreSQL, runtime adapters and some exported implementation contracts; separate processes do not provide independent databases or complete failure isolation. Saved web/native automation is trusted code executed in workers, so isolate worker privileges, credentials and network access appropriately. See [backend architecture](docs/architecture/backend.md), [implementation boundaries](docs/architecture/implementation-boundaries.md) and the [refactor assessment](docs/architecture/refactor-review.md).

| Source owner | Responsibility |
| --- | --- |
| [services/platform](services/platform) | `backend`: API composition, identity, projects, administration and shared adapters; `frontend`: workspace/admin shells and shared UI |
| [services/testing](services/testing) | Cases, shared steps, suites, test data, configurations, runs, results and defects |
| [services/manual](services/manual) | Stories, requirements, planning and work-item relationships |
| [services/dashboard](services/dashboard) | Quality analytics, release readiness and custom dashboards |
| [services/automation](services/automation) | Automation building, recording, execution dispatch and callbacks |
| [services/agentic](services/agentic) | Agent workflows, repository agents and inspection |
| [services/ai](services/ai) | Quality assistance, generation and AI review |
| [services/knowledge](services/knowledge) | Ingestion, search and grounding/context retrieval |
| [services/chatbot](services/chatbot) | Conversations, assistant answers and citations |
| [services/integration](services/integration) | Provider configuration, prompt/model selection and synchronization |
| [services/trace](services/trace) | Operational telemetry and monitoring gateways |
| [testengine/backend](testengine/backend) | API/browser/native orchestration, recording and execution evidence |
| [local-run/mobile-engine](local-run/mobile-engine) | Appium/WebdriverIO Android and iOS provider |
| [services/platform/backend/instance-setup-data](services/platform/backend/instance-setup-data) | Canonical SQL and versioned optional samples |
| [ops](ops), [scripts](scripts), [local-run](local-run) | Monitoring, build/deployment checks and local runtime wrappers |
| [services/catalog.json](services/catalog.json), [services/capabilities.json](services/capabilities.json) | Deployment/source registry and generated dependency metadata |
| [openapi.yaml](openapi.yaml) | Public API contract |

Each capability owns its `backend`, `frontend` and tests. There are no root `backend/` or `frontend/` source directories. To inspect a capability deployment without starting it:

```sh
npm run services:up -- --capabilities automation --print
```

## Diagnose and recover

Start with the affected service and preserve the request/trace/job IDs:

```sh
./hellotest.sh status --stack local
./hellotest.sh logs --stack local --tail 100 api
```

The [debugging runbook](docs/development/debugging.md) covers inspector ports, request IDs, logs, queue failures and provider health. For monitoring, use the [operations runbook](docs/ops-operations.md). Share sanitized errors and reproduction steps; omit environment files, cookies, tokens and private test data.

After correcting the cause, `./hellotest.sh restart --stack local api` restarts the API. Changed container environment settings require recreation through the appropriate `up` command. `./hellotest.sh down --stack local` stops the application and its launcher-managed monitoring without deleting named volumes. Confirm the stack/service scope before an operation; never use volume deletion as routine repair.

## Configuration, data and release handoff

Use the intended stack's configuration, not values copied from another environment. `hellotest.sh config` writes resolved settings under private `.hellotest/`; `--config <file>` supplies operator overrides. Keep these files, local environments and credentials out of commits and support reports. [CONTRIBUTING.md](CONTRIBUTING.md#configuration-ownership) identifies setting owners; the [platform guide](docs/PLATFORM_STACK.md) describes hosted bootstrap and secrets.

Before a shared deployment, assign and record these responsibilities:

- **Operator:** target stack, public/internal URLs, TLS/access controls, image/source versions and provider credentials. Local development defaults are not a hosted deployment policy.
- **Data owner:** backups and a verified restore procedure for PostgreSQL, object-storage evidence and protected configuration. A database-only backup does not include attachment bytes; preserve volumes during routine upgrades.
- **Release owner:** compatible schema/API/client changes, migration order and rollback plan. Retain older hashed UI assets during rolling releases as required by the [release contract](docs/architecture/capability-packaging.md).
- **Verifier:** readiness, sign-in/access checks and representative execution/results/evidence, with live-provider coverage and remaining gaps stated explicitly.

The bundled stack does not establish a production availability, capacity or disaster-recovery guarantee. Choose deployment/storage/monitoring arrangements and acceptance checks for the actual environment before release.

## Session isolation and responsive workspaces

Authenticated workspace data is cleared and in-flight reads are cancelled when the signed-in identity or permission profile changes. Account changes in another browser tab require server verification before the protected workspace renders. Logout invalidates pending login and refresh results. Display-name updates and transient API outages preserve open forms when identity and permissions remain valid.

Catalogs retain bounded pagination and lazy detail loading. Scroll restoration follows the document or focused workspace container, remembers at most 30 user/project route positions, and stops deferred restoration when the user interacts. Recorder telemetry uses a shared sequential poller: hidden tabs skip requests, each response has a five-second deadline, and unmount cancels pending work.

For reproducible checks run `npm run test:product-ux -- --filter sessionQueryIsolation`, `npm run test:product-ux -- --filter workspaceDiscoveryFlow`, and the checks in [CONTRIBUTING.md](CONTRIBUTING.md). These are behavior checks, not a promise of instant loading under all network or provider conditions.
