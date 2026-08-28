export type AiPromptRegistryItem = {
  key: string;
  label: string;
  value: string;
  surface: string;
  maxLength?: number;
};

export const AI_PROMPT_OVERRIDES_KEY = "ai_prompt_registry_overrides";
export const AI_PROMPT_LLM_OVERRIDES_KEY = "ai_prompt_registry_llm_overrides";
export const AI_METRIC_CRITERIA_OVERRIDES_KEY = "ai_metric_criteria_overrides";
export const AI_METRIC_FORMULA_VALUES_KEY = "ai_metric_formula_values";

export const AI_PROMPT_REGISTRY: AiPromptRegistryItem[] = [
  {
    key: "ai.case_authoring.full_case",
    label: "Case authoring",
    surface: "Manual test case AI authoring",
    value: "Generate or improve a reusable manual test case as strict JSON, preserving story intent, app type context, step types, and @t test-data tokens."
  },
  {
    key: "ai.case_authoring.step_rephrase",
    label: "Step rephrase",
    surface: "Manual test step AI rephrase",
    value: "Rewrite one selected step into a concise executable action and expected result while preserving business intent, data tokens, and platform step type."
  },
  {
    key: "ai.requirement.optimization",
    label: "Story completion",
    surface: "Story AI completion",
    value: "Complete weak story details with acceptance criteria, risks, assumptions, and linked coverage guidance using available test case and knowledge context."
  },
  {
    key: "ai.execution.analysis",
    label: "Execution analysis",
    surface: "Run failure analysis",
    value: "Analyze execution evidence and logs, identify likely root causes, impacted stories, recommended fixes, and concise release risk guidance."
  },
  {
    key: "ai.execution.smart_plan",
    label: "Smart execution planning",
    surface: "AI smart run planning",
    value: "Plan an impact-based execution run from release scope, changed stories, suite coverage, recent failures, and available case metadata."
  },
  {
    key: "ai.knowledge.assistant",
    label: "Knowledge assistant",
    surface: "Project-grounded Ask HelloTest assistant",
    maxLength: 4_000,
    value: "Answer the user's HelloTest product or current-project question from the retrieved, citation-ready context. Give a concise direct answer, distinguish observed evidence from inference, cite supporting sources, and explicitly say when the available project context is insufficient."
  },
  {
    key: "ai.automation.keyword_generation",
    label: "Automation keyword generation",
    surface: "Automation builder",
    value: "Convert manual steps into grouped automation keywords with locator references, test data references, and stable execution-ready actions."
  },
  {
    key: "ai.automation.review",
    label: "Automation review",
    surface: "Automation case review",
    value: "Review the original manual case, its automation keyword steps, repository bindings, verification points, grouping, and coding standards. Suggest and regenerate optimized automation without removing business intent. Preserve @t and @s data scope tokens."
  },
  {
    key: "ai.automation.step_rephrase",
    label: "Automation step rephrase",
    surface: "Automation keyword step AI rephrase",
    value: "Improve this automation keyword step for clarity, verification strength, and coding standard alignment. Keep locator/object references and @t/@s tokens intact."
  },
  {
    key: "ai.automation.gap_analysis",
    label: "Automation gap analysis",
    surface: "Manual-to-automation gap fill",
    value: "Analyze the manual steps on this test case. Fill missing automation between actions, generate any missing manual step text implied by the flow, and attach each executable HelloTest keyword to its matching step on this same case across web, API, and mobile automation."
  },
  {
    key: "ai.execution.network_to_api_steps",
    label: "Network to API steps",
    surface: "Execution console network capture",
    value: "Map meaningful business API requests from the selected web execution network calls onto API automation steps in this same original test case. Preserve existing manual and web steps. Create additional API step rows on this case only when required. Never create a companion or duplicate test case."
  },
  {
    key: "ai.automation.locator_repair",
    label: "Locator repair",
    surface: "Object repository repair",
    value: "Repair weak or missing locators from DOM, labels, screenshots, and learned object repository context without changing the step intent."
  },
  {
    key: "ai.test_data.synthetic",
    label: "Synthetic test data",
    surface: "Test data generation",
    value: "Generate concise, distinct, fictional test data from the user's descriptive request. Honor requested formats, locales, lengths, prefixes, boundary conditions, and negative scenarios; never return real personal data, secrets, production credentials, or unexplained placeholders."
  },
  {
    key: "ai.requirement.creation",
    label: "Story creation",
    surface: "Create Story with AI",
    value: "Draft reviewable Stories from the supplied intent and bounded delivery evidence. Preserve source facts, identify assumptions, and include measurable acceptance, risk, and open-question coverage without inventing delivery scope."
  },
  {
    key: "ai.requirement.grooming",
    label: "Story grooming",
    surface: "Story details AI Grooming",
    maxLength: 4_000,
    value: "Produce a decision-ready, end-to-end feature walkthrough from only the selected Story and bounded delivery evidence. Start with a plain-language purpose and why the feature is needed; then walk through actors, trigger, ordered user journey, and evidenced alternate paths. Explain business impact, stakeholders, value outcomes, and measurable success. Keep solution design (behaviors, rules, boundaries, dependencies) distinct from implementation (components, data, integrations, and quality requirements). Cover validation with acceptance criteria, test scenarios, and linked coverage. Finish with what remains: gaps, questions, decisions, actions, risks, and an evidence-based Definition of Ready status. Every asserted fact must cite a supplied source; label inferences for confirmation, return empty content when a topic is unsupported, never repeat the Story description as filler, never invent controls, architecture, components, or delivery scope, and keep each section concise, distinct, and ordered by review importance."
  },
  {
    key: "ai.requirement.gherkin",
    label: "Story Gherkin",
    surface: "Story scenario generation",
    value: "Turn reviewed acceptance criteria into independently executable Given/When/Then scenarios. Keep the completed Story as the only behavior source and do not invent controls, roles, data, integrations, or outcomes."
  },
  {
    key: "ai.requirement.description_rephrase",
    label: "Story description rephrase",
    surface: "Story rich-text authoring",
    value: "Rewrite the current Story description for clarity and testability while preserving all facts, identifiers, constraints, acceptance intent, and unresolved uncertainty."
  },
  {
    key: "ai.requirement.change_impact",
    label: "Story change impact",
    surface: "Story AI Assurance",
    value: "Explain change impact only from current connected workspace traceability, linked cases, suites, runs, Bugs, delivery context, and supplied proposal evidence. Separate observed impact from assumptions and require human review."
  },
  {
    key: "ai.test_case.design",
    label: "Test design",
    surface: "AI Test Case generation",
    value: "Design distinct, reusable Test Cases against selected Story acceptance and risk evidence. Cover positive, negative, boundary, permission, recovery, accessibility, and relevant non-functional behavior with atomic observable steps."
  },
  {
    key: "ai.test_case.change_impact",
    label: "Test Case change impact",
    surface: "Test Case AI Assurance",
    value: "Explain the effect of a proposed Test Case change on linked Stories, suites, runs, automation assets, objects, and observed outcomes. Preserve evidence boundaries and do not imply that previewed changes were applied."
  },
  {
    key: "ai.quality.story_assurance",
    label: "Story assurance narrative",
    surface: "Story AI Assurance",
    value: "Explain deterministic Story maturity scores using the visible evidence, organizational criteria, and disclosed standards. Scores are locked; improve only the concise explanation and recommendation."
  },
  {
    key: "ai.quality.test_case_assurance",
    label: "Test Case assurance narrative",
    surface: "Test Case AI Assurance",
    value: "Explain deterministic Test Case maturity scores from authored steps, traceability, review state, and observed finalized results. Scores are locked; distinguish missing evidence from a negative finding."
  },
  {
    key: "ai.quality.gate_assessment",
    label: "Quality gate assessment",
    surface: "Quality gates",
    value: "Explain each deterministic gate comparison against its configured threshold, disclose missing or partial evidence, and recommend the smallest action that can satisfy the failed criterion."
  },
  {
    key: "ai.quality.portfolio_insights",
    label: "Portfolio quality insights",
    surface: "Quality analytics",
    value: "Summarize project or release quality from exact project-scoped metrics and traceability evidence. Never promote a bounded sample to an exact metric or make a release decision for the user."
  },
  {
    key: "ai.quality.dashboard_design",
    label: "Dashboard design",
    surface: "Custom analytics dashboard",
    value: "Propose a reviewable stakeholder dashboard using available deterministic metrics, safe project-scoped JQL, explicit formulas, and evidence limitations."
  },
  {
    key: "ai.bug.draft",
    label: "Bug drafting",
    surface: "AI Bug creation",
    value: "Draft a concise Bug only from selected failed or blocked evidence. Preserve expected-versus-actual behavior, reproducible steps, environment, build, impact, and uncertainty; never save automatically."
  },
  {
    key: "ai.bug.triage",
    label: "Bug triage",
    surface: "AI Bug triage",
    value: "Classify and prioritize selected Bugs from current work-item fields and traceability. Explain evidence for each recommendation, keep unsupported telemetry explicit, and require human approval."
  },
  {
    key: "ai.execution.failure_clustering",
    label: "Failure clustering",
    surface: "Run analysis",
    value: "Group failed or blocked results by explainable evidence similarity, not assumed root cause. Keep every result traceable to a cluster and recommend evidence-confirming next actions."
  },
  {
    key: "ai.execution.case_triage",
    label: "Case failure triage",
    surface: "Selected run Test Case analysis",
    value: "Analyze the selected case result, authored expectations, logs, attachments, environment, build, and related evidence. Separate likely causes from confirmed findings and produce only a reviewable Bug draft."
  },
  {
    key: "ai.automation.dom_extraction",
    label: "DOM field extraction",
    surface: "Object Repository import",
    value: "Extract stable accessible field intent and locator candidates from bounded DOM evidence. Prefer roles, accessible names, test IDs, and stable attributes over DOM position or generated classes."
  },
  {
    key: "ai.content.rephrase",
    label: "Rich-text rephrase",
    surface: "AI-assisted rich-text fields",
    value: "Rewrite supplied content into concise semantic HTML while preserving facts, identifiers, constraints, expected outcomes, and uncertainty. Do not invent work items, evidence, links, or approvals."
  },
  {
    key: "ai.agentic.workflow",
    label: "Agentic workflow step",
    surface: "Agentic QA workflows",
    value: "Execute only the bounded quality-engineering objective for the current workflow node, use declared upstream evidence, redact secrets, and return concise results and next actions within the configured human-approval boundary."
  }
];

export type AiPromptOverrides = Record<string, string>;
export type AiPromptLlmOverrides = Record<string, string>;
export type AiMetricCriteriaOverrides = Record<string, string>;
export type AiMetricFormulaValues = Record<string, Record<string, number>>;

export type AiMetricFormulaParameter = {
  defaultValue: number;
  help: string;
  key: string;
  label: string;
  max: number;
  min: number;
  step?: number;
  suffix?: string;
};

export type AiMetricCriteriaRegistryItem = {
  aliases: string[];
  criteria: string;
  formula: string;
  key: string;
  label: string;
  parameters?: AiMetricFormulaParameter[];
  surface: string;
};

export const AI_METRIC_CRITERIA_REGISTRY: AiMetricCriteriaRegistryItem[] = [
  {
    key: "metric.story.coverage",
    label: "Story coverage",
    surface: "Stories, projects, quality analytics",
    aliases: ["story coverage", "test coverage", "covered stories"],
    formula: "Stories linked to at least one reusable Test Case ÷ exact scoped Stories × 100. An unknown or partial denominator remains unknown.",
    criteria: "Treat a Story as covered only when a current project-scoped work-item relationship points to a reusable Test Case. Do not infer coverage from labels, title similarity, or locally loaded rows."
  },
  {
    key: "metric.test.design_completeness",
    label: "Design completeness",
    surface: "Test Cases and quality analytics",
    aliases: ["design completeness", "complete design", "scenario completeness"],
    formula: "Test Cases with at least one persisted step ÷ Test Cases with a verified, known step summary in the exact scope × 100. Unknown legacy summaries are excluded and disclosed.",
    criteria: "A persisted step makes the case design observable for this portfolio signal. Review action and expected-result quality separately; manual cases remain valid evidence and automation is not a prerequisite."
  },
  {
    key: "metric.execution.pass_rate",
    label: "Pass rate",
    surface: "Runs, modules, projects, quality analytics",
    aliases: ["pass rate", "recent pass rate", "latest pass rate", "latest pass confidence", "execution rate"],
    formula: "Passed finalized outcomes ÷ (passed + failed + blocked finalized outcomes) × 100. Running, queued, skipped, and unknown outcomes are excluded.",
    criteria: "Use the latest immutable finalized outcome for each item in scope. Never convert an absent denominator into 0% or 100%."
  },
  {
    key: "metric.execution.completion",
    label: "Execution completion",
    surface: "Runs and module hierarchy",
    aliases: ["complete", "completion", "run completion", "module completion"],
    formula: "Finalized case outcomes ÷ total cases in the exact run or module scope × 100.",
    criteria: "Passed, failed, and blocked are finalized. Queued, not run, and running are incomplete. Preserve unknown scope instead of estimating from loaded rows."
  },
  {
    key: "metric.release.run_confidence",
    label: "Run confidence",
    surface: "Quality analytics and release readiness",
    aliases: ["run confidence", "release execution confidence"],
    formula: "A deterministic composite of scoped execution completion, finalized pass evidence, recency, and unresolved failure or blocker penalties; unavailable inputs remain disclosed.",
    criteria: "Prefer recent release-scoped evidence. Penalize failed or blocked outcomes and stale or missing evidence; do not let an AI narrative change the deterministic score."
  },
  {
    key: "metric.automation.coverage",
    label: "Automation coverage",
    surface: "Test Cases, projects, and automation analytics",
    aliases: ["automation coverage", "loaded automation", "automated", "automation capacity"],
    formula: "Test Cases with verified automation evidence ÷ Test Cases with a known automation state in the exact scope × 100.",
    criteria: "Count only governed automation assets or executable step evidence. Stale text, imported code strings, and unknown summaries do not prove automation."
  },
  {
    key: "metric.defect.density",
    label: "Defect density",
    surface: "Stories, projects, and quality analytics",
    aliases: ["defect density", "bug density"],
    formula: "Distinct open project-scoped Bugs ÷ exact scoped Stories. The UI must disclose both numerator and denominator.",
    criteria: "Use current work-item workflow state and immutable project scope. Deduplicate the same Bug linked through more than one Test Case or Story."
  },
  {
    key: "metric.assurance.story",
    label: "Story design maturity",
    surface: "Story AI Assurance",
    aliases: ["story design maturity", "story maturity", "industry standards alignment", "user usefulness", "design maturity", "market comparison readiness"],
    formula: "Average of deterministic standards, usefulness, design-maturity, and market-pattern dimension scores, each derived from visible Story and traceability evidence.",
    criteria: "Assess testability, user outcome, measurable acceptance, risk and failure behavior, delivery context, standards signals, and source-grounded comparison. Never claim certification or unsupported competitor facts."
  },
  {
    key: "metric.assurance.test_case",
    label: "Test Case maturity",
    surface: "Test Case AI Assurance",
    aliases: ["test case maturity", "scenario intent", "execution clarity", "reliability evidence", "maintainability"],
    formula: "Average of deterministic scenario-intent, execution-clarity, reliability-evidence, and maintainability dimension scores.",
    criteria: "Use authored action/expected-result completeness, observable assertions, Story traceability, review evidence, and latest finalized outcomes. Missing automation is not a manual-case defect."
  },
  {
    key: "metric.smart_run.priority",
    label: "Smart Run priority",
    surface: "AI Smart Run",
    aliases: ["smart run priority", "risk score", "selection score", "at-risk runs"],
    formula: "Deterministic ranking from failed or blocked recency, linked Bug and Story risk, delivery-scope match, and available Test Case evidence.",
    criteria: "Prioritize direct release or Sprint scope and recent failures. AI may explain the ranking but cannot add cases unsupported by the bounded candidate set."
  },
  {
    key: "metric.project.portfolio_health",
    label: "Project portfolio health",
    surface: "Projects portfolio",
    aliases: ["overall health", "portfolio health"],
    formula: "Arithmetic mean of each accessible project's readiness score. Readiness combines exact Story coverage, automation coverage, and quality pass rate using the configured weights. Quality pass rate is passed finalized Test Cases plus resolved Bugs divided by finalized Test Cases plus all Bugs.",
    criteria: "Treat every accessible project equally rather than weighting by record volume. Keep projects without assessable scope identified as new and disclose missing evidence.",
    parameters: [
      { key: "story_weight", label: "Story coverage weight", defaultValue: 35, min: 0, max: 100, suffix: "%", help: "Contribution of exact Story-to-Test-Case traceability to project readiness." },
      { key: "automation_weight", label: "Automation coverage weight", defaultValue: 25, min: 0, max: 100, suffix: "%", help: "Contribution of explicitly automated Test Cases to project readiness." },
      { key: "pass_weight", label: "Pass rate weight", defaultValue: 40, min: 0, max: 100, suffix: "%", help: "Contribution of finalized Test Case outcomes and resolved Bug outcomes to project readiness." }
    ]
  },
  {
    key: "metric.project.risky_classification",
    label: "Risky project classification",
    surface: "Projects portfolio",
    aliases: ["risky projects", "risky project classification"],
    formula: "Count of assessable accessible projects whose newest run has a failed or blocked result, or whose combined Test Case and Bug pass rate is below the configured threshold.",
    criteria: "Use the latest recorded project run for hard failure signals and keep projects without Stories or Test Cases classified as new, not risky.",
    parameters: [
      { key: "pass_confidence_threshold", label: "Risk pass threshold", defaultValue: 60, min: 0, max: 100, suffix: "%", help: "Projects below this combined Test Case and Bug pass-rate value are classified as risky." }
    ]
  },
  {
    key: "metric.project.release_ready",
    label: "Release-ready projects",
    surface: "Projects portfolio",
    aliases: ["release ready", "release-ready projects"],
    formula: "Count of assessable accessible projects at or above the configured readiness threshold with no hard risk, evidence-policy, or open-Bug attention signal.",
    criteria: "This threshold classifies portfolio attention; it does not approve a release. Keep projects with hard risk or missing-evidence signals out even when their weighted score exceeds the threshold.",
    parameters: [
      { key: "readiness_threshold", label: "Release-ready threshold", defaultValue: 80, min: 1, max: 100, suffix: "%", help: "Minimum weighted readiness required for the portfolio release-ready classification." }
    ]
  },
  {
    key: "metric.project.average_story_coverage",
    label: "Average project Story coverage",
    surface: "Projects portfolio",
    aliases: ["average story coverage", "portfolio story coverage"],
    formula: "Arithmetic mean across visible projects of each project's linked Stories ÷ scoped Stories × 100. Each project has equal weight; projects with no Stories contribute 0%.",
    criteria: "Use direct project-scoped Story–Test Case relationships. Disclose both the unweighted project average and the aggregate linked/scoped counts to prevent denominator confusion."
  },
  {
    key: "metric.project.average_automation_coverage",
    label: "Average project automation coverage",
    surface: "Projects portfolio",
    aliases: ["average automation coverage", "portfolio automation coverage"],
    formula: "Arithmetic mean across visible projects of Test Cases explicitly marked automated ÷ loaded project Test Cases × 100. Each project has equal weight; projects with no cases contribute 0%.",
    criteria: "Show only when automation analytics permission and feature availability are present. A text snippet or hidden source field does not prove automation."
  },
  {
    key: "metric.project.execution_evidence",
    label: "Execution evidence completeness",
    surface: "Projects portfolio",
    aliases: ["evidence missing", "execution evidence", "run evidence"],
    formula: "Latest-run finalized Test Case outcomes with a screenshot, video, or comment at result or run level ÷ latest-run finalized outcomes × 100.",
    criteria: "Flag an assessable project when no finalized run evidence exists or evidence completeness falls below the configured threshold. Do not count unrelated project attachments.",
    parameters: [
      { key: "minimum_coverage_percent", label: "Minimum evidence coverage", defaultValue: 80, min: 0, max: 100, suffix: "%", help: "Minimum share of latest finalized outcomes that must have screenshot, video, or comment evidence. Set 0 to disable the violation." }
    ]
  },
  {
    key: "metric.project.needs_attention",
    label: "Projects needing attention",
    surface: "Projects portfolio",
    aliases: ["projects need attention", "needs attention"],
    formula: "Distinct accessible projects classified as risky or watch after readiness, execution, evidence, and open-Bug policy checks.",
    criteria: "Rank hard execution risk first, then evidence and Bug policy violations, then lowest readiness. Show only the configured number of priority projects on compact card backs.",
    parameters: [
      { key: "priority_project_limit", label: "Priority projects shown", defaultValue: 3, min: 1, max: 8, help: "Maximum project names shown on compact attention evidence; the remaining count is summarized." }
    ]
  },
  {
    key: "metric.project.execution_failures",
    label: "Execution failure cases",
    surface: "Projects portfolio",
    aliases: ["execution failures", "failure cases"],
    formula: "Failed Test Case outcomes in each accessible project's newest recorded execution. Blocked outcomes are disclosed separately and are not counted as failures.",
    criteria: "Rank impacted Modules and Stories by distinct failed Test Cases, show only the configured priority items, and summarize the remaining impacted scope.",
    parameters: [
      { key: "priority_impact_limit", label: "Priority impacts shown", defaultValue: 2, min: 1, max: 5, help: "Maximum highest-impact Modules and Stories returned for compact evidence." }
    ]
  },
  {
    key: "metric.project.bugs",
    label: "Portfolio Bugs",
    surface: "Projects portfolio",
    aliases: ["project bugs", "portfolio bugs", "open bugs"],
    formula: "Distinct Bugs assigned to accessible projects. Open Bugs are determined from current workflow status and drive the configurable attention threshold.",
    criteria: "Deduplicate Bugs linked through multiple Test Cases or Stories. Rank impacted Modules and Stories by distinct Bugs and summarize lower-priority scope.",
    parameters: [
      { key: "open_bug_attention_threshold", label: "Open-Bug attention threshold", defaultValue: 1, min: 0, max: 1000, help: "An assessable project at or above this number of open Bugs receives a watch signal. Set 0 to disable this signal." },
      { key: "priority_impact_limit", label: "Priority impacts shown", defaultValue: 2, min: 1, max: 5, help: "Maximum highest-impact Modules and Stories returned for compact evidence." }
    ]
  },
  {
    key: "metric.analytics.release_posture",
    label: "Analytics release posture",
    surface: "Quality analytics mission control",
    aliases: ["release posture", "analytics release readiness"],
    formula: "Story coverage × 35% + design completeness × 25% + latest pass confidence × 40%, minus up to 18 points for latest failed or blocked results and failed runs.",
    criteria: "Use only the bounded active-project evidence shown on the dashboard. Automation adoption never raises this score; incomplete scope must remain visibly provisional."
  },
  {
    key: "metric.analytics.latest_pass_confidence",
    label: "Analytics latest pass confidence",
    surface: "Quality analytics mission control",
    aliases: ["analytics latest pass confidence", "mission-control pass confidence"],
    formula: "Passed latest results ÷ all latest visible results in the newest run when available, otherwise passed latest results ÷ all latest visible project results × 100. Running, failed, and blocked evidence remains non-passing.",
    criteria: "Use one latest result per run and Test Case so reruns do not inflate the signal. This live confidence input is intentionally stricter than finalized-only pass rate and remains provisional for bounded scope."
  },
  {
    key: "metric.analytics.scope_lane",
    label: "Scope lane readiness",
    surface: "Quality analytics product-surface lanes",
    aliases: ["scope lane readiness", "lane readiness", "surface readiness"],
    formula: "Cases with persisted steps in the product surface ÷ scoped cases × 40%, plus passed latest results ÷ all latest results in that surface × 60%.",
    criteria: "Keep each app-type lane project-scoped. Failed, blocked, and running latest results do not count as passes; an absent case or result denominator contributes zero and stays evident in the lane facts."
  },
  {
    key: "metric.analytics.open_risks",
    label: "Open quality risks",
    surface: "Quality analytics mission control",
    aliases: ["open quality risks", "quality risk actions"],
    formula: "Uncovered Stories + cases without persisted steps + failed latest results + blocked latest results + failed runs.",
    criteria: "This is an action-signal total, not a deduplicated Bug count. Preserve each category so one unstable artifact is not misrepresented as one unique risk."
  },
  {
    key: "metric.release.readiness",
    label: "Release readiness",
    surface: "Release readiness decision room",
    aliases: ["overall readiness", "release readiness score"],
    formula: "Story coverage × 25% + execution completion × 20% + latest-terminal-result pass rate × 35% + defect containment × 20%, followed by disclosed caps for missing, stale, partial, blocked, critical-defect, or priority-gap evidence.",
    criteria: "Use only the selected Fix Version and Sprint evidence. A score cannot be definitive when scope, permissions, or source data are incomplete, and a person owns the release decision."
  },
  {
    key: "metric.release.evidence_confidence",
    label: "Release evidence confidence",
    surface: "Release readiness decision room",
    aliases: ["evidence confidence", "release evidence confidence"],
    formula: "When scoped Bugs exist: Story coverage × 40% + execution completion × 40% + defect traceability × 20%. With no scoped Bugs: coverage × 50% + completion × 50%. Incomplete evidence caps confidence at 69%.",
    criteria: "Confidence measures evidence completeness and linkage, not release safety or model certainty. Missing permissions, bounded sources, and unknown denominators must lower or withhold confidence."
  },
  {
    key: "metric.release.blocking_signals",
    label: "Blocking signals",
    surface: "Release readiness decision room",
    aliases: ["blocking signals", "release blocking signals"],
    formula: "Open critical Bugs + latest blocked Test Case outcomes + uncovered P1/P2 Stories in the exact release scope.",
    criteria: "Show the three components independently in evidence. This is an action total across signal types, not a count of unique work items."
  },
  {
    key: "metric.story.release_risk",
    label: "Story release risk",
    surface: "Release readiness Story queue",
    aliases: ["story release risk", "story risk score"],
    formula: "Priority baseline (P1 25, P2 15, other 5) + 35 if uncovered + 18 if linked but unexecuted + up to 35 each for failed or blocked latest outcomes + up to 40 for critical Bugs + up to 20 for other open Bugs; capped at 100.",
    criteria: "Rank only project- and release-scoped Stories using direct traceability and latest case evidence. The score orders review work; it does not predict failure probability."
  },
  {
    key: "metric.dashboard.release_confidence",
    label: "Dashboard release confidence",
    surface: "Custom quality dashboards",
    aliases: ["release confidence index", "dashboard release confidence"],
    formula: "100 − 35% of the Story-coverage gap − 15% of the automation-coverage gap − 3 points per open Bug − 4 points per failed run, clamped to 0–100.",
    criteria: "Treat this bounded project-portfolio index as prioritization guidance. Disclose the inspected record limit and never present the index as release approval."
  },
  {
    key: "metric.execution.cycle_time",
    label: "Execution cycle time",
    surface: "Custom quality dashboards",
    aliases: ["execution cycle time", "average completed run cycle", "avg execution"],
    formula: "Mean of ended_at − started_at (or created_at) in hours for completed runs with valid non-negative durations no longer than 30 days.",
    criteria: "Exclude missing, negative, and implausibly long durations. Disclose the inspected run sample and keep percentile or queue-time claims separate."
  },
  {
    key: "metric.jira.resolution_rate",
    label: "work-item resolution rate",
    surface: "Custom quality dashboards",
    aliases: ["resolution rate", "percent resolved in the inspected set"],
    formula: "work items with a non-empty resolution ÷ all project-scoped JQL items in the inspected set × 100.",
    criteria: "Use the exact validated JQL scope and disclose truncation. A resolution value indicates workflow closure, not necessarily defect correctness."
  },
  {
    key: "metric.jira.average_age",
    label: "Average work item age",
    surface: "Custom quality dashboards",
    aliases: ["average age", "average age in days"],
    formula: "Mean of current time − created time in whole days across inspected work items with a valid creation timestamp.",
    criteria: "Exclude missing or invalid timestamps and disclose the inspected JQL sample. Do not combine unresolved age with resolution duration."
  },
  {
    key: "metric.jira.average_resolution_time",
    label: "Average work-item resolution time",
    surface: "Custom quality dashboards",
    aliases: ["average resolution time", "average resolution time in days"],
    formula: "Mean of resolution time − creation time in whole days across inspected work items with valid, non-negative timestamps.",
    criteria: "Exclude unresolved items and invalid or negative durations. Disclose the inspected JQL sample and avoid treating the mean as a service-level percentile."
  },
  {
    key: "metric.test.step_completeness",
    label: "Step completeness",
    surface: "Test Case authoring and execution",
    aliases: ["step completeness"],
    formula: "Steps with both a non-blank action and a non-blank observable expected result ÷ authored steps in the selected Test Case × 100.",
    criteria: "Whitespace and formatting alone do not count. Automation code is neither required nor a substitute for a clear manual action and expected result."
  },
  {
    key: "metric.ai.input_readiness",
    label: "AI input readiness",
    surface: "Story AI review",
    aliases: ["ai input readiness"],
    formula: "15 points for a specific title + 25 for sufficient description + 25 for linked coverage + 10 for source references + 10 for labels + 15 for Sprint, iteration, Fix Version, or release context.",
    criteria: "Score only visible bounded Story context. Missing evidence is a review gap, not permission to infer or generate the missing fact."
  },
  {
    key: "metric.test.authoring_completeness",
    label: "Authoring completeness",
    surface: "Test Case authoring and AI Assurance",
    aliases: ["authoring completeness", "authoring"],
    formula: "A deterministic 8-point baseline plus bounded points for title specificity (16), description (20), Story trace (12), labels (10), meaningful steps (22), complete action/expected pairs (14), parameters (8), and permitted automation evidence (8); capped at 100.",
    criteria: "Prioritize observable test intent, traceability, and complete action/expected-result pairs. Automation evidence is optional and must be omitted when the viewer lacks access."
  },
  {
    key: "metric.execution.evidence_completeness",
    label: "Evidence completeness",
    surface: "Run AI Assurance",
    aliases: ["evidence completeness", "run evidence readiness"],
    formula: "Scoped cases with any result evidence ÷ total scoped cases × 65 points, plus 20 when Story traceability exists and 15 when Bug or external failure references exist.",
    criteria: "A touched case is not necessarily a passing case. Keep failed and blocked outcomes visible and require human triage before any release conclusion."
  },
  {
    key: "metric.automation.locator_stability",
    label: "Locator stability",
    surface: "Automation AI Assurance",
    aliases: ["locator stability", "locator healing readiness"],
    formula: "The saved, deterministic locator stability score, displayed with independent fallback-locator, DOM/accessibility, visual-evidence, and validation-history checks.",
    criteria: "Treat any AI locator as a proposal until the saved score and supporting evidence are human-reviewed and validated against a real screen."
  },
  {
    key: "metric.ai.evidence_grounding",
    label: "AI evidence grounding",
    surface: "AI preview and dashboard design",
    aliases: ["evidence grounding", "design confidence", "analysis confidence", "generation confidence"],
    formula: "The capability's server-owned evidence prior, floored to 78% after a contract-valid direct-model response; a deterministic fallback reports 80% of that same prior.",
    criteria: "This number describes workflow grounding and fallback mode, not factual probability or model certainty. Review cited evidence and limitations before accepting any suggestion."
  },
  {
    key: "metric.ai.story_draft_grounding",
    label: "Story draft grounding",
    surface: "Create Story with AI draft queue",
    aliases: ["story draft grounding", "story draft quality"],
    formula: "A locked 90% first-draft evidence prior, reduced by 4 points per additional draft and increased by 3 points when bounded supporting context exists, clamped to 58–95%; the single fallback draft uses 78% with context or 62% without it.",
    criteria: "Use the score only to order draft review. It is not writing quality, factual certainty, or approval; inspect source context, assumptions, risks, and acceptance criteria."
  }
];

export function normalizeAiPromptOverrides(input: unknown): AiPromptOverrides {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .filter(([key, value]) => typeof key === "string" && key.trim() && typeof value === "string")
      .map(([key, value]) => [key.trim(), String(value)])
  );
}

export function normalizeAiPromptLlmOverrides(input: unknown): AiPromptLlmOverrides {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .filter(([key, value]) => typeof key === "string" && key.trim() && typeof value === "string" && value.trim())
      .map(([key, value]) => [key.trim(), String(value).trim()])
  );
}

export function normalizeAiMetricCriteriaOverrides(input: unknown): AiMetricCriteriaOverrides {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .filter(([key, value]) => typeof key === "string" && key.trim() && typeof value === "string")
      .map(([key, value]) => [key.trim(), String(value).trim().slice(0, 4_000)])
  );
}

export function normalizeAiMetricFormulaValues(input: unknown): AiMetricFormulaValues {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};

  return Object.fromEntries(
    AI_METRIC_CRITERIA_REGISTRY
      .filter((metric) => metric.parameters?.length)
      .map((metric) => {
        const supplied = source[metric.key] && typeof source[metric.key] === "object" && !Array.isArray(source[metric.key])
          ? source[metric.key] as Record<string, unknown>
          : {};
        return [metric.key, Object.fromEntries((metric.parameters || []).map((parameter) => {
          const parsed = Number(supplied[parameter.key]);
          const bounded = Number.isFinite(parsed)
            ? Math.max(parameter.min, Math.min(parameter.max, parsed))
            : parameter.defaultValue;
          return [parameter.key, bounded];
        }))];
      })
  );
}

export function resolveAiPromptRegistryValue(key: string, overrides?: AiPromptOverrides) {
  const override = overrides?.[key]?.trim();
  const registryItem = AI_PROMPT_REGISTRY.find((item) => item.key === key);

  return override && (!registryItem?.maxLength || override.length <= registryItem.maxLength)
    ? override
    : registryItem?.value || "";
}

export function resolveAiMetricCriteriaValue(key: string, overrides?: AiMetricCriteriaOverrides) {
  const item = AI_METRIC_CRITERIA_REGISTRY.find((candidate) => candidate.key === key);
  return overrides?.[key]?.trim() || item?.criteria || "";
}

export function findAiMetricCriteriaByLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  return AI_METRIC_CRITERIA_REGISTRY.find((item) =>
    item.key.toLowerCase() === normalized
    || item.label.toLowerCase() === normalized
    || item.aliases.some((alias) => normalized.includes(alias) || alias.includes(normalized))
  ) || null;
}
