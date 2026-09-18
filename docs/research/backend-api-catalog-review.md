# Catalog API architecture review — 2026-09-18

Reviewed 201 explicit method/path operations in 22 assigned route modules and their catalog/mapping services. The inventory below is taken from runtime route registration, including both Bug aliases; every listed operation is covered by its module conclusion. This is part of the full backend review (429 operations across 50 registered main-API modules). Synthetic HEAD routes are not counted twice.

## Implemented changes and evidence

| Operation | Previous service statements | Updated service statements | Evidence |
| --- | ---: | ---: | --- |
| Assign 1,000 Test Cases to a suite, replacing membership | 3,003 | 7 | Actual PostgreSQL execution; same ordering and revision result |
| Reorder 1,000 suite cases | 1,003 | 4 | Actual PostgreSQL execution; exact reversed mapping order |
| Synchronize one case's suite assignments | 3N + 3 | 5 for nonempty input | Actual PostgreSQL execution; duplicate IDs, foreign suites and primary suite checked |
| Replace 1,000 case/Bug links | 2,002 | 5 | Actual PostgreSQL execution; missing/foreign targets cannot remove existing links |
| Replace 1,000 case links plus one Story link for a Bug | 2,004 | 6 | Actual PostgreSQL execution; issue-side same-project validation now enforced |
| List N releases with their Story membership | N + 1 | 2 for nonempty list | 200-release behavioral fixture and PostgreSQL membership correctness |
| Readiness across N nonempty releases | 1 + 6N (case evidence present) | 2 + 4N | Removes repeated release/membership loads; at most three readiness trees active |
| Read Stories for Sprint health | 3 with full membership/details | 2 with five metric fields | Real SQL projection and project-filter regression |

Counts exclude transaction control, authentication, and permission queries. Empty inputs intentionally perform fewer operations. The previous counts are taken from the pre-change implementation; suite-assignment before/after counts and latency were also measured directly.

The suite benchmark loaded `git HEAD`'s previous service and the updated service against the same fresh PostgreSQL 16 fixture, with 1,000 cases and foreign keys. Three alternating runs measured baseline **1,523.8 / 1,119.9 / 1,229.2 ms** versus updated **29.5 / 26.5 / 29.8 ms**. Median elapsed time improved about **41.7×** and statement count fell **99.77%**. This is a local service benchmark, not a production p95 or whole-backend speed claim.

Release and Sprint health fanout now share `mapWithConcurrency`, which preserves response order, stops scheduling after an error and waits for already-started work before rejection. Release membership uses a parameterized JSON recordset and indexed membership/iteration candidates rather than a project-wide release/Story Cartesian join. Readiness lists omit Story descriptions and other detail payloads. Existing full release responses still include them.

The review also closed concrete scope gaps: application-only environment/configuration reads could include other projects' shared resources; Test Case defect routes lacked persisted project checks; Bug-side linking could bypass those checks; Sprint health exposed aggregate source data without checking each source permission. These now fail before returning protected data or replacing links. Legacy foreign Story/case/Bug links are excluded from Sprint and release aggregate scopes.

The refactor keeps route authorization at the HTTP boundary, moves Bug traceability policy into `issueLink.service`, keeps database mutations with their existing transaction/audit owner, and uses one shared concurrency utility. Response contracts and pagination were preserved; invalid foreign/missing link selections now return explicit client errors.

## Validation

- `catalogApiPerformance.test.js`: 16 behavioral tests for 200-release batching, bounded 40-release and 100-Sprint work, failure draining, all new source permissions, authorized response compatibility, and application-only route scope forwarding.
- `integration/catalogApiPerformance.postgres.test.js`: real PostgreSQL SQL/transaction coverage for 1,000-case assignments, append/reorder, revision mismatch, missing/foreign validation before writes, primary-suite fallback/clearing, case/Bug and Bug-side mapping batches, application-only environment/configuration/data-set scope, compact Sprint projection, direct/sprint release deduplication and exact-release finalized outcomes.
- Existing legacy release readiness, Story defect, traceability, hierarchy, issue-history, management CRUD, mobile enforcement, configuration matrix and project resource contracts remain in the full regression suite. The management test's old unbounded-fanout source assertion was updated to the new bounded behavior; behavioral tests verify actual results.
- Disposable database `agent_verify_catalog_arch_20260918` was created for these tests only. Fixtures rolled back and the database was dropped. No production application database was changed.

## Limits and residual scaling considerations

No promise of zero timeouts is made: external dependencies, database load and genuinely large operations can still fail, and shared runtime work handles bounded errors. Existing legacy full-list endpoints, Story/module/release membership writes and shared-step propagation retain their response/transaction semantics; very large selections still need workload-specific profiling or a future paginated/queued contract. Existing full-list and per-ID export paths were not silently truncated. Historical inconsistent multi-project relationships are rejected or excluded where touched. Concurrent cross-entity project moves still merit dedicated load/race testing beyond these disposable deterministic fixtures. No production index build, deployment or production load test was performed in this sub-review.

## Module conclusions and exact route inventory

### projects (10 operations)

Retained compact project catalog, membership/favorite behavior, aggregate counters, transactional create/delete and streamed snapshot response. Detail authorization still performs fresh membership checks. Existing project performance/deletion tests cover these paths; no speculative response reshaping.

| Method | Path | Review coverage |
| --- | --- | --- |
| POST | `/projects` | Module conclusion above; route/service path inspected |
| GET | `/projects` | Module conclusion above; route/service path inspected |
| GET | `/projects/catalog` | Module conclusion above; route/service path inspected |
| GET | `/projects/portfolio-analytics` | Module conclusion above; route/service path inspected |
| POST | `/projects/portfolio-attention-report.pdf` | Module conclusion above; route/service path inspected |
| PUT | `/projects/:id/favorite` | Module conclusion above; route/service path inspected |
| DELETE | `/projects/:id/favorite` | Module conclusion above; route/service path inspected |
| GET | `/projects/:id` | Module conclusion above; route/service path inspected |
| PUT | `/projects/:id` | Module conclusion above; route/service path inspected |
| DELETE | `/projects/:id` | Module conclusion above; route/service path inspected |

### appTypes (5 operations)

Reviewed all CRUD operations and project-scoped permissions. Small lookup reads and dependency-aware delete retained; application project/type are immutable through update. Existing errors are still handled by the shared error boundary.

| Method | Path | Review coverage |
| --- | --- | --- |
| POST | `/app-types` | Module conclusion above; route/service path inspected |
| GET | `/app-types` | Module conclusion above; route/service path inspected |
| GET | `/app-types/:id` | Module conclusion above; route/service path inspected |
| PUT | `/app-types/:id` | Module conclusion above; route/service path inspected |
| DELETE | `/app-types/:id` | Module conclusion above; route/service path inspected |

### projectMembers (5 operations)

Reviewed persisted project permission checks, destination authorization on moves, duplicate membership checks and workspace-admin role assignment restriction. Joined user data avoids per-member hydration. No change to grant freshness or role semantics.

| Method | Path | Review coverage |
| --- | --- | --- |
| POST | `/project-members` | Module conclusion above; route/service path inspected |
| GET | `/project-members` | Module conclusion above; route/service path inspected |
| GET | `/project-members/:id` | Module conclusion above; route/service path inspected |
| PUT | `/project-members/:id` | Module conclusion above; route/service path inspected |
| DELETE | `/project-members/:id` | Module conclusion above; route/service path inspected |

### requirements (25 operations)

Retained SQL cursor pages, separate complete metrics, batched relation hydration, persisted-scope writes and queued generation/import workflows. Reviewed ordinary CRUD, workspace bulk changes, ALM imports, AI preview/accept, related Stories and design routes. External/AI boundaries are covered by the shared resilience review; per-item bulk mutation work remains a scaling consideration.

| Method | Path | Review coverage |
| --- | --- | --- |
| GET | `/requirements/create-metadata` | Module conclusion above; route/service path inspected |
| GET | `/requirements/:id/edit-metadata` | Module conclusion above; route/service path inspected |
| POST | `/requirements/:id/ai-groom-preview` | Module conclusion above; route/service path inspected |
| POST | `/requirements/ai-description-rephrase` | Module conclusion above; route/service path inspected |
| POST | `/requirements/export` | Module conclusion above; route/service path inspected |
| POST | `/requirements/ai-gherkin-preview` | Module conclusion above; route/service path inspected |
| POST | `/requirements/ai-create-jobs` | Module conclusion above; route/service path inspected |
| GET | `/requirements/ai-create-jobs/:jobId` | Module conclusion above; route/service path inspected |
| GET | `/requirements/ai-create-jobs` | Module conclusion above; route/service path inspected |
| POST | `/requirements` | Module conclusion above; route/service path inspected |
| POST | `/requirements/import` | Module conclusion above; route/service path inspected |
| GET | `/requirements/alm/projects` | Module conclusion above; route/service path inspected |
| GET | `/requirements/alm/requirements` | Module conclusion above; route/service path inspected |
| POST | `/requirements/import/alm` | Module conclusion above; route/service path inspected |
| POST | `/requirements/ai-create-preview` | Module conclusion above; route/service path inspected |
| GET | `/requirements/metrics` | Module conclusion above; route/service path inspected |
| GET | `/requirements` | Module conclusion above; route/service path inspected |
| GET | `/requirements/:id` | Module conclusion above; route/service path inspected |
| PUT | `/requirements/:id` | Module conclusion above; route/service path inspected |
| PUT | `/requirements/:id/related-requirements` | Module conclusion above; route/service path inspected |
| POST | `/requirements/:id/ai-optimize-preview` | Module conclusion above; route/service path inspected |
| POST | `/requirements/:id/generate-test-cases` | Module conclusion above; route/service path inspected |
| POST | `/requirements/:id/design-test-cases-preview` | Module conclusion above; route/service path inspected |
| POST | `/requirements/:id/design-test-cases-accept` | Module conclusion above; route/service path inspected |
| DELETE | `/requirements/:id` | Module conclusion above; route/service path inspected |

### requirementReleases (9 operations)

Implemented one-query membership hydration for an entire release catalog, preserving direct/sprint union, manual precedence, project boundaries, ordering and full detail response. Readiness uses compact membership once and caps concurrent release trees at three. A single-release readiness route reuses the already-authorized release, and note generation reuses its loaded release. Finalized outcomes remain scoped to the exact stored release token.

| Method | Path | Review coverage |
| --- | --- | --- |
| GET | `/requirement-releases` | Module conclusion above; route/service path inspected |
| POST | `/requirement-releases` | Module conclusion above; route/service path inspected |
| GET | `/requirement-releases/readiness` | Module conclusion above; route/service path inspected |
| GET | `/requirement-releases/:id` | Module conclusion above; route/service path inspected |
| GET | `/requirement-releases/:id/readiness` | Module conclusion above; route/service path inspected |
| POST | `/requirement-releases/:id/release-notes` | Module conclusion above; route/service path inspected |
| PUT | `/requirement-releases/:id` | Module conclusion above; route/service path inspected |
| POST | `/requirement-releases/:id/scope` | Module conclusion above; route/service path inspected |
| DELETE | `/requirement-releases/:id` | Module conclusion above; route/service path inspected |

### requirementIterations (10 operations)

Implemented a concurrency cap of three for up to 100 Sprint health trees, compact health-only Story projection, summary-only existence check, project filtering of Story/case/Bug evidence and explicit permissions for each health source. Retained disclosed lookahead limits and complete/partial metadata, CRUD, date/stamp behavior and assignment response contracts.

| Method | Path | Review coverage |
| --- | --- | --- |
| GET | `/requirement-iterations/health` | Module conclusion above; route/service path inspected |
| GET | `/requirement-iterations` | Module conclusion above; route/service path inspected |
| POST | `/requirement-iterations` | Module conclusion above; route/service path inspected |
| GET | `/requirement-iterations/:id` | Module conclusion above; route/service path inspected |
| PUT | `/requirement-iterations/:id` | Module conclusion above; route/service path inspected |
| POST | `/requirement-iterations/:id/requirements` | Module conclusion above; route/service path inspected |
| GET | `/requirement-iterations/:id/requirements` | Module conclusion above; route/service path inspected |
| PUT | `/requirement-iterations/:id/requirements` | Module conclusion above; route/service path inspected |
| DELETE | `/requirement-iterations/:id/requirements` | Module conclusion above; route/service path inspected |
| DELETE | `/requirement-iterations/:id` | Module conclusion above; route/service path inspected |

### requirementTestCases (2 operations)

Reviewed both traceability operations and called mapping service: persisted requirement/case scope, conflicting legacy relationship detection, same-project validation, revision-independent transactional replacement and batched scope resolution are already present. Existing traceability regression tests retained. Per-link replacement writes remain a scaling consideration.

| Method | Path | Review coverage |
| --- | --- | --- |
| GET | `/requirement-test-cases` | Module conclusion above; route/service path inspected |
| PUT | `/requirement-test-cases/replace` | Module conclusion above; route/service path inspected |

### requirementDefects (2 operations)

Reviewed list/replace guards against unscoped member reads and foreign requirement/Bug combinations. Replacement locks/validates before deleting; automatic links preserve manual source. Existing Story defect tests retained. Issue-side writes now use the new validated set-based mapping boundary as well.

| Method | Path | Review coverage |
| --- | --- | --- |
| GET | `/requirement-defects` | Module conclusion above; route/service path inspected |
| PUT | `/requirement-defects/replace` | Module conclusion above; route/service path inspected |

### testCases (41 operations)

Reviewed create/import/export, catalog/metrics/review queue, bulk resolve, version/restore, object repository, automation build/recorder, AI authoring/generation and reviewer operations. Existing cursor, compact picker, batched hydration, source permissions, queued builds and version contracts retained. Suite and defect service improvements also apply to case mutation callers.

| Method | Path | Review coverage |
| --- | --- | --- |
| POST | `/test-cases` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/import` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/export` | Module conclusion above; route/service path inspected |
| GET | `/test-cases/automation/learning-cache` | Module conclusion above; route/service path inspected |
| GET | `/test-cases/automation/repository-context` | Module conclusion above; route/service path inspected |
| GET | `/test-cases/automation/learning-cache/export.csv` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/automation/learning-cache/import` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/automation/learning-cache/extract-fields` | Module conclusion above; route/service path inspected |
| GET | `/test-cases/automation/learning-cache/:id/usage` | Module conclusion above; route/service path inspected |
| PUT | `/test-cases/automation/learning-cache/:id` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/automation/learning-cache` | Module conclusion above; route/service path inspected |
| DELETE | `/test-cases/automation/learning-cache/:id` | Module conclusion above; route/service path inspected |
| DELETE | `/test-cases/automation/learning-cache/screens/:screenName` | Module conclusion above; route/service path inspected |
| GET | `/test-cases/automation/learning-cache/screens/:screenName/usage` | Module conclusion above; route/service path inspected |
| PUT | `/test-cases/automation/learning-cache/screens/:screenName` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/automation/learning-cache/:id/ai-improve` | Module conclusion above; route/service path inspected |
| GET | `/test-cases/automation/jobs/:transactionId` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/automation/build-batch` | Module conclusion above; route/service path inspected |
| GET | `/test-cases/review-summary` | Module conclusion above; route/service path inspected |
| GET | `/test-cases/metrics` | Module conclusion above; route/service path inspected |
| GET | `/test-cases` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/resolve-requirements` | Module conclusion above; route/service path inspected |
| GET | `/test-cases/:id/versions` | Module conclusion above; route/service path inspected |
| GET | `/test-cases/:id/versions/:revision` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/:id/versions/:revision/restore` | Module conclusion above; route/service path inspected |
| GET | `/test-cases/:id` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/:id/automation/build` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/:id/automation/generator-jobs` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/:id/automation/recorder-session` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/:id/automation/recorder-session/:sessionId/finish` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/design-test-cases-preview` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/ai-authoring-preview` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/ai-step-rephrase` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/design-test-cases-accept` | Module conclusion above; route/service path inspected |
| GET | `/test-cases/ai-generation-jobs` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/ai-generation-jobs` | Module conclusion above; route/service path inspected |
| PUT | `/test-cases/:id` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/:id/review` | Module conclusion above; route/service path inspected |
| POST | `/test-cases/:id/accept-generated` | Module conclusion above; route/service path inspected |
| DELETE | `/test-cases/:id/reject-generated` | Module conclusion above; route/service path inspected |
| DELETE | `/test-cases/:id` | Module conclusion above; route/service path inspected |

### testCaseModules (9 operations)

Retained module catalog aggregation and summary case-picker access. Reviewed app/project authorization and assignment scopes for all CRUD/mapping operations. List reads avoid per-module relation hydration; individual assignment validation/writes remain proportional to selected IDs.

| Method | Path | Review coverage |
| --- | --- | --- |
| GET | `/test-case-modules` | Module conclusion above; route/service path inspected |
| POST | `/test-case-modules` | Module conclusion above; route/service path inspected |
| GET | `/test-case-modules/:id` | Module conclusion above; route/service path inspected |
| GET | `/test-case-modules/:id/test-cases` | Module conclusion above; route/service path inspected |
| PUT | `/test-case-modules/:id` | Module conclusion above; route/service path inspected |
| POST | `/test-case-modules/:id/test-cases` | Module conclusion above; route/service path inspected |
| PUT | `/test-case-modules/:id/test-cases` | Module conclusion above; route/service path inspected |
| DELETE | `/test-case-modules/:id/test-cases` | Module conclusion above; route/service path inspected |
| DELETE | `/test-case-modules/:id` | Module conclusion above; route/service path inspected |

### testSuites (7 operations)

Reviewed every CRUD/assignment route, application scope, data visibility, extra testcase.update permission, revision conflicts, and hierarchy cycle protections. Assignment paths use the refactored suite mapping service; no hierarchy or execution context behavior changed.

| Method | Path | Review coverage |
| --- | --- | --- |
| POST | `/test-suites` | Module conclusion above; route/service path inspected |
| GET | `/test-suites` | Module conclusion above; route/service path inspected |
| GET | `/test-suites/:id` | Module conclusion above; route/service path inspected |
| PUT | `/test-suites/:id` | Module conclusion above; route/service path inspected |
| POST | `/test-suites/:id/assign-test-cases` | Module conclusion above; route/service path inspected |
| PUT | `/test-suites/:id/assign-test-cases` | Module conclusion above; route/service path inspected |
| DELETE | `/test-suites/:id` | Module conclusion above; route/service path inspected |

### suiteTestCases (2 operations)

Implemented batched validation, insertion, legacy primary-suite updates and reorder. Replacement/append/reorder preserve caller order and revisions; malformed, missing and foreign IDs reject before deletion. Removed assignments now clear obsolete legacy primary suites or choose a remaining mapping. Locks use NO KEY UPDATE for suite revisions and ordered case updates, reducing foreign-key lock conflicts.

| Method | Path | Review coverage |
| --- | --- | --- |
| GET | `/suite-test-cases` | Module conclusion above; route/service path inspected |
| PUT | `/suite-test-cases/reorder` | Module conclusion above; route/service path inspected |

### testCaseDefects (3 operations)

Implemented persisted case/issue scope guards on all three routes, unscoped-member rejection and testcase/feedback permissions. Manual replacement validates same-project cases/issues transactionally with one issue read and one insert. Automatic reconciliation insert is set based and preserves manual links. Added a 1,000-ID replacement input limit.

| Method | Path | Review coverage |
| --- | --- | --- |
| GET | `/test-case-defects` | Module conclusion above; route/service path inspected |
| GET | `/test-case-defects/:testCaseId/issues` | Module conclusion above; route/service path inspected |
| PUT | `/test-case-defects/replace` | Module conclusion above; route/service path inspected |

### testSteps (15 operations)

Reviewed all bulk/edit/reorder/duplicate/group/shared-group/preview routes, persisted parent scope, mobile feature gates, shared group project validation and service transactions. Step sequence/group reconciliation remains behaviorally sensitive and was retained; large per-step mutation selections still scale with count.

| Method | Path | Review coverage |
| --- | --- | --- |
| POST | `/test-steps/bulk` | Module conclusion above; route/service path inspected |
| POST | `/test-steps/bulk-delete` | Module conclusion above; route/service path inspected |
| POST | `/test-steps` | Module conclusion above; route/service path inspected |
| GET | `/test-steps` | Module conclusion above; route/service path inspected |
| POST | `/test-steps/run-api-request` | Module conclusion above; route/service path inspected |
| GET | `/test-steps/:id` | Module conclusion above; route/service path inspected |
| PUT | `/test-steps/:id` | Module conclusion above; route/service path inspected |
| POST | `/test-steps/move-automation` | Module conclusion above; route/service path inspected |
| POST | `/test-steps/duplicate` | Module conclusion above; route/service path inspected |
| POST | `/test-steps/group` | Module conclusion above; route/service path inspected |
| POST | `/test-steps/ungroup` | Module conclusion above; route/service path inspected |
| POST | `/test-steps/insert-shared-group` | Module conclusion above; route/service path inspected |
| PUT | `/test-cases/:id/test-steps/reorder` | Module conclusion above; route/service path inspected |
| PUT | `/test-steps/reorder` | Module conclusion above; route/service path inspected |
| DELETE | `/test-steps/:id` | Module conclusion above; route/service path inspected |

### sharedStepGroups (5 operations)

Reviewed CRUD, app/project authorization, mobile write gates, batched usage counts and shared-reference propagation. Existing normalization and synchronization behavior retained. Editing a widely reused group may perform many dependent writes; these are intentional transactional work, not replaced with unsafe parallel writes.

| Method | Path | Review coverage |
| --- | --- | --- |
| POST | `/shared-step-groups` | Module conclusion above; route/service path inspected |
| GET | `/shared-step-groups` | Module conclusion above; route/service path inspected |
| GET | `/shared-step-groups/:id` | Module conclusion above; route/service path inspected |
| PUT | `/shared-step-groups/:id` | Module conclusion above; route/service path inspected |
| DELETE | `/shared-step-groups/:id` | Module conclusion above; route/service path inspected |

### testDataSets (6 operations)

Added service-level project scope when only app_type_id is supplied, preventing NULL-application rows from other projects entering results. Existing route-resolved scope, move validation, encrypted/secret row handling, normalization and transactional data-set assignment protection retained. AI preview remains under data.manage/data.ai permissions.

| Method | Path | Review coverage |
| --- | --- | --- |
| POST | `/test-data-sets/ai-generate-preview` | Module conclusion above; route/service path inspected |
| POST | `/test-data-sets` | Module conclusion above; route/service path inspected |
| GET | `/test-data-sets` | Module conclusion above; route/service path inspected |
| GET | `/test-data-sets/:id` | Module conclusion above; route/service path inspected |
| PUT | `/test-data-sets/:id` | Module conclusion above; route/service path inspected |
| DELETE | `/test-data-sets/:id` | Module conclusion above; route/service path inspected |

### testEnvironments (5 operations)

Fixed application-only route to pass the authorized project to storage and added service-level scope subquery for alternate callers. Shared NULL-application environments remain local to the application project. CRUD validation, variable redaction and scope changes retained.

| Method | Path | Review coverage |
| --- | --- | --- |
| POST | `/test-environments` | Module conclusion above; route/service path inspected |
| GET | `/test-environments` | Module conclusion above; route/service path inspected |
| GET | `/test-environments/:id` | Module conclusion above; route/service path inspected |
| PUT | `/test-environments/:id` | Module conclusion above; route/service path inspected |
| DELETE | `/test-environments/:id` | Module conclusion above; route/service path inspected |

### testConfigurations (5 operations)

Fixed application-only route and service project scope, matching environment behavior. Reviewed mobile visibility, target-matrix validation, project move checks and secret variable handling. Per-configuration mobile app lookup is a remaining opportunity for request-local batching, without caching authorization across requests.

| Method | Path | Review coverage |
| --- | --- | --- |
| POST | `/test-configurations` | Module conclusion above; route/service path inspected |
| GET | `/test-configurations` | Module conclusion above; route/service path inspected |
| GET | `/test-configurations/:id` | Module conclusion above; route/service path inspected |
| PUT | `/test-configurations/:id` | Module conclusion above; route/service path inspected |
| DELETE | `/test-configurations/:id` | Module conclusion above; route/service path inspected |

### issues (26 operations)

Reviewed both /issues and /feedback aliases, metadata, AI draft/triage, export/bulk delete, catalog/metrics, history and CRUD. Extracted issueLink.service to own set-based case/Story mapping validation and replacement inside the existing Bug/audit transaction. Foreign/missing relationships now reject instead of being silently linked; project moves revalidate retained links. Cursor pagination and audit behavior retained.

| Method | Path | Review coverage |
| --- | --- | --- |
| GET | `/feedback/create-metadata` | Module conclusion above; route/service path inspected |
| GET | `/feedback/:id/edit-metadata` | Module conclusion above; route/service path inspected |
| POST | `/feedback/ai-triage-preview` | Module conclusion above; route/service path inspected |
| POST | `/feedback/export` | Module conclusion above; route/service path inspected |
| DELETE | `/feedback/bulk-delete` | Module conclusion above; route/service path inspected |
| POST | `/feedback/ai-draft-preview` | Module conclusion above; route/service path inspected |
| POST | `/feedback` | Module conclusion above; route/service path inspected |
| GET | `/feedback/metrics` | Module conclusion above; route/service path inspected |
| GET | `/feedback` | Module conclusion above; route/service path inspected |
| GET | `/feedback/:id` | Module conclusion above; route/service path inspected |
| GET | `/feedback/:id/history` | Module conclusion above; route/service path inspected |
| PUT | `/feedback/:id` | Module conclusion above; route/service path inspected |
| DELETE | `/feedback/:id` | Module conclusion above; route/service path inspected |
| GET | `/issues/create-metadata` | Module conclusion above; route/service path inspected |
| GET | `/issues/:id/edit-metadata` | Module conclusion above; route/service path inspected |
| POST | `/issues/ai-triage-preview` | Module conclusion above; route/service path inspected |
| POST | `/issues/export` | Module conclusion above; route/service path inspected |
| DELETE | `/issues/bulk-delete` | Module conclusion above; route/service path inspected |
| POST | `/issues/ai-draft-preview` | Module conclusion above; route/service path inspected |
| POST | `/issues` | Module conclusion above; route/service path inspected |
| GET | `/issues/metrics` | Module conclusion above; route/service path inspected |
| GET | `/issues` | Module conclusion above; route/service path inspected |
| GET | `/issues/:id` | Module conclusion above; route/service path inspected |
| GET | `/issues/:id/history` | Module conclusion above; route/service path inspected |
| PUT | `/issues/:id` | Module conclusion above; route/service path inspected |
| DELETE | `/issues/:id` | Module conclusion above; route/service path inspected |

### comments (2 operations)

Reviewed both entity-scoped operations. Scope resolution and project permission happen before joined comment reads or insertion; author serialization and 5,000-character body limit retained. Existing complete-list response remains compatible.

| Method | Path | Review coverage |
| --- | --- | --- |
| GET | `/comments` | Module conclusion above; route/service path inspected |
| POST | `/comments` | Module conclusion above; route/service path inspected |

### attachments (5 operations)

Reviewed metadata, entity-scoped list, streaming upload/download and delete. Permission precedes object access; filenames, content length, gzip/storage cleanup and stream handling retained. Object store network timing belongs to the common dependency boundary; no synthetic attachment truncation introduced.

| Method | Path | Review coverage |
| --- | --- | --- |
| GET | `/attachments/meta` | Module conclusion above; route/service path inspected |
| GET | `/attachments` | Module conclusion above; route/service path inspected |
| POST | `/attachments` | Module conclusion above; route/service path inspected |
| GET | `/attachments/:id/download` | Module conclusion above; route/service path inspected |
| DELETE | `/attachments/:id` | Module conclusion above; route/service path inspected |

### domainMetadata (2 operations)

Reviewed workspace-scope and domain metadata reads. Authenticated user scope, flag-filtered permissions, dropdown catalog normalization and immutable metadata cloning retained. Existing shared-cache invalidation and freshness are covered by the common runtime review.

| Method | Path | Review coverage |
| --- | --- | --- |
| GET | `/metadata/workspace-scopes` | Module conclusion above; route/service path inspected |
| GET | `/metadata/domain` | Module conclusion above; route/service path inspected |

