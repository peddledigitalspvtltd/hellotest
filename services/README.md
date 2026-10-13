# HelloTest service catalog

`catalog.json` records deployable components and source ownership. Each `services/<owner>/package.json` defines an npm workspace package. Its `hellotest` metadata generates `capabilities.json` (API names, required foundations and feature ownership); runtime profiles and route loading derive from it. Each API profile has a source root under `services/<profile>/backend`, with feature routes and use cases colocated there; composition and infrastructure adapters remain under `services/platform/backend` during the strangler migration. Each bounded route profile can run in its own container and scale independently.

For the customer-selectable product decision, target dependency diagram and current deployment limits, read [capability packaging](../docs/architecture/capability-packaging.md). Feature UI now lives beside its backend under `services/<profile>/frontend` and `services/<profile>/backend`.

## Local setup

From the repository root:

```bash
npm run setup
npm run audit:source-layout
npm run validate:architecture
```

`setup` installs the shared API/frontend runtimes, TestEngine, mobile worker and root npm workspace links. Use `npm run build --workspace @hellotest/dashboard`, `npm test --workspace @hellotest/dashboard` and `npm start --workspace @hellotest/dashboard` for one capability. Start commands require the configured shared infrastructure.

## Run profiles independently

```bash
npm run services:up -- --capabilities automation --print
npm run services:up -- --capabilities automation --build
npm run services:up -- --capabilities knowledge --build
```

The selector expands required foundations from `capabilities.json` and sets a deployment ceiling enforced by API registration, workers and feature policy. It never removes existing containers or data. For a single owner in an existing environment, use `docker compose -f docker-compose.microservices.yml up --build <owner>-api`.

The backend Dockerfile builds the selected capability UI with `--build-arg HELLOTEST_CAPABILITY=<owner>` and defaults its API profile with `HELLOTEST_SERVICE_PROFILE` (`platform`, `testing`, `knowledge`, `manual`, `dashboard`, `automation`, `agentic`, `chatbot`, `ai`, `trace`, or `integration`). The default `all` profile preserves the existing modular-monolith deployment; unknown values fail startup. Each profile loads its own routes and recurring workers. The selected image serves its UI manifest and hashed assets through the existing same-origin gateway. Compatible screens and API changes can ship without rebuilding the shell. Runtime dependencies, implementation imports and schema remain shared; see the packaging guide for compatibility and isolation limits.

For the workspace and administration UI, start `frontend` alongside the desired profiles, or use `npm run microservices:up` for the complete profile stack. Open `http://localhost:8080` and `http://localhost:8081`. The default runtime map points to `/services/<profile>` on the same origin. Nginx resolves upstreams at request time, preserves streaming progress, and starts even when an API is absent. An unavailable API returns an upstream error while the shell and reachable API routes remain available. Pages needing multiple domains still depend on those domains.

The selector resolves the capability selection and invokes Compose. A one-shot `schema-migrate` job applies schema updates; API profiles verify committed compatibility receipts with `HELLOTEST_SCHEMA_MODE=verify`, without running migrations themselves. Project/application reads use the existing shared Platform implementation behind narrow interfaces, preserving membership checks without depending on a separate Platform HTTP call. There is no extra internal read token or endpoint to configure. The shared database and authentication foundation remain explicit dependencies.

This Compose file is for local development: ports bind to loopback and infrastructure credentials have development defaults. Production deployments need managed secrets, TLS, backups, resource controls, and migration coordination. In Administration > Integrations, configure the TestEngine URL as `http://testengine-backend:4301` for this network; `testengine` is also available as a compatibility alias. LLM provider connections are configured in Integrations.

The frontend keeps `/api` as its fallback and can route domains directly with one runtime JSON map:

```bash
HELLOTEST_SERVICE_URLS='{"manual":"https://qa.example.com/api","chatbot":"https://chat.example.com","ai":"https://ai.example.com"}' \
  docker compose -f docker-compose.microservices.yml up --build frontend
```

A custom map replaces the default map; supply every separately deployed profile you need. Missing entries use their build-time endpoint or the `/api` fallback, which reaches Platform in this Compose stack. Invalid runtime JSON fails startup before either UI gets a partial configuration. External origins also require matching CORS configuration.

## Verification

```bash
npm test
npm run build
sh scripts/checks/validate-deployment-contracts.sh
npm run test:service-gateway
```

The gateway check uses disposable Docker containers and synthetic upstreams. It verifies both UI listeners, path/query/body forwarding, PATCH requests, immediate stream progress in both deployment modes, and continued Platform, Testing and Knowledge access with Chatbot and Manual stopped, including an Nginx restart. It removes only its own containers and network. `GATEWAY_TEST_NODE_IMAGE` and `GATEWAY_TEST_NGINX_IMAGE` can select compatible preloaded images. This check does not call a real LLM or validate a database-backed application deployment.

## Ownership rules

- Add or change service transport ownership in `services/<profile>/backend/service.manifest.js`; the API manifest is only an aggregator.
- Keep validation and response mapping in routes; keep feature use cases in `services/<profile>/backend/services`; keep providers behind ports/adapters.
- Each capability owns its `frontend/api.client.ts`; the legacy `api.*` facade composes them. Shared HTTP/session/cache behavior lives in `services/platform/frontend/src/lib/httpClient.ts`.
- Frontend requests choose a service endpoint through `services/<profile>/frontend` and `services/platform/frontend/src/platform/lib/serviceEndpoints.ts`; callers do not embed service URLs.
- PostgreSQL, Redis, MinIO, and Tika are shared infrastructure during the migration. A physical database split follows only after cross-domain joins have been replaced with versioned projections.
- Platform owns identity, workspace administration and instance setup. Testing owns common test assets, execution records, defects, schedules and batch jobs. Manual owns stories and product planning; defects belong to Testing. Dashboard owns Analytics, Release Readiness and Custom Dashboard as one capability. AI owns queued generation workers and quality assistance. Knowledge owns ingestion/search/retrieval; Chatbot owns conversations. Integration owns provider configuration, prompt templates and project sync.
- `testengine/backend` is the sole execution worker implementation. Root setup, builds, and tests include it.
- The TestEngine worker and Selenium Grid remain a separate execution plane. Start it with `docker compose -f testengine/docker-compose.yml up --build`; the catalog records the worker, Grid hub, Chrome node, and mobile engine so these can be deployed and monitored independently of the product API profiles.

## Operational infrastructure

`catalog.json` also inventories the eight monitoring/routing components in `operations`. Run `npm run ops:up` for the bounded standalone stack; see [the ops runbook](../docs/operations/operations.md) for budgets, integration, verification, and failure behavior.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the complete source map, architecture diagrams and contribution workflow.

Dependency enforcement is defined in [implementation contracts](../docs/architecture/implementation-boundaries.md). Cross-owner imports use declared npm dependencies and explicit exports; `npm run check:boundaries` rejects private relative imports and undeclared dependencies. There is no per-file exception registry. Single-owner tests live in `services/<owner>/test`; shared harnesses retain multi-owner contracts.

## Independent UI releases

Each package exposes lazy views from `frontend/entry.ts`. `HELLOTEST_CAPABILITY_UI_URLS` configures same-origin manifest paths; the microservices Compose file supplies defaults. Without a mapping the shell uses local lazy views for combined/development mode. A configured release failure shows a local retry state. Feature flags and permissions control menu/action visibility; backend checks still enforce access. See [the release contract and rollout limits](../docs/architecture/capability-packaging.md#ui-composition-and-releases).
