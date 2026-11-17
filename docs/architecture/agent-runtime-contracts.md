# Agent runtime contracts

The four agent families share versioned descriptors and lifecycle history while
retaining their native execution controls. `@hellotest/contracts/agents` is the
transport-neutral contract; it imports no service. The stock catalog describes
22 workflow specialists, four repository analyses, five quality reviews and
Automation Engineer. A descriptor records identity, objective, versioned
instructions, tool effects, evidence scopes, reviewed output and bounded limits.
Native effective specialist configuration is snapshotted when its run starts.
Historical descriptors are marked as reconstructed, rather than presented as an
exact historical instruction receipt.

## Shared evidence packet authority

`@hellotest/contracts/evidence` physically owns the canonical version1.0 JSON
schemas and bounded validator for KnowledgeObject, RetrievalRequest,
RetrievalEvent, ContextPacket and AnswerContract, plus the model-answer candidate
schema. Its generated declaration types come from these exact runtime schemas;
there is no separately maintained packet DTO/schema. Shared evidence-scope keys
also live in contracts. The Knowledge compatibility module re-exports the same
object, while Knowledge retains all builders, source authorization, grounding,
cache privacy and witness enforcement. The move changes no runtime shape,
version, business behavior or database schema. Type validation does not grant
source access or establish that a claim is supported. Both relationship aliases
are validated for exact packet witness membership, including when the other
alias is empty; foreign proof IDs cannot bypass the invariant.

## Persisted lifecycle and consistency

The observability database owns `agent_runs` and `agent_run_events`. Shared
statuses distinguish queued, running, waiting, succeeded, partial, failed,
cancelled and unknown. `succeeded` means the agent finished; an agent proposal
still requires its native review/apply gate and is never a passing test receipt.
Native tables continue to own execution, leases, cancellation and artifacts.

Workspace-backed specialist, quality and automation lifecycle/events project
into the canonical ledger in the same database transaction. Repository and
workflow tables can live in the main database: their native writes enqueue a
small transactional outbox identity. An idempotent worker projects those rows
into the ledger, then acknowledges only that queued version. There is no claimed
atomic transaction across the two databases. A failed delivery remains queued;
activity responses disclose pending batches and current synchronization time.
Read-through reconciliation covers a bounded recent source window. Migration
backfills all retained workspace history and seeds the complete main-store
outbox. Cursor pagination reads the retained canonical history without silently
truncating it to the reconciliation window.

Descriptors stay attached to the run that created them; later catalog edits do
not rewrite its instruction snapshot. Events preserve only safe correlation and
bounded latency/failure fields; native payloads and artifacts keep their
existing access policies. Current project membership, feature and permission
checks apply on every list/detail request, and detail verifies that the native
source still exists in the same scope. An activity row does not confer access.
The common AI-owned `AgentActivity` UI supports pluggable native detail controls.

## Execution ownership

The activity ledger describes execution; it does not replace any of these four
execution owners. Their claims and recovery contracts deliberately differ.

| Runtime | Claim and retry owner | Cancellation | Recovery | Evidence owner |
| --- | --- | --- | --- | --- |
| Temporal workflow | Temporal task queue, workflow history and the Agentic delivery outbox. Versioned scheduler commands and native node receipts bound activity retries; uncertain writes are reconciled rather than replayed. | Agentic persists cancellation and delivers the durable cancel command; active activities observe the run signal and deadline. | Temporal resumes the recorded history. Resume-from-node creates a new run and reuses only validated matching receipts. | Native workflow/node receipts and artifacts; canonical agent events project their lifecycle. |
| Development FIFO | Agentic process owns two active slots and twenty waiting entries. A waiting entry has dispatched no effect; it starts in FIFO order and receives a fresh execution deadline. | Removing a waiting entry performs no node action. Active local work observes its abort signal; terminal writes remain conditional. | The in-memory queue is not durable. Lost local ownership becomes interrupted, with retained completed work and no automatic action replay. | Persisted native run/node results; the FIFO is not an evidence store. |
| Interval workers | AI generation, Story generation, Automation generator and Testing batch services own their SQL claims, owner/lease checks, due times and bounded retry decisions. Shared helpers support applicable lease heartbeats and durations; they do not claim jobs. | Native queue cancellation updates the persisted job and linked activity; generation guards stop further provider calls and saved-case changes after lease loss. | Expired claims are considered under each queue's native recovery policy. AI capacity recovery is delayed in its queue; accepted model output and uncertain mutations are never blindly regenerated. | Native job results, workspace events and source artifacts; canonical lifecycle projection preserves its source reference. |
| Test Engine pull lease | Automation dispatch owns persisted queue state, worker-class selection, SQL lease ownership, frozen envelopes and callback admission. Workers execute the leased request; callback/event deduplication retains ordered evidence. | Dispatch and worker cancellation use the run/job identity. Expired or cancelled ownership cannot publish a passing result. | Native lease and receipt rules govern recovery. Completed/submitted effects and uncertain outcomes retain their identity and are not treated as fresh work. | Test execution results, assertions, screenshots/video/traces and artifact metadata remain owned by dispatch and the engine. |

`@hellotest/contracts/runtime/lease` provides the existing Testing/Automation
generation heartbeat with one in-flight renewal, a finite renewal watchdog,
linked cancellation, and a terminal lease-loss signal. It also normalizes bounded
pull-lease durations/expiry for generator and Test Engine queues. It contains no
SQL, cross-store transaction, recovery scheduler or implicit retry. AI generation
keeps its distinct heartbeat-grace behavior; Temporal keeps its own SDK lifecycle.

Direct builds, queued builds and recorder starts share application-scoped
PostgreSQL admission. A recorder ownership activity is reserved while holding the
lock, before a browser/device POST, and network work starts after that transaction
ends. Linked manual and automation cases share the exclusion. A durable recording
import receipt commits with the saved plan/readiness; its transaction correlation
releases admission even if optional activity delivery fails. Retrying that receipt
never replaces a later edit. Unknown recorder POST/stop outcomes retain ownership
and a safe activity reference instead of allowing an automatic duplicate session.

## Deployment and compatibility

Run the standard additive migration with both database connections configured
before restarting API/worker profiles. This revision requires main schema 24 and
observability schema 3. The new recording activity column is nullable, so retained
legacy import receipts remain readable. Verify-mode processes reject older schema
receipts. Contract-package files must be included in the workspace install and all
API/durable-worker images.

For production workflows, set `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE` and
`TEMPORAL_TASK_QUEUE` identically on API and Agentic durable worker, using the
existing persistent Temporal deployment. Apply
[`docker-compose.agentic-durable.yml`](../../docker-compose.agentic-durable.yml)
over the deployment's normal compose file. The overlay deliberately does not
create a production Temporal database. Use the same application database,
observability database, artifact storage and encryption/connection credentials
on both processes. Keep these values in the existing private environment file.

```sh
docker compose --env-file /path/to/deployment.env \
  -f docker-compose.platform.yml -f docker-compose.agentic-durable.yml \
  build api agentic-durable
docker compose --env-file /path/to/deployment.env \
  -f docker-compose.platform.yml -f docker-compose.agentic-durable.yml \
  run --rm --no-deps api npm run migrate
docker compose --env-file /path/to/deployment.env \
  -f docker-compose.platform.yml -f docker-compose.agentic-durable.yml \
  up -d api agentic-durable
```

Manual local workflows remain available with `APP_MODE=local`,
`NODE_ENV=test/development`, or an explicit
`WORKFLOW_ALLOW_LOCAL_FALLBACK=true`. Otherwise a missing Temporal configuration
returns `WORKFLOW_DURABLE_RUNTIME_REQUIRED`/503 and a readiness blocker. Compose
passes the opt-in flag with a false default. Unattended triggers and durable
resume always require Temporal; the development opt-in does not enable them.
Test runners explicitly set `NODE_ENV=test` when the caller has not selected one.

To exercise unattended workflows on a developer machine, run a separate Temporal
development server with a persisted SQLite file and connect both API and durable
worker to it. The CLI's development server and Docker binding are documented in
the [official Temporal setup guide](https://docs.temporal.io/cli/setup-cli). This
is a local verification setup, not the production persistence design.

```sh
mkdir -p .hellotest/temporal
temporal server start-dev --ip 0.0.0.0 --port 7233 \
  --ui-port 8233 --db-filename .hellotest/temporal/development.db
```

For Docker Desktop, use `TEMPORAL_ADDRESS=host.docker.internal:7233` for both
containers; host processes use `127.0.0.1:7233`. The durable overlay can be applied
to the existing local-run compose file with `HELLOTEST_SOURCE_CONTEXT=..`;
relative paths continue to resolve against `local-run`. Preserve its existing
project identity and volumes. The
worker database URL must use the compose `postgres` host rather than a host-only
loopback URL. A separate named Temporal container can instead join that same
compose network, with its persisted development SQLite file in its own volume;
then both services use that container's DNS name. Do not alter existing app data
volumes to enable the runtime. Run the isolated Temporal/PostgreSQL suite before
claiming live trigger delivery, and verify actual API/worker task-queue polling
after deployment. Deployment of this refactor remains the owning operator's step.


For example, after configuring the local private environment with the same
Temporal connection and container-reachable database URLs, use the **existing**
local compose project name in place of `hellotest-local`:

```sh
HELLOTEST_SOURCE_CONTEXT=.. docker compose --env-file .hellotest/local.env \
  -p hellotest-local -f local-run/docker-compose.yml \
  -f docker-compose.agentic-durable.yml build api agentic-durable
HELLOTEST_SOURCE_CONTEXT=.. docker compose --env-file .hellotest/local.env \
  -p hellotest-local -f local-run/docker-compose.yml \
  -f docker-compose.agentic-durable.yml run --rm --no-deps api npm run migrate
HELLOTEST_SOURCE_CONTEXT=.. docker compose --env-file .hellotest/local.env \
  -p hellotest-local -f local-run/docker-compose.yml \
  -f docker-compose.agentic-durable.yml up -d api agentic-durable
```


## Specialist evidence loop and model boundary

A specialist can request at most four additional read-only evidence calls under
its existing model-call, deadline and cancellation budgets. Native provider tool
calls go through the existing authenticated MCP backplane. Tools are fixed to
project evidence, indexed knowledge, an already observed record, or one bounded
graph neighborhood. Host-owned actor/project/application/source selectors cannot
be replaced by model arguments. Explicit source or exact-record selectors disable
any broader graph read. Each call renews access, bounds its response and records
started/completed/failed activity; newly admitted citations join final grounding
checks. A read or model proposal never establishes an executed effect.

`specialist-system/1` hashes the actual prepared system/developer messages just
before provider dispatch. Run metadata retains this hash, instruction version,
and full prepared-message hash; ordinary activity contains correlation rather
than provider bodies. Fixtures pin all 22 assembled stock frames, including the
expanded managed instruction defaults. Native tracing retains each actual model
POST and permitted schema correction. The shared structured completion boundary
is reused by Defect generation and Knowledge intent/answer JSON completion;
feature adapters own source grounding and domain checks. Retry policy comes from
`@hellotest/contracts/runtime/retry`: uncertain accepted/transport-failed model
POSTs are not automatically replayed.

## Routing, capabilities and telemetry

Deterministic intent anchors are the first pass. The existing Knowledge planner
resolves only unresolved intent (or an explicit model-planning request), using
validated query class, scopes and high/medium/low confidence. Low confidence
widens the eligible evidence scopes while preserving every explicit source and
record selector. Retrieval diagnostics and the chatbot details show confidence
and widening; no additional planning model is needed for known specialist or
exact native-record scope.

Repository Python/compiler readiness is an explicit optional runtime capability,
reported by health and the repository catalog. Unavailable analyses disappear
from launch choices and fail before model configuration or source work. Core API
readiness remains usable when this optional runtime is unavailable.

`/metrics` exports bounded `system`, `kind`, and safe failure-code labels for all
four families: stage latency, actual model calls, terminal tool calls, budget
exhaustion and failures. These process counters reset on restart; the persisted
canonical/native events provide retained per-run correlation. Prompts, tool
arguments, run IDs, project IDs and principal IDs are not metric labels.


## Workflow editor ownership

`WorkflowOperationFields` selects a concrete kind component from
`workflows/operationEditors/registry.ts`. The registry binds all 23 canonical
node kinds to their presentation metadata, including `ui.panel`. Seventeen
operation kinds own actual editor controls in individual leaf modules;
specialist, repository-agent, trigger and output controls remain in the native
inspector and have no supplemental operation fields. Shared input, connection
and HTTP request primitives do not dispatch kinds. The kind editor owns its
resource queries and dependent patches, including merge matching defaults,
loop mapping defaults, and wait timeout adjustment.

The extraction preserved 49 representative rendered variants and every emitted
control update in a one-time comparison with the exact pre-extraction source.
The former implementation is not shipped as a duplicate fixture. Repeatable
contracts exercise the actual registry, literal/blank values, native task data,
managed connection credential replacement, Sprint binding and MCP tool access.
