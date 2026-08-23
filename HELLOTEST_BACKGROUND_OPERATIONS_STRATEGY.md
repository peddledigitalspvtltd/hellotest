# HelloTest Background Operations Strategy

## Goal

Heavy work in HelloTest should not run inline in the request-response path.

That includes:

- bulk imports
- bulk exports
- AI test case generation
- smart execution creation
- AI automation build
- Test Engine dispatch
- run report generation
- code sync and backups

The product rule should be simple:

- the UI creates an operation
- the backend processes it in its own time
- progress appears in Operations Activity
- clicking an operation opens its full detail view inside the Runs or Executions workspace

## Product Experience

### Test Cases page

Bulk AI test case generation should remain launchable from the Test Cases page, but the page should only do orchestration.

The user flow should be:

1. select requirement scope or case scope
2. click `Generate in bulk`
3. HelloTest creates a backend operation
4. the modal closes quickly with a success message
5. progress moves to `Operations`
6. generated cases land back in the library as drafts or accepted assets

That keeps the Test Cases page responsive even when generation takes minutes.

### Operations Activity

Operations Activity should become the universal job center for HelloTest.

Tile view should show:

- operation type
- current status
- progress counts
- current phase
- scope
- latest update time
- quick summary

Clicking a tile should open the full operation detail view in the existing Executions page area, not a separate page.

That detail should show:

- summary
- progress bar
- phase timeline
- live event feed
- warnings and failures
- produced artifacts
- retry or rerun actions when relevant

## Reuse The Existing Control Plane

HelloTest already has:

- `workspace_transactions`
- `workspace_transaction_events`

Those should remain the user-facing control plane for long-running work.

Do not introduce a second job UI model.

Instead:

- keep `workspace_transactions` as the visible operation record
- keep `workspace_transaction_events` as the progress feed
- add backend-only job tables later for queueing, leasing, payload storage, and artifacts

## Operation Types

Recommended first-class operation families:

- `import`
  - requirements import
  - test case import
  - user import
  - dataset import
- `export`
  - HTML run report export
  - CSV export
  - sync package export
- `ai_generation`
  - bulk manual test case generation
- `smart_execution`
  - smart execution planning
  - smart run materialization
- `automation_build`
  - single test case build
  - suite build
  - stale automation rebuild
- `engine_dispatch`
  - HelloTest to Test Engine handoff
- `reporting`
  - HTML report generation
- `sync`
  - GitHub sync
  - Google Drive backup

## Recommended Backend Job Topology

### 1. Operation record

Created immediately in HelloTest backend.

Visible fields:

- `status`
- `title`
- `description`
- `metadata`
- `related_kind`
- `related_id`

### 2. Job payload record

Backend-only payload storage for large or sensitive job inputs.

Recommended future table:

- `operation_job_payloads`

Why:

- do not overload transaction metadata with huge request payloads
- keep replay and retry safe
- keep prompts, import manifests, and execution plans durable

### 3. Lease and worker control

Recommended future table:

- `operation_job_leases`

Purpose:

- worker claim ownership
- heartbeat
- expiry
- cancellation
- retry after crash

### 4. Artifact record

Recommended future table:

- `operation_job_artifacts`

Purpose:

- generated HTML reports
- import error files
- smart execution CSVs
- AI output manifests
- trace or evidence manifests

## Lanes And Concurrency

Not every operation type should compete for the same resources.

Recommended queue lanes:

- `ingest`
  - imports
  - low AI involvement
- `ai-design`
  - bulk manual test case generation
- `ai-build`
  - automation generation and rebuilds
- `planning`
  - smart execution creation
- `dispatch`
  - Test Engine handoff
- `reporting`
  - HTML report generation
- `sync`
  - GitHub and backup work

Recommended concurrency model:

- imports: low concurrency, CPU and I/O bound
- AI generation: small concurrency, token-budget limited
- automation build: moderate concurrency, prompt-budget limited
- smart execution: low concurrency, high reasoning cost
- engine dispatch: high concurrency, but only for handoff, not browser runtime
- reporting: low concurrency
- sync: low concurrency

## Progress Contract

Every long-running operation should update a shared progress shape through transaction metadata and events.

Recommended metadata keys:

- `total_items`
- `processed_items`
- `succeeded_items`
- `failed_items`
- `progress_pct`
- `current_phase`
- `current_item_label`
- `worker_count`
- `queue_lane`
- `eta_seconds`

Recommended phase events:

- `queued`
- `validate`
- `prepare`
- `dispatch`
- `process`
- `finalize`
- `publish`
- `complete`

This allows one Operations UI to work for every backend process.

## How Specific Features Should Work

### Bulk AI test case generation

Current repo status:

- already backend-driven
- already writes progress into workspace transactions

Recommended improvement:

- treat the Test Cases page as a launcher only
- move all heavy prompt orchestration into backend workers
- periodically update progress counts and current requirement in the transaction event feed
- allow retry of failed requirement slices, not only full job rerun

### Smart execution creation

Two modes are needed:

- `preview`
  - interactive and smaller scope
- `materialize`
  - backend operation for large scope or expensive ranking

If the candidate library is large, HelloTest should enqueue a `smart_execution` operation instead of blocking the UI.

### AI automation generation

Automation build should be a background job almost always.

Supported scopes:

- one case now
- selected cases now
- one suite scheduled
- stale automation rebuild scheduled

Output of the job:

- attached automation asset version
- generation summary
- build diagnostics
- confidence score

### Imports

All imports above a small threshold should be background jobs.

Examples:

- large CSV imports
- Postman collection transforms
- JUnit or TestNG ingestion
- spreadsheet-based test data imports

Small imports can still preview inline, but the commit step should become an operation when volume is high.

### Exports and HTML reports

Report rendering should run as a backend operation.

Flow:

1. user clicks export
2. HelloTest creates reporting operation
3. backend gathers execution summary and artifacts
4. HTML is rendered and stored
5. operation moves to completed
6. UI shows download link in operation detail

## Periodic Updates

Current safest delivery model:

- polling from the Operations tab

Recommended behavior:

- poll operation list every 5 seconds while Operations is open
- poll selected operation detail every 2 to 3 seconds while status is `queued` or `running`
- stop aggressive polling after completion

Future upgrade:

- server-sent events for active operations only

Start with polling because it is simpler and already fits the current frontend architecture.

## Hooks Between HelloTest Backend And Test Engine

For automated execution, HelloTest should create operations and hooks around dispatch.

Recommended internal hooks:

- `operation.created`
- `operation.started`
- `operation.progress`
- `operation.completed`
- `operation.failed`
- `operation.cancelled`
- `engine.dispatch.requested`
- `engine.dispatch.accepted`
- `engine.callback.progress`
- `engine.callback.completed`
- `report.generated`

This keeps orchestration explicit and testable.

## Failure Handling

Every operation should support:

- idempotent creation keys
- retry with backoff
- worker heartbeat
- cancellation token
- dead-letter escalation for repeated failure

Do not rely on in-memory process state alone for important operations.

## Recommended Data Model Additions

Future backend additions:

- `operation_job_payloads`
- `operation_job_leases`
- `operation_job_artifacts`
- `operation_job_children`
- `operation_retry_policies`

These do not replace `workspace_transactions`; they support them.

## Practical Delivery Order

### Step 1

Use the existing `workspace_transactions` pattern for:

- bulk AI test case generation
- imports
- exports
- smart execution materialization
- automation build

### Step 2

Add queue lanes and job leases so operations survive restarts and support bounded parallelism.

### Step 3

Add rich artifacts and HTML report generation as first-class operation outputs.

### Step 4

Add SSE for active operations after the queue model is stable.

## Strategic Rule

The best HelloTest experience is:

- pages stay responsive
- heavy work moves to backend operations
- progress is visible in one place
- details stay inspectable in context
- retries and failures are explicit

That is how bulk AI generation, imports, exports, smart execution, automation build, and Test Engine handoff should all feel like one coherent product.
