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

## Automation Engineer R&D — 16 October 2026

This follow-up reviewed browser interaction and source generation against upstream code and HelloTest's actual MCP contracts. The architectural consequence is to let the model choose grounded browser actions while the host renders confirmed operations into executable source. A separate model-authored reconstruction can otherwise omit a prerequisite click or change a working locator.

| Reviewed primary source | Finding and implementation decision |
| --- | --- |
| [Playwright MCP repository, `b8b4183e099f136cbec0388a6088d4aa2f6b9685`](https://github.com/microsoft/playwright-mcp/tree/b8b4183e099f136cbec0388a6088d4aa2f6b9685) and [matching Playwright source, `e8149b8257d32dcf8f72573ecc43e72439da7080`](https://github.com/microsoft/playwright/tree/e8149b8257d32dcf8f72573ecc43e72439da7080/packages/playwright-core/src/tools/backend) | MCP 0.0.83 packages Playwright `1.64.0-alpha-1790635538000`; official npm metadata identifies the matching source revision. Its tools produce typed actions/generated code alongside fresh page evidence. HelloTest retains its existing Playwright 1.59.1 runtime and typed, permission-checked MCP rather than introducing an incompatible second browser runtime. |
| [MCP snapshots](https://playwright.dev/mcp/snapshots), [interaction tools](https://playwright.dev/mcp/tools/interaction), and [`tab.ts`](https://github.com/microsoft/playwright/blob/e8149b8257d32dcf8f72573ecc43e72439da7080/packages/playwright-core/src/tools/backend/tab.ts) | Upstream refs identify observed nodes, expire with page changes and normalize to portable locators. Refresh state after navigation or a same-URL control transition. HelloTest currently uses observed unique locator candidates; adding refs requires snapshot identity, stale-ref invalidation and portable locator extraction, not a parameter rename. |
| [Playwright test agents](https://playwright.dev/docs/test-agents), [actionability](https://playwright.dev/docs/actionability), and [`response.ts`](https://github.com/microsoft/playwright/blob/e8149b8257d32dcf8f72573ecc43e72439da7080/packages/playwright-core/src/tools/backend/response.ts) | The generator performs scenarios and verifies selectors/checks live; generated source derives from interactions. Start URL, scoped data and complete expected results provide the concrete setup. Auto-waiting and bounded post-action observations support progress; a fresh execution still establishes whether the complete saved test passes. |
| [browser-use agent loop, `ccd22fef47a1a36e0c4596fef5db73a5117b9d06`](https://github.com/browser-use/browser-use/blob/ccd22fef47a1a36e0c4596fef5db73a5117b9d06/browser_use/agent/service.py), [message manager](https://github.com/browser-use/browser-use/blob/ccd22fef47a1a36e0c4596fef5db73a5117b9d06/browser_use/agent/message_manager/service.py), and [tools](https://github.com/browser-use/browser-use/blob/ccd22fef47a1a36e0c4596fef5db73a5117b9d06/browser_use/tools/service.py) | Browser state, structured model decisions, typed action dispatch, action results and replanning are separate concerns. The applicable pattern is observe → act → inspect the changed state → verify → save → advance, retaining a successful prefix when later work fails. This is a design inference; browser-use's Python runtime was not installed or embedded. |

The reusable compiler is [`automationRecordedProgram.js`](../../services/automation/backend/lib/automationRecordedProgram.js). Its input is a host-owned ledger of confirmed typed requests, not model-reported success. It renders navigation, intermediate actions and satisfied checks in order; preserves scoped references instead of embedding resolved private inputs; rejects unsupported operations atomically; and enforces bounds of 250 operations, 64,000 source characters and 2,000 characters per tool string.

The compiler preserves existing MCP semantics. Repository semantic locators default to `exact: true`, unlike native Playwright, so generated calls spell that option out. Visible-text checks poll normalized `innerText`; native text-content checks use `toHaveText`/`toContainText`. Raw title/URL checks retain exact string behavior rather than silently acquiring native title normalization or URL canonicalization. Whole scoped expected-text references use the injected parameter map when runtime normalization is necessary. Unsupported syntax, regex or locator chains are never evaluated or approximated.

Reproducible focused checks:

```sh
node --test services/automation/test/backend/automationRecordedProgram.test.js
node --test testengine/backend/test/browser/automationRecordedProgram.test.mjs
```

The first command passed eight compiler tests. The browser file contains a direct comparison against TestEngine's real locator resolver across 30 native/legacy/indexed forms, plus an isolated Chromium check: perform 15 actual MCP operations against an owned signup fixture, close that browser, and replay the compiled source unchanged with production Playwright bindings. The replay covers a prerequisite Sign up click, scoped input values and ten browser checks. Separate negative checks preserve raw-title and hidden-child text failures. These checks use actual browser/MCP execution with deterministic inputs; they do not invoke a provider model or create application accounts. Logs are retained under `/tmp/qaira-recorded-program-{unit,native-browser,resolver-equivalence}-tests.log` for this review.

A separate real-provider diagnostic completed the same high-level signup intent
in six model calls across three sections. It discovered the intermediate Sign up
click, used frozen public generated inputs and a private `@t.password` binding,
and compiled every accepted section exactly from the protected operation ledger.
All three saved sources then passed unchanged in a fresh TestEngine browser with
zero repairs. Each browser submitted once; no production cases or application
accounts were written. The diagnostic saved sections in memory; four separate
PostgreSQL checks cover progressive Plan persistence. Earlier diagnostic failures
exposed mixed actor/source instructions, a provider JSON-format requirement,
redundant SPA navigation and privacy-mask input; these failures drove the fixes,
rather than being counted as successful runs. Private local evidence is retained
under `/tmp/qaira-engineer-actor-signup-proof-actual5-*`; this is a controlled
fixture result, not a verified run against a customer's application.

This evidence does not guarantee arbitrary applications or missing data can be automated. Missing credentials, unavailable pages, product failures and anti-bot challenges must remain explicit unmet requirements. The custom MCP currently closes additional pages and restricts navigation to the configured origin; popup/cross-origin authentication flows require a separate lifecycle and permission contract. Generation receipts remain distinct from a verified test-run result.

### Accessible-name failure follow-up — 17 October 2026

A live failed build reached signup and received six successful model responses,
but the MCP DOM hints advertised a role locator named `Email *`. The actual
Playwright accessibility snapshot named that field `Email`: the required marker
was correctly hidden from accessibility. Repeated zero-match validations then
spent the browser budget; a generic exception incorrectly reported a model
failure. Manual parameter inheritance was available in this build.

The fix uses Playwright's [ARIA snapshots](https://playwright.dev/docs/aria-snapshots)
and [role locator semantics](https://playwright.dev/docs/locators#locate-by-role)
to ground candidates in the actual captured element, rather than treating label
`textContent` as its accessible name. Each retained locator resolves uniquely
to that node at capture time. A CSS alternative remains available, ambiguous
candidates are omitted, and no DOM attributes are injected. A literal star in
an actual accessible name is preserved. Native label and role queries can have
different matching semantics; candidates are verified through their real
Playwright resolver.

Recovery now exposes match counts/uniqueness, refreshes failed-check evidence and
bounds repeated unsuccessful probes against unchanged state. Browser-budget
errors retain their real classification and cause. One completion-only turn
may finish already-observed work without dispatching extra browser calls.
Build Error aggregation joins durable/event/outcome records by action identity
without hiding distinct failures or reintroducing resolved errors.

The owned real-model regression then exposed a second contract defect: the flat
advertised assertion schema allowed `value` beside `assertion: "visible"`, while
the server correctly forbade that combination. The discovered schema now states
the conditional state/text/page argument rules. Host validation and MCP rejection
return safe required/forbidden-field feedback. A visibility check is never silently
treated as text verification, and invalid requests never reach the browser.

After those fixes, a real configured-model diagnostic generated all three owned
signup sections in twelve calls. Each accepted source exactly matched the host
compiler's confirmed-operation ledger. All three sources then passed unchanged
in a separate fresh TestEngine browser, with no repairs and one submission per
browser. The fixture checked the hidden-marker Email candidates on both the
sign-in and signup states and verified actual private inputs without embedding
their values in source. Evidence is retained privately under
`/tmp/qaira-engineer-accessible-name-proof-final-actual1-*`; no production cases
or accounts were changed.

That run also showed repeated requests for an already-ready current URL. The
host skipped them safely, but the compact current-state view did not prominently
identify the remaining contract. Navigation no-op feedback now appears there
with its factual outcome and pending action/check or goal-acknowledgement stage,
while preserving any earlier actual browser failure. Deterministic loop checks
cover that presentation-only follow-up; it did not trigger another provider run.

### Successful lookup loop and token usage — 17 October 2026

The subsequent AT32 failure reached signup and made eight successful GPT-4o
requests. Provider-reported usage was 107,333 input tokens and 590 output tokens;
42,240 of those input tokens were cached, a subset rather than an additional
chargeable token count. The current browser snapshot had correct Email locators,
but old repository context still advertised a stale role name. After correcting
the lookup, the model validated the correct locator four times without making
the expected-result assertion. The terminal diagnostic retained an obsolete
zero-match failure. Raising the browser budget would not address this loop.

The model now receives snapshot-bound opaque target references. A host-owned
WeakMap resolves each reference to a validated portable locator before tool
schema validation, execution, recording or compilation. A stale or invented
reference fails before browser dispatch. Existing source-mode locator requests
remain compatible. Repository context supplies semantic screen/field identity;
historical selectors and their duplicate criteria do not enter the actor task.
Current goals, expected results, ordered linked manual steps, frozen data,
private references, story context and authorized evidence citations remain.

Successful validation is reusable on unchanged state. It retires an obsolete
lookup diagnostic but never satisfies a visibility or business assertion. The
host exposes `pending_contract` from actual recorded operations and checks, so
the model can distinguish performing the goal, verifying its expected result
and acknowledging completion. Saved source still derives from actual successful
receipts. A deterministic replay of the reported sequence completes only after
a real expected-result assertion, and refuses completion based on lookup alone.

The compact model projection keeps one current snapshot and bounded typed
history; full retained evidence remains available to the host and UI. On the
recorded final turn, current state plus history shrank from 22,639 to 4,590
characters. These are character measurements, not measured provider token
savings. A reconstructed replay of all eight expanded requests reduced total
message text from 432,816 to 197,706 characters (54.3%), with checks preserving
the supplied prompt, parameters, manual goals and story provenance. The captured
request's sanitization required repairing one premature brace for this offline
comparison; it is not evidence of a newly dispatched provider request.
Per-call UI shows reported input, output, total and cached input tokens
and duration; unavailable usage stays explicitly unreported. Trace metadata
also records the final expanded request's UTF-8 byte count. Cached input is
never added to the input or total token count again.

The applicable patterns follow [Playwright MCP snapshot references](https://playwright.dev/mcp/snapshots)
and browser-use's [current-state message management](https://github.com/browser-use/browser-use/blob/main/browser_use/agent/message_manager/service.py)
and [reported usage accounting](https://github.com/browser-use/browser-use/blob/main/browser_use/tokens/service.py).
This is an adaptation within HelloTest's custom MCP transport, not installation
of the browser-use Python SDK or the official `@playwright/mcp` package.

The runtime configuration currently selects the main frontend fallback. Updating
only the Automation capability bundle therefore did not update the visible
activity pane. The main frontend and affected capabilities must both be rebuilt,
and verification must follow the runtime-selected asset graph. On the actual
recorded 72-event failure, aggregation reduces six repeated error rows to the
two distinct causes: the assertion and the terminal tool-budget failure.
