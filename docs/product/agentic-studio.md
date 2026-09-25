# Agentic Studio

Agentic Studio is the workflow workspace at `/agentic-workflows`. Existing agent, repository analysis and execution links remain valid. The default view opens workflows; the Agent library and Recent work remain available through the workspace navigation.

## Authoring and inspecting a workflow

Start with a review or source-analysis template, or choose **Start from scratch**. Add nodes from the searchable library. Adding a node after a selected step inserts it into that step's existing connections. Drag between handles to connect branches; select a connection to remove it. **Arrange** places nodes by dependency depth. Removing a node in a simple, linear chain reconnects its predecessor and successor; branch removal leaves the remaining graph for explicit review.

Click a node for its inspector; double-click to expand input, parameters and output together. Parameters include the task, specialist, model connection, grounding, execution settings and advanced configuration. The full-screen inspector supports Escape and keyboard focus containment. The former provider-availability banner is absent from workflow creation.

**Workflow input** contains a JSON object passed to the trigger. **Settings** contains the name, description, lifecycle state, trigger and API credential references. Cmd/Ctrl+S saves. **Execute workflow** saves the current definition, checks readiness and starts execution. **Execute step** executes the selected node and its necessary ancestors; downstream nodes remain unexecuted. Readiness failures stay in the editor and link to the affected node.

The editor's Executions tab lists saved runs for the workflow. Execution details use the saved graph, with node statuses, actual bounded inputs, readable output or JSON, recorded attempts and logs. Source reviews and specialist evidence can be opened from the node output. **Open in editor** restores the workflow and execution input for a new run. **Stop review** cancels active work and preserves completed results.

## Templates and runtime contracts

Review templates cover release readiness, story assurance and failure investigation. Source templates cover UI objects, API tests, repository knowledge and component tests. Source nodes reuse `backend/agents/repositoryAgents.service.js`; they do not duplicate its compiler, storage or publication logic. Their stage progress and child execution reference are saved with the workflow step.

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

Real workflow execution supports manual triggers, registered specialists, source analysis, aggregation and output. Other node kinds, scheduled/webhook triggers and external write actions remain explicitly marked as preview-only. **Preview graph** saves simulated data and does not call workflow models or tools. **Test API output** is an explicit real HTTP request through the existing approved API test adapter.

The runtime retains its limits: eight executed steps, up to four analysis steps, 16 KB workflow input, a three-minute overall deadline and two concurrent workflow executions per worker. Specialist steps allow up to two bounded retries. Source nodes delegate once to the existing repository worker. Both execution start and transport retry use a request ID; saving an unchanged definition again does not duplicate execution. Changing the target, definition or input requires a new request ID. No database migration is required for the optional target and progress metadata.

## Ownership and verification

| Location | Responsibility |
| --- | --- |
| `services/agentic/frontend/pages/AgenticWorkflowsPage.tsx` | Workspace scope, permissions, queries, saves and navigation |
| `services/agentic/frontend/workflows/` | Canvas, node inspector, readable data, execution view, templates and graph helpers |
| `services/agentic/frontend/api.client.ts` | Capability API contract, including optional `target_node_id` |
| `services/agentic/backend/routes/agenticWorkflows.routes.js` | Authenticated, project-scoped routes |
| `services/agentic/backend/services/agenticWorkflowExecution.service.js` | Readiness, bounded execution, idempotency, actual inputs, cancellation and saved results |
| `services/agentic/backend/agents/` | Existing source analysis pipeline and review/publication contracts |
| `services/agentic/test/browser/` | Authoring, execution, retry, access changes, mobile layout and source-review handoffs |

Viewing, authoring and execution use `agentic_workflow.view`, `agentic_workflow.manage` and `agentic_workflow.run` respectively. Optional grounding and connection access use their existing capability permissions. UI controls reflect access; backend execution checks access again for each step. Upstream model output remains an untrusted proposal, and specialists retrieve their own permitted source evidence.

The design adopts the canvas/node-detail and saved-execution patterns described in [n8n's editor terminology](https://docs.n8n.io/contribute/contribution-guide-for-n8n-docs/terminology) and [partial execution documentation](https://docs.n8n.io/build/understand-workflows/understand-executions/types-of-executions). HelloTest keeps its own theme, authorization and bounded review runtime; this change does not embed the n8n runtime.
