import type {
  Execution,
  ExecutionResult,
  Issue,
  Requirement,
  TestCase,
} from "../types";

export type ReleaseReadinessScope = { release: string; sprint: string };
export type ReadinessGateState = "pass" | "warning" | "block";
export type ReadinessGate = {
  id: string;
  state: ReadinessGateState;
  count: number;
  total: number;
};
export type RequirementHotspot = {
  id: string;
  displayId: string;
  title: string;
  priority: number | null;
  coverageCount: number;
  executedCount: number;
  passedCount: number;
  failedCount: number;
  blockedCount: number;
  openBugCount: number;
  criticalBugCount: number;
  needsAttention: boolean;
};
type Input = ReleaseReadinessScope & {
  evidenceComplete?: boolean;
  now?: number;
  requirements: Requirement[];
  testCases: TestCase[];
  executions: Execution[];
  executionResults: ExecutionResult[];
  issues: Issue[];
};
const normalized = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase();
const sameValue = (left: unknown, right: unknown) =>
  normalized(left) === normalized(right);
const unique = <T>(items: T[]) => [...new Set(items)];
const percentage = (numerator: number, denominator: number) =>
  denominator ? Math.round((numerator / denominator) * 100) : null;
const timestamp = (value?: string | null) =>
  value ? new Date(value).getTime() || 0 : 0;
export const isOpenReadinessIssue = (issue: Issue) =>
  issue.status_category
    ? normalized(issue.status_category) !== "done"
    : !/^(done|closed|resolved|cancelled|canceled)(\b|$)/i.test(
        String(issue.status || "").trim(),
      );
export const isCriticalReadinessIssue = (issue: Issue) =>
  /critical|blocker|highest/i.test(
    `${issue.severity || ""} ${issue.priority || ""}`,
  );
const isHighIssue = (issue: Issue) =>
  /high/i.test(`${issue.severity || ""} ${issue.priority || ""}`);
const caseRequirementIds = (testCase: TestCase) =>
  unique([
    ...(testCase.requirement_ids || []),
    ...(testCase.requirement_id ? [testCase.requirement_id] : []),
  ]);
export const caseIdsForReadinessRun = (execution: Execution) =>
  unique(
    [
      ...(execution.test_case_ids || []),
      ...(execution.direct_test_case_ids || []),
      ...(execution.case_snapshots || []).map((item) => item.test_case_id),
    ].filter(Boolean),
  );
const assessed = (result: ExecutionResult) =>
  result.status === "passed" || result.status === "failed";

/** Keep run/environment boundaries and data rows. An edited old attempt cannot replace a newer attempt. */
export function latestReadinessResults(results: ExecutionResult[]) {
  const latest = new Map<string, ExecutionResult>();
  for (const result of results) {
    const key = JSON.stringify([
      result.execution_id,
      result.test_case_id,
      result.test_data_set_id || "",
      result.data_set_iteration_key ??
        result.data_set_iteration_index ??
        "default",
    ]);
    const current = latest.get(key);
    const newer = timestamp(result.created_at) - timestamp(current?.created_at);
    if (
      !current ||
      newer > 0 ||
      (newer === 0 && String(result.id).localeCompare(current.id) > 0)
    )
      latest.set(key, result);
  }
  return [...latest.values()];
}

export function deriveReleaseReadiness(input: Input) {
  const evidenceComplete = input.evidenceComplete !== false;
  const selectedRelease = input.release.trim();
  const selectedSprint = input.sprint.trim();
  const matches = (release: unknown, sprint: unknown) =>
    (!selectedRelease || sameValue(release, selectedRelease)) &&
    (!selectedSprint || sameValue(sprint, selectedSprint));
  const requirements = input.requirements.filter((item) =>
    matches(item.fix_version || item.release, item.sprint),
  );
  const requirementIds = new Set(requirements.map((item) => item.id));
  const explicitCaseIds = requirements.flatMap(
    (item) => item.test_case_ids || [],
  );
  const executions = input.executions.filter((item) =>
    matches(item.release, item.sprint),
  );
  const executionIds = new Set(executions.map((item) => item.id));
  const executionResults = input.executionResults.filter((item) =>
    executionIds.has(item.execution_id),
  );
  const latestCaseResults = latestReadinessResults(executionResults);
  const plannedCaseIds = new Set([
    ...explicitCaseIds,
    ...input.testCases
      .filter((item) =>
        caseRequirementIds(item).some((id) => requirementIds.has(id)),
      )
      .map((item) => item.id),
    ...executions.flatMap(caseIdsForReadinessRun),
    ...executionResults.map((item) => item.test_case_id),
  ]);
  const testCases = input.testCases.filter((item) =>
    plannedCaseIds.has(item.id),
  );
  const scopedDefectIds = new Set(
    [
      ...requirements.flatMap((item) => item.defect_ids || []),
      ...testCases.flatMap((item) => item.defect_ids || []),
      ...latestCaseResults.flatMap((item) => item.defects || []),
    ].map(normalized),
  );
  const linkedIssue = (issue: Issue) =>
    (issue.linked_requirement_ids || []).some((id) => requirementIds.has(id)) ||
    (issue.linked_test_case_ids || []).some((id) => plannedCaseIds.has(id)) ||
    Boolean(
      issue.linked_test_run_id && executionIds.has(issue.linked_test_run_id),
    ) ||
    [issue.id, issue.jira_bug_key].some(
      (id) => id && scopedDefectIds.has(normalized(id)),
    );
  const issues = input.issues.filter(
    (item) =>
      (!selectedRelease && !selectedSprint) ||
      matches(item.fix_version || item.release, item.sprint) ||
      linkedIssue(item),
  );
  const openIssues = issues.filter(isOpenReadinessIssue);
  const criticalIssues = openIssues.filter(isCriticalReadinessIssue);
  const highIssues = openIssues.filter(
    (item) => !isCriticalReadinessIssue(item) && isHighIssue(item),
  );
  const resultsByCase = new Map<string, ExecutionResult[]>();
  for (const result of latestCaseResults)
    resultsByCase.set(result.test_case_id, [
      ...(resultsByCase.get(result.test_case_id) || []),
      result,
    ]);
  const missingRowsByCase = new Map<string, number>();
  const missingRowsByRun = new Map<string, number>();
  for (const run of executions) {
    const ids = caseIdsForReadinessRun(run);
    for (const id of ids) {
      const snapshot = run.case_snapshots?.find(
        (item) => item.test_case_id === id,
      );
      const expected = Math.max(1, Number(snapshot?.expected_iterations) || 1);
      const observed = latestCaseResults.filter(
        (item) => item.execution_id === run.id && item.test_case_id === id,
      ).length;
      const missing = Math.max(0, expected - observed);
      if (missing) {
        missingRowsByCase.set(id, (missingRowsByCase.get(id) || 0) + missing);
        missingRowsByRun.set(
          run.id,
          (missingRowsByRun.get(run.id) || 0) + missing,
        );
      }
    }
  }
  const assessedCases = new Set(
    [...resultsByCase]
      .filter(
        ([id, results]) =>
          results.length &&
          results.every(assessed) &&
          !missingRowsByCase.has(id),
      )
      .map(([id]) => id),
  );
  const caseIdsByStory = new Map(
    requirements.map((story) => [story.id, new Set(story.test_case_ids || [])]),
  );
  for (const testCase of testCases)
    for (const id of caseRequirementIds(testCase))
      caseIdsByStory.get(id)?.add(testCase.id);
  const linkedCasesForStory = (story: Requirement) =>
    caseIdsByStory.get(story.id) || new Set<string>();
  const coveredRequirementCount = requirements.filter(
    (item) => linkedCasesForStory(item).size > 0,
  ).length;
  const highPriorityUncoveredCount = requirements.filter(
    (item) =>
      Number(item.priority || 3) <= 2 && !linkedCasesForStory(item).size,
  ).length;
  const count = (status: ExecutionResult["status"]) =>
    latestCaseResults.filter((item) => item.status === status).length;
  const passedCount = count("passed");
  const failedCount = count("failed");
  const blockedCount = count("blocked");
  const latestEvidenceAt = latestCaseResults.reduce<string | null>(
    (latest, result) => {
      const candidate =
        result.updated_at ||
        result.ended_at ||
        result.started_at ||
        result.created_at;
      return timestamp(candidate) > timestamp(latest)
        ? candidate || null
        : latest;
    },
    null,
  );
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const ageDays = latestEvidenceAt
    ? Math.max(0, Math.floor((now - timestamp(latestEvidenceAt)) / 86_400_000))
    : null;
  const loadedCaseIds = new Set(testCases.map((item) => item.id));
  const metrics = {
    coverage: percentage(coveredRequirementCount, requirements.length),
    completion: percentage(assessedCases.size, plannedCaseIds.size),
    passRate: percentage(passedCount, passedCount + failedCount),
    requirementCount: requirements.length,
    coveredRequirementCount,
    highPriorityUncoveredCount,
    plannedCaseCount: plannedCaseIds.size,
    executedCaseCount: assessedCases.size,
    passedCount,
    failedCount,
    blockedCount,
    runningCount: count("running"),
    pausedCount: count("paused"),
    pendingCount: count("pending"),
    skippedCount: count("skipped"),
    abortedCount: count("aborted"),
    notRunCount: [...plannedCaseIds].filter((id) => !resultsByCase.has(id))
      .length,
    unassessedCaseCount: plannedCaseIds.size - assessedCases.size,
    outcomeCount: latestCaseResults.length,
    openBugCount: openIssues.length,
    openCriticalBugCount: criticalIssues.length,
    openHighBugCount: highIssues.length,
    missingIterationCount: [...missingRowsByCase.values()].reduce(
      (total, count) => total + count,
      0,
    ),
    linkedBugCount: issues.filter(linkedIssue).length,
    missingCaseDetailsCount: [...plannedCaseIds].filter(
      (id) => !loadedCaseIds.has(id),
    ).length,
  };
  const sourcesComplete =
    evidenceComplete && metrics.missingCaseDetailsCount === 0;
  const gates: ReadinessGate[] = [
    {
      id: "critical-defects",
      state: criticalIssues.length ? "block" : "pass",
      count: criticalIssues.length,
      total: openIssues.length,
    },
    {
      id: "failed-outcomes",
      state: failedCount ? "block" : passedCount ? "pass" : "warning",
      count: failedCount,
      total: passedCount + failedCount,
    },
    {
      id: "priority-coverage",
      state: highPriorityUncoveredCount
        ? "block"
        : requirements.length
          ? "pass"
          : "warning",
      count: highPriorityUncoveredCount,
      total: requirements.length,
    },
    {
      id: "remaining-evidence",
      state:
        metrics.unassessedCaseCount || !plannedCaseIds.size
          ? "warning"
          : "pass",
      count: metrics.unassessedCaseCount,
      total: plannedCaseIds.size,
    },
  ].map((gate) => ({
    ...gate,
    state:
      !sourcesComplete && gate.state === "pass"
        ? "warning"
        : (gate.state as ReadinessGateState),
  }));
  const hotspots = requirements
    .map<RequirementHotspot>((story) => {
      const linkedCaseIds = linkedCasesForStory(story);
      const results = latestCaseResults.filter((item) =>
        linkedCaseIds.has(item.test_case_id),
      );
      const defectIds = new Set(
        [
          ...(story.defect_ids || []),
          ...testCases
            .filter((item) => linkedCaseIds.has(item.id))
            .flatMap((item) => item.defect_ids || []),
          ...results.flatMap((item) => item.defects || []),
        ].map(normalized),
      );
      const bugs = openIssues.filter(
        (item) =>
          item.linked_requirement_ids?.includes(story.id) ||
          item.linked_test_case_ids?.some((id) => linkedCaseIds.has(id)) ||
          [item.id, item.jira_bug_key].some(
            (id) => id && defectIds.has(normalized(id)),
          ),
      );
      const failedCount = results.filter(
        (item) => item.status === "failed",
      ).length;
      const blockedCount = results.filter(
        (item) => item.status === "blocked",
      ).length;
      const executedCount = [...linkedCaseIds].filter((id) =>
        assessedCases.has(id),
      ).length;
      return {
        id: story.id,
        displayId: story.display_id || story.id,
        title: story.title,
        priority: story.priority,
        coverageCount: linkedCaseIds.size,
        executedCount,
        passedCount: results.filter((item) => item.status === "passed").length,
        failedCount,
        blockedCount,
        openBugCount: bugs.length,
        criticalBugCount: bugs.filter(isCriticalReadinessIssue).length,
        needsAttention:
          !linkedCaseIds.size ||
          executedCount < linkedCaseIds.size ||
          failedCount > 0 ||
          bugs.length > 0,
      };
    })
    .sort(
      (a, b) =>
        b.criticalBugCount - a.criticalBugCount ||
        b.failedCount - a.failedCount ||
        Number(a.priority || 3) - Number(b.priority || 3) ||
        Number(b.needsAttention) - Number(a.needsAttention) ||
        a.displayId.localeCompare(b.displayId),
    );
  // These are observed review signals, never a release approval or a probability of success.
  const decisionState =
    criticalIssues.length ||
    failedCount ||
    blockedCount ||
    highPriorityUncoveredCount ||
    highIssues.length
      ? "attention"
      : !requirements.length ||
          !plannedCaseIds.size ||
          !latestCaseResults.length
        ? "insufficient"
        : !sourcesComplete ||
            metrics.unassessedCaseCount ||
            openIssues.length ||
            ageDays === null ||
            ageDays > 14
          ? "review"
          : "clear";
  return {
    evidenceComplete: sourcesComplete,
    missingRowsByRun,
    requirements,
    testCases,
    executions,
    executionResults,
    latestCaseResults,
    issues,
    openIssues,
    metrics,
    decisionState,
    gates,
    hotspots,
    latestEvidenceAt,
    ageDays,
  };
}
export type ReleaseReadinessModel = ReturnType<typeof deriveReleaseReadiness>;

export function releaseReadinessScopeOptions(
  requirements: Requirement[],
  executions: Execution[],
  issues: Issue[],
) {
  const distinct = (items: Array<string | null | undefined>) =>
    [
      ...new Map(
        items
          .filter(Boolean)
          .map((item) => [normalized(item), String(item).trim()]),
      ).values(),
    ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return {
    releases: distinct([
      ...requirements.map((item) => item.fix_version || item.release),
      ...executions.map((item) => item.release),
      ...issues.map((item) => item.fix_version || item.release),
    ]),
    sprints: distinct([
      ...requirements.map((item) => item.sprint),
      ...executions.map((item) => item.sprint),
      ...issues.map((item) => item.sprint),
    ]),
  };
}
