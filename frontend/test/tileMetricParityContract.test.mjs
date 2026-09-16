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

const assertProgressFirstMetricCard = (card, trailingMarker) => {
  const progressIndex = card.indexOf("<TileCardProgress");
  const metricsIndex = card.indexOf("<TileCardMetric");
  const trailingIndex = card.indexOf(trailingMarker);

  assert.ok(progressIndex >= 0, "Card should render progress");
  assert.ok(metricsIndex > progressIndex, "Progress should precede metric cards");
  if (trailingMarker) assert.ok(trailingIndex > metricsIndex, `${trailingMarker} should remain after metric cards`);
  assert.equal((card.match(/<TileCardProgress/g) || []).length, 2);
  assert.equal((card.match(/<TileCardMetric/g) || []).length, 4);
};

test("the shared tile primitives provide accessible progress and responsive metric cards", async () => {
  const [primitives, styles] = await Promise.all([
    readSource("../src/components/TileCardPrimitives.tsx"),
    readSource("../src/modal-system.css")
  ]);
  const progress = sliceBetween(primitives, "export function TileCardProgress", "export function TileCardStatusIndicator");

  for (const contract of ["role={safeValue === null ? undefined : \"progressbar\"}", "aria-valuemin={safeValue === null ? undefined : 0}", "aria-valuemax={safeValue === null ? undefined : 100}", "aria-valuenow={safeValue ?? undefined}", "aria-valuetext"] ) {
    assert.match(progress, new RegExp(contract.replace(/[{}?]/g, "\\$&")));
  }
  assert.match(progress, /aria-hidden=\{safeValue === null \? true : undefined\}/);
  assert.match(progress, /segments\?: Array/);
  assert.match(progress, /safeValue \?\? 0/);
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

test("Shared Step Group tiles lead with definition and terminal-run health while retaining history", async () => {
  const page = await readSource("../src/pages/SharedStepsPage.tsx");
  const card = sliceBetween(page, "const isActive = !isCreating && selectedGroupId", "catalogViewMode === \"list\"");

  assertProgressFirstMetricCard(card, "Current-linked-case run history");
  for (const detail of ["RichTextContent", "Step completeness", "Linked-case pass rate", "Steps", "Case links", "Runs", "Failed", "history-bars"]) {
    assert.match(card, new RegExp(detail));
  }
  assert.match(page, /current === "running" \|\| next === "running"/);
  assert.match(page, /isFinalized: \(current\?\.isFinalized \?\? true\) && result\.status !== "running"/);
  assert.match(page, /selectLatestExecutionResultInstances\(executionResults\)\.forEach/);
  assert.match(card, /filter\(\(result\) => result\.isFinalized\)/);
  assert.match(card, /steps include both an action and expected result/);
  assert.doesNotMatch(card, /executable automation/);
  assert.match(card, /aria-label=\{`Select Shared Step Group \$\{group\.name\}`\}/);
  assert.match(card, /aria-current=\{isActive \? "page" : undefined\}/);
  assert.doesNotMatch(card, /aria-pressed/);
});

test("Release Story tiles reuse Story delivery progress and the four canonical health metrics", async () => {
  const page = await readSource("../src/pages/ReleasesPage.tsx");
  const card = sliceBetween(page, "const renderReleaseStoryTile", "const releaseRowGroups");

  assertProgressFirstMetricCard(card, "release-story-context-facts");
  for (const detail of ["Pass rate", "Automation coverage", "Priority", "Linked cases", "Defect density", "Release readiness", "Sprint", "Fix Version"]) {
    assert.match(card, new RegExp(detail));
  }
  const evidenceQuery = sliceBetween(page, "const releaseReadinessQuery = useQuery", "const sprintsQuery = useQuery");
  assert.match(evidenceQuery, /api\.requirementReleases\.listReadiness\(\{ project_id: projectId \}\)/);
  assert.match(evidenceQuery, /readinessAccessKey/);
  assert.match(evidenceQuery, /enabled: Boolean\(projectId && canReadReadiness\)/);
  assert.match(page, /canReadReadiness = \["requirement_iteration\.view", "requirement\.view", "testcase\.view", "run\.view", "result\.view", "feedback\.view"\][\s\S]*?\.every\(\(permission\) => hasPermission\(session, permission, projectId\)\)/);
  assert.match(card, /readinessByReleaseId\.get\(expandedRelease\.id\)\?\.story_metrics\?\.\[story\.id\]/);
  assert.doesNotMatch(page, /api\.(executionResults|testCases)\.(list|releaseReadiness)\(/);
  assert.doesNotMatch(card, /storyEvidenceById|releaseStoryCaseIdsByStoryId|knownTestCases|linkedBugCount \/ linkedCaseCount/);
  assert.match(card, /metrics\?\.pass_rate_percent \?\? null/);
  assert.match(card, /metrics\?\.automation_coverage_percent \?\? null/);
  assert.match(card, /metrics\?\.readiness_score \?\? null/);
  assert.match(card, /readinessScore === null \? "No runs"/);
  assert.match(card, /linkedBugCount\.toFixed\(2\)/);
  assert.match(card, /story-tile-metrics/);
});

test("Test Run tiles use finalized results with concise defect and story metrics", async () => {
  const page = await readSource("../src/pages/ExecutionsPage.tsx");
  const card = sliceBetween(page, "function ExecutionListCard", "function ExecutionScheduleCard");

  assertProgressFirstMetricCard(card, "execution-run-card-actions");
  assert.match(card, /const finalizedTotal = summary\.passed \+ summary\.failed \+ summary\.blocked/);
  assert.match(card, /totalScopedCases \* executionDataIterationCount\(execution\)/);
  assert.match(card, /finalizedTotal \/ resolvedOutcomeCount/);
  assert.match(card, /summary\.passed \/ finalizedTotal/);
  for (const detail of ["Run Name", "Cases", "Pass rate", "Duration", "Defects", "Story impact", "Impacted stories", "Edit run"]) {
    assert.match(card, new RegExp(detail));
  }
  assert.match(card, /buildFinalizedProgressSegments/);
  assert.match(card, /execution\.metrics\?\.defect_count \?\? 0/);
  assert.match(card, /disabled=\{!canEdit \|\| isRunFinished\(execution\)\}/);
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

  assertProgressFirstMetricCard(card, "execution-card-facts");
  for (const detail of [
    "Launch readiness", "Run context", "Suites", "Cases", "Assignees", "Context",
    "assigneeLabel", "releaseLabel", "sprintLabel", "buildLabel", "nextRunLabel", "lastRunLabel", "Edit", "Run now", "Delete"
  ]) {
    assert.match(card, new RegExp(detail));
  }
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
  const segments = sliceBetween(page, "function buildFinalizedProgressSegments", "const executionDateTimeFormatter");

  assert.match(metrics, /executionResultInstanceKey/);
  assert.match(metrics, /data_set_iteration_key/);
  assert.match(metrics, /data_set_iteration_index/);
  assert.match(metrics, /latestResultByInstance/);
  assert.match(metrics, /candidateTimestamp === currentTimestamp/);
  assert.match(summary, /selectLatestExecutionResultInstances\(allExecutionResults\)/);
  assert.match(summary, /item\.caseCount = caseIdsByExecutionId\[executionId\]\?\.size \|\| 0/);
  assert.match(summary, /const finalizedCount = item\.passed \+ item\.failed \+ item\.blocked/);
  assert.match(summary, /item\.passed \/ finalizedCount/);
  assert.doesNotMatch(segments, /pendingCount|tone: "neutral"/);
  assert.match(segments, /blockedCount \/ totalCount\) \* 100, tone: "warning"/);
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
  assert.match(shared, /executionResults\.list\(\{ project_id: projectId, app_type_id: appTypeId, limit: 5000, projection: "summary" \}, \{ signal \}\)/);
  assert.match(route, /accessibleProjectIds/);
  assert.match(route, /projectService\.getProject\(scopedProjectId, req\.user\.id\)/);
  assert.match(route, /A project, execution, app type, or test case scope is required/);
  assert.match(route, /Math\.min\(5000/);
  assert.match(service, /JOIN executions ON executions\.id = execution_results\.execution_id/);
  assert.match(service, /executions\.project_id = \?/);
  assert.match(service, /LIMIT \?/);
});
