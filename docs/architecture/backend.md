# HelloTest Backend Architecture

## Architectural shape

HelloTest is a modular application with capability-owned source folders and selectable API profiles. It can run as one API process or as separate profile processes using capability-selected images, a shared Platform foundation and database contract. Browser, mobile, document extraction, object storage, cache/coordination, LLM, and telemetry systems are external providers even when Docker Compose runs them on the same host.

`services/<owner>/package.json` defines each npm workspace, exports and product metadata; generated `services/capabilities.json` defines API profile names, required foundations and feature ownership; `services/catalog.json` describes deployment and source locations. Each `services/<profile>/backend/service.manifest.js` owns its transport surface, and `services/platform/backend/src/routes/manifest.js` aggregates only enabled manifests. `HELLOTEST_SERVICE_PROFILE` selects a profile; `all` preserves the single API deployment. Unknown profiles fail startup. Profiles control transport registration and recurring worker ownership. Feature implementations live under their capability, while the runtime, schemas, dependency installation, and some use-case calls remain shared. See the [implementation boundaries](implementation-boundaries.md) and [source audit](source-layout.md).

Project and application reads use narrow public interfaces in `services/platform/backend/public`. Every profile calls the same local implementation, including membership checks and catalog redaction. These shared foundation reads require no internal Platform HTTP endpoint or service token.

Profiles can run in separate processes, but they retain shared data and code dependencies. Process separation alone does not establish independent data ownership, independent release compatibility, or complete failure isolation.

## Dependency direction

```text
routes/controllers
       |
       v
application services/use cases
       |
       +------> domain policies and catalogs
       |
       v
ports (database, cache, storage, engine, LLM, telemetry)
       |
       v
provider adapters and infrastructure clients
```

Provider code must not import routes. Domain policy must not import Fastify, Docker, or a concrete provider SDK. Cross-module workflows belong in a dedicated orchestration service instead of creating service-to-service cycles.

## Runtime services

### Bounded deployment profiles

| Profile | Primary capability | Port in microservice Compose |
| --- | --- | ---: |
| `platform` | identity, projects, access control, administration, instance setup | 3010 |
| `testing` | cases, suites, shared steps, environments, data, configurations, executions, defects | 3011 |
| `knowledge` | knowledge ingestion, search, and context retrieval | 3012 |
| `manual` | requirements, releases, iterations, work-item relationships | 3002 |
| `dashboard` | Analytics, Release Readiness and Custom Dashboard | 3003 |
| `automation` | engine callbacks, automation generation, local agent | 3004 |
| `agentic` | agentic workflows, repository agents, inspection | 3005 |
| `chatbot` | conversational retrieval and assistant streaming | 3006 |
| `ai` | quality assistance, assurance, and impact review | 3007 |
| `trace` | operational telemetry and trace correlation | 3008 |
| `integration` | LLM, repository, Jira, and TestEngine connections | 3009 |

All profiles expose the same liveness/readiness contract. Shared infrastructure remains a common failure domain. Some AI operations are exposed by the owning work-item routes in Manual or Testing; the AI profile owns `qualityAssistance.routes.js` and generation workers. Knowledge and Chatbot have separate profiles, with Chatbot depending on Knowledge for retrieval. Separate profiles do not remove these capability dependencies.

| Capability | Contract | Required for API readiness | Configuration owner |
| --- | --- | --- | --- |
| PostgreSQL | authenticated query + canonical and execution runtime schemas | yes | deployment environment |
| Redis | `PING`, bounded connection timeout | no; degraded without it | deployment environment |
| MinIO/S3 | read-only bucket probe; writes provision only in write paths | no; attachment features degrade | deployment environment |
| Apache Tika | bounded `GET /version` | no; rich extraction degrades | deployment environment |
| Test Engine | `/health/ready`, `/api/v1/capabilities`, shared-secret authentication | no; remote execution degrades | Administration > Integrations |
| LLM/embedding provider | provider adapter with bounded requests and explicit project scope | no; AI features degrade | Administration > Integrations |
| OpenTelemetry Collector | OTLP HTTP/gRPC | no; diagnostics degrade | deployment environment |

`GET /health/live` proves only that the process event loop is alive. `GET /health/ready` checks critical dependencies and returns 503 when the instance must leave traffic rotation. Authenticated `GET /admin/health` runs the full registry and reports optional degradation without mutating infrastructure.

The product and execution adapters are separate ports/pools but currently target the same PostgreSQL database because execution planning still enforces foreign-key and query relationships with product-domain records. `OBS_DATABASE_URL` may use different credentials for that same host/database, but a physically separate database now fails fast with a clear error instead of failing later on missing domain tables. A future physical split requires first replacing those joins with versioned service contracts and replicated execution projections.

## External-provider contract

Every pluggable service should expose or implement these concepts:

- a stable provider/type identifier;
- normalized, validated configuration with secrets stored separately from display metadata;
- a bounded `testConnection` operation;
- a capabilities document for feature negotiation;
- explicit authentication and project scope;
- request timeout, retry classification, and response-size limits;
- W3C `traceparent` propagation and structured, redacted logs;
- idempotency or a durable lease for every retryable mutation.

Provider failures must be translated to typed application errors. Raw upstream responses, authorization headers, cookies, access tokens, and user test data must not be persisted in operational telemetry.

Automation execution is a separate process boundary, not an untrusted-code sandbox. Saved web/native scripts run inside workers; authorize authors and isolate worker privileges, network reach and credentials. The inspection MCP destination policy applies to inspection tools, not arbitrary authored code.

## Background work

`services/platform/backend/src/plugins/backgroundTasks.js` loads only workers enabled by the profile and capability selection. Platform owns instance setup and project deletion; Testing owns schedules and batch processing; AI owns story/test-case generation; Integration owns project synchronization; Knowledge owns ingestion and its synchronization outbox; Agentic owns repository analyses; Automation owns orphan recorder cleanup. Other profiles start no recurring domain workers. The `all` profile starts workers for all enabled capabilities. Some worker implementations still call other capability modules; this ownership assignment is not a queue or data split.

Request handlers may enqueue durable work but cannot be the only worker. A job is safe for multiple API replicas only when it has an atomic claim, lease owner, lease expiry, heartbeat/progress, retry policy, and conditional terminal transition. Process-local mutexes and `setImmediate` are latency optimizations, not correctness mechanisms.

Long-term, queue consumers can move to dedicated worker deployments without changing route contracts because job persistence and handlers remain behind application-service boundaries.

## Observability

- Fastify/Pino emits structured logs.
- OpenTelemetry owns trace/span identity; application response headers reuse the active span.
- Prometheus labels use route templates and status classes to bound cardinality.
- Request latency is a histogram in seconds.
- Structured completion logs always retain errors and slow requests while high-volume health/lease polls are sampled; Prometheus counters remain unsampled.
- The Collector applies memory limits, removes sensitive attributes, batches exports, and forwards traces to Jaeger and OTLP logs to Loki.
- Grafana provisions Prometheus, Loki, Jaeger, a runtime dashboard, and trace/log correlation.
- Fatal Node.js errors initiate an idempotent drain of HTTP, Redis, PostgreSQL, and OpenTelemetry resources before the supervisor restarts the process.

## Source layout and ownership

- `services/<profile>/backend`: bounded API composition roots, route handlers and feature use cases.
- `services/<profile>/backend/routes`: transport validation, authentication, authorization and response mapping.
- `services/platform/backend/src/routes`: shared route manifest aggregation and profile registration.
- `services/<profile>/backend/services`: feature use cases. Split large modules by cohesive responsibility, not arbitrary line count.
- `services/platform/backend/src/services`: shared runtime services and storage/email/probe adapters. Instance setup belongs to Platform.
- `services/<profile>/frontend`: capability UI, hooks, and API clients. `services/platform/frontend/src/platform` composes the workspace shell, `services/platform/frontend/src/shared` holds reusable UI, and `services/platform/frontend/src/lib/api.ts` retains the compatibility API facade. See [CONTRIBUTING.md](../../CONTRIBUTING.md).
- `services/platform/backend/src/security`: permission catalogs, runtime-secret policy, and security boundary helpers.
- `services/platform/backend/src/db` and `services/platform/backend/src/obsDb`: database adapters and compatibility bootstrap only.
- `services/platform/backend/src/plugins`: Fastify lifecycle composition; no domain SQL.
- `services/platform/backend/src/utils`: stateless shared primitives; no feature orchestration.
- `services/platform/backend/instance-setup-data/schema-setup/schema.sql`: canonical new-install schema. Runtime bootstrap must never be the sole definition of a table.
- `testengine/backend`, `local-run/mobile-engine`: independently deployable execution providers. `testengine/backend` is the sole supported Test Engine worker implementation.
- `ops`: Collector, metrics, logging, tracing, dashboards, and alert configuration.

The historical `integrationService.js` generator was removed because it had no callers and embedded a stale hosted URL. The active integration boundary is `integration.service.js`; new provider-specific behavior should be added behind adapters rather than another parallel integration service.

## Change rules

1. Do not introduce circular imports. Put bidirectional workflows in a third orchestration module.
2. Routes must not query cross-project resources without resolving and enforcing their project first.
3. Health checks are read-only and bounded.
4. Never continue normal operation after an uncaught exception.
5. Never ship default production credentials; local development fallbacks are allowed only outside `NODE_ENV=production`.
6. Keep canonical schema, runtime compatibility bootstrap, OpenAPI, permissions, and tests in the same change.
7. A service is deployable only when Compose/Kubernetes dependencies, readiness, graceful shutdown, secrets, resource limits, and an operator runbook are present.
8. New Test Engine runtime and deployment work belongs only in `testengine/backend` and `testengine/`; do not introduce a parallel execution implementation.

## Capability UI artifacts

`--build-arg HELLOTEST_CAPABILITY=<owner>` builds that owner's UI and defaults its runtime API profile. The API serves the manifest and hashed UI files under `/capability-ui/<owner>/`; the same-origin gateway forwards this path. Artifact routes validate the selected owner, asset type, size and canonical path. They expose build assets only; product data routes retain authentication and authorization. Runtime dependencies and capability backend source remain shared because existing cross-package implementation imports require them. See [the release contract](capability-packaging.md).
