# AI Agents, Custom Agents, Workflow Nodes and Automation Engineer: product review and implementation plan

Date: 24 November 2026. Perspective: product architect. The question asked of every area is whether the feature does the job a user hired it for, not whether the code is well structured.

This review complements [the 17 November structural review](automation-agents-workflow-2026-11-17.md). That review closed code-level findings: registry, descriptors, SSE, triggers, resume. This one measures **outcomes**: what a user gets when they run the thing. Several areas that review marked complete still fail at the outcome level (see section 0.3).

## 0. Method, evidence and limits

### 0.1 What was examined

| Source | Scope |
|---|---|
| Live app, `http://localhost:8080`, signed in as the workspace admin | Agent Studio library and workbench, Create-agent builder (all 3 steps), Workflows list and editor, Test Automation case Build tools, Security observer quality agent |
| REST reads, same session | 32 agent descriptors; 20 saved agent sessions (all dated 2 Nov); 33 workflow runs on *HelloTest Launchpad*; 9 on *amazon*; 20 quality-agent runs; 17 repository-agent runs; 15 workflows; 204 test cases |
| Code | `services/contracts/agents`, `services/agentic/{backend,frontend,shared}`, `services/automation/backend/lib/build`, `docs/architecture/automation-workflow.md` |

### 0.2 Limits, stated plainly

- **No new agent or workflow run was started.** A run spends model credit and writes a saved review. All output analysis uses runs already saved in the app.
- Project *amazon* has **0 custom agents** ("Project agents 0"). Custom-agent behaviour comes from the builder UI, the CRUD API and one saved custom-agent session in *HelloTest Launchpad*. Version history, sharing and an existing custom agent's edit view were **not** observed.
- Only the Security observer quality agent's *configuration* was opened. Its saved-run output panels were read from code, not from a live render.
- Findings marked **(verify)** are inferences from one observation and need a confirming test before work starts.

### 0.3 Where the earlier "complete" status does not hold

| Earlier claim | Observation today |
|---|---|
| Sprint Automator end-to-end workflow is implemented | *amazon*: **9 of 9 runs failed**, each at the Automation Engineer node, with **seven different failure codes**. The longest took 6 min 53 s. |
| 32 agents have a common descriptor | True, but 22 workflow agents are **identical** in tools, limits and guardrail text. |
| Evidence scope and intent routing are grounded | A Test Design run was classified `execution_failure_task` because the prompt said "root cause certainty". Its "identifiers" were the words *release*, *required*, *request*, *story_id*. |

## 1. Executive summary

**Ten findings that matter most, in priority order**

1. **The flagship flow does not finish on real data (W, E).** Sprint Automator on *amazon* never produced a saved automation case. Failures are reported with one generic sentence, and one failing case stops the whole sprint.
2. **Three agents called "Automation Engineer" exist, plus a fourth descriptor (E).** The Agent Studio one failed in 3 of 3 saved sessions. The one that works lives in the case Build tools tab.
3. **Intent routing is keyword-driven, not agent-driven (A1).** It misclassifies agent tasks and extracts nonsense identifiers. Cause found: `contextIntent.js:207` and `:96`.
4. **Guardrails are a single static list (A2).** There are no per-agent guardrails, and no distinction between *enforced in code* and *requested in the prompt*.
5. **The headline quality score is the model grading itself (A3).** "Evidence review diagnostics", `method: model_assessment`, grounding 80.
6. **Output tabs overlap (section 2.4).** *Artifacts*, *Outcome* and *Full brief* repeat each other. *Model calls* is an ops view shown to every user.
7. **Custom agents cannot be tested before activation (C1)**, cannot use any tool beyond two read-only ones (C4), and have a guardrail limit mismatch between UI (5,000) and API (2,000) (C5).
8. **Workflow nodes can read everything and write almost nothing (W2).** There is no node to create a defect, start a run, ask a human to approve, or notify anyone. The Output node publishes nowhere.
9. **Five node kinds overlap (W3)** (`agent`/`llmAgent`/`customAI`, `apiAgent`/`apiTool`), and `webAgent` does not browse despite its name.
10. **Nothing measures whether any of this works (A8, E11).** No acceptance rate, first-run pass rate or minutes per automated case.

**Recommended sequence:** Phase 0 correctness fixes (about 1 week) → Phase 1 intent, guardrail and output model (2–3 weeks) → Phase 2 Automation Engineer reliability and verification loop (3–4 weeks) → Phase 3 workflow action nodes and failure model (3–4 weeks) → Phase 4 custom agent maturity (3 weeks). Phases 2 and 3 can overlap. Details in section 6.

## 2. Part 1: AI agents

### 2.1 The inventory

32 descriptors; the library shows 31 (the `browser` automation descriptor is reached through Build tools).

| Family | Count | Entry point | Output contract |
|---|---|---|---|
| Workspace specialists (lifecycle) | 22 | Library → Open agent → workbench | `quality-lifecycle/1` (18), `agent-review/3` (4) |
| Source builders | 4 | Library → source run | `repository-findings/1` → publish after review |
| Browser mission (quality) | 5 | Library → Quality Agent Lab | `quality-agent-report/1` |
| Automation | 1 | Test Automation → Build tools | `automation-program/1` |

### 2.2 What is uniform, and why that is a problem

All 22 workspace specialists share: tools `project_evidence:read` and `knowledge_search:read`; 4 model calls; 4 tool calls; 120 s timeout; `review_required: true`. The only differences are the prompt, the evidence scopes and a destination link. A user cannot tell from the descriptor what makes the Failure Analyst safer or cheaper than the Defect Reporter. The library card says "Review brief" on 22 of 31 cards.

Guardrails shown in a run's evidence panel are the same five lines for every agent (`agenticAssistant.service.js:979`), plus the optional free-text guardrails of a custom agent. The descriptor has **no guardrails key** at all.

### 2.3 Agent-by-agent assessment

Verdicts: **Sound** = intent, guardrail and output fit; **Gaps** = usable with fixes; **Weak** = does not deliver its intent today.

#### Lifecycle authoring: Story Architect, AI Story Completion, AI Grooming, AI Story Assurance (all Story-centred)

- **Intent.** Four agents act on one object, a Story, at different moments: create, complete, groom, assess. Nothing in the library says *when* to pick which. Assurance's "obligation matrix" overlaps Coverage Assurance (F13).
- **Guardrails.** Good text-level rules (no invented product rules, distinguish source-supported from proposed). Nothing is enforced beyond citation integrity.
- **Output.** Story Architect and Completion produce a draft. Grooming and Assurance produce findings and questions.
- **Verdict:** Gaps.
- **Plan:** A7 (decision-first cards), A2 (enforced guardrails: "no new acceptance criteria without a citation or a flagged proposal"), A12 (draft-vs-source diff in the review).

#### Test design and improvement: Test Design Agent, AI Test Case Improvement, AI Test Coverage Assurance

- **Observed run (Test Design, saved 2 Nov).** Headline "Test Case Proposal for Duplicate Click Handling…". One test-case artifact. Readiness `limited_evidence`: runs and bugs unavailable. `charts`, `tables` and `sections` were empty. 1 model call, 9,711 tokens.
- **Intent gap.** Routed as `execution_failure_task` (A1). Retrieval priority therefore favoured runs and bugs, which were the unavailable scopes.
- **Guardrail gap.** The proposed case was "blocked" by a missing pending-state control, yet it was still proposed. There is no rule that decides whether a *blocked* draft may be saved.
- **Output.** Strong: rationale, case, gaps. Missing: coverage delta ("this adds 1 of 7 acceptance criteria").
- **Verdict:** Gaps.

#### Execution intelligence: Smart Run Planner, Failure Analyst, AI Flaky Test Intelligence

- **Intent.** Clear and high value. Run Planner's output (ranked case table with exact IDs) is the most "actionable" in the set.
- **Guardrail.** Flaky Intelligence rules (same revision, build, environment, data) are the best-specified in the set but are prompt-level. The check "all compared attempts share revision and build" can be computed in code.
- **Output gap.** Run Planner ends in a table; there is no one-click "create Smart Run from this selection".
- **Verdict:** Gaps.

#### Defects: Defect Reporter, Defect Triage Agent

- **Intent.** Clear. Reporter drafts; Triage ranks.
- **Gaps.** No duplicate check against existing defects as a code step (the prompt asks for "duplicate candidates"). No export to an external tracker. Both end in a draft or table, with no "create defect" action on the output tab beyond artifact acceptance.
- **Verdict:** Gaps.

#### Release and risk: Quality Orchestrator, AI Release Readiness, AI Impact Analysis, AI Risk Prediction, AI Release Risk Simulation, AI Quality Graph, Quality Evaluator

- **Intent.** Seven agents answer variants of "can we ship, and what's risky?". Orchestrator is meant to route to specialists, but handoffs are suggestions (`suggested_handoffs: []` in the saved run), and the library has no way to run a handoff.
- **Guardrail.** Release Readiness and the F14–F17 agents are well specified ("code-computed gates", "not calibrated probabilities") and carry a `verifier: quality-evidence/1`. This is the right pattern. **Replicate it elsewhere** (A2).
- **Output.** Quality Evaluator reports a model-estimated grounding score (A3).
- **Verdict:** Release Readiness and F14–F17 are **Sound**. Orchestrator and Evaluator are **Gaps**.

#### Automation: Automation Engineer (workbench), AI Automation Repair, Object Repository Curator

- **Automation Engineer (workbench): Weak.** All three saved sessions are `failed` (`AGENT_OUTPUT_INVALID`). In the inspected one the model was called 3 times (about 32,500 tokens) and each revision hit a contract error (`AGENT_OUTCOME_FINDING_REFERENCE_INVALID`, then `…_FINDING_UNRESOLVED`). The user sees "This review failed before producing a saved outcome. Start a new review to retry." The run also logged "Enter a Start URL before creating or generating browser automation" and carried on. See section 5.
- **AI Automation Repair: Gaps.** Good contract (assertion-preserving, typed locator repair), but see E8.
- **Object Repository Curator: Gaps.** Reviews only; no apply path from the output.

#### Source builders: Object Repository Generator, API Test Case Generator, Repository Knowledge Builder, Component Test Generator

- **Intent.** The clearest of all: source in, reviewable artifacts out, publish after review. Findings → select → publish with status.
- **Sound** on intent and output. Gaps: the four have no guardrail description in their descriptor (only a compiler tool), and limits show `timeout_ms: 600000` only.

#### Browser mission: Web explorer, Security observer, Performance analyst, Accessibility reviewer, Visual regression

- **Intent.** Clear. "What comes back" is stated on each (e.g. Security: passive findings, response headers).
- **Guardrails.** Best-in-set honesty about tools ("never claim ZAP ran without a receipt", "don't claim axe-core ran when metrics disclose a DOM fallback"). Form submission is an explicit opt-in.
- **Output gap.** **Visual regression has no baselines** (`/agentic-quality/baselines` returned an empty list), so all 4+ completed visual runs are "first capture, review required". The agent cannot do its core job until a baseline workflow exists.
- **Output gap.** A run carries three overlapping panels: `agent_assessment`, `mission_outcome`, `mission_report`.
- **Verdict:** Gaps, with a Weak spot for Visual.

### 2.4 Output tabs: is each section useful?

| Surface | Tab / section | Useful? | Problem | Change |
|---|---|---|---|---|
| Workbench | **Review brief** (empty state) | Yes | Fine before a run | Keep |
| | **Activity** | Yes | Live progress | Keep; add failure reason on failed runs |
| | **Saved reviews (n)** | Yes | List only | Add compare, rerun-with-same-scope |
| Outcome panel | **Overview** | Yes, most used | Seven blocks stacked: summary, coverage facts, scope, quality panel, completion checks, limitations, assumptions, gaps. No verdict at the top | Decision card first (verdict, readiness, top 3 findings, primary action); collapse the rest |
| | **Findings** | Yes | "Requested change has no matching draft" is a dead end | Add "ask agent to draft this" action; priority filter |
| | **Artifacts** | Partly | Overlaps *Outcome* for drafts; also hosts charts/tables | Merge with Outcome as **Drafts & actions**; move charts/tables to **Analysis** |
| | **Full brief** | No | Concatenation of the other tabs (`agentOutcomeBrief`) | Remove as a tab; offer Copy, Download (MD/PDF/DOCX) and a print view |
| | **Outcome** | Partly | For non-draft agents it re-renders the summary and deliverables again | Show only when there are drafts or actions; otherwise hide |
| | **Model calls** | Ops only | Trace/ID view in front of end users | Show tokens, time and model as a one-line chip; full trace under **Run details** (admin) |
| Evidence flyout | Sources, route, guardrails, provenance | Yes | For failed runs guardrails say "No guardrail detail was returned" | Persist guardrails and route at intake, before any model call |
| Quality agent run | Findings, Visual evidence, Browser journey, Mission report, Run receipt, Agent assessment, Mission outcome, Model calls | Mixed | Assessment, outcome and report overlap | One **Result** panel + **Evidence** + **Receipt** |

### 2.5 Cross-cutting agent gaps and plan

Each work package has: change, where, acceptance test, size.

#### A1. Make agent intent authoritative and fix routing (P0, S)

- **Change.**
  1. For a selected specialist, derive `input_type`, priority scopes and deliverable from the agent's declared intent. User prompt wording may adjust retrieval but not reclassify.
  2. Fix the identifier pattern. Require a delimiter or digit and match case-sensitively for non-numeric prefixes; reject dictionary words.
  3. Treat `execution_failure` keyword matches as a hint only when the agent is a chat or generalist route.
- **Where.** `services/contracts/agents/contextIntent.js:96` (patterns), `:207` (identifiers).
- **Evidence.** Words *release*, *required*, *REQUIRED*, *request*, *runner*, *story_id*, *release_id*, *requires_proposal* were stored as identifiers. The Test Design prompt contained "root cause certainty".
- **Accept.** Unit table: prompts containing "release", "required", "request", "root cause", "failed" produce `identifiers: []` and the agent's own input type for each of the 22 specialists. A real ID (`AT_68`, `TC-12`, `BUG-3`) still matches.

#### A2. Per-agent guardrail packs with an enforcement type (P0, M)

- **Change.**
  1. Add `guardrails: [{id, text, enforcement: "code" | "prompt", severity}]` to the descriptor.
  2. Persist the list in the run at intake and show it in the evidence flyout, labelled with the enforcement type.
  3. Move computable rules into the existing verifier: cited IDs exist (already), compared attempts share revision/build (Flaky), release gates computed in code (Readiness), no draft saved while flagged "blocked" (Test Design), duplicate-defect check (Reporter).
- **Where.** `workflowSpecialists.json` (descriptor source), `agentDescriptors.service.js`, `agentResponseContract.js`.
- **Accept.** Descriptor hash changes only when guardrails change. Each of the 22 agents has at least 3 guardrails, at least 1 enforced in code. A run that violates an enforced guardrail is marked `needs_correction` with the rule id.

#### A3. Replace model self-score with checkable measures (P1, S)

- **Change.** Rename "Evidence review diagnostics" to "Model-estimated grounding (not verified)" and remove it from the headline. Add deterministic measures to the Overview: *share of claims with a valid citation*, *share of findings with a matching draft*, *share of acceptance criteria covered by proposed cases* (where applicable).
- **Accept.** The headline never shows a number that comes only from the model. Each measure shows numerator and denominator.

#### A4. Pre-run evidence check (P1, M)

- **Change.** Before **Start review**, show per scope: records available, records that will be used, and a fix ("pick a release", "add Runs scope"). Block or warn when a priority scope is empty.
- **Evidence.** The saved Test Design run had `missing_scopes: ["runs","bugs"]` and spent a model call to find out.
- **Accept.** Starting with an empty priority scope requires an explicit confirm. The same warning appears in workflow readiness.

#### A5. Fix or retire the workbench Automation Engineer (P0, M). See E12.

#### A6. Name collisions (P0, S)

- **Change.** Two descriptors are named "Automation Engineer" (`automation-engineer`, `browser`). Rename: *Automation Readiness Advisor* (workbench, if kept), *Automation Engineer* (the Build agent), *Automation Engineer node* in workflows.

#### A7. Decision-first library cards (P1, M)

- **Change.** Replace "Inputs & output / Review brief" with: **Decision it supports**, **Use when / not when**, **Needs** (e.g. Story, Release), **Returns** (analysis / drafts / actions), **Writes anything?**, **Typical time and tokens** (from A8). Add filters: lifecycle stage, output type, "creates drafts".
- **Accept.** No two cards share an identical "decision". A user can find "agent that makes defects" in two clicks.

#### A8. Agent scorecard from existing run data (P1, M)

- **Change.** Per agent: runs, completion rate, failure codes, draft-accept rate, median time, median tokens. Add a thumbs/reason capture on each finding and draft.
- **Where.** Reads `agent-runs` canonical rows; writes feedback to the activity ledger.
- **Accept.** Library card shows the three numbers; a failed-run breakdown by code is one click away.

#### A9. Run history that supports work (P2, M)

- **Change.** Compare two runs; "rerun with same scope"; share link with access check; export.

#### A10. Cost and time before and after (P2, S)

- **Change.** Show estimated tokens and seconds before the run (from scorecard medians). After the run, show actual in the header chip (see Model calls row, 2.4).

#### A11. Failure taxonomy for agent runs (P0, S)

- **Change.** Replace "failed before producing a saved outcome" with: code, plain cause, the unmet contract rule, tokens spent, and a next action ("retry with fewer required drafts", "supply Start URL"). When the outcome-contract repair loop fails, store the last invalid candidate for inspection.
- **Accept.** Each of the three failed AE sessions would show the contract issue (`finding reference invalid`) and its path (`artifacts[0].addressed_finding_ids`).

#### A12. Visual baselines (P1, M)

- **Change.** Add **Approve as baseline** on a visual run and a baselines list. Visual runs then compare. Until then, relabel the agent "Capture screenshot for review".
- **Accept.** Second run on the same URL and viewport reports a measured difference.

#### A13. Consolidate quality-run panels (P2, S). See table 2.4.

## 3. Part 2: Custom agent creation

### 3.1 What exists

A 3-step builder opened from **Create agent**:

| Step | Capability |
|---|---|
| 1. Purpose | Start from blank or any of 22 specialists; name (120), objective (2,000), description (600), model connection, task instructions (3,000) |
| 2. Skills & evidence | Up to 8 library skills; 2 tools; free-text additional guardrails; 6 evidence scopes; knowledge sources via Smart Context; domain context (4,000); required run inputs (comma-separated names) |
| 3. Completion & limits | Node AI settings (temperature, top P, evidence mode and budgets, retrieval focus, additional output schema); review criteria; required result (evidence review, or Story, Test case, Defect, Run, Automation Plan drafts, minimum 1–8); require evidence; stop on gaps; minimum findings 0–8; time 10–150 s; calls 1/2/4; output tokens 256–8,000 |
| Lifecycle | Save draft, Save and activate, versions with `expectedVersion`, archive; usable in the workflow *Workspace specialist* node |

API (`agenticWorkflows.routes.js:106-122`): list, get, create, update, delete. **Nothing else.**

### 3.2 Maturity assessment

| Dimension | Level | Reason |
|---|---|---|
| Authoring | Good | Clear steps, validated, templates |
| Safety of the output contract | Good | Completion rules are enforced in code, not by model claim |
| Trying it | **Missing** | No dry run before activation |
| Reuse and evolution | **Thin** | No clone with lineage, no diff or rollback seen, no "base agent changed" signal |
| Capability | **Thin** | Two read-only tools |
| Governance | **Missing** | No owner, visibility, approval or audit view seen |
| Operability | **Missing** | No scorecard; cannot be scheduled or triggered except through a workflow node |

### 3.3 Gaps and plan

#### C1. Test before activate (P0, M)

- **Change.** A **Try it** panel in the builder: pick a sample scope (a Story or Release), run once with a cost cap, see the assembled evidence list and the rendered output panel. Show the descriptor hash and the exact system frame to the author (redacted for secrets).
- **Where.** New route `POST /agentic-workflows/agents/:id/trial`, reusing the specialist model boundary.
- **Accept.** Activation is offered after one successful trial; a trial never saves artifacts and is labelled in history.

#### C2. Clone and lineage (P1, S)

- **Change.** *Duplicate*, and *Start from* records `derived_from: {agent_id, descriptor_hash}`. Show a notice when the base changes ("Story Architect updated; review changes").
- **Evidence.** The saved custom run reported its route as `quality-evaluator` while the user's agent was a "Quality Orchestrator custom". Lineage and identity are not clear **(verify** whether this is a base-profile fallback**)**. Fix by routing on the custom agent's own declared intent (A1).

#### C3. Version history, diff, rollback (P1, M) **(verify** UI exposure first**)**

- **Change.** List versions, diff two versions, activate an older one. Record which version produced each saved review (the session already carries `agent_version`).

#### C4. Tool catalog (P1, L)

- **Change.** Add selectable tools with an effect class (`read`, `propose`, `write`): run evidence, repository evidence, Test Data, MCP tools configured in the workspace, HTTP read. `write` tools need explicit per-agent approval and always produce a reviewable proposal, never a direct write.
- **Accept.** An agent restricted to `project_evidence` cannot call run evidence. Every tool call appears in the run with arguments and effect.

#### C5. Guardrails as structured rules (P0 for the limit bug, P1 for structure, M)

- **Bug.** The skills editor allows 5,000 characters of guardrails (`WorkflowSkills.tsx:51`); the API accepts 2,000 (`agentDefinition.js:35`). A 3,000-character guardrail passes the UI and fails on save. Align both, or surface the real limit.
- **Change.** Replace the single textarea with a rule list: *must cite*, *never include*, *max drafts*, *require human confirm for X*, plus free text. Mark each rule as prompt-level or code-checked (A2).
- **Accept.** A rule "never include customer emails" is code-checked against the output; a failing output is marked `needs_correction`.

#### C6. Typed output design (P2, M)

- **Change.** Beyond six result kinds: author-defined required sections (names, order), minimum citations, simple score thresholds. The *additional output schema* field in step 3 becomes a guided editor with preview.

#### C7. Typed run inputs (P1, S)

- **Change.** Replace comma-separated `required_inputs` with `{name, label, type (text, story, release, run, environment), default, required}` and generate a form. Reuse `evidenceScopeFields.json` pickers.
- **Accept.** A custom agent that needs `release_id` shows a release picker, not a free-text field.

#### C8. Limits and cost control (P2, S)

- **Change.** Hard caps (150 s, 4 calls, 8,000 tokens) are fixed in `agentDefinition.js`. Make them tiered by plan, show the reason when a cap blocks a setting, and add a per-agent monthly token budget.

#### C9. Governance (P1, M)

- **Change.** Owner; visibility (private, project, workspace); `draft → reviewed → active` for workspace-wide agents; audit view of changes. Define who may create agents (permission).

#### C10. Operate it (P2, M)

- **Change.** Scorecard (A8); schedule and event triggers on the agent directly (today only via a workflow); export and import definitions.

## 4. Part 3: Workflow nodes

### 4.1 Catalog assessment (23 kinds, 100 nodes, 4 specialists, 100 loop items, 1,000 loop executions)

Maturity: **Strong** = does its job; **OK** = usable with gaps; **Thin** = limited; **Overlap** = duplicates another.

| Node | Job | Maturity | Gap |
|---|---|---|---|
| Workflow trigger | Starts the flow with input | OK | Input is raw JSON. All 15 saved workflows use *manual* even though schedule, signed webhook and event triggers exist |
| Native AI task | Five fixed tasks on Story packets | OK | Tied to the `nativeStory` contract; cannot be reused on other inputs. Always exclusive (serial). Timeout up to 60 min |
| Custom AI | Own prompt + model | OK | Overlaps Workspace specialist |
| MCP server tool | Call an enabled MCP tool | OK | Always exclusive |
| Source analysis | Repository agents | Strong | Counts toward the 4-specialist cap |
| Workspace specialist | The 22 specialists and custom agents | OK | 150 s max; cap 4 per workflow |
| Specialist review | Reason over intent and upstream | **Overlap** | Same executor and validator as Workspace specialist |
| Web Evidence Agent | "Analyze supplied web evidence" | **Overlap / misleading** | Does not browse; users expect a browser. No node runs the browser mission agents |
| API Agent / HTTP Request | Approved API calls | **Overlap** | Two nodes, same effect class (`http_write`) |
| Knowledge search, Repository evidence, Run evidence | Read context | Strong | Read-only; fine |
| Condition | True/false routing | OK | Cannot branch on an agent's readiness or finding count without a Map step |
| Loop over items | Batches, return, collect | Strong | Sequential; per-item failure policy is only *stop* in the templates |
| Merge | Wait, append, match, combine | Strong | Cannot join revision-bound native checkpoints (documented) |
| Map JSON, Data operation | Shape and filter | Strong | Two nodes for one concern (shape data) |
| Wait | Pause | **Thin** | 0–60,000 ms only. No wait-for-approval or event |
| Stop with error | End run | OK | |
| Error handler | Handle failed node output | **Thin** | Returns the failure data with `recovered: true`; takes no recovery action |
| Log | Record evidence | OK | |
| Output | Publish result | **Thin** | No configuration (`validate: () => []`), no outgoing connection. It publishes nowhere outside the run record |

### 4.2 Workflow-level gaps

#### W1. Failures are opaque and late (P0, M)

- **Evidence.** *amazon*, 9 runs, node message in 7: "A workflow node could not finish. Review its configuration and completed output before retrying." Seven distinct codes: `AUTOMATION_UPSTREAM_BUILD_INCOMPLETE` (2), `…_ACTION_OUTCOME_UNCONFIRMED` (2), `AUTOMATION_BROWSER_ENGINE_UNAVAILABLE`, `AUTOMATION_UPSTREAM_SOURCE_INVALID`, `AI_INPUT_BUDGET_EXCEEDED`, `NODE_EXECUTION_FAILED` and a provider-unavailable skip. A *validation* failure (HTTP 422) was recorded as `outcome_unknown: true, reconciliation_required: true`.
- **Change.**
  1. Map every failure code to **cause, fix, who can fix it, safe to retry?**, shown on the node and in the run summary.
  2. Run all environment preflights before the first loop iteration: browser engine reachable, Start URL reachable, environment variables present, model connection valid, input within budget.
  3. A validation failure must not set `outcome_unknown`.
- **Where.** `WorkflowFailureDetails.tsx`, `runtimeEvents.js`, `nodes/shared/*Preflight.js`.
- **Accept.** Each of the seven codes renders a distinct card with a fix. A missing engine fails in under 10 seconds, not minutes in.

#### W2. Action nodes: let workflows change the product, safely (P1, L)

- **Change.** Add nodes with a `propose → approve → apply` model:
  1. **Human approval** (waits; assignee; timeout; approve/reject with comment)
  2. **Create or update record** (defect, test case, story comment) producing a draft that needs approval unless the workflow is marked trusted
  3. **Run tests** (start a Smart Run or suite on the Test Engine and wait for results)
  4. **Notify** (email, webhook, in-app)
  5. **Call workflow** (sub-workflow with typed input and output)
- **Accept.** A workflow can: take failing runs → Failure Analyst → Defect draft → approval → defect created. Every write is in the receipt journal and resumable.

#### W3. Consolidate overlapping nodes (P1, M)

- **Change.** Merge `llmAgent` into `agent` (keep a migration alias). Merge `apiAgent` and `apiTool` behind one **HTTP request** node with an "assist with AI" option. Rename `webAgent` to *Analyze supplied page evidence* and add a real **Browser mission** node wrapping the five quality agents. Group the step-kind picker by purpose (Start, Think, Read, Act, Shape, Flow, Finish) instead of a flat select of 21.

#### W4. Output and error handling that do something (P1, M)

- **Change.**
  1. **Output** gets a destination: show on the run (today), save as a report, attach to a record, send (via Notify). Name and shape the result.
  2. **Error handler** gets actions: retry with changed settings, route by failure category (retryable vs configuration vs validation), notify, continue.

#### W5. Per-item failure isolation in loops (P0, M)

- **Evidence.** The Sprint Automator template sets `onError: stop` on every node. One failed case stops the sprint (the runs summarise "Saved 1 manual Test Case… node could not finish").
- **Change.** A loop policy `item_failure: continue | stop`. Default **continue** for generation loops. Collect failures and report them in Output as a table with a retry-this-item action.
- **Accept.** A sprint with 5 cases where case 3 fails completes cases 1, 2, 4, 5 and lists case 3 with its failure card.

#### W6. Triggers and input (P2, M)

- **Change.** Typed workflow input (schema → form with pickers). A **Test trigger** with a sample payload. Surface schedule, webhook and event choices in the template gallery (none of the 10 templates uses one).

#### W7. Specialist cap by budget, not count (P2, S)

- **Change.** Replace "4 specialists" with a per-run model-call and token budget. Show remaining budget in the canvas header.

#### W8. Canvas ergonomics (P2, S)

- **Evidence.** On a 10-node workflow the fit view renders the graph at a size that is hard to read, while the inspector takes about one third of the page.
- **Change.** Fit with a minimum readable zoom; collapsible inspector.

## 5. Part 4: Automation Engineer and its workflow node

### 5.1 One job, four surfaces

| Surface | Where | State observed |
|---|---|---|
| **Build tools** | Test Automation → case → *Build tools* | The primary, mature path. Start URL (required), build browser (paired local agent or remote Test Engine), mode (perform steps or inspect only), after-generating options (save only, run, bounded repair, Playwright CLI), activity history, per-section Instructions / Source / Build Error / Browser activity / Verification / Model request / Model response |
| **Workflow node** | Native AI task → `automation-engineer` | Per case, inside two loops. 9 of 9 failures on *amazon* |
| **Workbench agent** | Agent Studio → Automation Engineer | 3 of 3 saved sessions failed; advice-only; no Start URL or environment input |
| **Descriptor `browser`** | Automation family | Same display name as the workbench agent |

Plus *AI Automation Repair* (F18) and a HelloTest MCP build tool.

The Build tools design follows Playwright's planner / generator / healer split, and generated source stays "unverified until a run passes". That framing is good. The gaps are in reliability, verification and consolidation.

### 5.2 Gaps and plan

#### E1. Verify by default (P0, M)

- **Evidence.** The default "After generating" is **Save instructions only**, and the sample case AT_68 sits at "Failed" from 9 Nov. In the sample project 12 cases are `ready` and 172 are `not_automated`, but `ready` means inputs are complete, not that a run passed.
- **Change.** Default to *Run generated test* when an environment is set. Show **Verified (run id)** vs **Unverified** in every list. Never display "Automated" without a passing run; use "Generated, unverified".
- **Accept.** A case list filter *Generated, unverified* exists, and the Sprint Automator output counts verified and unverified separately.

#### E2. Preflight before any model spend (P0, S)

- **Evidence.** The page header says **Local agent: Not checked**. `AUTOMATION_BROWSER_ENGINE_UNAVAILABLE` was found mid-run.
- **Change.** On opening Build tools: check engine, local agent, Start URL reachability and required environment variables. Disable **Build** with the exact reason.

#### E3. Human checkpoint instead of whole-case failure (P1, L)

- **Evidence.** `AUTOMATION_UPSTREAM_ACTION_OUTCOME_UNCONFIRMED` (2 of 9) and `…_BUILD_INCOMPLETE` (2 of 9) failed the whole case after minutes.
- **Change.** When one section's outcome is unconfirmed, pause that section and ask: *adjust expected result*, *mark observed result*, *skip with reason*, or *retry from here*. Progress already saved by section is kept (the design already saves progressively).
- **Accept.** A case with 1 unconfirmed section out of 6 ends as "5 sections built, 1 needs your input", not "Failed".

#### E4. Time and throughput (P2, L)

- **Evidence.** One case took 3–7 minutes; the node is exclusive and cases run one at a time; a sprint of 20 cases is a multi-hour run.
- **Change.** A build queue with a concurrency limit per environment, a time estimate, resumable batches, and partial results as they land.

#### E5. Close the loop: build → run → repair (P1, M)

- **Change.** After a failed verification run, offer **Repair** inline (F18 contract). Record repair outcomes against the case. One action path, not a separate agent page.

#### E6. Consolidate surfaces (P0 for naming, M)

- **Change.** Keep one **Automation Engineer** (Build tools) as the product. Workflow node and MCP tool call the same host (already true). Turn the workbench agent into a **Readiness Advisor** that answers "is this case ready to automate, and what is missing?" with a deep link to Build tools. If the advisor is not wanted, remove it from the library.
- **Accept.** The library has no agent that fails because it lacks a Start URL.

#### E7. Environment and credentials as first-class inputs (P1, S)

- **Change.** The workflow node already asks for a Test Environment; mirror it in the workbench and Build tools header (environment chip with reachability). Show which protected variables the case needs and which are missing.

#### E8. Repair and object reuse metrics (P2, S)

- **Change.** Show repository-object reuse rate and locator stability per case ("35 objects" is shown, reuse is not).

#### E9. Scorecard (P1, M)

- **Change.** Per project and per environment: build success rate, **first-run pass rate**, repair rate, median minutes per case, top failure codes. This also answers whether E1–E5 worked.

#### E10. Platform coverage honesty (P2, S)

- **Change.** Web and API are generated; native mobile accepts supplied selector evidence only. State this at the case-type selector and block "Build" for unsupported combinations instead of failing late.

### 5.3 The workflow node specifically (`automation-engineer` Native AI task)

| Aspect | Observation | Change |
|---|---|---|
| Contract | Whole case at once; 30-minute timeout; exclusive; `onError: stop` | W5 per-item isolation |
| Inputs | Needs Sprint, Test Environment, Start URL; checked partly at "Readiness" | E2 preflight before the first loop item |
| Outputs | "Saved 1 automation Test Case pending review and unverified" | E1: add a **Run tests** node (W2) after it and report verified vs unverified |
| Gate | `readinessPolicy: verify-inputs` default (alternative `require-ready`) | Explain both in the node; show which cases were skipped by the policy |
| Failure | 8 codes, one sentence | W1 failure cards |
| Template | Sprint Automator has no approval, no run, no notification | Add optional approval and run steps; ship a "Sprint → verified automation" template |

### 5.4 Reading the Automation page

All three KPI tiles show "Methodology unavailable for unmapped identity · population: unspecified · unit: unspecified". Either supply the metric identity or hide the line; as shown it reads like an error on every tile (P2, S).

## 6. Roadmap

### 6.1 Phases

| Phase | Weeks | Work packages | Outcome |
|---|---|---|---|
| **0. Correctness** | 1 | A1, A6, A11, C5 (limit bug), W1 (error cards for the seven codes, 422 ≠ unknown), E2, E6 (naming) | No misrouted intents, no silent limit mismatch, every failure explains itself |
| **1. Intent, guardrails, output** | 2–3 | A2, A3, A4, A7, output tab restructure (2.4), A12 | Each agent states its job, its enforced rules and a decision-first result |
| **2. Automation reliability** | 3–4 | E1, E3, E5, E7, E9, W5 | Sprint Automator finishes with partial results; verified vs unverified is visible |
| **3. Workflow actions** | 3–4 (overlaps 2) | W2, W3, W4, W6 | Workflows can approve, run, notify and write drafts |
| **4. Custom agents** | 3 | C1–C4, C7, C9, A8 scorecard | Authors can test, clone, govern and measure |
| **5. Polish** | 1–2 | A9, A10, A13, C6, C8, C10, E4, E8, E10, W7, W8 | |

### 6.2 Dependencies

- A2 and C5 share the guardrail model. Build once.
- W2's approval node is needed by E3's human checkpoint in the workflow setting.
- A8, E9 and C10 share the scorecard data. Build the read model once.
- W1 and A11 share the failure taxonomy (one catalogue, two renderers).

### 6.3 Success measures (set a baseline now)

| Measure | Today | Target |
|---|---|---|
| Sprint Automator runs reaching an automation case, *amazon* | 0 of 9 | 8 of 10 with partial results counted separately |
| Workbench agent runs that fail the output contract | 3 of 3 (Automation Engineer) | under 5% for any agent |
| Failure messages naming a cause and a fix | 0 of 9 runs | 100% |
| Mean time to first failure signal on a missing engine | minutes | under 10 s |
| Library agents with at least 3 guardrails, 1 code-enforced | 0 of 32 | 32 of 32 |
| Authors who run a trial before activating | not possible | at least 80% |
| Generated automation with a passing run attached | not reported | reported on every list |

### 6.4 Test plan per package (summary)

- **A1:** table-driven unit tests for the 22 specialists and a regex word-list.
- **A2 / C5:** descriptor-hash test; verifier test per code-enforced rule; UI and API limit parity test.
- **W1 / E2:** one fixture per failure code that asserts the card text and the preflight timing.
- **W5:** workflow fixture with a deliberately failing middle item.
- **E1 / E3:** Test Engine fixture with one unconfirmable section.
- **Output tabs:** component tests for the merged tabs; a visual check at 1440 and 390 px in light and dark.

### 6.5 Decisions for the product owner

1. Keep the workbench Automation Engineer as a *Readiness Advisor*, or remove it?
2. Should "trusted" workflows be allowed to apply writes without approval?
3. Are workspace-wide custom agents allowed, and who approves them?
4. Which external trackers and notification channels are in scope for W2?
5. Are tiered caps (C8) a commercial decision?

## 7. Evidence index

- Saved agent sessions inspected in full: Test Design Agent (`d7018891…`), Automation Engineer (`9b756b36…`), Quality Orchestrator custom (`c27661f0…`), all in *HelloTest Launchpad*.
- Workflow runs: 9 on *amazon* (`review-ef21e90a…` and eight others, 11 Nov); 33 on *HelloTest Launchpad*.
- Code references: `services/contracts/agents/contextIntent.js:96,207`; `services/agentic/backend/agents/agentDefinition.js:35`; `services/agentic/frontend/workflows/WorkflowSkills.tsx:51`; `services/agentic/backend/services/agenticAssistant.service.js:979`; `services/agentic/frontend/components/AgenticExperience.tsx:218`; `services/agentic/backend/routes/agenticWorkflows.routes.js:106-122`; `services/agentic/shared/workflowNodeKinds.json`; `services/agentic/shared/workflowNativeTasks.json`; `services/agentic/backend/workflows/nodes/{output,errorHandler,flow/wait}.js`.
- No secret values or session tokens are included.
