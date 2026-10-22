# Agentic Studio

Agentic Studio is the workflow workspace at `/agentic-workflows`. Existing agent, repository analysis and execution links remain valid. The default view opens workflows; the Agent library and Recent work remain available through the workspace navigation.

## Creating project agents

Open **Agent library → Create agent**, or **Customize** on a built-in specialist. The builder retains the workspace's side-panel layout and has three sections:

1. **Purpose**: name, objective, description, model connection and task instructions. A specialist can supply the initial configuration.
2. **Skills & evidence**: choose or create reusable skills, order or pause them, allow evidence tools, select project scopes and knowledge sources, provide domain context and declare required run-input names.
3. **Completion & limits**: require evidence references, stop for unresolved evidence gaps, set a minimum number of findings, and bound time, model calls and output tokens.

**Save draft** stores an immutable version without publishing it. **Save and activate** validates the model connection configuration and makes that version available in the library, workbench, workflow node picker and specialist selector. Activation does not make a provider health request; the actual run must receive valid model output. Required fields appear in the agent workbench and are supplied through **Workflow input** for workflows. Agent definitions belong to the current project. Viewing requires `agentic_workflow.view`; authoring requires `agentic_workflow.manage`; execution requires `agentic_workflow.run`.

Each workflow selection pins the activated version. Later drafts and activations do not silently replace it. Reselect an agent in the node inspector to adopt its current activated version. Runs store the server-resolved definition, version and hash together with the workflow snapshot; submitted definition snapshots are discarded. Workflow-specific task, skills and context changes are retained in that snapshot. Concurrent edits return a conflict instead of overwriting another saved version. Existing reviews remain inspectable.

Every AI review—built-in specialist, project agent, Custom AI and AI loop item—requires an active LLM connection. Missing models, provider errors, exhausted budgets and invalid output fail explicitly. Repository source extraction is the exception: compilation and cached extraction work without a model. Selecting an optional model adds a fresh review that must succeed; a cached review is never represented as a new model call. Oversized source findings are sampled within a documented context limit and the result is marked partial with the reviewed count.

The application controls evidence access, citation validation, completion checks and terminal workflow state. Model text cannot authorize tools or declare verified success. A failed completion check produces `needs_input` in the review and stops downstream workflow steps with **Needs review**. Supplied input is marked unverified. Reference checks establish traceability, not factual correctness; material decisions and artifact publication still require human review. The result exposes the effective model, prompt hash, provider request ID when available, response token usage, model-call count and agent version. Token usage describes the accepted response, not total billing across repair attempts.

The contract permits 10–70 seconds, one or two model requests per node (including JSON compatibility, transport retries and repair), and 256–8,000 output tokens. Configured workflow retries share the same model-call ledger and node deadline; they cannot reset those limits. Each AI loop item has its own bounded ledger, inside the overall workflow limit. Agents use the existing structured review output and explicitly supplied history; arbitrary verifier code, persistent agent memory and model-directed write tools are not enabled. Workflow HTTP/MCP nodes retain their separate permission and execution policies.

Agent/version, trace, coverage, graph and workflow receipt tables are additive and applied by the normal API schema bootstrap. Environments running schema verification must run the migration command before starting the updated API. Set `TEMPORAL_ADDRESS` and run the dedicated durable worker to enable Temporal execution. Without this explicit configuration, runs use the existing bounded local worker and become interrupted after a worker loss or deadline; there is no automatic fallback from Temporal to local execution.

## Authoring and inspecting a workflow

Start with a review or source-analysis template, or choose **Start from scratch**. The blank canvas has a **+** that adds the manual trigger. Use **+** after an unconnected node or on an existing connection to open the searchable library and wire the selected node automatically. Condition ports have separate true/false insertion targets; inserting on one branch preserves the other branch and the original source handle. Adding an Error handler sets the parent’s error policy to route failures. Circular, duplicate and invalid trigger/output connections are rejected. Drag between handles to connect branches; select a connection to remove it. **Arrange** places nodes by dependency depth. Removing a node in a simple, linear chain reconnects its predecessor and successor; branch removal leaves the remaining graph for explicit review.

Click a node for its inspector; double-click to expand input, parameters and output together. Parameters include the task, specialist, model connection, grounding, execution settings and advanced configuration. The full-screen inspector supports Escape and keyboard focus containment. The former provider-availability banner is absent from workflow creation.

**Workflow input** contains a JSON object passed to the trigger. **Settings** contains the name, description, lifecycle state, trigger and available project connections. Cmd/Ctrl+S saves. **Execute workflow** saves the current definition, checks readiness and starts execution. **Execute step** executes the selected node and its necessary ancestors; downstream nodes remain unexecuted. Readiness failures stay in the editor and link to the affected node.

The editor's Executions tab lists saved runs with durations and a status filter. Execution details use the saved graph, with node statuses, actual bounded inputs, recorded attempts and a filterable event timeline. Input fields expose copyable `$input` paths; output supports readable text, JSON and tables for object arrays. Null, false and empty arrays remain visible values. Run metrics show elapsed time, completed steps, failures and skipped branches. Select a log's node name to open its saved details. Source reviews and specialist evidence can be opened from the node output. **Open in editor** restores the workflow and execution input for a new run. **Stop review** cancels active work and preserves completed results.

## Templates and runtime contracts

The [Sprint Automator guide](sprint-automator.md) describes the native Story-to-Test-Case-to-automation template, secure API connection, per-Story data flow and Library acceptance.

Review templates cover release readiness, story assurance, failure investigation and a custom AI review. The For each template provides sample items and a runnable field mapping without a model. Source templates cover UI objects, API tests, repository knowledge and component tests. Source nodes reuse `backend/agents/repositoryAgents.service.js`; they do not duplicate its compiler, storage or publication logic. Their stage progress and child execution reference are saved with the workflow step.

Source workflow input uses the existing GitHub source contract:

```json
{
  "source": {
    "type": "github",
    "repository_url": "https://github.com/your-org/your-repo",
    "ref": "main",
    "integration_id": "optional-saved-github-integration-id"
  }
}
```

Leave optional fields empty or omit them when not needed. ZIP uploads remain available in the source agent workspace. A source execution produces drafts and findings; publishing requires the existing review and permission checks.

Every node offered in **Add a node** has an execution adapter:

| Group | Nodes | Result |
| --- | --- | --- |
| Start | Manual trigger | Original workflow input |
| AI and source analysis | Custom AI, Workspace specialist, Source analysis | Grounded review or existing repository analysis result |
| Connections and servers | HTTP Request, MCP server tool | Actual endpoint/tool result |
| Project capabilities | Knowledge search, Repository evidence, Run evidence | Permission-checked project evidence and source IDs |
| Data and flow | Condition, For each, Edit fields, Aggregator | Selected branch, collected items, mapped data or merged outputs |
| Results and recovery | Output, Log, Error handler | Inspectable result, log entry or explicit failure path |

Custom AI uses your task, instructions, selected skills, connected data, model selection and permitted project context through the existing review contract. Supplied workflow input is explicitly marked unverified; custom tasks call the configured model even when the project has no indexed evidence. Specialists request a model review and must identify missing task evidence instead of fabricating a supported outcome. They return structured reviews; they do not execute model-generated code. Repository evidence searches indexed source material; source analysis remains the dedicated GitHub pipeline. Run evidence retrieves permitted execution context rather than scheduling a test run.

Custom AI and specialist nodes offer **Choose or create skill**, using the existing prompt-template library with the isolated `workflow_skill` scope. Select an existing skill, save a new one, or edit a project skill. Nodes keep an editable snapshot of each selected skill (up to eight), so later library edits do not silently change saved workflows. Expand a skill card to edit, pause, reorder or remove it. Paused skills are retained in the definition and excluded from model guidance. A shared character budget covers the task, instructions, active skills and additional guardrails; the backend enforces the same 5,000-character limit. AI For each nodes expose the same skills, model, tools and context controls. Changing specialists populates their task, skills, retrieval tools and context scopes. Project evidence and Knowledge search can be disabled independently; execution respects those restrictions. Additional guardrails and context are editable; required permission, secret-redaction and untrusted-input boundaries remain enforced.

The next node's `$input` is the previous result's `data` value (including null, false and empty arrays), the trigger's request, or the complete AI result. Multiple inputs form an ordered array. `$request` always refers to the original workflow request. `$nodes.<id-or-output-label>` exposes a directly connected node's complete result. The inspector saves this same input context. Output labels must be unique and use letters, digits, underscores or hyphens; insertion generates a new label when a default is already in use. Aggregator appends branch data, For each returns the mapped items in `data` with per-item metadata in `items`, and Output publishes connected data with review/provenance details in separate fields. HTTP JSON bodies support typed `$input`/`$request` paths; endpoint URLs support encoded values such as `{{ $input.id }}`.

**Condition** compares a data path using equals, not-equals, exists, contains or numeric comparisons. Its true/false ports select branches; unselected nodes are marked skipped. **Edit fields** accepts JSON whose values may reference `$input`, `$request` or their dot paths. Literals remain literals. **For each** reads an array (for example `input.items`) and sequentially maps fields using `$item`, or performs an AI review per item. Each AI review receives that item as its connected input while retaining the original request. Item review IDs, evidence and readiness remain traceable in the final review packet. It collects every result into its output; graph back-edges are not used. Arrays above the configured limit fail explicitly rather than silently dropping items.

Failures stop execution by default. Set **On error → Route to error handler**, connect that handler, and its branch receives the failed input, attempt count and structured error code/message. Permission failures and cancellation always stop. A recovered workflow retains its failed step and ends **Needs review**. HTTP GET/HEAD and AI reviews can retry transient 408/429/500/502/503/504 failures within their node timeout, with zero to two retries and a configurable delay (including zero). Retries use a linear delay multiplier; external write methods and MCP calls are not automatically replayed. A step timeout reports `NODE_TIMEOUT`, separately from an overall workflow deadline. Events record starts, attempts, retry delays, branch selection, per-item progress, error routing, completion and log-node messages. Audit mode adds source IDs and output sizes. Logs retain up to 150 sanitized events per node. Stop/deadline writes compare the saved node snapshot before changing state, preserving concurrent progress, and record cancellation/interruption events.

The runtime allows 20 executed nodes, at most four registered/source analysis steps, up to ten For each items, 16 KB workflow input, 128 KB per-node output, a three-minute overall deadline and two concurrent workflows per worker. Source nodes delegate once to the existing worker. Request IDs preserve idempotency across transport retries and unchanged saves. Changing a target, graph, settings or input requires a new request ID. Completed results survive cancellation and interruption.

Scheduled/webhook starts and arbitrary expression/code execution remain unsupported and fail readiness. **Preview graph** is still explicitly simulated; **Execute workflow**, **Execute step**, and **Test API output** perform real operations.

## API and MCP connections

Open **Integrations → New Integration**, also available under **Admin Space → Integrations**. Choose **Integration type → Workflow connections**, then **Provider → MCP Server** or **HTTP API**. These providers appear in the same searchable tile/list catalog as LLM and other providers; there is no separate MCP tab. Existing connection records and workflow connection IDs are reused. New connections automatically belong to the current project; there is no separate project-access selector. Management APIs require the current `project_id` and project membership, and reject operations on connections outside that project. Changing projects resets the editor and loads that project's connections. Existing connections retain their previously configured scopes.

**Test connection and discover tools** uses the current form, including unsaved endpoint, authentication and header changes. It initializes the server and reads its catalog without creating a connection, updating saved settings, enabling tools or invoking them. Select enabled tools during creation, inspect their input/output schemas and server annotations, then save once. An active MCP provider requires at least one selected tool in the UI; an incomplete connection can be kept inactive. Saved provider details retain the catalog, server identity, negotiated protocol and discovery time. The workflow MCP node loads enabled tool names and schemas directly from the saved provider; **Refresh server tools** checks the server again. Execution pins the approved tool contract in the run snapshot and compares its name, input/output schemas, annotations and protocol revision against the live server catalog before dispatch. Changed contracts require discovery and saving in Integrations. Input arguments and declared structured output are schema-validated. A failed or invalid result after dispatch has an unknown external outcome and is never automatically replayed; schema validity does not verify the external postcondition. Connections refresh when returning from Integrations; **Refresh connections** also reloads them immediately. Administrators can edit, disable or delete a connection; disabled connections cannot execute. Viewing these settings requires `integration.view`; mutations and administrator discovery require `integration.manage`.

Saved settings use the existing `app_settings` store and need no database migration. Entered credentials are encrypted with AES-256-GCM using `WORKFLOW_CREDENTIAL_KEY`, or an existing `SESSION_SECRET` of at least 32 characters. Configure a stable key consistently on every Agentic/combined API instance before saving credentials. Retain that key across restarts; rotating it requires replacing saved credentials. An `AGENTIC_SECRET_…` environment reference is also supported. Credential values are never returned by settings APIs.

Deployment-managed `AGENTIC_HTTP_CONNECTIONS` catalogs remain supported alongside saved settings, scoped to explicit project IDs, and selected in the node inspector. Workflow definitions store the connection ID, never its secret. The shipped Compose files forward `AGENTIC_HTTP_CONNECTIONS`, `AGENTIC_SECRET_API` and `AGENTIC_SECRET_MCP` to the Agentic or combined API. Supply them through your deployment's secret/environment management, not committed files.

Example connection catalog (replace project IDs and endpoints). For deployment-managed MCP entries, supply the exact approved tool definitions from discovery; names alone cannot authorize execution:

```json
[
  {
    "id": "product-api",
    "name": "Product API",
    "kind": "http",
    "url": "https://api.example.com/v1",
    "projectIds": ["project-id"],
    "secretEnv": "AGENTIC_SECRET_API",
    "authType": "bearer",
    "methods": ["GET", "HEAD"]
  },
  {
    "id": "project-tools",
    "name": "Project MCP tools",
    "kind": "mcp",
    "url": "https://tools.example.com/mcp",
    "projectIds": ["project-id"],
    "secretEnv": "AGENTIC_SECRET_MCP",
    "authType": "bearer",
    "tools": ["read_status"],
    "toolDefinitions": [{ "name": "read_status", "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false } }]
  }
]
```

The provider form captures endpoint, Streamable HTTP transport, authentication, a 1–70 second connection timeout, enabled tools or HTTP methods, private-network access and active state. Additional request headers (up to 16) are encrypted, returned with masked values, and reused on every protocol request. Authentication and protocol headers cannot be overridden by custom headers. New workflow nodes inherit the saved timeout when selecting a provider.

The catalog supports bearer, basic (`username:password` stored in the secret) and header authentication (`authType: "header"`, `header: "X-API-Key"`). Secret variable names must begin `AGENTIC_SECRET_`; custom names need explicit container environment wiring. OAuth sign-in/refresh is not implemented and the form states that limit. Protocol versions and session headers are negotiated automatically rather than entered manually. Private addresses require `allowPrivateNetwork: true` on a named connection. Targets stay within the configured origin/path, DNS addresses are checked and pinned, redirects are rejected, responses are bounded, and diagnostics redact credential values.

Public unauthenticated GET/HEAD requests work without a connection. Other HTTP methods require a named connection that explicitly enables them. Choose **Load server tools** to discover MCP parameters, then select a tool and supply JSON arguments. The client validates arguments against the discovered schema and only calls tools allowlisted by the administrator. MCP tools may have side effects; enable only the tools intended for that project.

The MCP client implements Streamable HTTP with JSON and SSE responses, initialization, negotiated protocol/session headers and session cleanup for protocol versions **2025-11-25**, **2025-06-18**, and **2025-03-26**. It does not launch local stdio processes, expose HelloTest as an MCP server, or implement newer-only protocol revisions. Servers must support one of these revisions. Tool call errors are shown without automatically replaying a potentially completed operation.

Design references: [n8n MCP Client](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcpclient), [n8n Loop Over Items](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitinbatches), and the [MCP Streamable HTTP specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

## Ownership and verification

| Location | Responsibility |
| --- | --- |
| `services/agentic/frontend/pages/AgenticWorkflowsPage.tsx` | Workspace scope, permissions, queries, saves and navigation |
| `services/agentic/frontend/workflows/` | Canvas, node inspector, readable data, execution view, templates and graph helpers |
| `services/agentic/frontend/api.client.ts` | Capability API contract, including optional `target_node_id` |
| `services/agentic/backend/routes/agenticWorkflows.routes.js` | Authenticated, project-scoped routes |
| `services/agentic/backend/workflows/` | HTTP/MCP connections, data mapping and bounded node adapters |
| `services/agentic/backend/services/agenticWorkflowExecution.service.js` | Readiness, bounded execution, idempotency, actual inputs, cancellation and saved results |
| `services/agentic/backend/agents/` | Existing source analysis pipeline and review/publication contracts |
| `services/agentic/test/browser/` | Authoring, execution, retry, access changes, mobile layout and source-review handoffs |

Viewing, authoring and execution use `agentic_workflow.view`, `agentic_workflow.manage` and `agentic_workflow.run` respectively. Connection discovery requires view access; calling APIs or discovering MCP tools requires run access. Evidence retrieval also requires access to Knowledge Repo and its underlying sources. UI controls reflect access; backend execution checks access again for each step. Upstream model output remains an untrusted proposal, and specialists retrieve their own permitted source evidence.

The design adopts the canvas/node-detail and saved-execution patterns described in [n8n's editor terminology](https://docs.n8n.io/contribute/contribution-guide-for-n8n-docs/terminology) and [partial execution documentation](https://docs.n8n.io/build/understand-workflows/understand-executions/types-of-executions). HelloTest keeps its own theme, authorization and bounded review runtime; this change does not embed the n8n runtime.

Authoring references: [n8n connections](https://docs.n8n.io/build/understand-workflows/workflow-components/connect-nodes-together), [data flow](https://docs.n8n.io/build/work-with-data/understand-n8ns-data-structure), and [input mapping](https://docs.n8n.io/build/work-with-data/reference-data/use-the-ui-mapper). HelloTest uses its existing result envelopes and bounded adapters; it does not claim compatibility with n8n expressions or arbitrary n8n nodes.

Execution design references: [n8n error handling](https://docs.n8n.io/build/flow-logic/handle-errors-gracefully) and [debugging saved executions](https://docs.n8n.io/build/understand-workflows/understand-executions/debug-executions).


## AI lifecycle capabilities

The shared specialist catalog supplies the same names, skills, context scopes and feature contracts to the Agent library and workflow picker. It contains 22 default review agents covering the document's 18 feature IDs. **Customize** copies a specialist into a versioned project agent; analytical clones retain their code-owned feature checks. A review agent proposes findings and next steps. It does not implicitly publish the business artifact or execute its recommendations.

| Capability | Feature screen | Default review agent | Current behavior |
| --- | --- | --- | --- |
| F01 Story creation | Stories → AI creation | Story Architect | Cited model drafts, explicit acceptance |
| F02 Story completion | Story details → AI completion | Story Completion | Current draft context, cited field proposals |
| F03 Grooming | Story details → AI Groom Story | Story Grooming | Bounded business/technical review with source references |
| F04 Story assurance | Story details → AI Story Assurance | Story Assurance | Deterministic baseline remains fixed; model explains cited findings |
| F05 Test generation | Stories / Test Cases → AI generation | Test Design Agent | Model-generated structured drafts and reviewed acceptance |
| F06 Test improvement | Test Case details → AI improvement | Test Improvement | Current authored steps and expected outcomes preserved for review |
| F07 Smart Run | Runs → Smart Run | Smart Run Planner | Code selects allowed candidates; model supplies evidence-linked rationale |
| F08 Failure analysis | Run results → Failure analysis | Failure Analyst | Recorded symptom groups, model hypotheses and discriminating checks |
| F09 Bug creation | Bugs → AI creation | Defect Reporter | Model-generated draft; normal authoring acceptance |
| F10 Bug triage | Bugs → AI triage | Defect Triage Agent | Cited review proposals; no silent deterministic substitute |
| F11 Release readiness | Release readiness → AI release review | Release Readiness | Approved, versioned project policies and scoped exceptions; code computes gates and preserves unknown evidence |
| F12 Impact analysis | AI Story Assurance → Impact analysis; Test Case assurance | Impact Analysis | Existing direct relationships plus bounded snapshot traversal in the agent |
| F13 Coverage assurance | Story / Test Case assurance | Coverage Assurance | Reviewed criterion/assertion mappings, revision checks and exact-build observed assertion coverage |
| F14 Risk prediction | Release readiness → AI release review | Risk Prediction | Transparent rule-based indicators; no calibrated probability claim |
| F15 Flaky intelligence | Run case logs → Reliability investigation | Flaky Test Intelligence | Comparable attempt groups, descriptive intervals, suspect/insufficient states |
| F16 Risk simulation | Release readiness → AI release review | Release Risk Simulation | Code-computed hypothetical gate scenarios; actual gates unchanged |
| F17 Quality graph | Story/Test Case assurance; release/run reviews | AI Quality Graph | Persistent revision index, transactional invalidation, deletion tombstones and searchable evidence table |
| F18 Automation repair | Automation build → AI Automation Repair | Automation Repair | Typed locator proposals, pinned validation Runs, original/neighbor/negative checks and guarded apply |

Story assurance contains keyboard-accessible **Quality review** and **Impact analysis** tabs. Switching tabs preserves the current draft analysis without making another model request. The contextual lifecycle panels start collapsed, reuse theme tokens, and separate findings, code checks, next steps and provenance. Evidence tables render 30 rows initially with search and incremental expansion inside a bounded scroll area. Scope changes cancel the old request and discard late responses. Model errors have explicit retry guidance; existing authored work is preserved.

The analytical evidence service reads one repeatable-read, read-only project snapshot, with an eight-second SQL statement timeout and at most 2,000 rows per source. It intersects source grants, feature flags and selected evidence scopes before queries. Release membership follows native release relationships; application context excludes unrelated records. Missing, denied, truncated or unlinked evidence is disclosed rather than interpreted as absence. Free-form metadata and execution configuration/data snapshots are removed or hashed before model packaging. The full bounded snapshot must fit 2 MB; the model receives a valid JSON projection below approximately 12,000 characters. Projection omissions are explicit. Assurance and structured diagnostic reviews share a 60-second deadline and at most one output repair, with hidden transport retries disabled.

Release failure gates take precedence over unknowns. Execution completion, review readiness and publication are separate values. Passing retries do not erase observed failure records. Coverage links are only candidates. In Story coverage, open **Review criterion-to-assertion mappings** to select a criterion, linked Test Case and observable expected result, then approve, reject or withdraw the mapping with a rationale. Approval pins the Story, complete Test Case specification and assertion revisions. A changed criterion, step or test makes that mapping stale. Designed coverage counts current approvals; executable and observed coverage require matching saved assertion outcomes on the selected build and environment. Failed observations remain failures even after a passing retry; incomplete denominators remain unknown. Flakiness groups require the same test snapshot, build, environment, configuration and data; mixed outcomes are **suspect**, never automatically confirmed or quarantined. [Wilson intervals](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm) are descriptive and disclose the independence assumption.

Saved agent reviews retain the source permissions required at generation; reading a full review checks them again. History summaries omit source contents. New source permissions or feature revocation cannot expose a previously saved evidence packet through history.

### Model calls in TestOps

**TestOps → AI calls** reads shared LLM transport records for features, agents, workflow nodes and project embedding calls. Each actual request captures its prepared model body, bounded response, provider status, effective model, duration and reported token usage. Request IDs, distributed trace IDs, agent session IDs and workflow run/node IDs connect the record to its originating task. Compatibility corrections have separate linked records. A transport response is not a business-verification verdict; node failures and completion checks remain in the execution log.

The shared client excludes authentication headers, redacts credential fields and hidden provider reasoning, omits binary inputs and bounds captured text and structure. Records expire after 14 days; cleanup runs every five minutes. Calls abandoned by a worker become failed after 15 minutes. Capture failures are reported as `llm.trace_storage_unavailable` and do not replay or discard a generation. Calls made before this migration are not reconstructed.

Access requires project membership and `ops.view`. Workspace administrators can inspect prompt and response bodies. Other authorized operators see metadata, usage and timing, without content. The API enforces this distinction and uses `Cache-Control: no-store`. This restriction also covers source material aggregated from private documents. Request/response capture adds two bounded database writes; latency reports measure provider transport, excluding those writes. No provider price or reasoning-quality estimate is inferred from tokens.

TestOps has one **Dashboard** (Grafana), **Infrastructure logs**, **Distributed traces**, **Alerts**, **Service health**, and **AI calls**. The redundant TestGrid telemetry tab and second dashboard were removed. Test Engine jobs still retain their run details, and Test Engine service output remains searchable in infrastructure logs. The existing telemetry API remains available to clients.

### Durable workflow deployment

The Temporal workflow owns dependency ordering, branch selection, cancellation, the absolute run deadline and activity recovery. PostgreSQL holds UI projections, immutable node receipts and an atomic start/cancel delivery outbox. Full evidence and prompts stay in project storage; Temporal receives compact receipt hashes and control metadata. Successfully recorded nodes are reused after a lost activity acknowledgement without another model call. If a worker disappears after dispatch but before recording a result, that node fails with an explicit uncertain outcome; budgets and external effects are never silently reset.

HTTP writes and MCP calls reserve stable operation IDs and request hashes before dispatch. Recorded responses can be reused; changed arguments under the same ID conflict. Missing responses or persistence failures require reconciliation. A provider response is recorded as `response_received`, with `postcondition_verified: false`; it is never presented as proof that the intended business effect occurred.

Use an existing persistent Temporal deployment or Temporal Cloud. Configure the same address, namespace and task queue for the API and durable worker. The API must have applied the new schema first. The dedicated worker uses Debian/glibc because Temporal's native worker is not supported by the API's Alpine runtime.

For a host process, install workspace dependencies, provide the normal database and workflow credential settings, then run:

```sh
export TEMPORAL_ADDRESS=temporal.example.internal:7233
export TEMPORAL_NAMESPACE=default
export TEMPORAL_TASK_QUEUE=hellotest-agentic-v1
npm --prefix services/platform/backend run migrate
npm --workspace @hellotest/agentic run worker:durable
```

Start the API with the same `TEMPORAL_ADDRESS`. For Docker, apply [docker-compose.agentic-durable.yml](../../docker-compose.agentic-durable.yml) on top of `docker-compose.platform.yml` or `docker-compose.full.yml`, using the deployment's existing environment/secrets file:

```sh
docker compose --env-file /path/to/deployment.env \
  -f docker-compose.platform.yml -f docker-compose.agentic-durable.yml \
  up -d --build api agentic-durable
```

The overlay connects to the configured Temporal server; it does not create an ephemeral development server. For Temporal Cloud, set `TEMPORAL_TLS=true` and `TEMPORAL_API_KEY`. Host deployments also support `TEMPORAL_TLS_CA`, `TEMPORAL_TLS_SERVER_NAME`, and the `TEMPORAL_TLS_CERT` / `TEMPORAL_TLS_KEY` pair. Mount certificate files and pass their container paths when using a custom Docker override. Back up the Temporal persistence store along with the application database. Run one outbox-delivering durable worker or multiple workers on the same queue; stable workflow IDs prevent duplicate starts.

### Quality Graph freshness

Each assessment stores revision-bound nodes, typed edges, provenance, evidence references and its source scope. Native Story, Test Case, assertion, run, result, Defect, relationship and membership changes write an outbox event in the same database transaction. The AI worker processes these events every five seconds, invalidates older assessments and appends deletion tombstones without rewriting historical edges. Consumers are idempotent. Processed delivery metadata expires after 30 days; historical graph snapshots remain. Pending changes and changes processed during capture prevent a snapshot from being shown as current. Reading a saved agent review checks current source permissions and refreshes its graph freshness status.

Before deploying this revision, run `npm --prefix services/platform/backend run migrate` with the application and observation database URLs configured, then restart the relevant services. Main schema compatibility is version 5; observation schema compatibility is version 2. Verify-mode API and durable worker processes refuse to start against an older schema.

### Approved release policies

Release readiness exposes **Release policy and exceptions**. `quality_gate.view` reads the policy; `quality_gate.update` approves immutable versions using an expected-version check and a recorded rationale. Requirements include minimum completed attempts and maximum evidence age. Missing or future-dated execution timestamps remain unknown. Policy approvals and exception decisions invalidate earlier Quality Graph assessments.

An exception needs exact release/build/environment scope, the current policy version, a known failed gate, its current evidence hash, a reference, rationale and expiry (at most 30 days). Only recorded critical Defects and execution failures can be eligible. Missing sources, unknown coverage, minimum samples and stale evidence cannot be waived. Withdrawing approval, changing evidence or policy, or reaching expiry restores the blocking result. The observed failure is retained, and even a ready assessment does not authorize deployment.

### Typed automation repair

Automation Repair accepts a Test Case ID and an optional failed Run ID (otherwise the latest recorded failure). The model returns a typed `replace_locator` proposal; code permits only a failed standalone web `click`, `fill`, `hover`, `check` or `uncheck` with literal arguments. Values, assertions, timeouts, step order and other code remain unchanged. The proposal pins the complete authored source hash and saves the prior action for review. It is available from the Automation screen, the default agent, and workflow agent output.

Expand **Validate and apply repair**, select one to five neighboring Test Cases, a known-negative key/value fixture and an existing protected assertion, and document the fixture isolation/reset procedure. **Prepare validation Runs** creates separate snapshots without changing the authored Test Case. Start each check after preparing the application fixture: original failure reproduction, repaired Test Case plus neighbors, and the known-negative assertion check. The configured Test Engine uses fresh browser sessions, no attached browser and no healing. Execution settings and repository evidence must remain comparable. Shared-step, API, mobile, multi-row and arbitrary-code repairs require an authored change and are not auto-patched.

Verification reads trusted Test Engine jobs from observation storage and pinned specifications from the application database. Missing receipts, changed snapshots, unexpected failures, failed neighbors, changed execution settings, or a negative case that fails before its protected assertion keep the proposal unverified. The API requires source and test-data read permissions, `run.create` to prepare, `run.execute` to start, and both `step.manage` and `testcase.update` to apply. Apply rechecks the source and all receipts under locks, records the verifier receipt hashes and approver, and changes only the proposed locator action. Application fixture isolation and the semantic meaning of the negative case still require the reviewer's documented judgment; the recorded runner checks do not prove these by themselves.

### Blueprint scope and operational requirements

The feature matrix describes implemented behavior, not production certification of either document. These boundaries remain explicit:

- Durable execution applies to configured Agentic workflows. Standalone interactive AI requests remain request-bound. Existing local deployments need the Temporal configuration above to gain durable orchestration.
- Generic MCP operation receipts prevent automatic duplicate dispatch; business-specific postcondition verifiers and an operator reconciliation workflow are still required for autonomous verified writes.
- Coverage approvals are human-reviewed assertion mappings. They do not prove semantic oracle adequacy. Release approval authority is project-scoped through the existing Quality Gate permissions; deployment authorization remains separate.
- Automation Repair supports the constrained locator patch class above. It does not execute arbitrary model-generated scripts or claim to verify fixture isolation or semantic adequacy automatically.
- Risk indicators remain transparent rule bands. Calibrated probabilities and model semantic accuracy require representative labeled evaluations and a configured real provider.

Verification includes backend/frontend suites and production builds, actual PostgreSQL agent/version, coverage, graph and trace persistence, Temporal lost-acknowledgement recovery, workflow-history replay and cancellation without an activity worker. Browser checks cover model request/response inspection, project/role restrictions, assertion review, policy exceptions, repair controls, stale revisions, light/dark themes and mobile overflow. An opt-in PostgreSQL/Chrome check runs the actual Test Engine browser adapter through original failure, repaired/neighbor success, and known-negative assertion failure before guarded apply (`AGENT_REPAIR_BROWSER=1`, with `PLAYWRIGHT_EXECUTABLE_PATH` where required). Model responses in automated checks are fixtures: they establish contracts, state and wiring, not a live model's reasoning quality.

## Agent context and reviewed outcomes

All 31 built-in Studio agents have an intent-specific context policy. Workspace specialists, repository agents and browser agents share the Evidence scope control; it closes on outside click or Escape. Repository and browser tasks expose Context sources, Smart Context and an optional model choice. Changing sources clears the previous Smart Context selection. Model choices remain within the current project and require integration access; leaving the choice unset uses the configured model.

Explicit entity, release, build and environment identifiers are typed retrieval filters, rather than prompt-only hints. MCP preserves these filters through its validated retrieval request and context packet. Selected indexed sources remain pinned. When an entity is explicitly scoped, its authorized native metadata can accompany the selected indexed sources. A source-kind selection cannot widen the selected domains. Story context includes bounded related items, comments and attachment excerpts under their own permissions. Test Case context includes canonical IDs, Story links, description, Gherkin or step excerpts and explicit excerpt-completeness flags. A Gherkin document is not classified as missing test content merely because it has no structured steps.

Published per-feature MCP focus, item/token budgets and disabled-context settings apply before retrieval. Specialist requests retain the retrieved packet instead of automatically widening context again. Evidence access is rechecked before each generation attempt, supporting-source permissions are retained with the saved review, and indexed citation access is checked when reopening it. A provider context-size rejection may use one smaller packet under the existing deadline/model-call budget; the task and native schema stay intact, citation validation only permits retained sources, and omitted evidence remains a recorded limitation.

Findings can separate observations, gaps, impact, proposed changes and acceptance checks. Successors receive the original review as proposed context, retrieve evidence for their own permitted intent, and use their own instructions, settings and model profile. Story, Test Case, Defect and manual Run proposals use reviewed native creation/update APIs and idempotent acceptance receipts. Run proposals select only supplied canonical Test Case IDs; accepting one creates a manual Run and does not start execution. Test Case proposals use the generator's shared review fields and step editor, preserve Story links, test data, cleanup, platform step types and requested structured/Gherkin authoring mode. Source-generated repositories, native quality changes and automation repairs retain their specialized reviewed publication/validation flows.

The four repository reviews and five browser mission kinds now have dedicated AI Controls profiles. Until an individual profile is published, previously published shared settings remain inherited. The editor and trace identify the parent version/fingerprint; publishing a child makes it independent. The former shared browser decision profile remains a read-only legacy baseline. There are 71 registered profiles, including three reserved profiles.

## Large repository ingestion

ZIP uploads and saved archives transfer in backpressure-aware chunks to server-owned temporary files and object storage. GitHub acquisition remains pinned to a resolved commit, uses the same disk-backed path, and does not forward credentials to codeload. The compiler opens the archive directly and decompresses eligible members individually; it never runs repository commands.

`REPOSITORY_ARCHIVE_QUOTA_BYTES` controls the compressed storage quota (default 1 GiB). This replaces the old fixed 20 MiB ceiling. Source processing remains bounded: 30,000 eligible files, 128 MiB of eligible expanded text, 512 KiB per source file, a 600-second worker budget and a 6 MiB result window. Dependencies, generated/binary files, secret files and oversized individual files remain excluded with explicit warnings; unsafe paths, symlinks and encrypted archives remain rejected.

Source findings are reviewed in bounded model batches rather than only the first prompt-sized sample. `REPOSITORY_MODEL_REVIEW_BATCHES` controls the review cost budget (default 20 batches). Every batch preserves finding IDs and file/line evidence. The UI shows batch reviews and counts; budget exhaustion or reduced excerpts produce a partial outcome rather than a claim that every finding was reviewed. Unchanged source analysis can be reused, while the model review runs under the current context and configuration.


## Verification record — 12 October 2026

The Studio update passed 192 focused backend/contract checks, 47 Python compiler checks, seven browser workflows, 35 architecture checks, package-boundary checks and frontend type checking. Agentic, AI and admin production builds passed. Real PostgreSQL/SDK tests verified typed case scope, project isolation, revocation, per-agent inheritance, reviewed publication and versioned controls. An isolated PostgreSQL/MinIO test processed a 24 MiB source archive through all four repository agents, published native assets, replayed publication idempotently, reused source analysis and indexed/retrieved the generated knowledge.

The full backend run reported 1,464 passing checks, 53 failures and two skips. The remaining failing checks were present in the earlier baseline; ten earlier failures now pass. No new failing checks remained in that comparison. Configuration publication in these checks used disposable databases; live instance configuration versions were not published.
