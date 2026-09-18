# Backend API architecture review — 2026-09-18

## Scope and implementation

Reviewed all **429 explicit method/path operations in 50 registered main-API modules**, the four health/metrics routes, shared request/database/provider boundaries, and the active web and mobile execution services. Route coverage means route and downstream service inspection; it does not mean every operation was exercised against a live external provider. Fastify-generated HEAD routes are not counted separately.

- [Complete main-API route inventory](backend-api-route-inventory.json)
- [Catalog, planning, release readiness and traceability review](backend-api-catalog-review.md)
- [Execution, AI, automation and integration review](backend-api-execution-ai-review.md)
- [Authentication, administration and companion-engine review](backend-api-admin-engine-review.md)

Implemented the concrete performance, correctness and authorization findings. Existing API paths and ordinary successful response contracts are retained. Invalid cross-project operations, stale worker claims, concurrent password changes, unsupported profile credential fields and unsafe administration asset paths now receive explicit errors.

The refactor separates snapshot persistence into `executionSnapshot.repository`, Bug-link policy into `issueLink.service`, optional Redis behavior into an injectable `createRedisCache` boundary, and concurrency coordination into small shared helpers. HTTP routes own authorization, services own business rules, and existing transaction owners still control commit/rollback. This applies single responsibility and dependency inversion where they remove concrete duplication and make failure behavior testable; it does not introduce a speculative framework or broad inheritance hierarchy.

## Measured improvements

| Workload | Before | After | Verification |
| --- | --- | --- | --- |
| Replace 1,000 suite assignments | 3,003 SQL statements; median 1,229.2 ms | 7 statements; median 29.5 ms | Three alternating runs of old/new services, PostgreSQL 16 |
| Write 1,000 case and 5,000 step snapshots | 6,000 SQL statements; 2,380–2,428 ms | 24 statements; 151–176 ms | Real transactions, full JSON readback and late-failure rollback |
| Load steps for 1,000 cases | 1,000 SQL statements | 4 statements | Bounded 250-case read batches |
| List releases with Story membership | N + 1 SQL statements | 2 for a nonempty catalog | 200-release behavioral fixture and real membership SQL |
| Read one notification page from 30,000 rows | 30,000 rows transferred; 27,378,895 serialized bytes | 50 rows; 45,747 serialized bytes | Same ownership, total, unread count and cursor semantics |
| 40 overlapping metrics scrapes | One aggregate query per scrape | One shared pending aggregate query | Concurrent behavioral test; next scrape reads fresh state |
| 50 overlapping health checks | One pair of database probes per request | One shared pair while probes are active | Concurrent test followed by a newly observed outage |
| 20 concurrent mobile screenshot readers | One device capture per request | One shared pending capture | Device/session-specific concurrency test |

These are local service/transaction measurements and query-count reductions, **not production end-to-end latency guarantees**. SQL counts exclude authentication, transaction control and audit work unless the individual report states otherwise. No arbitrary timing threshold is used to make regression tests pass or fail.

## Shared failure and capacity boundaries

- **Optional Redis cache:** connection readiness follows the client's `ready` status, cold connection attempts are shared, connect waits are bounded to 1 second, commands and shutdown to 250 ms. Cache failure returns a cache miss/no-op, disconnects outstanding commands and applies a retry cooldown. Offline queuing and command replay are disabled. TTL/JSON behavior is retained. This client is used for optional cache/health operations, not durable job delivery. The readiness distinction and queue controls were checked against the installed client and the [official ioredis documentation](https://github.com/redis/ioredis#connection-events).
- **Outbound HTTP:** preserve null bodies for HEAD/204/205/304 responses; keep the final response readable when Retry-After exceeds the remaining budget; permit one half-open recovery probe; reject already-aborted calls before dispatch; count an HTTP failure once. Existing provider deadlines, bounded response bodies and retry policies remain in effect.
- **Health and metrics:** overlapping requests share active probes; finished results and failures are not cached. Metrics retain their query deadline. Health/readiness continue to distinguish required database dependencies from optional integrations. `/health/live` remains a process liveness check. Monitoring does not consume one new aggregate query per simultaneous scrape.
- **Database error handling:** statement cancellation, query read timeouts and connection acquisition timeouts produce sanitized, retryable 503 responses with `Retry-After: 1`, rather than ambiguous internal failures. These responses communicate temporary unavailability; they do not automatically replay writes.
- **Work bounds:** release/Sprint computations and workflow reconciliation use bounded workers that preserve result order and drain started work before propagating errors. Existing admission control, pool limits, transaction rollback and statement/query deadlines are retained.

## Correctness and authorization

Regression coverage includes project-scoped resource lists and defect links, source permissions for Sprint health, stale profile/password writes, durable verification attempt limits, single-use verification codes under concurrent requests, settings-key normalization, workspace-only transaction access, and administration proxy origin/path/redirect constraints. Snapshot and mapping writes remain atomic. Backup enqueue and worker ownership are coordinated through PostgreSQL across API replicas; execution heartbeats and generator starts require a matching live lease.

Permission checks are deduplicated only within one AI relation read. No cross-request permission cache was added. The detailed reports describe remaining deployment and scaling boundaries, including the web recorder's existing private-network access assumptions.

## Validation performed

- Main API: `cd backend/api && npm test` — **940 passed, 0 failed, 2 existing opt-in PostgreSQL tests skipped** (942 total). The pre-change suite passed 883 with the same two opt-in skips. OpenAPI/runtime route parity, permission contracts and lifecycle regressions pass.
- Web execution backend: `cd testengine/backend && npm test` — **45 passed**, including the TypeScript build.
- Mobile execution engine: `cd local-run/mobile-engine && npm test` — **19 passed**.
- Explicitly enabled PostgreSQL integration fixtures: `catalogApiPerformance.postgres.test.js`, `adminApiArchitecture.postgres.test.js`, `executionArchitecture.postgres.test.js` and `performanceIndexing.postgres.test.js` all passed against separately named disposable local databases. Tests cover actual SQL, rollback, row ownership, races, paging and concurrent index creation/reuse. Their source files declare the required opt-in variables and safe database-name constraints.
- The existing `runDataJourney.postgres.test.js` also passed after correcting its edit requests to use the stored expanded suite selection. Its previous fixture mismatch was reproduced with the original service; expected case/data counts and intentional scope-removal behavior were preserved. This exercises creation, editing, reruns, frozen parameter/data snapshots and cross-project isolation with real SQL.
- Real installed Redis client: JSON set/get, 100 concurrent reads, deletion and clean shutdown passed using a unique temporary key that was removed.
- Failure injection: unavailable/stalled cache, cancelled callers, HTTP body handling, recovery-probe contention, database timeouts, forbidden resource scopes, stale leases and concurrent account mutations.
- `git diff --check` passed. Disposable verification databases were removed; the application database was not migrated or load-tested.

## Index rollout and practical limits

Added `(user_id, created_at DESC, id DESC)` for notification pages to the existing fixed performance-indexing catalog. The existing administrator performance-indexing workflow builds it with `CREATE INDEX CONCURRENTLY`, recognizes equivalent indexes and reports progress/failure. An actual PostgreSQL EXPLAIN on 30,000 fixture rows selected this index. **The index was not built on the application's database during this review**; run the existing performance-indexing action after deploying to enable it there. Pagination and query-volume fixes do not depend on that action.

Production performance still depends on project size, indexes, pool sizing, hardware and external providers. Some legacy full-list/export endpoints and per-item bulk mutations retain their established complete-response contract; they have not been silently truncated. Provider-backed operations, real devices and browser recording require deployment-specific end-to-end verification. Before raising traffic, measure p50/p95/p99 latency, SQL waits, pool saturation, memory, dependency failures and rejection rates under representative concurrent workloads. No deployment, production data mutation or promise of zero failures/timeouts is implied.
