# AI configuration source audit

This audit describes the repository implementation. It does not certify semantic model quality, apply production settings, or establish which revision is deployed.

The canonical profile definitions are `services/platform/shared/aiFeatureCatalog.json`. Each profile declares one `configuration_owner` and an explicit `output_kind`; operation aliases are unique. `aiPromptDefaults.json` is an exact public projection of the active administrator-owned definitions, rather than a separately maintained set of prompts.

## Ownership and invocation

- **40 active administrator controls:** 38 chat features, the embedding integration view, and the external MCP failure-investigation prompt.
- **33 active agent profiles:** saved Agent Studio agent definitions or workflow nodes own their behavior, limits, model and evidence settings. Calls to a native application service retain the node execution scope.
- **3 retained identities without a dedicated model invocation:** `ai.quality.gate_assessment`, `ai.execution.case_triage`, `ai.agentic.browser_decision`. They are excluded from publication.

The 34 agent-owned catalog definitions include one retained legacy browser baseline; that baseline is not an additional active agent. A profile identity used for tracing or a native artifact contract does not make the administrator its configuration owner.

## Corrections

- Selected-case execution analysis returns plain text; run-report analysis returns a JSON report. They now have distinct profiles and operations. A report JSON schema can no longer constrain the case execution panel.
- Reviewed historical report instruction blocks migrate by an exact key allowlist. The old case prompt, model settings and output schema are not copied into the new report profile.
- Defect triage only refines the category and its explanation. Its prompt no longer invites priority changes, owner assignments, duplicate detection or changes to deterministic readiness.
- Failure clustering explains the host-owned groups. It no longer asks the model to regroup results, change members/counts or invent confidence. Its task marker resolves through the dedicated clustering profile.
- Release notes, retrieval intent, source enrichment, relationship extraction, grounding verification and locator repair now state their actual task, evidence limits and native deliverable instead of placeholder primary prompts.
- Case authoring permits safe synthetic fixtures while continuing to prohibit invented real credentials and live fixture claims.
- Stock generic guardrails fall from 1,362 to 858 characters while retaining user-objective priority, evidence/permission boundaries, exact identifiers, secret handling and verified-action requirements. This is a character reduction, not a provider-token measurement.
- Every previous stock prompt/guardrail remains an exact recognized migration value. Custom administrator-authored text is preserved; reading a profile does not publish or erase a saved configuration.

## Administrator-owned feature inventory

| Profile | Surface | Native response |
| --- | --- | --- |
| `ai.case_authoring.full_case` | Case authoring | json |
| `ai.case_authoring.step_rephrase` | Step rephrase | json |
| `ai.requirement.optimization` | Story completion | json |
| `ai.execution.analysis` | Selected-case execution analysis | text |
| `ai.execution.report_analysis` | Run report analysis | json |
| `ai.execution.smart_plan` | Smart execution planning | json |
| `ai.knowledge.assistant` | Knowledge assistant | json |
| `ai.automation.keyword_generation` | Automation keyword generation | json |
| `ai.automation.review` | Automation review | json |
| `ai.automation.step_rephrase` | Automation step rephrase | json |
| `ai.automation.gap_analysis` | Automation gap analysis | json |
| `ai.execution.network_to_api_steps` | Network to API steps | json |
| `ai.automation.locator_repair` | Locator repair | json |
| `ai.test_data.synthetic` | Synthetic test data | json |
| `ai.requirement.creation` | Story creation | json |
| `ai.requirement.grooming` | Story grooming | json |
| `ai.requirement.gherkin` | Story Gherkin | json |
| `ai.requirement.description_rephrase` | Story description rephrase | html |
| `ai.requirement.change_impact` | Story change impact | json |
| `ai.test_case.design` | Test design | json |
| `ai.test_case.change_impact` | Test Case change impact | json |
| `ai.quality.story_assurance` | Story assurance narrative | json |
| `ai.quality.test_case_assurance` | Test Case assurance narrative | json |
| `ai.quality.portfolio_insights` | Portfolio quality insights | json |
| `ai.quality.dashboard_design` | Dashboard design | json |
| `ai.bug.draft` | Defect drafting | json |
| `ai.bug.triage` | Defect triage | json |
| `ai.execution.failure_clustering` | Failure clustering | json |
| `ai.automation.dom_extraction` | DOM field extraction | json |
| `ai.content.rephrase` | Rich-text rephrase | html |
| `ai.release.notes` | Release notes | json |
| `ai.knowledge.intent` | Context intent planning | json |
| `ai.knowledge.enrichment` | Source enrichment | json |
| `ai.knowledge.graph_extract` | Knowledge relationship extraction | json |
| `ai.knowledge.embedding` | Evidence embeddings | embedding |
| `ai.admin.prompt_optimization` | Prompt optimization | json |
| `ai.knowledge.verification` | Answer grounding verification | json |
| `ai.automation.recorder_mapping` | Recorder step mapping | json |
| `ai.authoring.request_validation` | Test Case request validation | json |
| `ai.mcp.investigate_failure` | MCP failure investigation prompt | messages |

## Agent-owned feature inventory

| Profile | Surface |
| --- | --- |
| `ai.agentic.workflow` | Agentic workflow step |
| `ai.agentic.quality_plan` | Browser quality plan |
| `ai.agentic.quality-orchestrator` | Quality Orchestrator |
| `ai.agentic.story-architect` | Story Architect |
| `ai.agentic.test-designer` | Test Design Agent |
| `ai.agentic.automation-engineer` | Automation Engineer |
| `ai.agentic.run-planner` | Smart Run Planner |
| `ai.agentic.failure-analyst` | Failure Analyst |
| `ai.agentic.bug-reporter` | Defect Reporter |
| `ai.agentic.bug-triage` | Defect Triage Agent |
| `ai.agentic.quality-evaluator` | Quality Evaluator |
| `ai.agentic.repository-curator` | Object Repository Curator |
| `ai.agentic.story-completion` | AI Story Completion |
| `ai.agentic.story-grooming` | AI Grooming |
| `ai.agentic.story-assurance` | AI Story Assurance |
| `ai.agentic.test-improvement` | AI Test Case Improvement |
| `ai.agentic.release-readiness` | AI Release Readiness |
| `ai.agentic.impact-analysis` | AI Impact Analysis |
| `ai.agentic.coverage-assurance` | AI Test Coverage Assurance |
| `ai.agentic.risk-prediction` | AI Risk Prediction |
| `ai.agentic.flaky-test-intelligence` | AI Flaky Test Intelligence |
| `ai.agentic.release-risk-simulation` | AI Release Risk Simulation |
| `ai.agentic.quality-graph` | AI Quality Graph |
| `ai.agentic.automation-repair` | AI Automation Repair |
| `ai.agentic.repository.object_repository` | Object Repository Generator |
| `ai.agentic.repository.api_tests` | API Test Case Generator |
| `ai.agentic.repository.repository_knowledge` | Repository Knowledge Builder |
| `ai.agentic.repository.component_tests` | Component Test Generator |
| `ai.agentic.browser.web` | Web Explorer |
| `ai.agentic.browser.performance` | Performance Quality Agent |
| `ai.agentic.browser.security` | Security Quality Agent |
| `ai.agentic.browser.accessibility` | Accessibility Quality Agent |
| `ai.agentic.browser.visual` | Visual Quality Agent |

## Reproduce the source inventory

```sh
node scripts/checks/ai-configuration-inventory.mjs
node --test --test-concurrency=1 services/platform/backend/test/aiGovernanceCoverage.test.js services/platform/backend/test/aiInstructionAudit.test.js services/platform/backend/test/aiGenerationIntent.test.js
```

The inventory scans production JavaScript, TypeScript and Python under `services`, `testengine`, `local-run` and `scripts`, including `.mjs`/`.cjs` and the vendored semantic compiler. Dependencies, build outputs, generated artifacts and tests are excluded. It checks unique identities, owner declarations, response kinds, public-default completeness, static instruction references, model selections and raw model transport candidates. It reports source entry points rather than maintaining a second runtime profile registry. Dynamic specialist/browser selectors remain bounded by the runtime registries and host validators.

The intentionally separate boundaries are the small provider connection probe, native engine/telemetry HTTP, and the shared model adapter/policy layers. The vendored Python `llm_client.py` is explicitly inactive: the repository worker invokes the deterministic `compile.py` adapter, not that vendor orchestrator. Activating a new model client requires the same ownership, tracing and request-policy integration as the existing model paths.

Source and mocked-provider checks establish mapping, prompt composition, migration preservation and typed contracts. They do not establish factual correctness, complete acceptance coverage or successful execution by a production model.

## Runtime and validation follow-through

Agent execution now establishes a trusted asynchronous node/definition/run scope before model and provider resolution. The primary feature identity confines additional response schemas and task prompts to the appropriate phase. Shared native field/identifier checks, source permissions and execution budgets remain enforced. Historical agent admin rows are preserved but excluded from effective prompt/provider mappings; opening Agent Studio cannot convert those legacy mappings into an explicit model selection.

Application review criteria resolve on the server, with their own version/fingerprint provenance. Agent rubrics remain local. Story and Test Case design completeness now measure authored contracts rather than rewarding unrelated NFR categories, negative cases, automation, optional metadata or run history. Recorded execution evidence is disclosed separately. Keyword matches do not confer standards applicability.

The implementation was checked with native browser fixtures for AI Controls, Metric Governance and workflow node settings, full workspace/admin builds, a disposable real-PostgreSQL MCP/domain integration suite, and focused configuration/contract/scoring tests. Whole-suite failures are compared against isolated HEAD worktrees; unchanged failures are not counted as validation passes. Static source coverage does not certify provider semantic quality, change the production database, or deploy code.

The node UI uses a generated `aiExecutionDefaults.json` projection containing only model/evidence defaults and native contract notes. This avoids shipping full prompts and historical migration dictionaries to the editor. The source audit checks exact equality with the canonical catalog; refresh it with `node scripts/checks/ai-configuration-inventory.mjs --write-defaults` after changing those defaults.

## Validation snapshot

- Source inventory: 1,292 source files, 35 classified transport/policy sources, no missing mappings or duplicate identities.
- Workspace and admin production builds, TypeScript checks and package-boundary checks passed.
- Four Chrome browser fixtures passed: AI Controls editing/inspection, prompt reset, Metric Governance and native node configuration.
- Disposable PostgreSQL integration passed, including admin authorization, publication, versioned agent persistence, native task isolation, trace provenance and metric criteria.
- The focused governance/transport suite passed 106 tests; the final scoring/context frontend subset passed 19 tests. Additional node/default and abstention tests passed.
- Final full backend run: 3,283 tests; 3,211 passed, 21 skipped, 51 failed. The same 51 failures reproduce at isolated HEAD, with no additional failing test names.
- Whole frontend comparison: 918 tests, 904 passed, 14 failed; all 14 failures reproduce at isolated HEAD (which had 15 failures). Later node-default, scoring and browser checks passed separately.
- The Agent Studio page bundle fell from 2,084 KB with the full catalog import to 375 KB using the checked execution-default projection. This measures emitted JavaScript size, not LLM token usage.

No deployment or production configuration change was performed. In particular, an administrator-authored production NFR-only application override remains stored until explicitly replaced and published; node execution no longer inherits that override.
