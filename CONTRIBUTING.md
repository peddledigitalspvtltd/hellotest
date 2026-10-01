# Engineering contribution guide

Use [CONTRIBUTE.md](CONTRIBUTE.md) for the numbered first-day setup and VS Code walkthrough. This reference covers terminal workflows, configuration ownership, architecture, implementation standards, verification and review. For operating the application, start with [README.md](README.md); for an incident or failed debug session, use the [debugging runbook](docs/development/debugging.md).

<a id="5-prerequisites-and-first-setup"></a>

## Prerequisites and dependency installation

Use Node.js **22.18+** for development. Package engines permit Node 20, but frontend tests import TypeScript directly using Node's native support. Use npm and Docker with Compose v2. Python is required for applicable agent tools and packaging; an Appium server and devices are required only for native execution.

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

Create the ignored root `.env.development.local` from [development.env.example](docs/development/development.env.example), as described in [the configuration walkthrough](CONTRIBUTE.md#3-create-the-private-development-configuration). If that file exists, review and merge changes instead of overwriting it. This keeps Compose initializer credentials, API credentials and engine secrets consistent.

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
