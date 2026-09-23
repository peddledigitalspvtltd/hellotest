import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

const sliceBetween = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  assert.ok(start >= 0, `Missing start marker: ${startMarker}`);
  assert.ok(end > start, `Missing end marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
};

const assertProgressFirstMetricCard = (card, trailingMarker, metricComponent = "TileCardMetric") => {
  const progressIndex = card.indexOf("<TileCardProgress");
  const metricsIndex = card.indexOf(`<${metricComponent}`);
  const trailingIndex = card.indexOf(trailingMarker);

  assert.ok(progressIndex >= 0, "Card should render progress");
  assert.ok(metricsIndex > progressIndex, "Progress should precede metric cards");
  if (trailingMarker) assert.ok(trailingIndex > metricsIndex, `${trailingMarker} should remain after metric cards`);
  assert.equal((card.match(/<TileCardProgress/g) || []).length, 2);
  assert.equal((card.match(new RegExp(`<${metricComponent}`, "g")) || []).length, 4);
};

test("the shared tile primitives provide accessible progress and responsive metric cards", async () => {
  const [primitives, styles, statusBar, barStyles] = await Promise.all([
    readSource("../src/components/TileCardPrimitives.tsx"),
    readSource("../src/modal-system.css"),
    readSource("../src/components/MetricStatusBar.tsx"),
    readSource("../src/components/MetricStatusBar.css")
  ]);
  const progress = sliceBetween(primitives, "export function TileCardProgress", "export function TileCardStatusIndicator");

  assert.match(progress, /<MetricStatusBar/);
  assert.match(progress, /breakdown\?: MetricBreakdown/);
  assert.match(statusBar, /role=\{progress \? \(available \? "progressbar"/);
  assert.match(statusBar, /aria-valuemin=\{progress && available \? 0/);
  assert.match(statusBar, /aria-valuemax=\{progress && available \? 100/);
  assert.match(statusBar, /aria-valuenow/);
  assert.match(statusBar, /aria-valuetext/);
  assert.match(statusBar, /segment.displayCount/);
  assert.match(statusBar, /title=\{description\}/);
  assert.match(barStyles, /height: 14px/);
  assert.match(barStyles, /@container \(max-width: 24px\)/);
  assert.match(styles, /\.tile-card-metric-grid \{[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.tile-card-metric-grid \{[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@container \(max-width: 360px\)[\s\S]*\.tile-card-metric-grid \{[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /:root\[data-theme="dark"\] \.tile-card-progress-stack[\s\S]*background: rgba\(15, 35, 65, \.72\) !important/);
  assert.match(styles, /:root\[data-theme="dark"\] \.tile-card-metric[\s\S]*background: color-mix/);
  assert.match(styles, /@media \(forced-colors: active\)[\s\S]*\.tile-card-progress-track/);
});

test("Test Suite tiles put truthful readiness above four metrics and retain identity, description, and insight", async () => {
  const page = await readSource("../src/pages/DesignPage.tsx");
  const card = sliceBetween(page, "const mappedCaseCount = counts[suite.id]", "viewMode === \"list\"");

  assertProgressFirstMetricCard(card, "test-case-ai-note");
  for (const detail of ["EntityIdBadge", "StatusBadge", "CatalogCardDescription", "Story coverage", "Suite stability", "Cases", "Steps", "Automation", "Failed"]) {
    assert.match(card, new RegExp(detail));
  }
  assert.match(card, /value=\{mappedCaseCount \? coverageScore : null\}/);
  assert.match(page, /isFinalized: \(current\?\.isFinalized \?\? true\) && result\.status !== "running"/);
  assert.match(page, /selectLatestExecutionResultInstances\(executionResults\)\.forEach/);
  assert.match(card, /filter\(\(result\) => result\.isFinalized\)/);
  assert.match(card, /value=\{finalizedHistory\.length \? stabilityScore : null\}/);
  assert.doesNotMatch(card, /: 8}%/);
  assert.match(card, /aria-label=\{`Select Test Suite \$\{suite\.name\}`\}/);
  assert.match(card, /aria-current=\{activeSuiteId === suite\.id \? "page" : undefined\}/);
  assert.doesNotMatch(card, /aria-pressed/);
  assert.match(page, /richTextToPlainText\(suite\.description \|\| ""\)/);
});

test("Shared Step Group tiles show definition, recorded step health and compact metric counts", async () => {
  const page = await readSource("../src/pages/SharedStepsPage.tsx");
  const service = await readSource("../../backend/api/src/services/sharedStepMetrics.service.js");
  const card = sliceBetween(page, "const isActive = !isCreating && selectedGroupId", "catalogViewMode === \"list\"");
  assertProgressFirstMetricCard(card, "");
  assert.doesNotMatch(card, /EvidenceFlipCard/);
  for (const detail of ["RichTextContent", "Step completeness", "Shared Step Pass Rate", "Steps", "Case Reuse", "Executed Steps", "Failed Steps"]) assert.ok(card.includes(detail), detail);
  assert.doesNotMatch(card, /history-bars|Observed shared-step run history/);
  assert.match(card, /const passRate = executedSteps \? Math\.round\(\(passedSteps \|\| 0\) \/ executedSteps \* 100\) : null/);
  assert.match(service, /execution_step_snapshots/);
  assert.match(service, /shared_step_statuses\(r\.logs\)/);
  assert.match(service, /o\.status IN \('passed','failed'\)/);
  assert.doesNotMatch(page, /selectLatestExecutionResultInstances\(executionResults\)/);
  assert.match(card, /steps include both an action and expected result/);
  assert.match(card, /aria-label=\{`Select Shared Step Group \$\{group\.name\}`\}/);
  assert.match(card, /aria-current=\{isActive \? "page" : undefined\}/);
  assert.doesNotMatch(card, /aria-pressed/);
});

test("Release Story tiles reuse Story delivery progress and the four canonical health metrics", async () => {
  const page = await readSource("../src/pages/ReleasesPage.tsx");
  const card = sliceBetween(page, "const renderReleaseStoryTile", "const releaseRowGroups");

  assertProgressFirstMetricCard(card, "");
  for (const detail of ["Pass rate", "Automation coverage", "Priority", "Linked cases", "Defect density"]) {
    assert.match(card, new RegExp(detail));
  }
  assert.doesNotMatch(card, /release-story-context-facts|<TileCardFact|evidenceStory\.sprint|evidenceStory\.fix_version/);
  const evidenceQuery = sliceBetween(page, "const releaseReadinessQuery = useQuery", "const sprintsQuery = useQuery");
  assert.match(evidenceQuery, /api\.requirementReleases\.listReadiness\(\{ project_id: projectId \}\)/);
  assert.match(evidenceQuery, /readinessAccessKey/);
  assert.match(evidenceQuery, /enabled: Boolean\(projectId && canReadReadiness\)/);
  assert.match(page, /canReadReadiness = \["requirement_iteration\.view", "requirement\.view", "testcase\.view", "run\.view", "result\.view", "feedback\.view"\][\s\S]*?\.every\(\(permission\) => hasPermission\(session, permission, projectId\)\)/);
  assert.match(card, /readinessByReleaseId\.get\(expandedRelease\.id\)\?\.story_metrics\?\.\[story\.id\]/);
  assert.doesNotMatch(page, /api\.(executionResults|testCases)\.(list|releaseReadiness)\(/);
  assert.doesNotMatch(card, /storyEvidenceById|releaseStoryCaseIdsByStoryId|knownTestCases|linkedBugCount \/ linkedCaseCount/);
  assert.match(card, /metrics\?\.pass_rate_percent \?\? null/);
  assert.match(card, /metrics\?\.linked_cases \? metrics\.automation_coverage_percent : null/);
  assert.match(card, /deriveStoryReadiness\(story, \{ forceRelease: true \}\)/);
  assert.match(card, /label=\{storyReadiness\.label\}/);
  assert.match(card, /title=\{readinessEvidence\}/);
  assert.match(card, /readinessScore === null \? "Unverified"/);
  assert.doesNotMatch(card, /metrics\?\.readiness_score/);
  assert.match(card, /linkedBugCount\.toFixed\(2\)/);
  assert.match(card, /story-tile-metrics/);
});

test("Test Run tiles use finalized results with concise defect and story metrics", async () => {
  const page = await readSource("../src/pages/ExecutionsPage.tsx");
  const card = sliceBetween(page, "function ExecutionListCard", "function ExecutionScheduleCard");

  assertProgressFirstMetricCard(card);
  assert.match(card, /const finalizedTotal = summary\.passed \+ summary\.failed \+ summary\.blocked/);
  assert.match(card, /totalScopedCases \* executionDataIterationCount\(execution\)/);
  assert.match(card, /completedTotal \/ resolvedOutcomeCount/);
  assert.match(card, /summary\.passed \/ finalizedTotal/);
  for (const detail of ["Run Name", "Cases", "Pass rate", "Duration", "Defects", "Story impact", "Impacted stories"]) {
    assert.match(card, new RegExp(detail));
  }
  assert.match(card, /const completedTotal = finalizedTotal \+ \(summary\.skipped \|\| 0\) \+ \(summary\.aborted \|\| 0\)/);
  assert.match(card, /breakdown=\{resolvedOutcomeCount \? buildRunOutcomeBreakdown/);
  assert.match(card, /breakdown=\{finalizedTotal \? buildRunOutcomeBreakdown/);
  assert.match(card, /execution\.metrics\?\.defect_count \?\? 0/);
  assert.doesNotMatch(card, /execution-run-card-actions|>Edit run<|>Open run</);
  assert.match(card, /execution-run-selection-row[\s\S]*<input[\s\S]*<ExecutionStatusIndicator/);
  assert.doesNotMatch(card, /execution outcomes touched|external references|label="Blocking"|label="Suites"|label="Release"|label="Assignee"|execution\.created_at/);
  assert.match(card, /aria-current=\{isActive \? "page" : undefined\}/);
  assert.doesNotMatch(card, /role="button"/);
  assert.doesNotMatch(card, /<ProgressMeter/);
});

test("Scheduled Run tiles lead with launch and context readiness while retaining schedule planning details", async () => {
  const [page, styles] = await Promise.all([
    readSource("../src/pages/ExecutionsPage.tsx"),
    readSource("../src/modal-system.css")
  ]);
  const card = sliceBetween(page, "function ExecutionScheduleCard", "function WorkspaceTransactionCard");

  assertProgressFirstMetricCard(card, "");
  for (const detail of [
    "Launch readiness", "Run context", "Suites", "Cases", "Assignees", "Context",
    "assigneeLabel"
  ]) {
    assert.match(card, new RegExp(detail));
  }
  assert.doesNotMatch(card, /execution-card-facts|Run now|Delete schedule/);
  assert.match(card, /launchSignals = \[[\s\S]*active schedule[\s\S]*test scope[\s\S]*upcoming run time/);
  assert.match(card, /contextAttachedCount[\s\S]*test_environment_id[\s\S]*test_configuration_id[\s\S]*test_data_set_id/);
  assert.match(card, /nextRunTimestamp !== null && nextRunTimestamp >= liveNow/);
  assert.match(card, /resolvedCaseCount/);
  assert.match(card, /aria-current=\{isActive \? "page" : undefined\}/);
  assert.match(card, /execution-schedule-tile-card/);
  assert.match(card, /<article[\s\S]*tile-card-title-group tile-card-open-button/);
  assert.doesNotMatch(card, /<button[^>]*execution-schedule-card-button[\s\S]*<TileCardProgress/);
  assert.doesNotMatch(card, /summary\.passed|passRate|schedule_id/);
  assert.match(page, /new Set\(\[[\s\S]*schedule\.test_case_ids[\s\S]*suite\.test_case_ids/);
  assert.match(styles, /\.execution-schedule-tile-card,[\s\S]*container-type:\s*inline-size/);
  assert.doesNotMatch(card, /role="button"/);
});

test("Test Run summaries deduplicate Data Set iterations and keep pass rate terminal-only", async () => {
  const [page, metrics] = await Promise.all([
    readSource("../src/pages/ExecutionsPage.tsx"),
    readSource("../src/lib/executionResultMetrics.ts")
  ]);
  const summary = sliceBetween(page, "const executionSummaryById = useMemo", "const executionImpactSummaryById");
  const segments = sliceBetween(page, "function buildRunOutcomeBreakdown", "const executionDateTimeFormatter");

  assert.match(metrics, /executionResultInstanceKey/);
  assert.match(metrics, /data_set_iteration_key/);
  assert.match(metrics, /data_set_iteration_index/);
  assert.match(metrics, /latestResultByInstance/);
  assert.match(metrics, /candidateTimestamp === currentTimestamp/);
  assert.match(summary, /selectLatestExecutionResultInstances\(allExecutionResults\)/);
  assert.match(summary, /item\.caseCount = caseIdsByExecutionId\[executionId\]\?\.size \|\| 0/);
  assert.match(summary, /const finalizedCount = item\.passed \+ item\.failed \+ item\.blocked/);
  assert.match(summary, /item\.passed \/ finalizedCount/);
  assert.match(segments, /key: "pending", label: "Pending"/);
  assert.match(segments, /key: "blocked", label: "Blocked", count: blockedCount/);
  assert.match(segments, /key: "running", label: "Running"/);
  assert.match(segments, /key: "skipped", label: "Skipped"/);
  assert.match(segments, /key: "aborted", label: "Aborted"/);
});

test("nested Run Suite tiles reuse count segments and retain their case-instance completion denominator", async () => {
  const page = await readSource("../src/pages/ExecutionsPage.tsx");
  const card = sliceBetween(page, '"record-card tile-card execution-suite-card"', "{!filteredExecutionSuites.length ? (");
  assert.match(card, /<TileCardProgress/);
  assert.doesNotMatch(card, /<ProgressMeter/);
  assert.match(card, /label="Suite completion"/);
  assert.match(card, /breakdown=\{buildRunOutcomeBreakdown\(/);
  for (const field of ["passedCount", "failedCount", "blockedCount", "count", "skippedCount", "abortedCount", "runningCount", "pausedCount"]) {
    assert.ok(card.includes(`suiteMetric?.${field}`), field);
  }
  assert.match(card, /value=\{suiteMetric\?\.count \? suiteMetric\.percent : null\}/);
});

test("Bug tiles show evidence and triage health above their four summary metrics", async () => {
  const page = await readSource("../src/pages/IssuesPage.tsx");
  const card = sliceBetween(page, "filteredItems.map((item: Issue)", "catalogViewMode === \"list\"");

  assertProgressFirstMetricCard(card);
  assert.match(card, /item\.message,[\s\S]*item\.steps_to_reproduce,[\s\S]*item\.expected_result,[\s\S]*item\.actual_result/);
  assert.match(card, /const triageFields = \[item\.severity, item\.priority, isAssigned \? assigneeLabel : ""\]/);
  for (const detail of ["Evidence completeness", "Triage completeness", "Severity", "Priority", "Linked scope", "Ownership", "item.linked_test_run_id", "assigneeLabel"]) {
    assert.match(card, new RegExp(detail.replace(".", "\\.")));
  }
  assert.match(card, /aria-current=\{selectedIssueId === item\.id \? "page" : undefined\}/);
  assert.doesNotMatch(card, /role="button"/);
});

test("execution-result evidence is project scoped, authorized, and bounded", async () => {
  const [executions, design, shared, api, route, service] = await Promise.all([
    readSource("../src/pages/ExecutionsPage.tsx"),
    readSource("../src/pages/DesignPage.tsx"),
    readSource("../src/pages/SharedStepsPage.tsx"),
    readSource("../src/lib/api.ts"),
    readSource("../../backend/api/src/routes/executionResults.routes.js"),
    readSource("../../backend/api/src/services/executionResult.service.js")
  ]);

  assert.match(api, /list: \(query\?: \{ project_id\?: string;/);
  assert.match(executions, /executionResults\.list\(\{ project_id: projectId, limit: 5000 \}\)/);
  assert.match(design, /executionResults\.list\(\{ project_id: projectId, app_type_id: appTypeId/);
  assert.match(shared, /api\.sharedStepGroups\.metrics\(\{ app_type_id: appTypeId \}, \{ signal \}\)/);
  assert.doesNotMatch(shared, /executionResults\.list/);
  const [sharedRoute, sharedService] = await Promise.all([
    readSource("../../backend/api/src/routes/sharedStepGroups.routes.js"),
    readSource("../../backend/api/src/services/sharedStepMetrics.service.js")
  ]);
  assert.match(sharedRoute, /projectService\.getProject\(app\.project_id, req\.user\.id\)/);
  assert.match(sharedRoute, /\["shared_step.view", "testcase.view"\]/);
  assert.match(sharedRoute, /\["run.view", "result.view"\]/);
  assert.match(sharedRoute, /include_execution: includeExecution/);
  assert.match(sharedService, /e\.project_id = \?/);
  assert.match(sharedService, /WHERE app_type_id = \?/);
  assert.match(sharedService, /LIMIT 10/);
  assert.match(route, /accessibleProjectIds/);
  assert.match(route, /projectService\.getProject\(scopedProjectId, req\.user\.id\)/);
  assert.match(route, /A project, execution, app type, or test case scope is required/);
  assert.match(route, /Math\.min\(5000/);
  assert.match(service, /JOIN executions ON executions\.id = execution_results\.execution_id/);
  assert.match(service, /executions\.project_id = \?/);
  assert.match(service, /LIMIT \?/);
});
