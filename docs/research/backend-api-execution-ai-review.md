# Execution, analytics, knowledge and integration API architecture review

Reviewed 2026-09-18. Scope: **159 method/path operations in 17 route modules**. Inventory comes from actual route registration, including loop-created routes and GET/POST wildcard variants. Every operation is listed below. Review included route validation/authentication and the invoked service boundaries; this is not a claim that every route received an independent load test.

## Implemented findings

| Finding | Implemented change | Evidence |
|---|---|---|
| One INSERT round trip per frozen case/step held run transactions open | Extracted `executionSnapshot.repository.js`; 250-row inserts remain inside caller transaction for create/edit/rerun |1000 cases+5000 steps:6000→24 INSERTs; 5,750 maximum bind parameters; real PostgreSQL JSON round-trip and late-chunk rollback |
| One step SELECT per selected case | Shared snapshot repository loads selected case steps in250-ID batches, retaining case/step order |1000 cases:1000→4 SELECTs; selected IDs de-duplicated and empty selection dispatches no query |
| Permission lookup per relation endpoint repeated for each record | Resolve each canonical entity-type permission once per read; no cross-request cache |1000 story/case relations:2000→2 checks; alias/denial/revocation/error tests |
| Nested graph scans blocked analytics CPU as evidence grew | Index scoped case IDs, suite IDs and defect links; union matching defect indices |1000 stories+1000 defects:6000 relationship reads versus at least 2,000,000 in repeated joins; shared defect counts once |
| Up to200 workflow reconciliations competed for pool connections | `mapWithConcurrency` caps reconciliation at 4, preserves order and drains active work before rejection | Behavioral peak-concurrency/order/failure tests; helper also adopted by release-readiness review |
| Submitted rerun actor could misattribute audit ownership | Stamp `created_by` from authenticated user | Route regression with different submitted and authenticated identities |
| Engine heartbeat replaced owner and failed to renew lease | Atomic owner+active-status+unexpired guard, extending valid lease 2 minutes | PostgreSQL owner, expiry and terminal-status tests |
| Log/artifact reads transferred whole runtime state | PostgreSQL JSON-field projection | Real PostgreSQL response parity and cross-project 404 checks |
| Repeated generator `/run` calls launched concurrent nonidempotent builds | Atomic transition from unused live lease for its worker, returning 409 for duplicates | 10 racing PostgreSQL calls invoke builder once; foreign owner rejected |
| Multiple API replicas could execute the same queued project sync | Atomic queued→running compare-and-set before provider access | Two independent service instances deliberately read same queued row; only winner enters provider processing |
| Concurrent enqueue checks could create duplicate sync jobs | Per-integration advisory transaction lock around pending check, insert and queue audit event | 10 concurrent PostgreSQL enqueue calls return one ID with one queued audit event |
| Detached sync processor rejection could become unhandled | Catch and report safe failure code from scheduled task | Source review plus unchanged caller response semantics |

## Validation and measurement

- 459 passed, 1 skipped, 0 failed across460 existing/new execution, workflow, knowledge, analytics, repository, integration, automation and engine unit/contract checks before the final step-loader addition.
- 87 lifecycle/frozen-scope/dataset checks passed after the step-loader change; focused performance tests include query counts, rollback, relation grants, graph joins, reconciliation and authenticated actor assertions.
- Dedicated `test/integration/executionArchitecture.postgres.test.js`: 8 passed on isolated PostgreSQL 16, including all seven behavioral subtests plus parent test. It checks real SQL, JSON serialization, rollback, live lease ownership, duplicate build prevention and competing sync workers/enqueues.
- Local microbenchmark for 6,000 snapshots, latest run: **2,380.3 ms row-at-a-time → 176.4 ms batched (13.49×)**. Previous runs were 2,427.5 → 150.7 ms and 5,124.9 → 311.0 ms. These are local transaction measurements, not production API p95/p99 or end-to-end latency guarantees. The deterministic reduction is 99.6% fewer snapshot INSERT round trips.
- The existing `runDataJourney.postgres.test.js` fixture sent only an original parent suite when its expected counts required the saved expanded parent/child selection. The same mismatch was reproduced with the original HEAD execution service in a separate pristine database. Corrected both edit manifests to send `run.suite_ids`, preserving all expected case/row counts and intentional removal semantics. The full PostgreSQL frozen-data journey now passes, covering create, edit, rerun, inherited data, parameter freezing, lifecycle and cross-project isolation.
- All database verification used disposable `agent_verify_*` databases. No deployed application database or external provider was changed.

## Per-module conclusions

| Module | Operations | Conclusion |
|---|---:|---|
| `executions.routes.js` | 22 | Fixed snapshot persistence and step-read N+1 costs; retained transaction boundaries, immutable frozen fields, case ordering, and new UUIDs on rerun. Rerun audit actor now comes from authentication. Existing list/detail hydration, optimistic revision checks, feature/mobile grants, parameter planning, execution dispatch, report/export and mail boundaries reviewed. |
| `executionResults.routes.js` | 12 | Reviewed all list/detail/create/update/delete, ensure/lifecycle, evidence upload and defect-link paths. Existing scoped access, row locks, revisions, bounded list limits, attachment size bounds and release-readiness lookahead semantics retained. No payload or readiness layout changes. |
| `executionSchedules.routes.js` | 6 | Reviewed creation/update resource validation, bulk hydration, single reads, manual runs, delete, scheduled claims and completion. Existing durable schedule leases and execution idempotency retained; snapshot improvements also benefit scheduled run creation. |
| `qualityAnalytics.routes.js` | 15 | Fixed quadratic suite/defect graph joins with indexed sets/maps while preserving exact defect de-duplication and archived-case filtering. Reviewed aggregate overview, request-scoped gadget cache, bounded two-worker gadget batches, dashboard CRUD, report/export, share and AI-design paths. |
| `qualityAssistance.routes.js` | 4 | Reviewed deterministic impact/failure previews and model-assisted rephrasing. Existing subject authorization and deterministic provenance retained. Full linked-history collection remains a scaling limit requiring contract-aware pagination/summary design. |
| `aiKnowledge.routes.js` | 36 | Fixed relation authorization fanout: one permission lookup per canonical entity type per read, at most five, with no cross-request authorization cache. Reviewed legacy CRUD/context, source/collection lifecycle, ACLs, queued ingestion/idempotency, retrieval budgets, assistant ownership, preflight deadlines, SSE cancellation and bounded model gateway paths. |
| `aiPromptTemplates.routes.js` | 4 | Reviewed scoped listing, authoring, update app/project consistency, delete and template validation. Existing route permission catalog and service domain validation retained; no result contract change. |
| `agenticWorkflows.routes.js` | 15 | Fixed unbounded list reconciliation with four workers, ordered results, stop-on-failure scheduling and drain-before-rejection. Reviewed assistant cancellation, graph validation, scoped workflows, preview runs, readiness, durable review starts, cancellation and deadlines. |
| `automationGenerator.routes.js` | 3 | Fixed run-start race: unused, unexpired lease and matching worker required by atomic update; concurrent duplicate starts return 409 before builder invocation. Lease/get/run machine-auth boundaries and generation persistence reviewed. |
| `repositoryAgents.routes.js` | 8 | Reviewed runtime capabilities, paginated 20-row summaries, bounded ZIP uploads, idempotent 202 job submission, ownership checks, cancellation/retry, approval/publish and artifact download. Existing durable worker lease and bounded compiler execution retained. |
| `repositoryInspection.routes.js` | 7 | Reviewed project/app access, encrypted short-lived capabilities, owner revalidation, local pairing/download, allowed operation list, bounded body reads and stream cancellation. Existing deliberate 60-second browser operation and 5-minute SSE limits retained. |
| `engine.routes.js` | 7 | Fixed heartbeat ownership and active/expiry conditions and extended valid lease by2minutes. Log/artifact queries now project only the required JSON field. Reviewed transactional SKIP LOCKED claims, machine snapshots, scoped status/results/logs/artifacts. |
| `localAgent.routes.js` | 2 | Reviewed authenticated bounded health probes and optional fixed-script host launch. Health requests use 900 ms attempt deadlines, single attempts and bounded response reads; no shell input or retry expansion introduced. |
| `integrations.routes.js` | 8 | Reviewed CRUD, active-only nonadmin visibility, secret masking, bounded/cancellable connection probes, admin-only export/import and audit writes. Existing provider adapter safety and nonidempotent retry restrictions retained. |
| `projectSync.routes.js` | 1 | Fixed atomic queued-to-running claim across replicas, transaction-scoped per-integration advisory locking for duplicate enqueue prevention, atomic enqueue+audit event and detached processor error handling. Provider work remains outside locks; no automatic replay of uncertain external writes. |
| `testEngineCallbacks.routes.js` | 1 | Reviewed bounded raw signed-body capture, timing-safe signature checking, project/run/case binding, result upsert, final evidence writes, telemetry and completion. Existing callback contract retained; no speculative replay added. |
| `testEngineInternal.routes.js` | 8 | Reviewed machine-auth lease/stats/detail/start/step execute/report/complete/fail routes and dispatch service state transitions, revision/evidence behavior, body limits and provider deadlines. Existing durable result/write sequencing retained. |

## Remaining scaling/operational limits

- Legacy execution/schedule/knowledge collections and full graph/report contracts are not universally paginated; changing default totals or silently truncating evidence would break clients. Large-project production benchmarks and an explicit pagination/report-job contract are still needed before claiming every endpoint has bounded end-to-end latency.
- Run creation still validates individual selected suites/direct cases/assignees; this change batches the much larger case-step reads and snapshot writes. Expanding all resource validation into bulk repositories is a separate measured opportunity.
- PDF rendering, email delivery, browser inspection and LLM work have inherently longer deadlines than CRUD. Existing bounded provider policies remain; moving synchronous contracts to 202 jobs requires clients and durable result retrieval.
- A process crash after an external sync write can leave a running transaction without a known outcome. Automatic provider replay is deliberately absent; operator reconciliation or provider-supported idempotency is required. Atomic claiming prevents duplicate workers from executing the same queued transaction, and atomic enqueue prevents racing duplicate submissions.
- Generator run execution still waits for the builder response; duplicate requests now fail fast 409 rather than start another build. Interrupted running builds require explicit reconciliation instead of blind retry.
- Source-level and isolated PostgreSQL verification do not establish a production SLO. Deployed query plans, database cardinality, network latency, CPU saturation and connection-pool pressure need representative load testing.

## Complete route inventory

### `executions.routes.js`

| Method | Path | Review/result |
|---|---|---|
| POST | `/executions/parameter-plan` | Reviewed authentication, project/domain grants, validation and delegated lifecycle/planning service contract. |
| GET | `/executions/history` | Reviewed authentication, project/domain grants, validation and delegated lifecycle/planning service contract. |
| POST | `/executions/smart-plan-preview` | Reviewed authentication, project/domain grants, validation and delegated lifecycle/planning service contract. |
| POST | `/executions/manual-run-suggestion` | Reviewed authentication, project/domain grants, validation and delegated lifecycle/planning service contract. |
| POST | `/executions` | Fixed: batched step reads and transactional snapshot inserts; actor and feature/scope checks retained. |
| POST | `/executions/local-run` | Fixed through snapshot repository; local automation scope/mobile grants retained. |
| GET | `/executions` | Reviewed scoped list and bulk hydration; collection remains unpaginated for compatibility. |
| GET | `/executions/:id` | Reviewed run/project access and frozen detail hydration; legacy live fallback uses batched step reads. |
| PUT | `/executions/:id` | Fixed added-case snapshot batching; existing frozen cases, history protection and revisions retained. |
| PUT | `/executions/:id/cases/:testCaseId/assignment` | Reviewed project permission, scope validation, inherited assignment handling and optimistic revisions. |
| PUT | `/executions/:id/:level/:scopeId/assignment` | Reviewed project permission, scope validation, inherited assignment handling and optimistic revisions. |
| POST | `/executions/:id/rerun` | Fixed batched snapshots and authenticated created_by; rerun parameter generation and UUID semantics retained. |
| POST | `/executions/:id/start` | Reviewed execution grants, runtime context and provider dispatch; external writes remain unretried. |
| POST | `/executions/:id/cases/:testCaseId/steps/:stepId/run` | Reviewed execution grants, runtime context and provider dispatch; external writes remain unretried. |
| POST | `/executions/:id/cases/:testCaseId/ai-analysis` | Reviewed authentication, project/domain grants, validation and delegated lifecycle/planning service contract. |
| GET | `/executions/:id/report.pdf` | Reviewed export/share permission, report renderer/provider limits and awaited audit/evidence writes; heavy reports remain synchronous. |
| GET | `/executions/:id/cases/:testCaseId/report.pdf` | Reviewed export/share permission, report renderer/provider limits and awaited audit/evidence writes; heavy reports remain synchronous. |
| GET | `/executions/:id/report.html` | Reviewed export/share permission, report renderer/provider limits and awaited audit/evidence writes; heavy reports remain synchronous. |
| POST | `/executions/:id/share-report` | Reviewed export/share permission, report renderer/provider limits and awaited audit/evidence writes; heavy reports remain synchronous. |
| POST | `/executions/:id/cases/:testCaseId/share-report` | Reviewed export/share permission, report renderer/provider limits and awaited audit/evidence writes; heavy reports remain synchronous. |
| POST | `/executions/:id/complete` | Reviewed authentication, project/domain grants, validation and delegated lifecycle/planning service contract. |
| DELETE | `/executions/:id` | Reviewed authentication, project/domain grants, validation and delegated lifecycle/planning service contract. |

### `executionResults.routes.js`

| Method | Path | Review/result |
|---|---|---|
| GET | `/execution-results/:id/attachments` | Reviewed scoped result access, action-specific permissions, bounded input and result/evidence transaction behavior. |
| POST | `/execution-results/:id/attachments` | Reviewed scoped result access, action-specific permissions, bounded input and result/evidence transaction behavior. |
| DELETE | `/execution-results/:id/attachments/:attachmentId` | Reviewed scoped result access, action-specific permissions, bounded input and result/evidence transaction behavior. |
| POST | `/execution-results/ensure` | Reviewed result lock/revision and explicit lifecycle semantics; no blind retry. |
| POST | `/execution-results/lifecycle` | Reviewed result+run grants, allowed actions, revision and transaction boundaries. |
| GET | `/execution-results/release-readiness` | Reviewed exact release/sprint filters,500-run/5,000-result ceilings, latest iteration evidence and truthful truncation. |
| POST | `/execution-results` | Reviewed scoped result access, action-specific permissions, bounded input and result/evidence transaction behavior. |
| GET | `/execution-results` | Reviewed scoped result access, action-specific permissions, bounded input and result/evidence transaction behavior. |
| GET | `/execution-results/:id` | Reviewed scoped result access, action-specific permissions, bounded input and result/evidence transaction behavior. |
| PUT | `/execution-results/:id` | Reviewed scoped result access, action-specific permissions, bounded input and result/evidence transaction behavior. |
| PUT | `/execution-results/:id/defect-links` | Reviewed scoped result access, action-specific permissions, bounded input and result/evidence transaction behavior. |
| DELETE | `/execution-results/:id` | Reviewed scoped result access, action-specific permissions, bounded input and result/evidence transaction behavior. |

### `executionSchedules.routes.js`

| Method | Path | Review/result |
|---|---|---|
| POST | `/execution-schedules` | Reviewed project/mobile/data scope, schedule validation and durable schedule service behavior. |
| GET | `/execution-schedules` | Reviewed project/mobile/data scope, schedule validation and durable schedule service behavior. |
| GET | `/execution-schedules/:id` | Reviewed project/mobile/data scope, schedule validation and durable schedule service behavior. |
| PUT | `/execution-schedules/:id` | Reviewed project/mobile/data scope, schedule validation and durable schedule service behavior. |
| POST | `/execution-schedules/:id/run` | Reviewed project/mobile/data scope, schedule validation and durable schedule service behavior. |
| DELETE | `/execution-schedules/:id` | Reviewed project/mobile/data scope, schedule validation and durable schedule service behavior. |

### `qualityAnalytics.routes.js`

| Method | Path | Review/result |
|---|---|---|
| GET | `/analytics/overview` | Reviewed per-source visibility and fixed aggregate query cost; missing source is never false zero. |
| GET | `/quality-dashboards` | Reviewed project scope, dashboard/gadget validation and delegated CRUD/render/evaluation contract. |
| GET | `/quality-dashboards/:id` | Reviewed project scope, dashboard/gadget validation and delegated CRUD/render/evaluation contract. |
| POST | `/quality-dashboards` | Reviewed project scope, dashboard/gadget validation and delegated CRUD/render/evaluation contract. |
| PUT | `/quality-dashboards/:id` | Reviewed project scope, dashboard/gadget validation and delegated CRUD/render/evaluation contract. |
| DELETE | `/quality-dashboards/:id` | Reviewed project scope, dashboard/gadget validation and delegated CRUD/render/evaluation contract. |
| GET | `/quality-dashboards/:id/report.pdf` | Reviewed project scope, dashboard/gadget validation and delegated CRUD/render/evaluation contract. |
| POST | `/quality-dashboards/:id/report.pdf` | Reviewed project scope, dashboard/gadget validation and delegated CRUD/render/evaluation contract. |
| POST | `/quality-dashboards/:id/share-report` | Reviewed project scope, dashboard/gadget validation and delegated CRUD/render/evaluation contract. |
| POST | `/analytics/jql` | Reviewed project scope, dashboard/gadget validation and delegated CRUD/render/evaluation contract. |
| POST | `/analytics/query` | Reviewed project scope, dashboard/gadget validation and delegated CRUD/render/evaluation contract. |
| POST | `/analytics/jql-batch` | Reviewed request-local context reuse, gadget limit and two-worker fanout; indexed scope join reused. |
| POST | `/analytics/query-batch` | Reviewed alias parity with JQL batch and fixed indexed scope join. |
| POST | `/analytics/dashboard-design-preview` | Reviewed project scope, dashboard/gadget validation and delegated CRUD/render/evaluation contract. |
| GET | `/ai/quality-insights` | Fixed indexed story/case/defect joins; source grants and exact evidence counts retained. |

### `qualityAssistance.routes.js`

| Method | Path | Review/result |
|---|---|---|
| POST | `/ai/rich-text-rephrase` | Reviewed subject/project permission and deterministic graph or bounded model-service output contract. |
| POST | `/requirements/:id/ai-impact-preview` | Reviewed subject/project permission and deterministic graph or bounded model-service output contract. |
| POST | `/test-cases/:id/ai-impact-preview` | Reviewed subject/project permission and deterministic graph or bounded model-service output contract. |
| POST | `/executions/:id/ai-failure-clusters` | Reviewed subject/project permission and deterministic graph or bounded model-service output contract. |

### `aiKnowledge.routes.js`

| Method | Path | Review/result |
|---|---|---|
| GET | `/projects/:project_id/knowledge` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| GET | `/projects/:project_id/knowledge/overview` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| POST | `/projects/:project_id/knowledge` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| PUT | `/projects/:project_id/knowledge/:id` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| GET | `/projects/:project_id/knowledge/search` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| GET | `/projects/:project_id/knowledge/context-package` | Fixed relation permission fanout in context assembly; request-local grants and RAG scope preserved. |
| POST | `/projects/:project_id/knowledge/relations` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| GET | `/projects/:project_id/knowledge/relations/source/:source_id` | Fixed per-read canonical permission lookup de-duplication; denied/unknown types excluded. |
| GET | `/projects/:project_id/knowledge/relations/target/:target_id` | Fixed per-read canonical permission lookup de-duplication; denied/unknown types excluded. |
| DELETE | `/projects/:project_id/knowledge/:id` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| POST | `/knowledge/ingestions` | Reviewed multipart bounds, ACL checks, idempotency and durable 202 enqueue. |
| GET | `/knowledge/ingestions/:id` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| POST | `/knowledge/ingestions/:id/retry` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| POST | `/knowledge/search` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| GET | `/knowledge/sources` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| GET | `/knowledge/sources/:id/file` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| DELETE | `/knowledge/sources/:id` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| GET | `/knowledge/collections` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| POST | `/knowledge/collections` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| GET | `/knowledge/collections/:id` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| PUT | `/knowledge/collections/:id` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| DELETE | `/knowledge/collections/:id` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| POST | `/knowledge/collections/:id/sources` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| DELETE | `/knowledge/collections/:id/sources` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| GET | `/knowledge/assistant/integrations` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| GET | `/knowledge/assistant/sessions` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| POST | `/knowledge/assistant/sessions` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| GET | `/knowledge/assistant/sessions/:id` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| GET | `/knowledge/sources/:id` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| GET | `/knowledge/sources/:id/revisions` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| PUT | `/knowledge/sources/:id/security` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| PATCH | `/knowledge/assistant/sessions/:id` | Reviewed project/source/session ownership, action grant and delegated lifecycle/ACL/retrieval contract. |
| POST | `/knowledge/assistant/sessions/:id/messages/stream` | Reviewed same turn authorization/idempotency plus abortable SSE. |
| POST | `/v1/context/retrieve` | Reviewed version/input validation, five-second preflight, budgets and authoritative user identity. |
| POST | `/v1/context/retrieve-stream` | Reviewed same context preflight plus streaming cancellation/backpressure. |
| POST | `/knowledge/assistant/sessions/:id/messages` | Reviewed ownership, bounded preflight, turn idempotency and pending202 behavior. |

### `aiPromptTemplates.routes.js`

| Method | Path | Review/result |
|---|---|---|
| GET | `/ai-prompt-templates` | Reviewed route grant, project/app scope and template service validation/persistence. |
| POST | `/ai-prompt-templates` | Reviewed route grant, project/app scope and template service validation/persistence. |
| PUT | `/ai-prompt-templates/:id` | Reviewed route grant, project/app scope and template service validation/persistence. |
| DELETE | `/ai-prompt-templates/:id` | Reviewed route grant, project/app scope and template service validation/persistence. |

### `agenticWorkflows.routes.js`

| Method | Path | Review/result |
|---|---|---|
| POST | `/agentic-assistant/sessions` | Reviewed project/app/workflow access, input validation and preview/review execution distinction. |
| GET | `/agentic-assistant/sessions` | Reviewed project/app/workflow access, input validation and preview/review execution distinction. |
| GET | `/agentic-assistant/sessions/:id` | Reviewed project/app/workflow access, input validation and preview/review execution distinction. |
| GET | `/agentic-workflows` | Reviewed project/app/workflow access, input validation and preview/review execution distinction. |
| POST | `/agentic-workflows` | Reviewed project/app/workflow access, input validation and preview/review execution distinction. |
| POST | `/agentic-workflows/api-agent-test` | Reviewed project/app/workflow access, input validation and preview/review execution distinction. |
| GET | `/agentic-workflows/:id` | Reviewed project/app/workflow access, input validation and preview/review execution distinction. |
| PUT | `/agentic-workflows/:id` | Reviewed project/app/workflow access, input validation and preview/review execution distinction. |
| DELETE | `/agentic-workflows/:id` | Reviewed project/app/workflow access, input validation and preview/review execution distinction. |
| POST | `/agentic-workflows/:id/runs` | Reviewed project/app/workflow access, input validation and preview/review execution distinction. |
| GET | `/agentic-workflows/:id/readiness` | Reviewed project/app/workflow access, input validation and preview/review execution distinction. |
| POST | `/agentic-workflows/:id/executions` | Reviewed project/app/workflow access, input validation and preview/review execution distinction. |
| POST | `/agentic-workflow-runs/:id/cancel` | Reviewed project/app/workflow access, input validation and preview/review execution distinction. |
| GET | `/agentic-workflow-runs` | Fixed reconciliation fanout to 4; limit 200, result ordering and summary projection retained. |
| GET | `/agentic-workflow-runs/:id` | Reviewed project/app/workflow access, input validation and preview/review execution distinction. |

### `automationGenerator.routes.js`

| Method | Path | Review/result |
|---|---|---|
| POST | `/automation-generator/internal/jobs/lease` | Reviewed machine authentication, bounded lease selection and job-service contract. |
| GET | `/automation-generator/internal/jobs/:id` | Reviewed machine authentication, bounded lease selection and job-service contract. |
| POST | `/automation-generator/internal/jobs/:id/run` | Fixed atomic lease-owner/expiry/start guard; duplicate running job rejected 409 before build. |

### `repositoryAgents.routes.js`

| Method | Path | Review/result |
|---|---|---|
| GET | `/repository-agents` | Reviewed ownership/domain grant, bounded job/artifact contract and durable worker behavior. |
| GET | `/repository-agents/runs` | Reviewed ownership/domain grant, bounded job/artifact contract and durable worker behavior. |
| POST | `/repository-agents/runs` | Reviewed bounded source parsing, idempotency, project grant and202 durable enqueue. |
| GET | `/repository-agents/runs/:id` | Reviewed ownership/domain grant, bounded job/artifact contract and durable worker behavior. |
| POST | `/repository-agents/runs/:id/cancel` | Reviewed ownership/domain grant, bounded job/artifact contract and durable worker behavior. |
| POST | `/repository-agents/runs/:id/retry` | Reviewed ownership/domain grant, bounded job/artifact contract and durable worker behavior. |
| POST | `/repository-agents/runs/:id/publish` | Reviewed run/project access, domain publish grant and mobile scope before durable publication. |
| GET | `/repository-agents/runs/:id/artifacts/:name` | Reviewed ownership/domain grant, bounded job/artifact contract and durable worker behavior. |

### `repositoryInspection.routes.js`

| Method | Path | Review/result |
|---|---|---|
| GET | `/repository-inspection/capabilities` | Reviewed project grant, capability/owner binding, operation whitelist and bounded proxy lifetime. |
| POST | `/repository-inspection/sessions` | Reviewed project grant, capability/owner binding, operation whitelist and bounded proxy lifetime. |
| POST | `/repository-inspection/local-agent/setup` | Reviewed project grant, capability/owner binding, operation whitelist and bounded proxy lifetime. |
| GET | `/repository-inspection/local-agent/download` | Reviewed project grant, capability/owner binding, operation whitelist and bounded proxy lifetime. |
| GET | `/repository-inspection/sessions/:id` | Reviewed project grant, capability/owner binding, operation whitelist and bounded proxy lifetime. |
| GET | `/repository-inspection/sessions/:id/*` | Reviewed project grant, capability/owner binding, operation whitelist and bounded proxy lifetime. |
| POST | `/repository-inspection/sessions/:id/*` | Reviewed project grant, capability/owner binding, operation whitelist and bounded proxy lifetime. |

### `engine.routes.js`

| Method | Path | Review/result |
|---|---|---|
| POST | `/api/engine/runs/claim` | Reviewed transactional SKIP LOCKED claim; no concurrent dispatch or retry expansion. |
| GET | `/api/engine/runs/:runId/snapshot` | Reviewed machine or project-scoped authorization and minimal lookup/state contract. |
| POST | `/api/engine/runs/:runId/heartbeat` | Fixed owner-bound live lease renewal; other owners, expired leases and terminal jobs rejected. |
| GET | `/api/runs/:runId/status` | Reviewed machine or project-scoped authorization and minimal lookup/state contract. |
| GET | `/api/runs/:runId/results` | Reviewed machine or project-scoped authorization and minimal lookup/state contract. |
| GET | `/api/runs/:runId/logs` | Fixed minimal logs JSON projection, retaining project-scoped read and missing-job 404. |
| GET | `/api/runs/:runId/artifacts` | Fixed minimal artifacts JSON projection, retaining project-scoped read and missing-job 404. |

### `localAgent.routes.js`

| Method | Path | Review/result |
|---|---|---|
| GET | `/local-agent/status` | Reviewed authentication, fixed provider candidates, 900 ms probe deadlines and fixed-script launch gate. |
| POST | `/local-agent/start` | Reviewed authentication, fixed provider candidates, 900 ms probe deadlines and fixed-script launch gate. |

### `integrations.routes.js`

| Method | Path | Review/result |
|---|---|---|
| POST | `/integrations` | Reviewed catalog grant, credential masking/import semantics and awaited durable audit work. |
| GET | `/integrations` | Reviewed catalog grant, credential masking/import semantics and awaited durable audit work. |
| POST | `/integrations/test-connection` | Reviewed explicit manage grant, cancellation, credential resolution and provider deadline. |
| GET | `/integrations/export` | Reviewed catalog grant, credential masking/import semantics and awaited durable audit work. |
| POST | `/integrations/import` | Reviewed catalog grant, credential masking/import semantics and awaited durable audit work. |
| GET | `/integrations/:id` | Reviewed catalog grant, credential masking/import semantics and awaited durable audit work. |
| PUT | `/integrations/:id` | Reviewed catalog grant, credential masking/import semantics and awaited durable audit work. |
| DELETE | `/integrations/:id` | Reviewed catalog grant, credential masking/import semantics and awaited durable audit work. |

### `projectSync.routes.js`

| Method | Path | Review/result |
|---|---|---|
| POST | `/projects/:id/sync/:provider` | Fixed duplicate enqueue race and atomic worker claim; queued API response precedes provider work. |

### `testEngineCallbacks.routes.js`

| Method | Path | Review/result |
|---|---|---|
| POST | `/api/testengine/callbacks/runs` | Reviewed exact raw-body signing input, configured size limit and callback service binding/upsert. |

### `testEngineInternal.routes.js`

| Method | Path | Review/result |
|---|---|---|
| POST | `/testengine/internal/jobs/lease` | Reviewed machine authentication, payload bounds and durable dispatch/result state transition. |
| GET | `/testengine/internal/jobs/queue-stats` | Reviewed machine authentication, payload bounds and durable dispatch/result state transition. |
| GET | `/testengine/internal/jobs/:id` | Reviewed machine authentication, payload bounds and durable dispatch/result state transition. |
| POST | `/testengine/internal/jobs/:id/start` | Reviewed machine authentication, payload bounds and durable dispatch/result state transition. |
| POST | `/testengine/internal/jobs/:id/steps/:stepId/execute` | Reviewed machine authentication, payload bounds and durable dispatch/result state transition. |
| POST | `/testengine/internal/jobs/:id/steps/:stepId/report` | Reviewed machine authentication, payload bounds and durable dispatch/result state transition. |
| POST | `/testengine/internal/jobs/:id/complete` | Reviewed machine authentication, payload bounds and durable dispatch/result state transition. |
| POST | `/testengine/internal/jobs/:id/fail` | Reviewed machine authentication, payload bounds and durable dispatch/result state transition. |

