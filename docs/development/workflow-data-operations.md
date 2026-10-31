# Workflow data operations

HelloTest's native `dataOperation` node executes eight declarative operations using the shared [operation catalog](../../services/agentic/shared/workflowDataOperations.json), the [backend adapter](../../services/agentic/backend/workflows/dataOperations.js), and the existing workflow execution engine. These operations make no model, database, network, or arbitrary code calls. Existing `transform` nodes retain their whole-input mapping behavior.

The implementation follows n8n's documented node breakdown, with explicit HelloTest contracts rather than compatibility with imported n8n node payloads. Source references were reviewed on 2026-10-31.

| n8n capability | HelloTest operation | Implemented behavior | Deliberate scope |
| --- | --- | --- | --- |
| [Edit Fields](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.set/) | `editFields` | Per-item JSON mapping; retain or replace existing fields; nested destinations | Exact variable references, without executable expressions |
| [Split Out](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitout/) | `splitOut` | Split an array field; select parent fields; configure destination | One array field per node; malformed or missing arrays fail explicitly |
| [Aggregate](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.aggregate/) | `aggregate` | Collect entire items or field values; field projection; optional list flattening and null placeholders | JSON items; no binary transport |
| [Limit](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.limit/) | `limit` | Keep first/last N, including explicit zero | Deterministic input order |
| [Sort](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.sort/) | `sort` | Multiple typed sort fields; ascending/descending; stable ties; explicit null placement | Deterministic comparison; no random or executable comparators |
| [Remove Duplicates](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.removeduplicates/) | `removeDuplicates` | Compare all, selected, or all-except fields; structural equality; keep first | Current execution only; no cross-run history claims |
| [Filter](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.filter/) | `filter` | Per-item conditions combined using all/any | Existing strict native operators; no type coercion or regular expressions |
| [Switch](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.switch/) | `switch` | Named routes; first/all matches; drop, first-route, or separate fallback | Declarative rules; output ports are stable route IDs |

The n8n [item-linking contract](https://docs.n8n.io/build/work-with-data/reference-data/link-data-items/how-items-link-through-workflows.md) and the official [Split Out](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Transform/SplitOut/SplitOut.node.ts) and [Aggregate](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Transform/Aggregate/Aggregate.node.ts) implementations informed provenance handling. HelloTest records its own explicit `source_items` metadata for each input index and associated output indexes, including discarded duplicates that map to the retained item. This metadata describes only the current transformation; it does not assert product evidence or automation verification.

## Native flow capability matrix

| Capability | Executable HelloTest contract | Boundary |
| --- | --- | --- |
| [Loop Over Items](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitinbatches/) | `loopAction: "workflow"`, `loop` and `done` outputs, final body return to `continue`; batches feed connected body nodes; Done collects processed results | Isolated nested bodies, up to four nesting levels; 100 input items per loop; shared maximum 100 batches and 1,000 body step executions |
| [Merge](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.merge/) | Append, combine fields, position, matching fields, all combinations, or choose input; ordered input ports and explicit clash policy | Two inputs for item-combining modes; five matching joins; no arbitrary SQL |
| [Wait](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait/) | Bounded delay that preserves input and observes cancellation and step deadlines | 0–60 seconds; calendar, webhook, and form resume conditions are not offered |
| [Stop And Error](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.stopanderror/) | Explicit reason fails the step; optional native Error handler receives it | A recovered failure remains visible and leaves the execution needing review |
| Branching and fan-in | Typed Condition true/false ports and named Switch routes; empty item branches skip downstream work | Unconfigured Switch handles are blocked before execution; merge order follows numbered input ports |
| Scheduling | Dependency-aware sequential or bounded parallel branches, with sensitive/effectful nodes kept exclusive | Manual triggers execute; scheduled/webhook starts and approval gates remain unavailable in the current native execution adapter |

Graph previews remain explicitly simulated. Executing a workflow uses the native execution endpoint and actual node adapters. Nested execution records carry complete `iteration_path` values; each completed or failed batch has an inspectable body snapshot. An unhandled body failure preserves earlier results and prevents the next batch. Cancellation and timeout do not establish a successful run.

## Configuration and data contract

Every node sets `kind: "dataOperation"`, `dataOperation`, and `dataSourceKey` (default `input`). The source must resolve to an array; for an HTTP response use the path shown in its actual output, such as `input.items`. Legacy Map JSON can explicitly wrap a single object: `{"items":["$input"]}`. Each operation's catalog supplies complete defaults. Mapping, sort, aggregate-field, condition, and route editors persist JSON strings; the backend also accepts their parsed JSON values.

Per-item mappings and conditions resolve `$item` and `$input` to the current item. `$request`, `$nodes`, and `$iteration` retain native workflow meaning; `$iteration` contains the current zero-based `index`, one-based `number`, and `total`. Mapping strings are literal unless the complete string is an allowed variable path. Dotted destination field names create nested objects. Reserved prototype keys and overlapping mapping destinations fail validation.

Results contain `data` (an array), `operation`, `input_count`, `item_count`, and `source_items`. Split Out links every generated child to its parent. Aggregate links its one output to every input. Limit, Sort, and Filter preserve the exact retained-item associations. Empty filters, zero limits, and empty split arrays produce no fabricated items. Aggregate deliberately produces a single aggregate object even for an empty source.

Switch additionally returns `routes` (route ID to item array), `route_items` (route ID to source indexes), and `routed_count`. `data` includes each accepted input once; `routed_count` includes multiple placements when all-match mode is enabled. A route named `fallback` is reserved for the separate fallback option. Source handles must select a declared route; downstream nodes receive that route's array rather than the entire Switch result.

## Bounds and verification

Inputs and outputs are bounded to 1,000 items and 128 KB of JSON including result metadata; operation configuration is bounded to 16 KB. Paths allow 12 segments and JSON nesting allows 32 levels. Limits fail the node without returning a successful prefix. Numeric/boolean/date sort modes require actual matching types; automatic sort rejects mixed field types. Date values use valid ISO calendar dates or ISO timestamps with explicit time zones so remote hosts produce the same order. Missing sort values use the configured null ordering. Deduplication distinguishes absent fields, explicit null, and differently typed values.

Run `node --test services/agentic/test/backend/workflowDataOperations.test.js` to verify the actual native adapter, catalog defaults, item-level context, non-mutation, provenance, first/all/fallback routing, malformed configuration, prototype paths, type handling, cancellation, and bounds. Scheduler-specific routing and loop/merge behavior are tested separately by the workflow runtime suite.

Run `node --test services/agentic/test/backend/workflowFlowExecution.test.js services/agentic/test/backend/workflowMergeOperations.test.js` for connected and nested loop execution, exact route subsets, ordered fan-in, terminal iteration history, shared loop budgets, deadline propagation, cancellation, Stop recovery, all join variants, and clash handling. These fixtures execute real node adapters with an in-memory persistence boundary; they do not claim a deployed database or Temporal worker run.
