# Quality agents in AI Agents

The five browser specialists live in **AI Agents → Quality agents**. Select an agent to open its task workspace. The former `?view=quality` landing page is removed; that address returns the agent directory. Missions open as `?view=workbench&agent=browser-web` (or browser-security, browser-performance, browser-accessibility, browser-visual).

| Agent | Task and report |
| --- | --- |
| Web explorer | Crawl same-origin pages, locate information, fill non-secret inputs and perform a bounded browser journey. Retain extracted facts, action outcomes, console/network findings, screenshot and JSON report. |
| Security observer | Navigate to the requested surface, then inspect actual response headers and browser-visible transport policy. Passive checks, without exploit or penetration-test claims. |
| Performance analyst | Reach the requested page and measure navigation timing, available LCP/CLS, resources and explicit budgets. Single-navigation observations, not load testing or field percentiles. |
| Accessibility reviewer | Reach the requested surface and run axe-core with element-specific findings. Automated checks do not certify WCAG compliance. |
| Visual regression | Reach the requested surface and compare the fixed-viewport screenshot to a human-reviewed baseline. The first capture needs baseline review. |

## Autonomous mission

Enter the target, the task, an optional configured credential reference, and the form-submission policy. Review the scope before launching. All five agents support the same observe/action loop before their domain checks. A task without a goal can still run deterministic preset checks; turn off autonomous mode to author a fixed web journey.

The existing durable worker dispatches an isolated Playwright browser. The engine publishes a bounded observation containing visible text and at most 80 actionable elements with temporary IDs. Input values, passwords, scripts and elements marked `data-sensitive` are excluded. The API's project-scoped model selects one typed action against those IDs. Supported actions are click, fill, select, press, hover, scroll, wait, back, visible-text assertion, same-origin navigation, extraction, completion and blocked. The engine validates the action again against its current observation and live element. No generated JavaScript or shell code runs in this loop.

The worker checkpoints each decision before dispatch and reuses that decision after a lost acknowledgement. Each observation has a sequence number; stale decisions, conflicting decisions and cross-project/application commands are rejected. The account, project membership, feature availability and run permission are checked on each worker step and again after model latency. Cancellation during model latency prevents the next action. A restarted engine does not replay partially executed actions.

Stages and the action report arrive through the existing 1.5-second active-run polling. These are incremental browser observations, not synthetic model progress or private reasoning. Screenshots and downloadable JSON reports retain their integrity hashes and authorized download paths.

Limits remain explicit: 12 actions, five same-origin pages, 120 seconds and 250 browser requests. Missing models, failed actions and exhausted limits are visible outcomes. Completion is a model assessment supported by the retained observations, not independent proof of business correctness. Payment, destructive, communication and access-changing controls need a separately reviewed workflow; a general task does not bypass those boundaries.

## Credential references and external MCP hosts

Secret values never belong in the URL, task, action values or MCP arguments. Configure `QUALITY_AGENT_CREDENTIAL_REFERENCES` on the execution engine using entries with a reference ID, exact `origin`, and `project_ids`. References support `http_basic` (username/password environment references) and `form` (fixed field selectors, environment references and a fixed submit selector). Secret environment names must begin with `QUALITY_SECRET_`. Inject their values through the deployment secret manager or a private Compose override; never commit them.

Example configuration contains references only:

```json
[
  {
    "id": "staging-login",
    "project_ids": ["project-id"],
    "origin": "https://staging.example.test",
    "type": "form",
    "fields": [
      {"selector": "#username", "secret_env": "QUALITY_SECRET_STAGING_USER"},
      {"selector": "#password", "secret_env": "QUALITY_SECRET_STAGING_PASSWORD"}
    ],
    "submit_selector": "button[type=submit]"
  }
]
```

Only the reference ID is persisted with the mission. The runner resolves it for the exact project and origin, authenticates outside the model loop, masks configured credential fields and matching secret text in screenshots, and removes known credential values from observations and findings. Private targets and additional resource origins retain the existing exact network allowlists. An unconfigured or incorrectly scoped reference fails explicitly.

External ChatGPT/LLM MCP hosts discover `hellotest_browser_mission_prepare` and `hellotest_browser_mission_status`. Preparing creates an immutable, expiring preview bound to the MCP principal, client and project. The user authorizes that exact plan in Agent Studio; `hellotest_operation_execute` then submits the original mission once. Poll the status tool for live stages, action outcomes, findings and report paths. A submitted job is never reported as an executed or passing browser task. Credential values cannot be passed through these tools.

## Specialist review chains

Workspace review output omits the diagnostic scores, repeated citation/guardrail/route badges and reusable-workflow prompt. Model-call details are in the second **Model calls** tab. Source inspection remains available through **Sources**.

A built-in review can invoke one applicable authoring specialist using its original permitted evidence, citations, findings, recommendations and gaps. The shared two-call budget and deadline still apply; there is no recursive model-selected delegation.

| Review | Follow-up when applicable |
| --- | --- |
| Story assurance or grooming | Story completion |
| Quality, release, risk, impact or run planning | Story architect, test designer or defect reporter, selected from the task and available evidence scopes |
| Failure analysis, flakiness or defect triage | Defect reporter |
| Automation readiness, repair or repository maintenance | Test designer |
| Authoring specialist | Produces its own structured proposal; does not delegate to itself |

Stories contain a title, description, priority and acceptance criteria. Test cases contain prerequisites and complete action/expected-result steps. Defects contain reproduction steps, expected/observed behavior and severity. Each draft must cite supplied evidence; invented citations, missing fields and empty assertions are rejected. Cards expose the proposals in a readable, responsive layout and link to the destination workspace. These are reviewable proposals; domain records are not changed automatically. If the follow-up cannot finish, the original review remains available with an explicit gap.

## Local execution

Saved local browser/API cases POST directly to the host Playwright runner on port 4311; they do not wait for queue polling or fall back to the container Test Engine. The host launcher loads only the persisted dispatch credentials and disables queue-pull mode. Local runs force a fresh browser session and retain trace/video evidence. Their signed callbacks use the local signing configuration and must match the recorded dispatch; no remote engine integration is required to save results.

Otherwise unassigned local cases join one application-scoped **Default Local Runs** suite. Existing suite assignments are preserved. Suite receipts, case outcomes and evidence remain visible in Test Runs. The local-agent controls now appear on Automation as well as Object Repository and distinguish a paired inspection browser from a reachable execution runner. The setup panel can copy a browser-specific pairing command for an existing full runner. Stop that runner before restarting with the command; this avoids two agents competing for port 4311. Start the full host runner with `./local-run/bin/start-host-recorder.sh` (or the `.cmd` equivalent).

## Research and verification

The design uses the observation/action loop and concrete retained artifacts rather than installing a second unrestricted agent framework. Primary references:

- [Playwright Test Agents](https://playwright.dev/docs/test-agents): chained planning, generation and execution with explicit artifacts.
- [Browser Use product extraction example](https://docs.browser-use.com/customize/code-agent/example-products): iterative navigation and retained structured extraction. HelloTest deliberately executes typed actions instead of arbitrary generated code.
- [MCP security best practices](https://modelcontextprotocol.io/docs/draft/tutorials/security/security_best_practices): identity, target and credential boundaries.

Real Chromium fixtures verify navigation, fresh observations, extraction, cancellation, retained reports and the five deterministic specialist checks. Worker tests use controlled model/HTTP responses for checkpoint/retry, cancellation and scoped decision handling. UI fixtures verify the directory, task lifecycle, structured proposals, evidence/history, role restrictions and desktop/mobile layouts. No paid model request or external user account is used by these checks.
