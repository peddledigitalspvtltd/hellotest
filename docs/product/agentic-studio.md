# Agentic Studio

Agentic Studio is the workflow workspace at `/agentic-workflows`. Existing agent, repository analysis and execution links remain valid. The default view opens workflows; the Agent library and Recent work remain available through the workspace navigation.

## Authoring and inspecting a workflow

Start with a review or source-analysis template, or choose **Start from scratch**. Add nodes from the searchable library. Adding a node after a selected step inserts it into a linear chain. After a Condition, the new node remains disconnected so existing true/false branches are preserved. Drag between handles to connect branches; select a connection to remove it. **Arrange** places nodes by dependency depth. Removing a node in a simple, linear chain reconnects its predecessor and successor; branch removal leaves the remaining graph for explicit review.

Click a node for its inspector; double-click to expand input, parameters and output together. Parameters include the task, specialist, model connection, grounding, execution settings and advanced configuration. The full-screen inspector supports Escape and keyboard focus containment. The former provider-availability banner is absent from workflow creation.

**Workflow input** contains a JSON object passed to the trigger. **Settings** contains the name, description, lifecycle state, trigger and available project connections. Cmd/Ctrl+S saves. **Execute workflow** saves the current definition, checks readiness and starts execution. **Execute step** executes the selected node and its necessary ancestors; downstream nodes remain unexecuted. Readiness failures stay in the editor and link to the affected node.

The editor's Executions tab lists saved runs for the workflow. Execution details use the saved graph, with node statuses, actual bounded inputs, readable output or JSON, recorded attempts and logs. Source reviews and specialist evidence can be opened from the node output. **Open in editor** restores the workflow and execution input for a new run. **Stop review** cancels active work and preserves completed results.

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

Custom AI uses your task, instructions, connected data, model selection and permitted project context through the existing review contract. It returns cited findings; it does not execute model-generated code. Repository evidence searches indexed source material; source analysis remains the dedicated GitHub pipeline. Run evidence retrieves permitted execution context rather than scheduling a test run.

**Condition** compares a data path using equals, not-equals, exists, contains or numeric comparisons. Its true/false ports select branches; unselected nodes are marked skipped. **Edit fields** accepts JSON whose values may reference `$input`, `$request` or their dot paths. Literals remain literals. **For each** reads an array (for example `input.items`) and sequentially maps fields using `$item`, or performs an AI review per item. It collects every result into its output; graph back-edges are not used. Arrays above the configured limit fail explicitly rather than silently dropping items.

Failures stop execution by default. Set **On error → Route to error handler**, connect that handler, and its branch receives the failure. Permission failures and cancellation always stop. A recovered workflow retains its failed step and ends **Needs review**. HTTP GET/HEAD and specialist calls can retry within their node timeout; external write methods and MCP calls are not automatically replayed.

The runtime allows 20 executed nodes, at most four registered/source analysis steps, up to ten For each items, 16 KB workflow input, 128 KB per-node output, a three-minute overall deadline and two concurrent workflows per worker. Source nodes delegate once to the existing worker. Request IDs preserve idempotency across transport retries and unchanged saves. Changing a target, graph, settings or input requires a new request ID. Completed results survive cancellation and interruption.

Scheduled/webhook starts and arbitrary expression/code execution remain unsupported and fail readiness. **Preview graph** is still explicitly simulated; **Execute workflow**, **Execute step**, and **Test API output** perform real operations.

## API and MCP connections

Connections are configured by the deployment administrator, scoped to explicit project IDs, and selected in the node inspector. Workflow definitions store the connection ID, never its secret. The shipped Compose files forward `AGENTIC_HTTP_CONNECTIONS`, `AGENTIC_SECRET_API` and `AGENTIC_SECRET_MCP` to the Agentic or combined API. Supply them through your deployment's secret/environment management, not committed files.

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

The catalog supports bearer, basic (`username:password` stored in the secret) and header authentication (`authType: "header"`, `header: "X-API-Key"`). Secret variable names must begin `AGENTIC_SECRET_`; custom names need explicit container environment wiring. OAuth refresh is not implemented. Private addresses require `allowPrivateNetwork: true` on a named connection. Targets stay within the configured origin/path, DNS addresses are checked and pinned, redirects are rejected, responses are bounded, and diagnostics redact credential values.

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
