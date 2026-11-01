# Workflow node audit — 2 November 2026

The reported Sprint Automator failure was an invalid JSON-mode model request.
The saved native node replaced the feature's default prompt, removing its only
explicit JSON instruction. The remaining instruction blocks and serialized
schema did not contain the required literal word. OpenAI-compatible JSON mode
requires that instruction in `messages` when `response_format.type` is
`json_object`; see the [official Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat).

The shared request policy now inserts a trusted, idempotent JSON directive before
dispatch, including when strict schema mode downgrades to JSON mode. It preserves
JSON mode and the native output validation rather than removing the output
contract. A valid graph, a passing readiness check or a successful mocked provider response
does not establish that a live provider accepted the request.

## Node implementation inventory

The editor declares 23 supported node kinds in
[workflowGraph.ts](../../services/agentic/frontend/workflows/workflowGraph.ts).
The new [node contract tests](../../services/agentic/test/backend/workflowNodeContracts.test.js)
compare their fixture coverage with that TypeScript declaration, then validate
an executable graph for each kind. Connected loops include their Loop, Continue
and Done edges; error handlers include a parent configured to route failures.
This checks readiness coverage, rather than claiming 23 live external services
were executed.

| Node kinds | Actual execution adapter | Verification boundary |
| --- | --- | --- |
| `trigger`, `output` | Native request input and selected connected results | Local runtime/store fixtures; output preserves the actual selected input |
| `agent`, `llmAgent`, `customAI` | Registered specialist policy and `assistant.respond` | Controlled model/assistant responses, permissions, budgets and saved results; live provider quality is separate |
| `repositoryAgent` | Source-analysis worker with bounded polling and cancellation | Controlled worker results and repository identity; source compiler/provider execution has separate suites |
| `artifactTask` | Native Story assurance, Test Case generation, Test Case assurance and Automation Engineer | Exact stage readiness, permissions and revision-bound lineage; real Sprint persistence is checked by the PostgreSQL pipeline fixture |
| `apiTool`, `apiAgent`, `webAgent` | Managed/public HTTP transport | Real local HTTP server, all seven supported methods, managed credentials, encoded mappings, status failures, pagination and uncertain write receipts; Web evidence forces GET |
| `mcpTool` | Project-scoped enabled tool, negotiated MCP transport and schemas | Real local JSON/SSE protocol fixture, session headers, selected tool, schema changes and argument validation |
| `knowledgeTool`, `repositoryTool`, `testOpsTool` | Authorized bounded Knowledge retrieval with the appropriate source-kind restriction | Controlled retrieval packets and permission revocation; no replacement search index or fabricated run evidence |
| `condition` | Strict typed comparison and selected branch | Actual comparison values, including JSON `false`, `0`, `null`, arrays and objects |
| `loop` | Connected body, legacy mapping, per-item review or Story packets | Connected/nested body execution, exact batch context, empty input, output collection, scope guards and bounded histories; Temporal receipts have a separate integration run |
| `transform`, `dataOperation` | Restricted path mapping and eight declarative data operations | Actual values, selected ports, empty output, reserved paths, item/byte limits and provenance |
| `aggregator` | Six implemented merge modes and dependency barrier | Actual ordered arrays, strict joins, field clashes, unpaired items, native checkpoint selection and output bounds |
| `wait`, `stop` | Cancellable bounded delay and explicit terminal reason | Actual delay cancellation and Stop routing with controlled run persistence |
| `errorHandler`, `log` | Failed-source context and sanitized execution log | Structured recorded failures, safe messages, retained attempts and downstream recovery state |

The implementation entrypoints are
[the runtime](../../services/agentic/backend/services/agenticWorkflowExecution.service.js),
[node operations](../../services/agentic/backend/workflows/nodeOperations.js),
[native artifact tasks](../../services/agentic/backend/workflows/artifactTasks.js),
and [structured runtime events](../../services/agentic/backend/workflows/runtimeEvents.js).
The [workflow contract](workflow-engine.md) defines loop, merge, replay and effect
semantics. No arbitrary JavaScript, external trigger infrastructure or unlisted
integration is implied by this inventory.

## Concrete input and dispatch fixes

- A boolean or array could be coerced into a valid case count. Generator counts
  now accept only scalar numeric values from 1–10. Invalid Sprint trigger IDs
  and explicitly malformed model connection selectors stop before native model
  resolution. Sprint API-only reads use the same Sprint identity validation
  without requiring application or generation settings that their adapter does
  not consume.
- A direct Condition comparison supplied as raw `false`, `0` or `null` could be
  replaced by the default comparison against `true`. The field now requires
  JSON text, consistent with the editor and data-operation conditions. The text
  values `false`, `0` and `null` retain their exact types.
- Retained Sprint API fields could dispatch HTTP after changing a node to a
  transformation. Sprint-specific dispatch and validation now apply only to HTTP
  node kinds. A data node executes its own adapter.
- Web evidence could parse an invalid retained POST body although it dispatches
  GET. Validation and dispatch now share the effective HTTP method. Methods are
  trimmed and uppercased; read methods do not enter mutation journaling, while
  writes still require an operation identity. Explicit boolean, numeric, object
  or array method values cannot silently become GET. Existing Temporal
  scheduling order is unchanged.
- Cursor pagination on a non-GET request is rejected during readiness. Reserved
  mapping fields and prototype paths in transformation mappings, inline loops,
  MCP arguments and write bodies are rejected before the run starts.
- Boolean/array coercion in retry counts, deadlines and parallel settings is
  rejected. Millisecond settings require integers within their documented bounds.

These validations report a configuration problem; they do not silently widen
scope, replace a selected model, or retry a possibly completed external write.

## Error capture

Workflow failures preserve safe application codes, category, HTTP status,
upstream status, nullable provider code/type/parameter, request ID, retry hints,
and bounded validation issues. Raw provider response bodies, prompts and model
candidates are not copied into the workflow error projection. Generic AI nodes
retain their existing `AGENT_PROVIDER_ERROR` contract while exposing the safe
underlying `provider_failure_code` and protocol metadata.

Loop errors identify the original failed child, batch and iteration path.
Parallel rejections each retain their own details and log entry, while the first
failure remains the execution's root cause. Cancellation, timeouts, rejected
requests and unknown operation outcomes remain distinct. An unknown outcome
cannot continue through an Error handler or automatically redispatch an effect.
The specialist compatibility path no longer mistakes `invalid_request_error`
for evidence that JSON mode is unsupported.

The node inspector shows these details above the output. A
[controlled browser screenshot](screenshots/workflow-node-failure-details.png)
records the failed-batch view; it is a UI fixture rather than a live Sprint run.

## Verification record

The focused adapter audit ran 60 tests with zero failures. It includes the nine
new node-contract checks plus existing HTTP, data, native readiness/lineage,
merge, connection, credential and Sprint-migration checks:

```sh
node --test services/agentic/test/backend/workflowNodeContracts.test.js services/agentic/test/backend/workflowDataOperations.test.js services/agentic/test/backend/workflowNativeReadiness.test.js services/agentic/test/backend/workflowHttpExecution.test.js services/agentic/test/backend/workflowNativeLineage.test.js services/agentic/test/backend/workflowMergeOperations.test.js services/agentic/test/backend/workflowConnections.test.js services/agentic/test/backend/workflowCredentialPolicy.test.js services/agentic/test/backend/workflowSprintMigration.test.js
```

The shared request investigation also recorded 4/4 native node configuration
regressions and 29/29 request policy/envelope/fallback checks. The final full
workflow gate passed 219/219 tests. Provider and AI service regressions passed
189 tests with one optional integration test skipped; the native specialist
provider/context/stream checks passed 61/61. Runtime diagnostic checks passed
88/88. These focused commands overlap and their totals should not be summed.
The real PostgreSQL Sprint pipeline passed with 84 local model-fixture
calls, including the connected For Each body; replay added no model calls. That
fixture enforces the provider's JSON requirement, but is not a paid live-provider
call or production Sprint rerun.

`npm run test:workflows:temporal` passed real durable parallel dependencies,
ordered fan-in, nested loops, lost acknowledgement recovery, uncertain outcomes,
cancellation and replay. The execution-inspector browser test, full frontend
TypeScript check and agentic production capability build passed. Service
boundaries, documentation links and whitespace checks also passed.

## Local runtime refresh

The local API and frontend images were rebuilt and recreated with the existing
Compose environment and monitoring network on 2 November 2026. No workflow was
active at refresh. Both services became healthy; API readiness, the frontend API
proxy, main frontend and admin frontend returned HTTP 200. Eight running backend
file hashes matched the workspace implementation.

A read-only diagnostic composed a request using the saved Sprint generator's
actual node configuration. The messages lacked JSON guidance before shared
request preparation and contained trusted guidance afterward. The diagnostic
made zero provider requests. Native pipeline verification used the local model
fixture; no full execution against the configured external model was submitted.

## Assurance and loop follow-up

The subsequent `test-case-assurance` failure is an output-contract rejection,
which is separate from the earlier invalid JSON-mode request. A retained local
provider trace contained a dimension name in `/insights/1/kind`, where the schema
requires a finding category. Its format repair succeeded. Local retained traces
do not contain the newly reported terminal run, so that historical example does
not establish the exact invalid field in the user's newer response.

The audit found concrete defects that made these failures harder to prevent or
diagnose:

- The advertised review example used arrays for scalar dimension IDs,
  priorities and finding categories, listed more locations than allowed, and
  included a `limits` field forbidden at the response root. The example now
  validates against its own unchanged native schema. Allowed selections and
  budgets are separate from the example.
- Each assurance call reviews one case, while saved/default node prose could
  request a batch. A trusted native response-scope record now identifies the
  exact artifact and cardinality, and new default guidance explicitly leaves
  iteration to the host. Saved user instructions remain intact. Regression
  coverage proves sibling cases do not enter one another's review requests.
- A complete repair previously received half the initial output allowance.
  Both requests now have the same 6,144-token native ceiling, still capped by
  managed node settings. There are at most two calls, each capped at 60 seconds,
  within a 120-second total budget and the enclosing workflow cancellation.
- Assurance and generic-agent error wrappers dropped useful schema details and
  paid-generation retry flags. Those boundaries now retain bounded validation
  paths/keywords, missing properties, provider protocol metadata and model-call
  counts. Errors identify the exact Story, case, child node, loop and batch.
  The inspector displays those details at desktop and mobile widths, without
  exposing prompts or raw candidates.
- Generic AI nodes omitted `AI_OUTPUT_SCHEMA_VIOLATION` from their existing
  bounded correction loop. They now correct it under the original call budget.
  Exhausted schema/JSON output, refusals and deadlines cannot automatically
  replay unchanged requests. Actual provider capacity/transport errors retain
  their separate retry policy.
- MCP handshake/schema/auth failures proven to precede a tool dispatch were
  incorrectly recorded as unknown external outcomes. Only those proven
  pre-dispatch reservations are released. Once a tool could have been sent,
  its uncertain receipt remains retained and cannot replay.
- `workflow_operation_receipts` had an extra unique constraint on project,
  run and node, although its primary operation identity already includes the
  iteration path. That constraint blocked the second loop iteration. Main
  schema **15** removes only that exact redundant constraint, preserving the
  primary key, existing receipts and unrelated uniqueness rules.

These changes do not map invalid finding categories to different meanings,
discard substantive findings, weaken citations, substitute a model, fabricate
readiness, or claim a test execution passed.

The full AI-feature regression passed **2,489 tests**, with ten optional tests
skipped. The generic node/agent/workflow selection passed **374/374**, and the
assurance/schema selection passed **98/98**. Counts overlap.

The real PostgreSQL Sprint pipeline passed with 101 controlled local HTTP model
responses. It executes the connected For Each chain, repairs a deliberately
invalid category once per Story, and verifies a persistent invalid result stops
with exact diagnostics while retaining the already saved pending-review case.
Request replay makes no additional provider calls. The separate effects fixture
tests three actual MCP writes locally and three through Temporal execution,
including a lost loop acknowledgment and history replay without duplicate
effects, plus fresh and version-14-to-15 migration paths.

```sh
node --test services/ai/test/backend/assuranceWorkflowContract.test.js services/platform/backend/test/aiReviewContracts.test.js services/platform/backend/test/aiArtifactRequests.test.js services/platform/backend/test/schemaReadiness.test.js
node scripts/checks/test-sprint-automator-postgres.mjs
node scripts/checks/test-workflow-effects-postgres.mjs
```

Production-model output quality remains a separate boundary: a second invalid
review still fails with its exact field diagnostics. No paid provider request
or user's saved workflow execution was submitted for these checks. Hosted
`app.hellotest.ai` rollout still requires its deployment connection; the verified
local build does not update that separate instance.

The local API and editor were refreshed after the normal migration completed.
Runtime verification confirmed schema receipt **15**, removal of the obsolete
effect constraint, and matching SHA-256 digests for all ten changed backend and
shared runtime files. The deployed Agentic UI entry is `entry-C1ffGItq.js`;
the main frontend matches the final local build. Direct and proxied API readiness,
the main frontend and the admin frontend all returned HTTP 200. These checks
did not submit a saved workflow or call a production model.
