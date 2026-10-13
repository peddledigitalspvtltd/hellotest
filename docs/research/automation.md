# Automation and agent workflow implementation review

Reference research: dated observations and verification counts describe the recorded review, not current acceptance. Use the current [verification runbook](../development/verification.md) for reproducible checks.


Reviewed on 10 September 2026 against the current application source, browser-rendered components and isolated PostgreSQL execution tests.

## Product decision

The useful next step for this product is a reproducible evidence-review workflow: describe a release or quality question, choose registered specialists, inspect execution readiness, run the review, and open each saved result with its sources. The existing graph designer already supported more node types than the backend could execute. Giving those nodes a new visual treatment without an execution contract would not improve the product.

This change adds real, bounded specialist workflows alongside the existing honest graph previews. The two modes remain explicit in history and details. An actual review is never presented as a test run, and a graph preview is never presented as successful automation.

## Research and its implementation consequences

| Primary source | Relevant finding | Implemented consequence |
| --- | --- | --- |
| [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | Start with understandable workflows and add autonomy where it improves outcomes. Separate predetermined orchestration from agents deciding how to act. | A small registered execution set replaces the previous gap between a broad canvas and sample-only execution. Dependency order is deterministic; specialists retrieve and assess evidence. Arbitrary API, code, control-flow and write nodes cannot silently execute. |
| [OpenAI: A practical guide to building agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/) | Models, tools and instructions need explicit boundaries, layered safeguards and a human intervention path. | Each node identifies an actual specialist. Every specialist independently retrieves permitted evidence. Unsupported approval gates fail readiness. Review results require a human decision before changing project artifacts. |
| [Temporal: Activity execution](https://docs.temporal.io/activity-execution) and [retry policies](https://docs.temporal.io/encyclopedia/retry-policies) | Execution attempts, deadlines, cancellation and retry policy are separate lifecycle concepts. Failures must propagate to the workflow. | Persist before starting, store per-step attempts and results, enforce step and workflow deadlines, permit only bounded transient retries, retain completed work on cancellation, and mark expired work interrupted. This implementation does **not** claim Temporal-style durable replay. |
| [Playwright: Best practices](https://playwright.dev/docs/best-practices) and [retries](https://playwright.dev/docs/test-retries) | Test user-visible behavior, isolate tests and preserve the distinction between an initial pass and recovery after a retry. | Browser tests exercise real components with isolated API fixtures. Runtime tests assert actual attempt counts, failure preservation, cancellation, source evidence and recovery rather than checking only generated output shapes. |
| [OWASP: LLM application risks](https://owasp.org/www-project-top-10-for-large-language-model-applications/) | Prompt injection and excessive authority are risks when untrusted content is used by systems with tools. | Upstream model text is labelled as an untrusted proposal, never converted into authoritative source evidence. Each downstream specialist verifies against its own permitted sources. There are no external write tools or arbitrary code execution in this runtime. |

These are design inferences from the sources, not claims that one framework or vendor implementation was adopted.

## Findings in the existing application

1. **The workflow API only produced samples.** `agenticWorkflow.service.js` correctly labelled these as previews, but there was no real composition path for the ten functioning workspace specialists. The canvas exposed tools, conditions, looping, retry controls and model tuning that had no execution implementation.
2. **Execution records needed a richer lifecycle.** The PostgreSQL status constraint permitted only queued, running, completed, failed and aborted. An integration test exposed this when a completed deterministic review correctly required further human review. The runtime schema now permits `needs_review`, `cancelled` and `interrupted` while retaining existing values.
3. **Permission grants did not fully express feature availability for evidence.** A specialist could retrieve a source type whose product capability was disabled. Current-project reads and indexed source permission resolution now include the corresponding feature gates.
4. **Run history transferred complete snapshots and results for every row.** The UI now asks for compact summaries and loads the selected execution separately. Polling updates only active work; complete results are retrieved on demand.
5. **The recorder could select the wrong automation step.** `automationCasePreparation.service.js` fell back to the target step at the same array position when it could not find the manual step. Independently edited linked cases could therefore record into a different action. Automated cases also accepted an unchecked target step ID. Both paths now validate ownership and an unambiguous matching action, expected result, step type and reusable-group identity. Changed or ambiguous mappings return a clear conflict before updating module membership.

The existing parameter resolver, separate manual-to-automation case blueprint, automation permission helpers and source-agent publication boundaries were inspected and preserved. Review workflows use those product records as evidence; they do not start the test engine or rewrite cases.

## Implemented workflow

1. Create the included **Release readiness review** template: request → Story Architect → Smart Run Planner → human review packet. A saved specialist review can also seed a reusable specialist → Quality Evaluator workflow.
2. Edit a task, select a registered specialist and configure its evidence scope. Model tuning and custom output schemas are explicitly preview-only; a “Use specialist defaults” action clears them.
3. **Save and check readiness** validates the saved definition. Blockers identify the affected step and link back to its inspector. Editing the graph invalidates the previous readiness result.
4. **Execute review** persists an immutable snapshot and returns a run immediately. Start retries reuse an idempotency key. The UI displays actual completed steps and supports stopping the run.
5. Open a saved specialist review to inspect findings, source citations, evidence gaps and proposed next actions. Raw graph and step details are available in a collapsed section, keeping the review outcome prominent.

History labels distinguish Review from Preview. Execution references can be reopened through `?view=runs&workflow_run=<id>` with project/application checks. Workflow timestamps use the user's regional date and time preferences.

## Runtime contract and limits

| Concern | Behavior |
| --- | --- |
| Supported nodes | One request trigger; 1–4 registered specialists; optional append aggregators; output steps. Up to 8 nodes. |
| Start | Manual, explicitly requested; no schedules or webhooks are activated. |
| Ordering | Topological, sequential execution. Branched graphs collect the connected ancestor reviews. |
| Limits | Three minutes overall; specialist step timeout up to 70 seconds; input up to 16 KB; two active reviews per API worker. |
| Retries | Zero to two step retries for transient HTTP-class failures only, within the same step deadline. Specialist model recovery remains bounded internally. Permission failures and invalid inputs never retry. |
| Evidence | Actual saved specialist result, session ID, citations, readiness and generation provenance. Declared samples are excluded from executed outputs. |
| Missing evidence | Insufficient evidence stops downstream work and records `needs_review`. Limited evidence can complete the packet while retaining `needs_review`. |
| Cancellation | Persist cancellation before signalling the worker. Other workers observe it through stored state. Compare-and-set terminal writes prevent late completion from replacing cancellation. Cleanup remains available to authorized operators after a feature is disabled. |
| Recovery | Expired in-progress rows become `interrupted` on read. Completed reviews remain available. Work is never automatically replayed after a process restart. |
| Authorization | Actual workflow project checked at API entry; permission and feature availability checked at start and between steps/retries. Each specialist enforces evidence permissions and feature gates. |
| Unsupported behavior | Conditions, loops, expressions, external tools, write actions, execution approval gates, explicit parallel concurrency and custom output contracts fail readiness. Existing previews remain available. |

The worker executes in the API process. A process failure therefore stops active work; the saved deadline provides honest recovery status rather than automatic resumption. Long-running schedules, external writes and durable worker replay require a separately implemented execution system and are not advertised as available.

## Verification evidence

- `services/platform/backend/test/agentWorkflowExecution.test.js`: registered-node execution, immutable snapshots, exact scope, idempotent concurrent starts, invalid definition/input rejection, grants and feature denial, actual citations and ancestor results, missing-evidence stop, cancellation after feature disablement, cancellation from another worker, bounded retry counts, permission revocation and expired-run recovery.
- `services/platform/backend/test/agentWorkspaceReliability.test.js`: specialist retrieval and model recovery plus disabled knowledge/source feature boundaries.
- `services/platform/backend/test/automationBuildPersistence.test.js`: recorder ownership, reordered exact matches and rejection of unrelated positional targets.
- `services/platform/backend/test/integration/agentWorkspace.postgres.test.js`: all ten real specialists, saved evidence reviews, original graph previews, real review execution and lifecycle persistence in a fresh `agent_verify_*` PostgreSQL database. No provider model is configured; results must identify deterministic evidence summaries. The test deletes its disposable database afterward.
- `services/agentic/test/browser/agentWorkflowExecution.test.mjs`: readiness invalidation, unsupported-node blockers, start recovery with the same request ID, actual progress, stored review cards, cancellation and mobile layout.
- Existing `services/agentic/test/browser/agentWorkspace.test.mjs` preserves coverage of all fourteen agents and the original specialist/preview workflows.

Browser artifacts are isolated renders of the production components and styles with explicit API fixtures; they are not screenshots of customer data:

- `/tmp/qaira-workflow-execution-after/01-workflow-readiness-desktop.png`
- `/tmp/qaira-workflow-execution-after/02-executing-desktop.png`
- `/tmp/qaira-workflow-execution-after/03-review-results-desktop.png`
- `/tmp/qaira-workflow-execution-after/04-review-results-dark-mobile.png`

The review result design makes status, evidence gaps and the next useful action visible before the implementation trace. The fixtures verify interaction and layout; PostgreSQL and service tests independently verify execution and persistence.
