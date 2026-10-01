# Agentic Studio

Agentic Studio is the workflow workspace at `/agentic-workflows`. Existing agent, repository analysis and execution links remain valid. The default view opens workflows; the Agent library and Recent work remain available through the workspace navigation.

## Authoring and inspecting a workflow

Start with a review or source-analysis template, or choose **Start from scratch**. The blank canvas has a **+** that adds the manual trigger. Use **+** after an unconnected node or on an existing connection to open the searchable library and wire the selected node automatically. Condition ports have separate true/false insertion targets; inserting on one branch preserves the other branch and the original source handle. Adding an Error handler sets the parent’s error policy to route failures. Circular, duplicate and invalid trigger/output connections are rejected. Drag between handles to connect branches; select a connection to remove it. **Arrange** places nodes by dependency depth. Removing a node in a simple, linear chain reconnects its predecessor and successor; branch removal leaves the remaining graph for explicit review.

Click a node for its inspector; double-click to expand input, parameters and output together. Parameters include the task, specialist, model connection, grounding, execution settings and advanced configuration. The full-screen inspector supports Escape and keyboard focus containment. The former provider-availability banner is absent from workflow creation.

**Workflow input** contains a JSON object passed to the trigger. **Settings** contains the name, description, lifecycle state, trigger and available project connections. Cmd/Ctrl+S saves. **Execute workflow** saves the current definition, checks readiness and starts execution. **Execute step** executes the selected node and its necessary ancestors; downstream nodes remain unexecuted. Readiness failures stay in the editor and link to the affected node.

The editor's Executions tab lists saved runs with durations and a status filter. Execution details use the saved graph, with node statuses, actual bounded inputs, recorded attempts and a filterable event timeline. Input fields expose copyable `$input` paths; output supports readable text, JSON and tables for object arrays. Null, false and empty arrays remain visible values. Run metrics show elapsed time, completed steps, failures and skipped branches. Select a log's node name to open its saved details. Source reviews and specialist evidence can be opened from the node output. **Open in editor** restores the workflow and execution input for a new run. **Stop review** cancels active work and preserves completed results.

## Templates and runtime contracts

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

Custom AI uses your task, instructions, selected skills, connected data, model selection and permitted project context through the existing review contract. Supplied workflow input is explicitly marked unverified; custom tasks can call the configured model even when the project has no indexed evidence. Workspace specialists still require task-specific project evidence. It returns cited findings; it does not execute model-generated code. Repository evidence searches indexed source material; source analysis remains the dedicated GitHub pipeline. Run evidence retrieves permitted execution context rather than scheduling a test run.

Custom AI and specialist nodes offer **Choose or create skill**, using the existing prompt-template library with the isolated `workflow_skill` scope. Select an existing skill, save a new one, or edit a project skill. Nodes keep an editable snapshot of each selected skill (up to eight), so later library edits do not silently change saved workflows. Expand a skill card to edit, pause, reorder or remove it. Paused skills are retained in the definition and excluded from model guidance. A shared character budget covers the task, instructions, active skills and additional guardrails; the backend enforces the same 5,000-character limit. AI For each nodes expose the same skills, model, tools and context controls. Changing specialists populates their task, skills, retrieval tools and context scopes. Project evidence and Knowledge search can be disabled independently; execution respects those restrictions. Additional guardrails and context are editable; required permission, secret-redaction and untrusted-input boundaries remain enforced.

The next node's `$input` is the previous result's `data` value (including null, false and empty arrays), the trigger's request, or the complete AI result. Multiple inputs form an ordered array. `$request` always refers to the original workflow request. `$nodes.<id-or-output-label>` exposes a directly connected node's complete result. The inspector saves this same input context. Output labels must be unique and use letters, digits, underscores or hyphens; insertion generates a new label when a default is already in use. Aggregator appends branch data, For each returns the mapped items in `data` with per-item metadata in `items`, and Output publishes connected data with review/provenance details in separate fields. HTTP JSON bodies support typed `$input`/`$request` paths; endpoint URLs support encoded values such as `{{ $input.id }}`.

**Condition** compares a data path using equals, not-equals, exists, contains or numeric comparisons. Its true/false ports select branches; unselected nodes are marked skipped. **Edit fields** accepts JSON whose values may reference `$input`, `$request` or their dot paths. Literals remain literals. **For each** reads an array (for example `input.items`) and sequentially maps fields using `$item`, or performs an AI review per item. Each AI review receives that item as its connected input while retaining the original request. Item review IDs, evidence and readiness remain traceable in the final review packet. It collects every result into its output; graph back-edges are not used. Arrays above the configured limit fail explicitly rather than silently dropping items.

Failures stop execution by default. Set **On error → Route to error handler**, connect that handler, and its branch receives the failed input, attempt count and structured error code/message. Permission failures and cancellation always stop. A recovered workflow retains its failed step and ends **Needs review**. HTTP GET/HEAD and AI reviews can retry transient 408/429/500/502/503/504 failures within their node timeout, with zero to two retries and a configurable delay (including zero). Retries use a linear delay multiplier; external write methods and MCP calls are not automatically replayed. A step timeout reports `NODE_TIMEOUT`, separately from an overall workflow deadline. Events record starts, attempts, retry delays, branch selection, per-item progress, error routing, completion and log-node messages. Audit mode adds source IDs and output sizes. Logs retain up to 150 sanitized events per node. Stop/deadline writes compare the saved node snapshot before changing state, preserving concurrent progress, and record cancellation/interruption events.

The runtime allows 20 executed nodes, at most four registered/source analysis steps, up to ten For each items, 16 KB workflow input, 128 KB per-node output, a three-minute overall deadline and two concurrent workflows per worker. Source nodes delegate once to the existing worker. Request IDs preserve idempotency across transport retries and unchanged saves. Changing a target, graph, settings or input requires a new request ID. Completed results survive cancellation and interruption.

Scheduled/webhook starts and arbitrary expression/code execution remain unsupported and fail readiness. **Preview graph** is still explicitly simulated; **Execute workflow**, **Execute step**, and **Test API output** perform real operations.

## API and MCP connections

Open **Integrations → New Integration**, also available under **Admin Space → Integrations**. Choose **Integration type → Workflow connections**, then **Provider → MCP Server** or **HTTP API**. These providers appear in the same searchable tile/list catalog as LLM and other providers; there is no separate MCP tab. Existing connection records and workflow connection IDs are reused. New connections automatically belong to the current project; there is no separate project-access selector. Management APIs require the current `project_id` and project membership, and reject operations on connections outside that project. Changing projects resets the editor and loads that project's connections. Existing connections retain their previously configured scopes.

**Test connection and discover tools** uses the current form, including unsaved endpoint, authentication and header changes. It initializes the server and reads its catalog without creating a connection, updating saved settings, enabling tools or invoking them. Select enabled tools during creation, inspect their input/output schemas and server annotations, then save once. An active MCP provider requires at least one selected tool in the UI; an incomplete connection can be kept inactive. Saved provider details retain the catalog, server identity, negotiated protocol and discovery time. The workflow MCP node loads enabled tool names and schemas directly from the saved provider; **Refresh server tools** checks the server again. Execution always revalidates the selected tool and its arguments against the live server catalog. Connections refresh when returning from Integrations; **Refresh connections** also reloads them immediately. Administrators can edit, disable or delete a connection; disabled connections cannot execute. Viewing these settings requires `integration.view`; mutations and administrator discovery require `integration.manage`.

Saved settings use the existing `app_settings` store and need no database migration. Entered credentials are encrypted with AES-256-GCM using `WORKFLOW_CREDENTIAL_KEY`, or an existing `SESSION_SECRET` of at least 32 characters. Configure a stable key consistently on every Agentic/combined API instance before saving credentials. Retain that key across restarts; rotating it requires replacing saved credentials. An `AGENTIC_SECRET_…` environment reference is also supported. Credential values are never returned by settings APIs.

Deployment-managed `AGENTIC_HTTP_CONNECTIONS` catalogs remain supported alongside saved settings, scoped to explicit project IDs, and selected in the node inspector. Workflow definitions store the connection ID, never its secret. The shipped Compose files forward `AGENTIC_HTTP_CONNECTIONS`, `AGENTIC_SECRET_API` and `AGENTIC_SECRET_MCP` to the Agentic or combined API. Supply them through your deployment's secret/environment management, not committed files.

Example connection catalog (replace project IDs and endpoints):

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
    "tools": ["read_status", "search_documents"]
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
