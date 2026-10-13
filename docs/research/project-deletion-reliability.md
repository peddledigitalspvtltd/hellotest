# Large-project deletion reliability

Reference research: dated observations and verification counts describe the recorded review, not current acceptance. Use the current [verification runbook](../development/verification.md) for reproducible checks.


Reviewed and implemented on 2026-09-20.

## Root cause

Read-only inspection found 110,318 Test Cases in SAP PM Mobile Automation and 21,597 in HelloTest Launchpad12. The `test_cases.manual_test_case_id` self-reference had no supporting index. Its `ON DELETE SET NULL` foreign-key action could scan the case table for every deleted case. Other relationship columns also lacked deletion indexes.

The old UI waited for a synchronous deletion request, with a 30-second client deadline. The API performed the entire SQL deletion and an unbounded fanout of object-storage deletions before responding. That made large deletions appear to fail even when the server was still working.

## Behavior after the fix

- `DELETE /projects/:id` returns **202 Accepted** with a durable job receipt and `Location: /projects/:id/deletion`. Repeated requests share a job. Explicit retries reuse failed work; a recreated project with a reused identifier receives a new receipt.
- `GET /projects/:id/deletion` reports queued, running, cleanup, completed or failed, plus processed row count and safe error details. The original requester can inspect/retry cleanup after project membership disappears. Other users still need the applicable current project permission; API-key restrictions remain enforced.
- The UI persists receipts per user, polls without response caching, recovers after navigation/reload or a lost response, prevents duplicate submissions, and only reports completion after the job completes. Bulk deletion queues bounded groups of requests. A receipt-only recovery view remains available when the requester loses their final project membership.
- One deletion worker owns a PostgreSQL advisory session lock across API replicas. Work resumes after a restart when that session disappears. Idle polling uses the existing connection pool; active work uses a separate, bounded database connection.
- The worker builds missing relationship indexes concurrently, reuses equivalent indexes and repairs its own interrupted invalid builds. It refuses conflicting index definitions.
- The deletion repository captures indexed temporary identity sets and deletes children before parents in batches of up to 1,000 rows. All database changes remain in one transaction. A late failure rolls back the product data and cleanup manifest together. Conflicting cross-project relationships are rejected before destructive work.
- Object cleanup starts after commit. A durable outbox retains attachment objects, repository source ZIPs and configured knowledge-vector cleanup. Storage work uses pages of 100 and at most four concurrent operations; S3 requests have abort deadlines. Failed work remains retryable instead of being reported as complete.
- Scoped mutation admission and worker claims reject projects being deleted. Database guards on legacy project-owned tables without dependable foreign keys prevent background writers from recreating orphan records after deletion.

## Verification

Real PostgreSQL fixtures cover the original complete sample project, rollback at a late trigger, worker ownership races, duplicate enqueue, restart recovery, lost COMMIT acknowledgement, post-commit storage failures, cleanup paging, index reuse/repair, scope isolation and new deletion admission.

The final large fixture removed **100,002 cases, 100,000 steps, 100,000 versions and 1,100 legacy notifications in 24.7 seconds**, using 315 bounded mutation batches, while preserving **50,001 unrelated/shared cases**. This run overlapped other local verification and builds. An injected failure after a completed batch restored the original data. This is a local fixture measurement, not a production latency guarantee.

Final validation passed 970 backend tests (two opt-in integration tests skipped by the default command), 516 frontend tests, five large-project PostgreSQL tests and 16 PostgreSQL queue/cleanup tests. Separate index tests verify complete B-tree key definitions, safe invalid-index repair and rejection of conflicting definitions.

Frontend browser regression tests use intercepted API responses and disposable fixtures. They exercise queued/running/cleanup/completed transitions, transient polling errors, lost DELETE responses, reload/navigation, duplicate prevention, bulk enqueue, explicit retries, legacy synchronous success and receipt-only access recovery. No real project was deleted by these tests.

Relevant tests:

- `services/platform/backend/test/integration/projectDeletion.postgres.test.js`
- `services/platform/backend/test/integration/projectDeletionLarge.postgres.test.js`
- `services/platform/backend/test/integration/projectDeletionQueue.postgres.test.js`
- `services/platform/test/backend/projectDeletionAccess.test.js`
- `services/knowledge/test/backend/projectDeletionCleanup.test.js`
- `services/platform/test/backend/projectDeletionIndexes.test.js`
- `services/platform/test/browser/projectDeletion.test.mjs`

The PostgreSQL tests require their explicit opt-in variables and enforce disposable database names. Test databases are removed after verification. The two user projects were only inspected read-only.

## Local rollout

Rebuilt and restarted the existing `local-run` API and frontend services with their existing environment file. Both containers are healthy; the main UI and admin UI return 200, and API readiness succeeds through the frontend proxy. Container source hashes match the tested deletion implementation. All 26 relationship-index definitions were verified or built concurrently on the local database. The deletion ledger remains empty and both named projects remain present, ready for the user to delete from the updated UI.

A final `READ ONLY` transaction checked all 11 repository scope-conflict conditions against both actual projects. All returned false (49 ms for SAP PM Mobile Automation, 433 ms for HelloTest Launchpad12). No deletion or enqueue was performed.

## Operational boundaries

SQL deletion is atomic; external storage cleanup follows that commit and cannot restore deleted project rows. A cleanup error therefore means the records are gone but external cleanup still needs to finish. The UI retains that job and permits a confirmed retry.

Database outages, storage outages and conflicting cross-project relationships can still produce a failed job. They do not require keeping the initiating HTTP request open. Large transactions still use database/WAL capacity; only one project deletion runs at a time per database. Index preparation may make the first job take longer. Completed job receipts remain as a small durable record of the request.
