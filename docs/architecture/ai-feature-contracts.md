# AI feature contracts and budgets

Story and Test Case **Analyse with AI** request an evidence-grounded narrative for the current draft. Existing deterministic scores remain unchanged. Failed model reviews show an explicit fallback reason; they are not presented as completed AI reviews.

## Inputs and expected outputs

| Feature | Relevant input | Output contract |
| --- | --- | --- |
| Story creation | User intent, selected delivery scope, reviewed context and image references | Reviewable Story fields, acceptance criteria, assumptions, gaps and evidence references |
| Complete Story | Bounded current Story, acceptance criteria, specification, planning fields and relevant linked cases | Supported Story improvements in the existing Story schema |
| Groom Story | Current Story and bounded, authorized delivery evidence | Distinct purpose, journey, business impact, solution, implementation and validation sections, with citations and readiness gaps |
| Story Assurance | Current unsaved draft, linked evidence, organizational criteria and locked score baseline | Cited explanations, prioritized improvements and limitations; no generated scores |
| Test Case Assurance | Current structured steps or current Gherkin, metadata, linked Story acceptance and locked baseline | Cited explanations and actionable design improvements; no generated execution results or scores |
| Test Case generation | Explicit user objective, optional selected Story with criteria/specification, relevant authorized knowledge, authoring mode and requested count | Distinct cases with executable steps and observable expected outcomes; exact Story references only when a Story is selected |
| Case authoring / step rephrase | Current case, selected Story, platform, data tokens and selected step when applicable | Full case or one selected step using the requested schema; preserve data tokens and intent |
| Defect creation | Reporter brief, selected run/cases/Stories, observed results and reviewed context | Editable Defect fields, factual field citations, unsupported-field gaps and assumptions |
| Defect triage | Selected Defects and supporting evidence | Cited category refinements; deterministic priority and readiness remain locked |
| Automation | Manual case, available keyword catalog, object bindings and reviewed evidence | Existing keyword/step schema, valid references and explicit missing bindings |
| Execution analysis / planning / reports | Selected run evidence or delivery scope, available case IDs and bounded logs | Feature-specific analysis, plan or report; distinguish observed results from inferred causes |
| Synthetic data | Requested format, boundaries, field context and relevant reviewed constraints | Distinct fictional values and a concise summary |
| Rich-text rewrite | Current field, entity context and reviewed terminology | Allowed semantic HTML preserving facts and uncertainty |
| Knowledge / specialist assistants | Authorized, scoped retrieval, bounded history and current objective | Existing cited answer or specialist contract, with explicit evidence gaps |

Generation resolves published feature configuration from [AI Controls](../product/ai-controls.md). The shared catalog supplies stock defaults and conditional format/recovery templates; the frontend registry provides compatible prompt keys. Role, task, guardrails, model settings and MCP policy are editable through reviewed publication. Native schemas, identifiers, permission checks and bounded transport limits remain application contracts. An explicit user objective within the feature intent takes precedence over default coverage guidance: an NFR-only request must not be replaced with core positive cases. Story selection is optional and improves grounding. Full and reduced-context retries preserve that objective and the native schema.

## Context and provider selection

Smart Context applies feature-specific source-kind filters, deduplicates results, and builds a bounded reviewed pack with intact citation boundaries. The preview and submitted pack use the same included sources. Explicit context scopes no longer expand implicitly from the prompt's keywords. The artifact snapshot helpers select meaningful fields instead of serializing complete hydrated database records. Current Gherkin takes precedence over cached structured rows.

Provider precedence is explicit user selection, active configured feature preference, last successful provider for the same project/feature, last successful provider for that project, then the existing active fallback. A sole active provider is selected automatically in the shared selector. Retired implicit preferences are skipped; an unavailable explicit selection stays visible. Opening a selector or making a failed request does not record a success.

## Spending and failure bounds

`llmRequestPolicy.js` bounds every chat request using `llmHttpClient`. These are application limits, not a claim about a particular provider's context window or tokenizer.

| Operation | Maximum output tokens per call |
| --- | ---: |
| Story creation, completion, grooming; full-case authoring | 6,144 |
| Test Case generation; automation generation | 8,192 |
| Story / Test Case Assurance; Defect draft; execution analysis, plan and reports; release notes; rich-text rewrite | 4,096 |
| Dashboard design | 3,072 |
| Defect category triage; synthetic data | 2,048 |
| Selected manual-step rewrite | 1,024 |
| Other chat calls | 4,096 |

A lower caller-supplied limit is retained. Knowledge assistant calls retain their existing gateway budgets and usage accounting. The shared text-input ceiling is 96,000 UTF-8 bytes, including the schema and instructions; oversized inputs are rejected before dispatch rather than cutting serialized JSON or tool messages. Feature-level snapshots impose smaller field and record limits. Images retain their separate feature admission limits.

Direct Test Case previews accept at most ten Stories and ten requested cases per call. Background generation remains bounded per Story. Defect drafting includes at most ten selected cases, ten Stories and ten failure results, with omissions disclosed in its evidence boundaries.

Explicit provider parameter or context-size rejections may receive bounded corrections under one deadline. Truncated, refused, empty or invalid structured responses are rejected with actionable errors. The shared transport does not replay successful or uncertain billable generations. The specialist workflow uses configured bounded JSON, citation and outcome corrections with concrete host feedback; the knowledge gateway retains its independently bounded retry and cost policy.

JSON-object mode is used for compatibility with configured providers, with schema instructions and feature-level validation. JSON mode alone does not guarantee schema adherence; this distinction follows the [OpenAI structured output documentation](https://developers.openai.com/api/docs/guides/structured-outputs).

## Verification scope

Automated checks cover request contents, scope and citation boundaries, current structured/Gherkin drafts, provider-default precedence, input/output budgets, explicit compatibility handling, and failure behavior. UI regressions cover the shared Story/Defect studio and Smart Context/provider selection.

Live checks used only synthetic data against the configured `openai/gpt-oss-20b` integration: a small Story JSON contract completed with 165 input and 655 completion tokens under a 1,024-token output ceiling; actual Story and Test Case Assurance calls both returned cited reviews without fallback. These checks establish compatibility for that configuration, not every model or every real project scenario.

## Agent Studio outcomes (20 October 2026)

This review covers the 22 workspace specialists, five browser quality agents and project-defined agents. The four **Build from source** agents and their compiler runtime are excluded. This is an implementation and regression review, not certification against an industry standard or a claim that every model produces correct business content.

The shared [outcome catalog](../../services/agentic/shared/agentOutcomeContracts.json) declares authoring versus analysis. A successful transport response is not sufficient for a reviewable outcome. The host validates native fields, exact source references, permitted Test Case types, finding IDs and proposal coverage. It feeds specific issues back within the same configured budget. An unchanged rejected draft stops further correction. Missing product behavior stays an explicit blocker.

| Agent | Reviewable outcome |
| --- | --- |
| Quality Orchestrator | Cited decision brief and scoped specialist drafts for actionable library gaps |
| Story Architect | Complete Story draft: title, description, priority and acceptance criteria |
| Story Completion | Complete revision-pinned Story proposal, or cited no-change conclusion |
| Story Grooming | Ambiguities, dependencies and questions, with supported Story/Test Case proposals |
| Story Assurance | Acceptance/coverage matrix and supported corrective proposals |
| Test Design Agent | Complete structured/Gherkin cases, type, priority, data parameters, setup, actions and expected results |
| Test Improvement | Improved case drafts preserving intent and parameters, or cited no-change conclusion |
| Automation Engineer | Complete manual automation Plan draft with metadata and linked manual cases; existing durable browser generation remains separate |
| Smart Run Planner | Exact existing case selection, rationale and exit criteria for a manual Run draft |
| Failure Analyst | Observed-versus-expected evidence, hypotheses and diagnostics; Defect drafts only when observed evidence supports them |
| Defect Reporter | Complete draft with reproduction, expected/actual, severity and priority |
| Defect Triage | Cited per-Defect recommendation table; no inferred authorization to overwrite Defects |
| Quality Evaluator | Evidence review and concrete library proposals for applicable cited gaps |
| Object Repository Curator | Locator/duplicate review and validation requirements; no unsupported locator replacement |
| Release Readiness | Gate evidence, blockers, residual risks and supported follow-up drafts; no automatic release approval |
| Impact Analysis | Relationship/impact matrix and supported regression drafts |
| Coverage Assurance | Criterion-to-case matrix and supported missing case drafts |
| Risk Prediction | Evidence-backed signals, uncertainty and mitigation; no invented probabilities |
| Flaky Test Intelligence | Attempt/environment patterns, hypotheses and repeatability experiments |
| Release Risk Simulation | Explicit assumptions and scenario/sensitivity tables; simulated results stay labelled |
| Quality Graph | Witnessed relationships, missing links and proposed follow-up |
| Automation Repair | Existing typed, pinned and separately verified repair proposal; no generic script replacement |
| Browser Web/Security/Performance/Accessibility/Visual | Specialist task brief, observed findings, metrics where measured, limitations and appropriate report/Defect review |
| Create agent | Version-pinned objective, skills, evidence/tool scopes, completion rules, limits and explicit review or native authoring output kind |

Test Improvement with a selected saved case reads a versioned full manual intent snapshot. Up to 30 exact steps or complete supported Gherkin remain intact in primary and reduced packets; oversized or unsupported sources stop with a specific reason. Private values stay out of model context. Story links require the selected Story scope and current permission; omitted links are explicitly disclosed. Read-only link evidence cannot authorize an unversioned Story update.

Findings have stable IDs. New artifacts identify the original findings they address and cite overlapping supporting evidence. Handoffs receive the original review, authorized evidence and earlier proposals labelled as proposals. Each successor must validate its own output and coverage before being marked complete. Typed finding routing supports known artifact kinds and selected scopes; legacy wording heuristics remain a compatibility fallback, not authorization.

**Review & approve** presents the resulting editable content. Acceptance reuses native domain services, permissions, revision checks where available, source-access rechecks and a per-proposal idempotent receipt. Story completion can update an evidenced saved Story revision. Cases, Defects, Runs and automation Plans create new drafts; there is no invented revision-safe overwrite path. Automation Plan approval does not save model-written scripts or claim execution. The native Run stores its name and case selection; approved rationale/exit criteria are retained in the acceptance receipt because the Run domain has no corresponding editable fields.

Analysis outputs support cited text sections, rectangular text tables and labelled finite numerical bar charts. Charts require evidence and units; the schema cannot establish semantic accuracy of model-authored numbers. Findings, full brief and historical output rendering reject object coercions and null-placeholder responses. Human review remains necessary for business correctness.

### Configuration, streaming and cost

Prompts, skills, output guidance and narrative guardrails resolve from versioned AI Controls. Recognized stock proposal guidance upgrades through an explicit default migration; reviewed custom text remains intact. The Model & limits tab exposes total calls, corrections, specialist handoffs and whole-task timeout. Project-agent limits can reduce those values. Domain schemas, ACLs and approval requirements remain code-enforced and cannot be disabled by prompt configuration.

The host streams actual intake, retrieval, correction, handoff and browser-decision progress. It also streams schema-validated read-only draft previews, with fresh source permissions, while final checks continue. Raw provider JSON and private reasoning are not streamed; draft previews cannot be accepted before a persisted final result. Disconnects and deadlines propagate cancellation, and publication rechecks active execution and source ACLs for both streaming and ordinary JSON requests.

Generation, compatibility correction and handoffs share the total budget. Per-agent corrections are bounded, provider transport/refusal/truncation failures are not blindly replayed, and old browser observations are explicitly excerpted. Provider-reported usage is aggregated only when every call supplies it; missing usage remains unknown. No token multiplier or small-model accuracy guarantee has been established by these controlled regressions.

The approach adapts programmatic gates and scoped specialist handoffs from [Anthropic's agent patterns](https://www.anthropic.com/engineering/building-effective-agents), typed tool results from the [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools), and authorization/output validation principles from [OWASP's AI Agent Security guidance](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html). These references inform the design; they are not claims of certification.
