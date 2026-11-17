# Automation backend contracts and ownership

This records the code-level architecture changes from the Automation, Agents and
Workflow Nodes review on 17 November 2026. Existing mutation guards, immutable
build/engine input snapshots, permission checks, recorder source preservation,
native worker routing and execution-evidence rules remain the baseline.

## Package direction and public ports

The AI/Automation/Agentic capability dependency direction is now
`Agentic → Automation → AI`; portable types/policies live beneath all three in
`@hellotest/contracts`. That infrastructure package imports no capability and is
not discovered as a separately deployable feature. It contains the versioned
agent descriptors/lifecycle, workflow descriptor types, engine envelope,
canonical evidence/packet schemas and shared retry/lease policies. Frontend TypeScript declarations and runtime
implementations have separate conditional exports. Exact JSON exports take
precedence over JavaScript wildcard members.

`@hellotest/contracts/evidence` is the single canonical portable schema and
bounded validator for Knowledge objects, retrieval requests/events, context
packets and answers. Knowledge retains its compatibility export and domain
builders; the shared package owns no retrieval or persistence behavior. Generated
TypeScript declarations derive from these schemas and the architecture gate
checks drift. Both relationship aliases participate in witness validation; an
empty alias cannot conceal populated evidence in the other alias.

The full production source-import audit checks every service, not only these
three manifests. It rejects an induced cycle in the three capabilities,
undeclared imports, deep `backend/lib` or `backend/services` exports on their
public maps, and outbound service imports from contracts. Existing package-level
host/foundation composition edges elsewhere still form a larger aggregated
component; this change does not claim that the entire repository is a DAG.
Composition entry points and foundational Platform imports require a separate
whole-platform ownership migration if that broader DAG becomes a requirement.

Automation owns repair rules, context, service, route and review UI. Existing
`/ai/automation-repairs` HTTP URLs remain stable, while both gateway route metadata
and focused browser routing select Automation. Agentic invokes the public
`@hellotest/automation/repair` port. AI's generic lifecycle review accepts an
explicit repair-render slot, avoiding a reverse UI dependency.

Repository inspection browser controls, hook, pairing/session helpers and HTTP
client live in Automation. AI owns generic command/evidence/activity primitives
and the review/progress HTTP client. Agentic's remaining activity compatibility
port points downward to AI; its service-definition index has no eager UI export.
The canonical activity view remains available through the lazy capability entry.

## Cohesive implementation seams

`aiAutomationBuilder.service.js` now owns build admission/orchestration and public
entry points. Real implementation factories under `services/builder` separate
engine resolution, program generation, recorded-program compilation, recorder
import, repository modeling and repository storage. Explicit lazy dependency
ports preserve existing access, transaction, model and engine boundaries. These
modules contain the implementation; they are not extra forwarding facades.

`testEngineDispatch.service.js` retains serialized queue/callback ownership.
`services/dispatch` owns engine-type normalizers, envelope assembly and execution
planning. `@hellotest/contracts/engine` defines `engine-run/1`, checks the transport
shape, preserves extension/frozen fields, reads retained unversioned envelopes,
and rejects explicitly unsupported versions. Native worker validators still own
runtime-specific step/source syntax; this schema does not replace them.

Automation's former flat helper directory is physically grouped into `browser`,
`recording`, `parameters`, `verification`, `upstream` and `build`. Each domain has a
small implementation index in its README. Callers import the actual owner;
there are no old-path compatibility wrappers or unused eager barrel modules.

The browser loop has named transitions and a state diagram in its module header.
The public transport entry is separate from observation/planning/validation/
action/verification/publication/recovery. A terminal state cannot perform another
action, and cancellation/deadline checks reject late provider completion. A
completed loop remains a generation result; passing assertions require actual
execution evidence.

## Workflow kind and data-action ownership

The canonical node registry binds 23 concrete kind definitions. Each module owns
its validator, optional preflight and executor together with the portable schema,
ports, handles, UI defaults and exclusivity policy selected by the definition
helper. The runtime retains access, graph scheduling, cancellation and receipt
orchestration; it does not dispatch business behavior by kind or executor family.
Versioned Temporal scheduler histories retain their existing command contract.

Wait and Stop have actual flow implementations. Data Operation admits bounded
JSON once, then invokes one of eight action-specific compilation/execution
owners: edit fields, split out, aggregate, limit, sort, remove duplicates, filter
and switch. Common item/byte limits, cancellation and input-to-output provenance
remain in the facade. Shared path/value helpers contain no registry or runtime
imports, avoiding an initialization cycle. Compatibility facades retain their
existing public signatures without forwarding a giant branch elsewhere.

The integrated workflow gate passed 581 tests with two explicit integration skips;
a separate real Temporal/PostgreSQL run passed trigger/resume, nested/parallel
loops, acknowledged and uncertain effects, cancellation and history replay.
These are isolated runtime checks, not evidence that the deployed app has already
polled its production queue or delivered a live trigger.

## Activity and authoring boundaries

Build activity has an authenticated SSE endpoint with a durable event offset,
bounded connection duration, heartbeat, disconnect cleanup and permission
rechecks. The focused client/hook handles split UTF-8 frames, cursor reconnect,
scoped snapshot merging and polling fallback. Authorization loss clears retained
authorized details and stops retrying. A disconnect stops observation, not the
underlying job; reconnect status is visible to the user.

Build/record admission, durable recording import, queue ownership and deployment
policies are documented in the four-runtime ownership table in
[agent-runtime-contracts.md](agent-runtime-contracts.md). The authoring-state
endpoint returns a code-free scope-specific ownership receipt. Conflict errors
expose only allowlisted activity identity/status/phase, never arbitrary error
details or source values. Definite recorder rejection releases admission;
uncertain start/stop acknowledgement retains ownership and requires reconciliation.

Unmapped frontend steps no longer produce placeholder/no-op programs. Their
structured repository/request review issues direct the user to the missing
mapping. API previews assert only authored expectations; no default success
status is invented. Existing recorder preflight rejects unsupported contexts and
missing target/file bindings before preparing or replacing a saved plan.

Generation retries share the AI safety classifier. Explicit rejection and local
predispatch capacity can recover under bounded policy; accepted output,
truncation and uncertain mutations are not automatically repeated. The existing
host-selected buffered source-proposal phase retains its separately reviewed
bounded transport-retry opt-in; this does not authorize replay of browser or
project mutations.

## Verification and review guard

The 1,200-line review check requires a named owner, concrete split seams, relevant
validation and a bounded line ceiling for each remaining oversized file. Plans
are versioned in `large-file-split-plans.json`; unreviewed growth fails the check.
UI controller extraction has its own browser behavior and rendering evidence and
must finish before the final whole-repository orphan/threshold audit is accepted.

The final host backend run covered all 615 discovered test files with concurrency
two: 4,858 passed, no failures or cancellations, and 33 explicit skips. The Test
Engine suite passed 272 tests with one optional compression skip. Separate real
PostgreSQL tests verified six authoring admission/receipt scenarios. Actual
recorder start orchestration, shared lease ownership, safe error transport,
browser terminal/cancel states, versioned engine contracts, SSE authorization/
reconnect and source export resolution have focused regressions. The complete
OpenAPI operation/security/schema parity gate passed six checks. Final metadata
and runtime-public-port checks passed; all 257 exports resolve. Workflow owner
verification separately exercises the real isolated Temporal/PostgreSQL runtime.
App and Node frontend type checks and full frontend contracts are owned by the
final UI integration verification.
These checks use real code and transactional PostgreSQL where stated; fixture
HTTP/UI tests are identified as such. They do not establish a new deployed app
session, a paid-model completion, physical mobile execution or live unattended
trigger delivery. Those deployment/runtime smoke receipts belong to the final
operator-led verification.

The API runtime image now copies the contracts manifest before workspace install
and its full source before runtime validation. The image check resolves short,
conditional and wildcard public ports plus concrete runtime consumers without
evaluating services. A regression builds the real Dockerfile copy surface into an
isolated package tree; all six packaging checks pass and the complete runtime
surface resolves 257 ports. Optional local durable setup is documented in
[local-workflow-runtime.md](../product/local-workflow-runtime.md); its pinned
official image passed isolated named-volume persistence across restart. The final
operator rollout separately confirmed a deployed durable worker with both
workflow and activity pollers and seven live webhook/schedule/cancel/resume
checks. This is distinct from the earlier isolated runtime suite.

The rollout exposed a local-only credential-policy mismatch: the durable image's
production default rejected the existing local API encryption key. The local
overlay now explicitly selects development/local mode and preserves that exact
key, engine credentials and callback addresses. Production retains strict secret
validation. Startup now verifies both schema receipts, cleans up partially opened
resources and logs only a known phase/code/static hint. Eight focused startup,
secret/redaction and serial-build checks pass. The deployed entry/diagnostic
source hashes match the final worker image.

A read-only build diagnostic observed main frontend completion alongside heavy
host paging and VM memory stalls. The documented local `build` command therefore
builds API, frontend and durable worker serially, stops on the first failure and
starts no service. It changes no global Docker/RAM settings. Final deployment and
end-user evidence are tracked in the review ledger.
