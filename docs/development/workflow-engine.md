# Native workflow execution and editor

The Agentic Workflow editor now exposes real bounded adapters for connected loops, item transformations, explicit merge modes, Wait and Stop. These execute through HelloTest's native workflow engine; they are not delegated to an n8n installation, and importing arbitrary n8n node JSON does not make its integrations executable. See the [complete n8n core-node comparison](n8n-workflow-parity.md), [data and flow contracts](workflow-data-operations.md), and [managed credential contract](workflow-credentials.md).

## Connected loops

Set `kind: "loop"` and `loopAction: "workflow"`. The input path (`loopSourceKey`) must resolve to an array. `loopBatchSize` determines each batch and `loopMaxIterations` limits the total input items; an oversized input fails before dispatching its body. The editor's default is a batch of one, at most ten input items, and a three-minute composite timeout.

Connect `loop` to the first body step, connect the final body step back to the loop's `continue` input, and connect `done` to the steps that consume the collected results. The body must finish before the next batch starts. Every body branch needs a path back to Continue, including any error recovery branch. Arbitrary cycles, extra body entry points, scope-crossing returns, and body branches that escape to an Output are rejected. Drafts may be saved incomplete; readiness prevents execution until the body is connected.

`$input` is the current connected value: the batch array at the first body step, then the preceding step's actual output. `$item` is the loop input item for batch size one, or its batch for larger batches. A data operation applies its own per-item mapping and binds `$item` and `$input` to each item. `$iteration` includes batch index, number, total and batch size. `$request` stays the original execution input. Mappings use restricted data paths, not executable JavaScript expressions.

Done emits the processed values returned by selected body branches in batch order. Empty input skips the body and exposes an empty collected result. Each body result has an `iterations` history with exact recorded input/output/error/status, item range and `iteration_path`. The inspector can select prior batches, including failed and skipped records; raw JSON copying preserves the selected record. Selecting Execute Step inside a body is blocked because a body requires its enclosing batch context; execute the enclosing loop instead.

Nested loop bodies are isolated and may be four levels deep. Shared limits across connected loops are 100 total batches and 1,000 body step executions. Each loop accepts at most 100 input items; collected output is at most 1,000 items and 128 KB. Execution history is bounded to 2 MB. A failed or cancelled batch preserves earlier results and prevents subsequent batches. A failure recovered in an earlier batch remains visible and leaves the final execution needing review even if the last batch succeeds.

Legacy inline field-mapping, per-item AI-review and revision-pinned Story-packet loop modes retain their separate contracts. The foreach sample template uses the connected-body contract.

## Merge and branch scheduling

All connected dependencies must reach a terminal state before a fan-in runs. Conditions and Switch expose selected ports; inactive branches do not dispatch downstream work. Switch gives each connection only its selected route's items. A data operation that produces zero items stops its branch rather than fabricating a success item.

Merge orders numbered input ports before unnumbered connections, preserving connection order among equal ports. Append retains each input's item ranges. Legacy Combine Fields preserves conflicting scalar alternatives with conflict provenance. Position, Matching Fields and All Combinations operate on two object-item streams and expose paired indexes. Matching Fields supports inner, left, right, outer and non-match outputs, strict typed comparisons and first/all matches. Field clash policies explicitly select the first input, last input, or suffixed values. Choose Input waits for dependencies and returns only the selected input; selecting an inactive input returns an empty array.

Sequential mode dispatches one dependency-ready node. Parallel mode dispatches up to the saved `max_parallel_nodes` (1–8). External mutations, MCP tools, native artifact tasks, repository analysis, Stop and composite loops execute exclusively. Client-supplied `exclusive` flags cannot weaken this rule. Body steps run sequentially; outer independent branches may run in parallel. Merge order follows ports and connections, never completion timing.

The workflow deadline defaults to three minutes, or one hour when native artifact tasks are present. `settings.maxDurationMs` explicitly sets 1,000–3,600,000 milliseconds. Each connected loop's timeout covers all its batches and body steps; the workflow deadline also applies. Wait is a cancellable 0–60-second interval that retains its input. It does not expose calendar, form or webhook resume behavior. Stop raises its configured reason and can route to an Error handler.

## Native Story checkpoints and external effects

Public node output is distinct from revision-bound native Story checkpoints. A loop selects only its current batch's exact Story IDs and revisions for body input, and separately accumulates completed checkpoint lineage for Done. It never feeds the previous batch's completed Story into the next batch. Wait and other data-preserving nodes retain this lineage. Choose Input retains only the chosen port's checkpoints. Generic positional/key/cartesian joins refuse native checkpoints because arbitrary field joins cannot safely determine artifact identity; use Append, Combine Fields or Choose Input for those branches.

Managed connections resolve encrypted credentials immediately before transport; workflow definitions store their references. Destination policy and auth identity are validated on save and dispatch, and response echoes are redacted. The API diagnostic route uses the same managed/public-only HTTP transport. Definitions and legacy run snapshots are sanitized at the service boundary. Inline credentials are rejected before a new execution is stored.

Effect receipts include the run, node and nested iteration path in their identity. Separate batches can perform separate approved operations; an acknowledgement retry cannot repeat the same operation. A missing committed response remains an unknown outcome requiring reconciliation.

## Durable execution

New Temporal plans use scheduler version 2 with the same dependency, selected-port, parallel and exclusive-operation rules as the local worker. Accepted legacy plans retain their original command sequence for history replay. Parallel activities patch only their own node projections, avoiding lost sibling progress. A composite loop records its body results in its verified receipt, so recovery after a lost activity acknowledgement restores the complete iteration history without dispatching its body again. Native payloads and credentials remain outside Temporal workflow arguments/history; summaries carry IDs, hashes and branch decisions.

If the activity stops before its composite receipt commits, recovery records an unknown outcome and preserves already persisted body snapshots for inspection. Those snapshots never authorize resuming an effect. The failed parent stops downstream dispatch. Cancellation likewise preserves recorded body progress while marking any interrupted step explicitly.

## Verification

- `npm run test:workflows`: native data/flow, merge, HTTP/MCP, credentials, lineage, run persistence and existing workspace regression tests.
- `npm run test:workflows:temporal`: a fresh disposable local PostgreSQL database and actual Temporal server/worker, including parallel overlap, ordered fan-in, connected/nested loops, acknowledgement recovery, an injected pre-commit receipt failure, cancellation and five history replays. The fault fixture checks that all three completed batch outputs remain available, only three actual body dispatches occurred, and no downstream output ran. The runner refuses remote or existing non-empty verification databases and drops its temporary database.
- `node --test services/agentic/test/frontend/workflowGraph.test.mjs`: port/return validation, insertion, layout, templates and JSON export.
- Browser fixtures under `services/agentic/test/browser/`: actual sort/filter dispatch through editor configuration, stable Switch ports, merge/loop controls, deadline/concurrency persistence, read-only inspection, recorded iteration JSON, desktop and mobile layout.

These checks do not publish to the deployed HelloTest environment or establish parity with every n8n integration.
