# HelloTest Backend Architecture

## Architectural shape

HelloTest is a modular monolith for transactional product data and a set of independently deployable execution and infrastructure services. The API remains one deployable unit where requirements, test design, releases, permissions, and audit records need strong transactions. Browser, mobile, document extraction, object storage, cache/coordination, LLM, and telemetry systems are treated as external providers even when Docker Compose runs them on the same host.

This boundary avoids a distributed monolith: domain modules share one transactional API process, while resource-heavy or independently scalable capabilities communicate through versioned HTTP/queue contracts.

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

## Background work

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

- `api/src/routes`: transport validation, authentication, authorization, response mapping.
- `api/src/services`: application use cases. Large modules should be split by cohesive use case, not by arbitrary line count.
- `api/src/security`: permission catalogs, runtime-secret policy, and security boundary helpers.
- `api/src/db` and `api/src/obsDb`: database adapters and compatibility bootstrap only.
- `api/src/plugins`: Fastify lifecycle composition; no domain SQL.
- `api/src/utils`: stateless shared primitives; no feature orchestration.
- `db/schema.sql`: canonical new-install schema. Runtime bootstrap must never be the sole definition of a table.
- `testengine/backend`, `local-run/mobile-engine`: independently deployable execution providers. `testengine/backend` is the sole supported Test Engine worker implementation.
- `apps/hellotest-execution-engine`: archived source-only prototype. It owns no image, manifest, runtime endpoint, or release contract and must never be restored as a parallel execution plane.
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
8. New Test Engine runtime and deployment work belongs only in `testengine/backend` and `testengine/`; archived execution prototypes cannot acquire start scripts or deployment artifacts.
