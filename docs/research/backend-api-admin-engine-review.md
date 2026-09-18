# Administration and companion API architecture review

Reviewed on 2026-09-18. Scope: all 69 operations registered by the 11 assigned main API modules, plus 46 default companion operations (11 Test Engine server, 18 recorder, 6 OPS, 11 mobile), and configurable OPS aliases. Fastify-generated HEAD handling is implicit. The source-of-truth main route inventory was captured from route registration, not inferred solely from filenames. No production/application database was modified; PostgreSQL verification used a newly created `agent_verify_admin_arch_*` database, removed afterward.

## Results and measured evidence

| Change | Before | After / verified behavior |
| --- | --- | --- |
| Notification page, 30,000-row disposable fixture | 30,000 rows, 27,378,895 serialized bytes, 362.63 ms local sample | 50 rows, 45,747 serialized bytes, 71.38 ms local sample |
| Replace 120 role grants | 121 mutation round trips | 2 mutation round trips, same transactional grant set |
| Concurrent mobile screenshot viewers | 20 device calls for 20 overlapping requests | 1 in-flight device capture shared by 20 authorized requests; later captures remain fresh |
| Verification failures | Throw rolled attempt increment back | Failure accounting commits; fifth wrong code rejects with 429 |
| Concurrent verification reuse | Unlocked select allowed simultaneous consumption | Real PostgreSQL: 1 success and 7 rejections for 8 simultaneous uses |
| Profile and password races | Full-row patch could restore stale secrets/admin state | Patch-only writes; password update CAS returns 409 after a competing reset |

Timing is an illustrative single local measurement, including database result hydration, not a production p95/p99 claim. Serialized notification figures compare the prior complete loaded result with the new response page. Exact-count and offset work still occurs in PostgreSQL; response/JavaScript memory is bounded.

## Main API module review

### `auth.routes.js` — 8 operations

Called services reviewed: auth.service, token, email, scoped integration selection.

Login already uses asynchronous password derivation, fresh account/grant reads and credential compare-and-set. Fixed verification transactions: failed attempt counters and expiry cleanup commit before rejection; SELECT FOR UPDATE serializes consumption, while successful code consumption/account mutation remain atomic. Missing session credentials now return 401; bearer scheme is case-insensitive.

| Method | Path | Access boundary |
| --- | --- | --- |
| GET | `/auth/setup` | Public authentication/bootstrap flow |
| POST | `/auth/signup/request-code` | Public authentication/bootstrap flow |
| POST | `/auth/signup/verify` | Public authentication/bootstrap flow |
| POST | `/auth/login` | Public authentication/bootstrap flow |
| POST | `/auth/login/google` | Public authentication/bootstrap flow |
| POST | `/auth/forgot-password/request-code` | Public authentication/bootstrap flow |
| POST | `/auth/forgot-password/verify` | Public authentication/bootstrap flow |
| GET | `/auth/session` | Bearer session verification |

### `admin.routes.js` — 1 operations

Called services reviewed: runtimeHealth.service, project.service, attachment.service, database schema/permission reads.

Health authenticates and checks ops.view plus selected project membership. Dependency checks are delegated to the existing runtime health coordinator. Schema/permission failures become blocked checks rather than healthy empty data; no rewrite required.

| Method | Path | Access boundary |
| --- | --- | --- |
| GET | `/admin/health` | Authenticated; ops.view |

### `adminPortal.routes.js` — 18 operations

Called services reviewed: adminPortal.service, user.service, featureFlag.service, integration.service, dropdownCatalog.service, performanceIndexing.service, sampleData installer.

All control-plane mutations use requireAdmin; status and login are intentionally public. Overview issues independent aggregate reads concurrently; audit output is limited to 200. Fixed fractional audit limits. Feature updates and audit are transactional; indexing is delegated to its existing background coordinator and stopped on close. Schema/sample setup remains explicit administrator work.

| Method | Path | Access boundary |
| --- | --- | --- |
| GET | `/admin-portal/status` | Public status/authentication |
| POST | `/admin-portal/auth/login` | Public status/authentication |
| GET | `/admin-portal/overview` | Workspace administrator |
| GET | `/admin-portal/dropdowns` | Workspace administrator |
| PUT | `/admin-portal/dropdowns/:key` | Workspace administrator |
| POST | `/admin-portal/setup/schema` | Workspace administrator |
| GET | `/admin-portal/setup/performance-indexing` | Workspace administrator |
| POST | `/admin-portal/setup/performance-indexing` | Workspace administrator |
| GET | `/admin-portal/setup/sample-data` | Workspace administrator |
| POST | `/admin-portal/setup/sample-data` | Workspace administrator |
| POST | `/admin-portal/users` | Workspace administrator |
| PUT | `/admin-portal/users/:id/status` | Workspace administrator |
| PUT | `/admin-portal/feature-flags` | Workspace administrator |
| GET | `/admin-portal/integration-types` | Workspace administrator |
| POST | `/admin-portal/integrations` | Workspace administrator |
| DELETE | `/admin-portal/integrations/:id` | Workspace administrator |
| PUT | `/admin-portal/security/password` | Workspace administrator |
| GET | `/admin-portal/audit` | Workspace administrator |

### `adminUi.routes.js` — 4 operations

Called services reviewed: configured frontend HTTP proxy.

Fixed absolute URL, backslash authority and base-path traversal escape from the public asset wildcard. The resolved HTTP(S) URL must retain configured origin, credentials and base path; redirects are rejected. Valid assets preserve body, content type, cache header and status. Existing 10-second fetch deadline remains.

| Method | Path | Access boundary |
| --- | --- | --- |
| GET | `/admin` | Public static gateway; constrained configured frontend |
| GET | `/admin/runtime-config.js` | Public static gateway; constrained configured frontend |
| GET | `/admin/` | Public static gateway; constrained configured frontend |
| GET | `/admin/*` | Public static gateway; constrained configured frontend |

### `users.js` — 7 operations

Called services reviewed: user.service, permission.service, batchProcess.service.

Verified seven CRUD/import/password routes including self-update restrictions and current-user deletion protection. Fixed undeclared password_hash acceptance and stale full-row profile writes: updates persist only explicitly supplied allowlisted fields. Own-password changes compare the verified hash in the final update so an intervening reset wins. Imports remain queued; hashes never appear in list/get projections.

| Method | Path | Access boundary |
| --- | --- | --- |
| POST | `/users` | Authenticated; user.manage |
| POST | `/users/import` | Authenticated; user.import |
| GET | `/users` | Authenticated; user.view |
| GET | `/users/:id` | Authenticated; user.view |
| PUT | `/users/:id` | Authenticated; user.manage; self/manager restriction |
| PUT | `/users/:id/password` | Authenticated; workspace.view; self/manager restriction |
| DELETE | `/users/:id` | Authenticated; user.manage |

### `roles.routes.js` — 8 operations

Called services reviewed: role.service, featureFlag.service, permission and role-preset catalogs.

Role permissions remain configured grants independent of feature availability; availability is annotated on reads. Replacement now uses one DELETE and one bulk INSERT inside the existing transaction instead of one INSERT per permission. Unknown grants reject before mutation; empty replacement still clears exactly the chosen role.

| Method | Path | Access boundary |
| --- | --- | --- |
| POST | `/roles` | Authenticated; role.manage |
| GET | `/roles` | Authenticated; role.view |
| GET | `/roles/:id` | Authenticated; role.view |
| GET | `/permissions` | Authenticated; role.view |
| GET | `/roles/:id/permissions` | Authenticated; role.view |
| PUT | `/roles/:id/permissions` | Authenticated; role.manage |
| PUT | `/roles/:id` | Authenticated; role.manage |
| DELETE | `/roles/:id` | Authenticated; role.manage |

### `featureFlags.routes.js` — 2 operations

Called services reviewed: featureFlag.service, adminPortal audit.

Existing flag writes validate known boolean keys and merge in PostgreSQL, preserving independent concurrent edits. Dependency evaluation fails closed for invalid keys/cycles. Reads are private/no-store; route permission enforcement remains in the shared permission layer. No new authorization cache was introduced.

| Method | Path | Access boundary |
| --- | --- | --- |
| GET | `/feature-flags` | Authenticated; workspace.view |
| PUT | `/feature-flags` | Authenticated; feature_flag.manage |

### `settings.routes.js` — 8 operations

Called services reviewed: settings.service, apiKey.service.

Fixed a canonicalization mismatch: permission checks now trim preference keys exactly as storage does, closing whitespace-wrapped governed-key bypasses. Localization already bounds pack size/content. API keys remain hashed, user-scoped and reveal the raw credential only at creation; revoke/delete include owner predicates.

| Method | Path | Access boundary |
| --- | --- | --- |
| GET | `/settings/localization` | Authenticated user; workspace.view |
| PUT | `/settings/localization` | Authenticated user; localization.manage |
| GET | `/settings/workspace-preferences` | Authenticated user; workspace.view |
| PUT | `/settings/workspace-preferences` | Authenticated user; workspace.view |
| GET | `/settings/api-keys` | Authenticated user; api_key.manage |
| POST | `/settings/api-keys` | Authenticated user; api_key.manage |
| DELETE | `/settings/api-keys/:id` | Authenticated user; api_key.manage |
| DELETE | `/settings/api-keys/:id/permanent` | Authenticated user; api_key.manage |

### `notifications.routes.js` — 6 operations

Called services reviewed: notification.service, pagination utility.

GET now performs a scoped aggregate plus SQL LIMIT/OFFSET query, keeping total/unread_count/cursor response semantics while transferring at most 200 rows. Stable created_at/id order and invalid-cursor checks added. Mark-read is a single owner-scoped UPDATE, removing the read-then-write race and returning 404 for other users.

| Method | Path | Access boundary |
| --- | --- | --- |
| GET | `/notifications` | Authenticated current user; owner-scoped data |
| GET | `/notifications/unread-count` | Authenticated current user; owner-scoped data |
| PUT | `/notifications/read-all` | Authenticated current user; owner-scoped data |
| PUT | `/notifications/:id/read` | Authenticated current user; owner-scoped data |
| DELETE | `/notifications/:id` | Authenticated current user; owner-scoped data |
| DELETE | `/notifications` | Authenticated current user; owner-scoped data |

### `workspaceTransactions.routes.js` — 5 operations

Called services reviewed: workspaceTransaction.service, project.service, appType.service, observability database.

Lists already cap rows and batch user hydration. Every transaction detail/action resolves its authoritative project and checks the corresponding permission; artifact identity is checked against the selected transaction. Fixed include_global=true to require workspace admin, consistent with individual global-record access. Fractional limits now become integer SQL LIMIT values.

| Method | Path | Access boundary |
| --- | --- | --- |
| GET | `/workspace-transactions` | Authoritative project membership + transaction permission; global records require admin |
| GET | `/workspace-transactions/:id/events` | Authoritative project membership + transaction permission; global records require admin |
| GET | `/workspace-transactions/:id/artifacts` | Authoritative project membership + transaction permission; global records require admin |
| GET | `/workspace-transactions/:id/artifacts/:artifactId/download` | Authoritative project membership + transaction permission; global records require admin |
| DELETE | `/workspace-transactions/:id` | Authoritative project membership + transaction permission; global records require admin |

### `opsTelemetry.routes.js` — 2 operations

Called services reviewed: opsTelemetry.service, scoped integration selection, resilient HTTP client.

Snapshot and clear verify selected project membership and shared ops permission policy. Existing provider calls bound bytes/events/concurrency/deadlines, hide credentials, require exact project echoes and use the dedicated project-delete endpoint. No fallback can convert a project delete into a global delete. Existing behavioral tests retained.

| Method | Path | Access boundary |
| --- | --- | --- |
| GET | `/ops-telemetry/snapshot` | Authenticated; ops.view |
| DELETE | `/ops-telemetry/logs` | Authenticated; ops.manage |

## Companion services

### Test Engine server

Reviewed `testengine/backend/src/server.ts`, run store/executor contracts, queue-worker health/lifecycle, CORS/shared-secret guards and live-session handling. Run handoff/retry/read operations require the configured shared secret. Production readiness fails closed for missing/unsafe credentials or a required unhealthy queue; shutdown drains tracked work to a deadline. The queue worker remains the supported execution plane. No server API shape changed.

| Method | Path | Review conclusion |
| --- | --- | --- |
| OPTIONS | `/*` | CORS preflight policy |
| GET | `/health/live` | Public health/capability compatibility |
| GET | `/health/ready` | Public health/capability compatibility |
| GET | `/health` | Public health/capability compatibility |
| GET | `/api/v1/capabilities` | Public health/capability compatibility |
| GET | `/api/v1/live-session/screenshot` | Legacy live-view transport; deployment boundary noted below |
| GET | `/api/v1/live-session` | Legacy live-view transport; deployment boundary noted below |
| GET | `/api/v1/runs` | Shared-secret run boundary; validates identifiers/callback envelope |
| GET | `/api/v1/runs/:id` | Shared-secret run boundary; validates identifiers/callback envelope |
| POST | `/api/v1/runs` | Shared-secret run boundary; validates identifiers/callback envelope |
| POST | `/api/v1/runs/:id/retry` | Shared-secret run boundary; validates identifiers/callback envelope |

### Test Engine recorder registration

Reviewed every route handler in `testengine/backend/src/lib/recorder.ts` together with inspection security/proxy boundaries. Repository inspection is paired-agent or service/session authorized, limits concurrent inspection browsers, validates remote targets, pins DNS-resolved egress, bounds captured events and closes orphan sessions. Token checks additionally protect live, stream, screenshot, input and tab activation. Stream cleanup closes listeners/CDP resources; screenshot capture has a five-second deadline. Ordinary automation recorder creation/status/control retains its existing trusted-network compatibility, described explicitly below.

| Method | Path | Review conclusion |
| --- | --- | --- |
| GET | `/api/v1/recorder/agent/status` | Paired-agent/repository-session guard; lifecycle/record lookup checked |
| GET | `/api/v1/recorder/sessions` | Paired-agent/repository-session guard; lifecycle/record lookup checked |
| GET | `/api/v1/recorder/sessions/:id` | Paired-agent/repository-session guard; lifecycle/record lookup checked |
| GET | `/api/v1/recorder/sessions/:id/tabs` | Paired-agent/repository-session guard; lifecycle/record lookup checked |
| POST | `/api/v1/recorder/sessions/:id/tabs/activate` | Paired-agent/repository-session guard; lifecycle/record lookup checked; explicit live-view session token |
| POST | `/api/v1/recorder/sessions/:id/inspect/start` | Paired-agent/repository-session guard; lifecycle/record lookup checked |
| POST | `/api/v1/recorder/sessions/:id/inspect/stop` | Paired-agent/repository-session guard; lifecycle/record lookup checked |
| POST | `/api/v1/recorder/sessions/:id/highlight` | Paired-agent/repository-session guard; lifecycle/record lookup checked |
| POST | `/api/v1/recorder/sessions/:id/inspect/validate` | Paired-agent/repository-session guard; lifecycle/record lookup checked |
| GET | `/api/v1/recorder/sessions/:id/inspect/result` | Paired-agent/repository-session guard; lifecycle/record lookup checked |
| GET | `/api/v1/recorder/sessions/:id/live` | Paired-agent/repository-session guard; lifecycle/record lookup checked; explicit live-view session token |
| GET | `/api/v1/recorder/sessions/:id/stream` | Paired-agent/repository-session guard; lifecycle/record lookup checked; explicit live-view session token |
| GET | `/api/v1/recorder/sessions/:id/screenshot` | Paired-agent/repository-session guard; lifecycle/record lookup checked; explicit live-view session token |
| POST | `/api/v1/recorder/sessions/:id/input` | Paired-agent/repository-session guard; lifecycle/record lookup checked; explicit live-view session token |
| POST | `/api/v1/recorder/sessions` | Paired-agent/repository-session guard; lifecycle/record lookup checked; remote URL policy and inspection capacity gate |
| POST | `/api/v1/recorder/sessions/:id/stop` | Paired-agent/repository-session guard; lifecycle/record lookup checked |
| POST | `/api/v1/recorder/sessions/:id/pause` | Paired-agent/repository-session guard; lifecycle/record lookup checked |
| POST | `/api/v1/recorder/sessions/:id/resume` | Paired-agent/repository-session guard; lifecycle/record lookup checked |

`inspectionProxy.ts` registers no application API routes. Its ephemeral loopback HTTP proxy, CONNECT and WebSocket handlers validate/pin target addresses, remove proxy credentials and close sockets on shutdown.

### Test Engine OPS registration

Reviewed `testengine/backend/src/lib/opsTelemetry.ts`: authentication fails closed when required credentials are missing; ingest bounds payloads/depth/string/array sizes, redacts secrets, bounds in-memory events and persisted store bytes, and serializes persistence. Project filters and scoped delete preserve other projects. Configured events-path aliases register the same GET/POST/DELETE plus project-delete operations as the defaults.

| Method | Default path | Review conclusion |
| --- | --- | --- |
| POST | `/api/v1/events` | Authenticated bounded ingest; returns 202 |
| GET | `/api/v1/events` | Authenticated project/filter/limit-aware listing |
| DELETE | `/api/v1/events` | Authenticated legacy/global clear contract |
| DELETE | `/api/v1/events/projects/:projectId` | Authenticated explicitly scoped clear |
| GET | `/api/v1/ops-telemetry/services` | Authenticated scoped service summary |
| GET | `/ops-telemetry` | Authenticated board; nosniff/no-referrer headers |

### Mobile Engine

Reviewed `local-run/mobile-engine/src/server.js`, `security.js`, `operational.js` and parameter contracts. All `/api/v1/mobile/*` operations require the service credential or a session-specific token; public health/capabilities remain compatible. Provider readiness and downloads have deadlines; graceful shutdown closes drivers. New screenshot coalescing is keyed by the actual driver, retains only in-flight promises, clears successes/failures, and marks responses no-store. Execution remains sequential within each driver to preserve step order.

| Method | Path | Review conclusion |
| --- | --- | --- |
| GET | `/health` | Public health/capabilities; readiness can require a healthy provider |
| GET | `/health/live` | Public health/capabilities; readiness can require a healthy provider |
| GET | `/health/ready` | Public health/capabilities; readiness can require a healthy provider |
| GET | `/api/v1/capabilities` | Public health/capabilities; readiness can require a healthy provider |
| POST | `/api/v1/mobile/execute` | Service credential required; owns driver lifecycle and sequential results |
| POST | `/api/v1/mobile/recorder/sessions` | Service secret or token for this session; record/driver state checked |
| GET | `/api/v1/mobile/recorder/sessions/:id` | Service secret or token for this session; record/driver state checked |
| GET | `/api/v1/mobile/recorder/sessions/:id/live` | Service secret or token for this session; record/driver state checked |
| GET | `/api/v1/mobile/recorder/sessions/:id/screenshot` | Service secret or token for this session; record/driver state checked; coalesced in-flight capture, no-store |
| POST | `/api/v1/mobile/recorder/sessions/:id/input` | Service secret or token for this session; record/driver state checked |
| POST | `/api/v1/mobile/recorder/sessions/:id/stop` | Service secret or token for this session; record/driver state checked; session token revoked and driver closed |

### Archived execution package

`apps/hellotest-execution-engine/package.json` marks the package archived, non-deployable and replaced by `testengine/backend`. Its `src/index.ts` starts a queue worker, not an HTTP server; there are no active registered HTTP API routes in this package. It was excluded from supported deployment changes.

## Validation

- Final complete main API suite coordinated by the root review: 940 passed, zero failed, two existing opt-in skips. Earlier focused suites passed 66/66; final proxy/admin route checks passed 13/13 (including the added tenth architecture test).
- `backend/api/test/adminApiArchitecture.test.js`: permission-key canonicalization, profile field boundaries, grant-query count/rollback, scoped bounded notifications, global transaction restriction, session 401 and asset URL escape checks.
- `backend/api/test/authVerificationTransactions.test.js`: signup/reset failure counters and expired-code cleanup persist despite rejected responses.
- `backend/api/test/integration/adminApiArchitecture.postgres.test.js`: real row locks, single-use code concurrency, rollback, grant bulk SQL, password race, notification ownership/cursors and 30,000-row measurement; passed in a disposable database.
- Test Engine: `npm test` compiled TypeScript and passed 45/45 existing tests.
- Mobile Engine: `LOG_LEVEL=error npm test` passed 19/19, including the new 20-viewer screenshot regression.
- The root review added the unfiltered notification index to the existing concurrent performance-indexing catalog and verified actual build/reuse plus a 30,000-row PostgreSQL EXPLAIN plan in another disposable database. It was removed after verification.

## Preserved contracts and remaining boundaries

The changes retain endpoint paths and successful response fields. Intentional error corrections are 401 for missing bearer credentials, 400 for undeclared profile hashes/escaped proxy paths, 403 for non-admin global transaction inclusion, 404 for other users’ notification mutations, and 409 for a password changed concurrently. The shared pagination utility gained additive exports only. Services retain their existing responsibility boundaries; no broad controller/service rewrite or permission cache was introduced.

These checks do not establish production capacity or eliminate every possible bottleneck. Remaining review observations:

- Legacy Test Engine ordinary recorder create/list/status/inspect/stop/pause/resume and execution live-session endpoints do not uniformly require the service secret; repository-inspection and live-view token paths have stronger protection. CORS alone is not server-to-server authorization. Keep this existing surface behind a trusted gateway/network. A full credential-contract migration requires coordinated frontend/API/engine changes and was not silently imposed here.
- Test Engine in-memory run/envelope history and mobile stopped-session history lack a general bounded retention contract. A retention/pagination design should preserve existing history/retry consumers before imposing truncation.
- Notification exact counts and offset cursors still perform work proportional to user history/deep offset; the retained contract now bounds returned rows and application memory. A keyset API would further improve deep pagination.
- Personal workspace preferences still read/merge/write a complete preference object; simultaneous independent profile settings edits can conflict. Feature-flag writes already use an atomic PostgreSQL merge.
- User creation still assigns project membership per project, and sample setup still performs administrator membership work per administrator. These are authorized setup/import operations; batching these paths further requires their ownership and rollback invariants to remain intact.
- The admin static proxy still buffers the configured frontend asset body after its 10-second network deadline. It now rejects foreign URLs and redirects, but does not add a new asset-size contract.
- No production load test, real mail/Google provider, real browser automation provider, physical Android device or cloud-device session was exercised. Engine integration tests use controlled local fixtures.
