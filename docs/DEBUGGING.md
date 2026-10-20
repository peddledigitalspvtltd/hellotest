# Debugging HelloTest

The current guide is the [development debugging runbook](development/debugging.md).

It covers API, frontend, TestEngine and native worker breakpoints; inspector ports; request/trace IDs; structured logs; queue diagnosis; and recovery that preserves data. Start with [CONTRIBUTING.md](../CONTRIBUTING.md) for development setup, the private environment file, VS Code profiles, a first request walkthrough, engineering standards and terminal workflows.

VS Code configurations remain in [launch.json](../.vscode/launch.json) with supporting [tasks.json](../.vscode/tasks.json). Inspect their local environment before starting a debugger compound.


### Automation engineer and repair context

Automation Build Tools and Agent Studio use the same context-source, evidence-scope,
Smart Context and model controls. The selected case and all its saved sections are
the build contract; optional source selections govern additional retrieval. Smart
Context source IDs and evidence filters are re-read through the signed-in HelloTest
MCP gateway. AI Controls governs the retrieval mode, required evidence and context
budget. An optional retrieval outage is reported explicitly; required retrieval
fails the build instead of silently widening or replacing the selected sources.

`Build complete case` / `Build step plan` queues the durable automation batch
worker, with one explicitly selected case. The existing local generator API remains
available for local-agent clients. Progress comes from the build transaction, and
code is saved only after every section maps to valid executable instructions and
the authored source still matches its pinned revision.

Build parameter review uses the same linked manual defaults, selected resources
and permissions as the browser host. Unset authored inputs open a dialog; leaving
them blank runs one case with empty strings. **Review data & build** also lets you
edit configured public values. Saved overrides retain their priority in generation,
new runs and Playwright exports. Empty input never changes the expected result.
`AUTOMATION_PARAMETER_PLAN_CHANGED` means a reviewed source changed: reopen the
dialog to review the current data. No browser retry can repair a stale receipt.

Live web evidence uses the TestEngine-owned Playwright-backed MCP adapter at
`POST /api/v1/automation/mcp` (`serverInfo.name = hellotest-playwright`), not an
unmanaged `npx` process. Configure an active Test Engine integration and an
application start URL/environment. An isolated MCP session supplies navigation,
accessibility snapshots, unique-locator checks and bounded browser actions.
Interactions require the user's checkbox and current automation build access;
read-only sessions cannot submit forms. The protocol session is closed on success,
failure and cancellation. Native Android/iOS still use Appium, and API requests use
the API runtime rather than pretending to be browser actions.

Repair pins a recorded failure and its specification. Playwright MCP observations
can inform typed locator changes or complete case-owned section rewrites. Rewrites
preserve action order, entered data/parameter references and all existing assertions;
arbitrary JavaScript and shared-definition changes need a separate authored change.
Applying a repair still requires the original failure to reproduce, the patched
case and neighboring cases to pass, and a known-negative fixture to fail at its
protected assertion. These checks run on frozen snapshots with healing disabled.
MCP observations and model completions never substitute for Test Engine receipts.

Relevant checks:

```sh
node --test services/automation/test/backend/automationAgentContext.test.js services/automation/test/backend/automationBrowserAgent.test.js services/ai/test/backend/automationRepairRules.test.js
npm --prefix testengine/backend run build
node --test testengine/backend/test/automationMcp.test.mjs testengine/backend/test/browser/automationMcpFlow.test.mjs
VITE_TEST_URL=http://127.0.0.1:5197 node --test services/automation/test/browser/automationAgentSetup.test.mjs
```

## Knowledge, Smart Context and agent reviews

Smart Context sends the current agent, selected context sources and evidence IDs
alongside the retrieval query. Application scope and source access are rechecked
by the shared retrieval/MCP backplane. Deselecting every source disables the
agent's Smart Context preview instead of searching the entire project.

New indexed Test Case and Run passages use the `source-permission-boundary-v1`
profile. Case passages retain actions, expected results and parameter names;
private test-data values and Run result/configuration snapshots are retrieved
live under their respective permissions. Older indexed case/run revisions are
withheld until refreshed. The source detail explains this and offers **Refresh
project sources** to authorized managers. A queued refresh is not proof of a
searchable revision: reload the source after processing finishes. Historical
unsafe revisions remain unavailable as AI evidence.

Specialist reviews negotiate `Accept: text/event-stream` on
`POST /agentic-assistant/sessions`. The stream carries recorded review stages,
retrieval progress and a validated final result, with keep-alive comments during
quiet model calls. Cancellation reaches the running operation; an interrupted
connection is not a completed review. Check saved review history before retrying.
The JSON contract remains available for existing callers. Default specialist
reviews have a 150-second overall bound and a 120-second model-stage bound;
custom agents retain their configured shorter limits. Agent definitions permit
10–150 seconds and one to four model calls. Transport failures do not replay
provider work automatically.

**Findings** records the primary assessment. **Review & approve** contains typed
proposals from relevant successor agents using cited findings as input. Approval
saves only supported native fields through existing domain services. Run review
criteria and rationale remain in the audited brief; accepting a Run saves its
supported name and selected cases. Repository batch reviews load full saved
findings and proposals on demand with fresh access checks.

Ask HelloTest intersects Smart Context source selections with explicit filters;
conflicting selections require correction rather than silently broadening the
search. Same-turn recovery can follow an already-running request for up to 150
seconds; it does not submit a second model turn. MCP public context requests
accept bounded source/evidence filters and up to a 60-second retrieval budget.
Remote packet retrieval is supported; chatbot retrieval callbacks remain in
process. Binary reports/artifacts and external ALM reads require typed wrappers
and are not advertised as generic JSON reads.

Relevant checks:

```sh
npm run test:mcp
npm run test:mcp:postgres
node --test services/agentic/test/backend/assistantProgressStream.test.js services/agentic/test/frontend/assistantProgressStream.test.mjs
node --test services/knowledge/test/backend/knowledgeApplicationContext.test.js services/knowledge/test/backend/knowledgeContextEngine.test.js
node --test services/chatbot/test/backend/*.test.js services/chatbot/test/frontend/*.test.mjs
VITE_TEST_URL=http://127.0.0.1:5197 node --test services/agentic/test/browser/smartContextScope.test.mjs services/agentic/test/browser/agentWorkspace.test.mjs
```
