import type {
  Execution,
  ExecutionResult,
  Issue,
  Requirement,
  RequirementIteration,
  RequirementRelease,
  TestCase,
} from "../types";

export type ReleaseReadinessScope = { release: string; sprint: string; iterationId?: string };
export type ReadinessGateState = "pass" | "warning" | "block";
export type ReadinessGate = {
  id: string;
  state: ReadinessGateState;
  count: number | null;
  total: number;
};
export type ReadinessCaseRunEvidence = {
  runId: string;
  results: ExecutionResult[];
  expectedRows: number;
  missingRows: number;
};
export type ReadinessCaseEvidence = {
  id: string;
  title: string | null;
  displayId: string;
  /** A reusable case record is loaded; this does not measure design completeness or quality. */
  detailsAvailable: boolean;
  storyIds: string[];
  runIds: string[];
  results: ExecutionResult[];
  runEvidence: ReadinessCaseRunEvidence[];
  /** Observed rows plus declared missing run rows. A case with no run has no known row plan. */
  expectedRows: number;
  missingRows: number;
  assessed: boolean;
  status: "passed" | "failed" | "blocked" | "unassessed" | "not-run";
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
  caseIds: string[];
  openIssueIds: string[];
  runIds: string[];
  needsAttention: boolean;
};
type Input = ReleaseReadinessScope & {
  /** Only unambiguous labels from the authorized native delivery catalogs. */
  releaseAliases?: string[];
  releaseSprintNames?: string[];
  allowLegacySprintFallback?: boolean;
  /** IDs from the authorized native Release and run evidence endpoints. */
  scopedRequirementIds?: string[];
  scopedExecutionIds?: string[];
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
const completedStoryStatuses = new Set([
  "qa_done", "qa done", "done", "closed", "resolved", "accepted", "complete", "completed",
]);
const completedStory = (story: Requirement) => {
  const category = normalized(story.status_category);
  return category ? category === "done" : completedStoryStatuses.has(normalized(story.status));
};

/** Defects still store delivery labels, so never guess a duplicate native name. */
export function readinessDeliveryLabels(
  release: RequirementRelease | null,
  releases: RequirementRelease[],
  sprints: RequirementIteration[],
  iterationId = "",
) {
  // A freshly loaded detail can be newer than the cached catalog (for example,
  // immediately after creating or renaming this Release).
  const knownReleases = release ? [release, ...releases.filter(item => item.id !== release.id)] : releases;
  const releaseAliases = release ? unique([release.name, release.fix_version].filter(Boolean))
    .filter(label => knownReleases.filter(item => sameValue(item.name, label) || sameValue(item.fix_version, label)).length === 1) : [];
  const selectedSprint = sprints.find(item => item.id === iterationId);
  const uniqueSprintName = (name: string) => sprints.filter(item => sameValue(item.name, name)).length === 1;
  return {
    releaseAliases,
    releaseSprintNames: release ? sprints.filter(item => (release.sprint_ids || []).includes(item.id) && uniqueSprintName(item.name)).map(item => item.name) : [],
    allowLegacySprintFallback: !iterationId || Boolean(selectedSprint && uniqueSprintName(selectedSprint.name)),
  };
}

/** Keep run/environment boundaries and data rows. An edited old attempt cannot replace a newer attempt. */
export function latestReadinessResults(results: ExecutionResult[]) {
  const latest = new Map<string, ExecutionResult>();
  for (const result of results) {
    const key = JSON.stringify([
      result.execution_id,
      result.test_case_id,
      // Match the API/runner identity. A row key or dataset label may change
      // during a retry; the frozen row index remains the authoritative slot.
      String(result.data_set_iteration_index ?? result.data_set_iteration_key ?? "default"),
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
  const selectedSprint = selectedRelease ? "" : input.sprint.trim();
  const releaseLabels = new Set((input.releaseAliases ?? [selectedRelease]).map(normalized).filter(Boolean));
  const releaseSprintNames = new Set((input.releaseSprintNames || []).map(normalized));
  const matches = (release: unknown, sprint: unknown) =>
    (!selectedRelease || sameValue(release, selectedRelease)) &&
    (!selectedSprint || sameValue(sprint, selectedSprint));
  const nativeStoryIds = input.scopedRequirementIds ? new Set(input.scopedRequirementIds) : null;
  const nativeRunIds = input.scopedExecutionIds ? new Set(input.scopedExecutionIds) : null;
  const matchesStorySprint = (item: Requirement) => !selectedRelease && input.iterationId
    ? item.iteration_id === input.iterationId || (!item.iteration_id && input.allowLegacySprintFallback !== false && sameValue(item.sprint, selectedSprint))
    : !selectedSprint || sameValue(item.sprint, selectedSprint);
  const requirements = input.requirements.filter((item) =>
    (nativeStoryIds ? nativeStoryIds.has(item.id) : !selectedRelease || sameValue(item.fix_version || item.release, selectedRelease))
      && matchesStorySprint(item),
  );
  const requirementIds = new Set(requirements.map((item) => item.id));
  const explicitCaseIds = requirements.flatMap(
    (item) => item.test_case_ids || [],
  );
  const executions = input.executions.filter((item) =>
    nativeRunIds ? nativeRunIds.has(item.id) : matches(item.release, item.sprint),
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
  const matchesIssueScope = (issue: Issue) => {
    const issueRelease = normalized(issue.fix_version?.trim() || issue.release);
    if (selectedRelease) return releaseLabels.has(issueRelease) ||
      (!issueRelease && releaseSprintNames.has(normalized(issue.sprint)));
    return !selectedSprint || input.allowLegacySprintFallback !== false && sameValue(issue.sprint, selectedSprint);
  };
  const issues = input.issues.filter(
    (item) =>
      (!selectedRelease && !selectedSprint) ||
      matchesIssueScope(item) ||
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
  const casesById = new Map(testCases.map((item) => [item.id, item]));
  const caseIdsByRun = new Map(executions.map((run) => [run.id, new Set(caseIdsForReadinessRun(run))]));
  const caseEvidence = [...plannedCaseIds].map<ReadinessCaseEvidence>((id) => {
    const testCase = casesById.get(id);
    const results = resultsByCase.get(id) || [];
    const resultsByRun = new Map<string, ExecutionResult[]>();
    for (const result of results)
      resultsByRun.set(result.execution_id, [...(resultsByRun.get(result.execution_id) || []), result]);
    const runEvidence = executions
      .filter((run) => caseIdsByRun.get(run.id)?.has(id) || resultsByRun.has(run.id))
      .map<ReadinessCaseRunEvidence>((run) => {
        const rows = resultsByRun.get(run.id) || [];
        const snapshot = run.case_snapshots?.find((item) => item.test_case_id === id);
        const declaredRows = caseIdsByRun.get(run.id)?.has(id)
          ? Math.max(1, Number(snapshot?.expected_iterations) || 1)
          : 0;
        return {
          runId: run.id,
          results: rows,
          expectedRows: Math.max(declaredRows, rows.length),
          missingRows: Math.max(0, declaredRows - rows.length),
        };
      });
    const isAssessed = assessedCases.has(id);
    return {
      id,
      title: testCase?.title || null,
      displayId: testCase?.display_id || id,
      detailsAvailable: Boolean(testCase),
      storyIds: requirements.filter((story) => linkedCasesForStory(story).has(id)).map((story) => story.id),
      runIds: runEvidence.map((item) => item.runId),
      results,
      runEvidence,
      expectedRows: runEvidence.reduce((total, item) => total + item.expectedRows, 0),
      missingRows: missingRowsByCase.get(id) || 0,
      assessed: isAssessed,
      status: results.some((result) => result.status === "failed") ? "failed"
        : results.some((result) => result.status === "blocked") ? "blocked"
        : !results.length ? "not-run"
        : isAssessed && results.every((result) => result.status === "passed") ? "passed"
        : "unassessed",
    };
  });
  const linkedIssueIds = issues.filter(linkedIssue).map((item) => item.id);
  const metrics = {
    coverage: percentage(coveredRequirementCount, requirements.length),
    completion: percentage(assessedCases.size, plannedCaseIds.size),
    passRate: percentage(passedCount, passedCount + failedCount),
    requirementCount: requirements.length,
    coveredRequirementCount,
    completedRequirementCount: requirements.filter(completedStory).length,
    highPriorityUncoveredCount,
    plannedCaseCount: plannedCaseIds.size,
    executedCaseCount: assessedCases.size,
    passingCaseCount: caseEvidence.filter((item) => item.status === "passed").length,
    designKnownCount: loadedCaseIds.size,
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
    linkedBugCount: linkedIssueIds.length,
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
    {
      id: "blocked-evidence",
      state: blockedCount ? "block" : latestCaseResults.length ? "pass" : "warning",
      count: blockedCount,
      total: latestCaseResults.length,
    },
    {
      id: "evidence-freshness",
      state: ageDays !== null && ageDays <= 14 ? "pass" : "warning",
      count: ageDays,
      total: 14,
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
        caseIds: [...linkedCaseIds],
        openIssueIds: bugs.map((item) => item.id),
        runIds: unique([
          ...executions.filter((run) => caseIdsForReadinessRun(run).some((id) => linkedCaseIds.has(id))).map((run) => run.id),
          ...results.map((result) => result.execution_id),
        ]),
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
    caseEvidence,
    executions,
    executionResults,
    latestCaseResults,
    issues,
    openIssues,
    linkedIssueIds,
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
