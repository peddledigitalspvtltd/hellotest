const db = require("@hellotest/platform/backend/src/db");
const { RELATIONAL_METRICS, buildRelationalEvidence, QA_DONE, DEV_DONE, status: storyStatus } = require("./qualityDashboardRelations");
const { releaseStoryMembershipSql, releaseExecutionMembershipSql } = require("@hellotest/platform/backend/src/utils/deliveryScopeSql");

const nowIso = () => new Date().toISOString();
const normalizeText = (value) => String(value || "").trim();
const lowerText = (value) => normalizeText(value).toLowerCase();
const percent = (numerator, denominator) => denominator ? Math.round((numerator / denominator) * 100) : 0;
const isOpen = (status) => !["closed", "resolved", "done", "accepted", "complete", "completed", "fixed", "verified"].includes(lowerText(status));
const FINAL_CASE_STATUSES = new Set(["passed", "failed", "blocked", "skipped", "aborted", "cancelled"]);
const FINAL_RUN_STATUSES = new Set(["passed", "completed", "failed", "blocked", "skipped", "aborted", "cancelled", "partially_completed"]);
const NATIVE_DASHBOARD_METRICS = new Set(["count", "releaseConfidence", "requirementCoverage", "coverageGaps", "automationCoverage", "executionCompletion", "passRate", "evidenceConfidence", "openDefects", "failedRuns", "executionCycleHours", "completedRuns30d", "testCases", "testSuites", "testRuns", "moduleCaseCount", ...Object.keys(RELATIONAL_METRICS)]);
const PERCENTAGE_METRICS = new Set(["releaseConfidence", "requirementCoverage", "automationCoverage", "executionCompletion", "passRate", "evidenceConfidence", "devStoryCompletion", "qaStoryCompletion", "storyTestPassRate", "storyExecutionCoverage", "defectTraceability"]);
const RELEASE_REFS_SQL = `SELECT jsonb_agg(jsonb_build_object('id', rel.id, 'name', rel.name, 'display_id', rel.display_id, 'fix_version', rel.fix_version))
  FROM requirement_releases rel WHERE rel.project_id = requirements.project_id AND ${releaseStoryMembershipSql('requirements', 'rel')}`;
// Use native IDs after renames. Legacy labels are accepted only when they do
// not ambiguously identify two releases in the same project.
const EXECUTION_RELEASE_SCOPE = `SELECT rel.id FROM requirement_releases rel WHERE rel.project_id = executions.project_id AND
  ${releaseExecutionMembershipSql('executions', 'rel')}`;
const EXECUTION_RELEASE_FILTER = `(? = '' OR ? = ANY(ARRAY(SELECT ref FROM requirement_releases rel,
  LATERAL unnest(ARRAY[LOWER(rel.id), LOWER(rel.name), LOWER(rel.display_id), LOWER(rel.fix_version)]) ref
  WHERE rel.id IN (${EXECUTION_RELEASE_SCOPE})
  UNION ALL SELECT LOWER(TRIM(COALESCE(executions.release, ''))) WHERE NOT EXISTS (${EXECUTION_RELEASE_SCOPE})
    AND (SELECT COUNT(*) FROM requirement_releases legacy WHERE legacy.project_id = executions.project_id
      AND LOWER(TRIM(COALESCE(executions.release, ''))) = ANY(ARRAY[LOWER(legacy.id),LOWER(legacy.name),LOWER(legacy.display_id),LOWER(legacy.fix_version)])) <= 1)))`;
const EXECUTION_SPRINT_FILTER = `(? = '' OR ? = ANY(ARRAY(SELECT ref FROM requirement_iterations iteration,
  LATERAL unnest(ARRAY[LOWER(iteration.id),LOWER(iteration.name),LOWER(iteration.display_id)]) ref
  WHERE iteration.id = executions.iteration_id AND iteration.project_id = executions.project_id
  UNION ALL SELECT LOWER(TRIM(COALESCE(executions.sprint, ''))) WHERE executions.iteration_id IS NULL)))`;
const normalizeNativeMetric = (metric) => {
  const requested = metric == null || metric === "" ? "count" : String(metric);
  if (!NATIVE_DASHBOARD_METRICS.has(requested)) throw Object.assign(new Error("This metric is not available for native project dashboards. Choose a supported native metric."), { code: "DASHBOARD_METRIC_UNSUPPORTED", statusCode: 400 });
  return requested;
};
const completedRecently = (item, now = Date.now()) => FINAL_RUN_STATUSES.has(item.status)
  && new Date(item.ended_at || 0).getTime() >= now - 30 * 86_400_000
  && new Date(item.ended_at || 0).getTime() <= now;

const loadContext = async (projectId, release = "", sprint = "") => {
  const project = await db.prepare("SELECT id, display_id, name FROM projects WHERE id = ?").get(projectId);
  if (!project) {
    const error = new Error("Project not found.");
    error.statusCode = 404;
    throw error;
  }

  const normalizedRelease = lowerText(release);
  const normalizedSprint = lowerText(sprint);
  const [requirements, testCases, suites, executions, results, plannedCases, issues, modules] = await Promise.all([
    db.prepare(`
      SELECT requirements.id, requirements.display_id, requirements.title,
        requirements.status, requirements.priority, requirements.labels,
        requirements.release, requirements.fix_version, requirements.sprint, requirements.iteration_id,
        (SELECT name FROM requirement_iterations WHERE id = requirements.iteration_id AND project_id = requirements.project_id) AS sprint_name,
        COALESCE((${RELEASE_REFS_SQL}), '[]'::jsonb) AS native_releases,
        (SELECT COUNT(*) > 1 FROM requirement_releases legacy WHERE legacy.project_id = requirements.project_id
          AND LOWER(TRIM(COALESCE(NULLIF(requirements.fix_version,''), requirements.release,''))) = ANY(ARRAY[LOWER(legacy.id),LOWER(legacy.name),LOWER(legacy.display_id),LOWER(legacy.fix_version)])) AS legacy_release_ambiguous,
        requirements.created_at, requirements.updated_at,
        COALESCE((SELECT jsonb_agg(links.test_case_id) FROM (
          SELECT test_case_id FROM requirement_test_cases WHERE requirement_id = requirements.id
          UNION SELECT id FROM test_cases WHERE requirement_id = requirements.id
        ) links), '[]'::jsonb) AS test_case_ids
      FROM requirements WHERE project_id = ?
    `).all(projectId),
    db.prepare(`
      SELECT test_cases.id, test_cases.display_id, test_cases.title,
        test_cases.status, test_cases.priority, test_cases.labels, test_cases.suite_id,
        test_cases.automated, test_cases.automation_status, test_cases.test_case_type,
        test_cases.created_at, test_cases.updated_at,
        COALESCE((SELECT jsonb_agg(linked_story.id) FROM requirements linked_story
          WHERE linked_story.project_id = ? AND (linked_story.id = test_cases.requirement_id
            OR EXISTS (SELECT 1 FROM requirement_test_cases WHERE requirement_id = linked_story.id AND test_case_id = test_cases.id))), '[]'::jsonb) AS requirement_ids,
        COALESCE((SELECT jsonb_agg(test_case_effective_module_cases.module_id) FROM test_case_effective_module_cases WHERE test_case_effective_module_cases.test_case_id = test_cases.id), '[]'::jsonb) AS module_ids
      FROM test_cases LEFT JOIN app_types ON app_types.id = test_cases.app_type_id
      WHERE app_types.project_id = ? OR (test_cases.app_type_id IS NULL AND EXISTS (
        SELECT 1 FROM requirements linked_story WHERE linked_story.project_id = ? AND
          (linked_story.id = test_cases.requirement_id OR EXISTS (SELECT 1 FROM requirement_test_cases WHERE requirement_id = linked_story.id AND test_case_id = test_cases.id))))
    `).all(projectId, projectId, projectId),
    db.prepare(`SELECT test_suites.id, test_suites.display_id, test_suites.name,
      test_suites.labels, test_suites.created_at, test_suites.updated_at,
      COALESCE((SELECT jsonb_agg(suite_test_cases.test_case_id) FROM suite_test_cases WHERE suite_test_cases.suite_id = test_suites.id), '[]'::jsonb) AS test_case_ids
      FROM test_suites JOIN app_types ON app_types.id = test_suites.app_type_id WHERE app_types.project_id = ?`).all(projectId),
    db.prepare(`SELECT executions.id, executions.name, executions.status, executions.release, executions.release_id, executions.iteration_id,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', rel.id, 'name', rel.name, 'display_id', rel.display_id, 'fix_version', rel.fix_version))
        FROM requirement_releases rel WHERE rel.id IN (${EXECUTION_RELEASE_SCOPE})), '[]'::jsonb) AS native_releases,
      (SELECT name FROM requirement_iterations WHERE id = executions.iteration_id AND project_id = executions.project_id) AS sprint_name,
      (SELECT COUNT(*) > 1 FROM requirement_releases legacy WHERE legacy.project_id = executions.project_id
        AND LOWER(TRIM(COALESCE(executions.release,''))) = ANY(ARRAY[LOWER(legacy.id),LOWER(legacy.name),LOWER(legacy.display_id),LOWER(legacy.fix_version)])) AS legacy_release_ambiguous,
      executions.sprint, executions.build, executions.started_at, executions.ended_at,
      executions.created_at, assignee.name AS assignee_name
      FROM executions LEFT JOIN users assignee ON assignee.id = executions.assigned_to
      WHERE executions.project_id = ?`).all(projectId),
    db.prepare(`
      SELECT ranked.* FROM (
        SELECT execution_results.id, execution_results.execution_id, execution_results.test_case_id,
          execution_results.status, execution_results.created_at,
          COALESCE(execution_results.ended_at, execution_results.timer_started_at, execution_results.started_at, execution_results.created_at) AS updated_at,
          ROW_NUMBER() OVER (
          PARTITION BY execution_results.test_case_id
          ORDER BY execution_results.created_at DESC, execution_results.id DESC
        ) AS result_rank
        FROM execution_results
        JOIN executions ON executions.id = execution_results.execution_id
        WHERE executions.project_id = ?
          AND ${EXECUTION_RELEASE_FILTER}
          AND ${EXECUTION_SPRINT_FILTER}
      ) ranked WHERE ranked.result_rank = 1
    `).all(projectId, normalizedRelease, normalizedRelease, normalizedSprint, normalizedSprint),
    db.prepare(`
      SELECT DISTINCT execution_case_snapshots.test_case_id, execution_case_snapshots.suite_id
      FROM execution_case_snapshots
      JOIN executions ON executions.id = execution_case_snapshots.execution_id
      WHERE executions.project_id = ?
        AND ${EXECUTION_RELEASE_FILTER}
        AND ${EXECUTION_SPRINT_FILTER}
    `).all(projectId, normalizedRelease, normalizedRelease, normalizedSprint, normalizedSprint),
    db.prepare(`
      SELECT DISTINCT feedback.id, feedback.display_id, feedback.title,
        feedback.status, feedback.priority, feedback.severity, feedback.labels,
        feedback.release, feedback.fix_version, feedback.sprint, feedback.bug_type,
        feedback.created_at, feedback.updated_at, feedback.linked_test_run_id,
        COALESCE(feedback.linked_test_case_ids, '[]'::jsonb) || COALESCE((SELECT jsonb_agg(test_case_id) FROM test_case_defects WHERE issue_id = feedback.id), '[]'::jsonb) AS linked_test_case_ids,
        COALESCE(feedback.linked_requirement_ids, '[]'::jsonb) || COALESCE((SELECT jsonb_agg(requirement_id) FROM requirement_defects WHERE issue_id = feedback.id), '[]'::jsonb) AS linked_requirement_ids,
        reporter.name AS reporter_name,
        assignee.name AS assignee_name
      FROM feedback
      LEFT JOIN users reporter ON reporter.id = feedback.user_id
      LEFT JOIN users assignee ON assignee.id = feedback.assignee_id
      LEFT JOIN executions ON executions.id = feedback.linked_test_run_id
      LEFT JOIN requirement_defects ON requirement_defects.issue_id = feedback.id
      LEFT JOIN requirements defect_requirements ON defect_requirements.id = requirement_defects.requirement_id
      LEFT JOIN test_case_defects ON test_case_defects.issue_id = feedback.id
      LEFT JOIN test_cases defect_test_cases ON defect_test_cases.id = test_case_defects.test_case_id
      LEFT JOIN app_types defect_app_types ON defect_app_types.id = defect_test_cases.app_type_id
      WHERE feedback.project_id = ?
         OR (feedback.project_id IS NULL AND (executions.project_id = ?
           OR defect_requirements.project_id = ?
           OR defect_app_types.project_id = ?))
    `).all(projectId, projectId, projectId, projectId),
    db.prepare(`SELECT test_case_modules.id, test_case_modules.name FROM test_case_modules JOIN app_types ON app_types.id = test_case_modules.app_type_id WHERE app_types.project_id = ?`).all(projectId)
  ]);

  const matchesRelease = item => !normalizedRelease || ((item.native_releases || []).length
    ? item.native_releases.some(rel => [rel.id, rel.name, rel.display_id, rel.fix_version].some(value => lowerText(value) === normalizedRelease))
    : !item.legacy_release_ambiguous && lowerText(item.fix_version || item.release) === normalizedRelease);
  const matchesSprint = item => !normalizedSprint || (item.iteration_id
    ? [item.iteration_id, item.sprint_name].some(value => lowerText(value) === normalizedSprint)
    : lowerText(item.sprint) === normalizedSprint);
  const scopedRequirements = normalizedRelease
    ? requirements.filter(matchesRelease)
    : requirements;
  const sprintScopedRequirements = normalizedSprint
    ? scopedRequirements.filter(matchesSprint)
    : scopedRequirements;
  const scopedExecutions = executions.filter((item) =>
    matchesRelease(item) && matchesSprint(item)
  );
  const requirementIds = new Set(sprintScopedRequirements.map((item) => item.id));
  const executionIds = new Set(scopedExecutions.map((item) => item.id));
  const plannedCaseIds = new Set(plannedCases.map((item) => item.test_case_id).filter(Boolean));
  const hasPlanningScope = Boolean(normalizedRelease || normalizedSprint);
  const scopedTestCases = hasPlanningScope
    ? testCases.filter((item) => plannedCaseIds.has(item.id) || (item.requirement_ids || []).some((id) => requirementIds.has(id)))
    : testCases;
  const testCaseIds = new Set(scopedTestCases.map((item) => item.id));
  const plannedSuiteIds = new Set(plannedCases.map((item) => item.suite_id).filter(Boolean));
  const primarySuiteIds = new Set(scopedTestCases.map((item) => item.suite_id).filter(Boolean));
  const scopedSuites = hasPlanningScope
    ? suites.filter((item) => plannedSuiteIds.has(item.id) || (item.test_case_ids || []).some((id) => testCaseIds.has(id)) || primarySuiteIds.has(item.id))
    : suites;
  const scopedResults = results.filter((item) => testCaseIds.has(item.test_case_id) && executionIds.has(item.execution_id));
  const scopedIssues = issues.filter((item) =>
    (!normalizedRelease || lowerText(item.fix_version || item.release) === normalizedRelease || executionIds.has(item.linked_test_run_id)
      || (item.linked_requirement_ids || []).some(id => requirementIds.has(id)) || (item.linked_test_case_ids || []).some(id => testCaseIds.has(id)))
    && (!normalizedSprint || lowerText(item.sprint) === normalizedSprint || executionIds.has(item.linked_test_run_id)
      || (item.linked_requirement_ids || []).some(id => requirementIds.has(id)) || (item.linked_test_case_ids || []).some(id => testCaseIds.has(id)))
  );

  return {
    project: { id: project.id, key: project.display_id || project.id, name: project.name },
    release: normalizeText(release) || null,
    sprint: normalizeText(sprint) || null,
    requirements: sprintScopedRequirements.map(item => ({ ...item, sprint: item.sprint_name || item.sprint, test_case_ids: [...new Set((item.test_case_ids || []).filter(id => testCaseIds.has(id)))] })),
    testCases: scopedTestCases,
    suites: scopedSuites,
    executions: scopedExecutions,
    results: scopedResults,
    plannedCaseIds,
    issues: scopedIssues,
    modules
  };
};

const calculateMetrics = (context, now = Date.now()) => {
  const coveredRequirements = context.requirements.filter((item) => (item.test_case_ids || []).length > 0).length;
  const automatedCases = context.testCases.filter((item) => item.automated === "yes" || item.automation_status === "ready").length;
  const completedResults = context.results.filter((item) => ["passed", "failed", "blocked"].includes(item.status));
  const passedResults = completedResults.filter((item) => item.status === "passed").length;
  const blockedResults = completedResults.filter((item) => item.status === "blocked").length;
  const failedRuns = context.executions.filter((item) => item.status === "failed").length;
  const openDefects = context.issues.filter((item) => isOpen(item.status)).length;
  const criticalDefects = context.issues.filter((item) => isOpen(item.status) && ["critical", "highest"].includes(lowerText(item.severity || item.priority))).length;
  const uncoveredHighPriorityRequirements = context.requirements.filter((item) => Number(item.priority || 3) <= 2 && !(item.test_case_ids || []).length).length;
  const resultCaseIds = new Set(context.results.map((item) => item.test_case_id).filter(Boolean));
  const plannedCaseIds = new Set([...(context.plannedCaseIds || []), ...resultCaseIds]);
  const completedCaseIds = new Set(context.results.filter((item) => FINAL_CASE_STATUSES.has(item.status)).map((item) => item.test_case_id).filter(Boolean));
  const completion = percent(completedCaseIds.size, plannedCaseIds.size);
  const coverage = percent(coveredRequirements, context.requirements.length);
  const passRate = percent(passedResults, completedResults.length);
  const defectContainment = context.issues.length
    ? percent(Math.max(context.issues.length - openDefects, 0), context.issues.length)
    : 100;
  let releaseConfidence = Math.round((coverage * 0.25) + (completion * 0.20) + (passRate * 0.35) + (defectContainment * 0.20));
  if (!context.requirements.length || !context.testCases.length || !completedResults.length) releaseConfidence = Math.min(releaseConfidence, 49);
  if (context.requirements.some((item) => Number(item.priority || 3) <= 2 && !(item.test_case_ids || []).length)) releaseConfidence = Math.min(releaseConfidence, 69);
  if (blockedResults) releaseConfidence = Math.min(releaseConfidence, 59);
  if (criticalDefects) releaseConfidence = Math.min(releaseConfidence, 39);

  const completedDurations = context.executions
    .filter((item) => item.started_at && item.ended_at)
    .map((item) => Math.max(0, new Date(item.ended_at).getTime() - new Date(item.started_at).getTime()))
    .filter(Number.isFinite);
  const latestEvidenceAt = context.results.reduce((latest, item) => {
    const timestamp = new Date(item.updated_at || item.created_at || 0).getTime();
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0);
  const evidenceAgeDays = latestEvidenceAt ? Math.max(0, Math.floor((now - latestEvidenceAt) / 86_400_000)) : -1;
  const defectTraceability = buildRelationalEvidence(context).values.defectTraceability;

  return {
    releaseConfidence,
    requirementCoverage: coverage,
    coverageGaps: Math.max(context.requirements.length - coveredRequirements, 0),
    automationCoverage: percent(automatedCases, context.testCases.length),
    openDefects,
    failedRuns,
    executionCycleHours: completedDurations.length ? Math.round((completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length / 3_600_000) * 10) / 10 : 0,
    completedRuns30d: context.executions.filter((item) => completedRecently(item, now)).length,
    testCases: context.testCases.length,
    testSuites: context.suites.length,
    testRuns: context.executions.length,
    moduleCaseCount: context.testCases.filter((item) => (item.module_ids || []).length > 0).length,
    executionCompletion: completion,
    passRate,
    blockedResults,
    criticalDefects,
    uncoveredHighPriorityRequirements,
    evidenceAgeDays,
    defectTraceability,
    defectContainment,
    evidenceConfidence: Math.round((coverage * 0.4) + (completion * 0.4) + (defectTraceability * 0.2)),
    ...buildRelationalEvidence(context).values
  };
};

const calendarBucket = (value, week) => {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown date";
  if (week) date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, week ? 10 : 7);
};

const groupRecords = (records, groupBy, modules = []) => {
  const counts = new Map();
  const moduleNames = new Map(modules.map((item) => [item.id, item.name]));
  const add = (value) => {
    const label = normalizeText(value) || "Unspecified";
    counts.set(label, (counts.get(label) || 0) + 1);
  };
  records.forEach((item) => {
    if (groupBy === "priority") add(item.priority ?? item.severity);
    else if (groupBy === "labels") [...new Set(Array.isArray(item.labels) && item.labels.length ? item.labels : ["Unlabeled"])].forEach(add);
    else if (groupBy === "sprint") add(item.sprint || "No sprint");
    else if (groupBy === "fixVersion" || groupBy === "release") {
      const releases = (item.native_releases || []).map(release => release.name || release.fix_version || release.id);
      [...new Set(releases.length ? releases : [item.fix_version || item.release || "No release"])].forEach(add);
    }
    else if (groupBy === "story") [...new Set(item.story_titles?.length ? item.story_titles : ["No story"])].forEach(add);
    else if (groupBy === "assignee") add(item.assignee_name || "Unassigned");
    else if (groupBy === "reporter") add(item.reporter_name || "Unknown reporter");
    else if (groupBy === "issuetype") add(item.bug_type || item.test_case_type || item.record_type);
    else if (groupBy === "resolution") add(isOpen(item.status) ? "Unresolved" : "Resolved");
    else if (groupBy === "statusCategory") add(["passed", "completed", "closed", "resolved", "done", "accepted"].includes(lowerText(item.status)) ? "Done" : ["running", "paused", "in_progress", "in progress"].includes(lowerText(item.status)) ? "In progress" : "To do");
    else if (groupBy === "module" || groupBy === "components") {
      const labels = [...new Set((item.module_ids || []).map((id) => moduleNames.get(id) || id))];
      (labels.length ? labels : ["No module"]).forEach(add);
    } else if (/^(created|updated)(Week|Month)$/.test(groupBy)) {
      add(calendarBucket(groupBy.startsWith("updated") ? item.updated_at || item.created_at : item.created_at, groupBy.endsWith("Week")));
    } else add(item.status);
  });
  const temporal = /^(created|updated)(Week|Month)$/.test(groupBy);
  return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((left, right) => temporal ? left.label.localeCompare(right.label) : right.value - left.value || left.label.localeCompare(right.label));
};

const metricEvidence = (context, metric, now) => {
  const withType = (records, type, target) => ({ records, type, target });
  if (Object.hasOwn(RELATIONAL_METRICS, metric)) {
    const records = buildRelationalEvidence(context).records[metric];
    if (["stories", "devStoryCompletion", "qaStoryCompletion", "storyTestPassRate", "storyExecutionCoverage", "storiesWithOpenDefects"].includes(metric)) return withType(records, "story", "/requirements");
    if (["linkedDefects", "defectTraceability"].includes(metric)) return withType(records, "issue", "/issues");
    return withType(records, "test-case", "/test-cases");
  }
  if (["count", "openDefects"].includes(metric)) return withType(metric === "openDefects" ? context.issues.filter((item) => isOpen(item.status)) : context.issues, "issue", "/issues");
  if (["requirementCoverage", "coverageGaps"].includes(metric)) return withType(metric === "coverageGaps" ? context.requirements.filter((item) => !(item.test_case_ids || []).length) : context.requirements, "story", "/requirements");
  if (["testRuns", "failedRuns", "completedRuns30d", "executionCycleHours"].includes(metric)) {
    const records = context.executions.filter((item) => metric === "failedRuns" ? item.status === "failed" : metric === "completedRuns30d" ? completedRecently(item, now) : metric === "executionCycleHours" ? Boolean(item.started_at && item.ended_at) : true);
    return withType(records, "test-run", "/executions");
  }
  if (metric === "testSuites") return withType(context.suites, "test-suite", "/test-suites");
  if (["passRate", "executionCompletion"].includes(metric)) {
    const cases = new Map(context.testCases.map((item) => [item.id, item]));
    const latest = new Map(context.results.map((item) => [item.test_case_id, item]));
    const ids = metric === "passRate" ? [...latest.keys()] : [...new Set([...(context.plannedCaseIds || []), ...latest.keys()])];
    const records = ids.map((id) => ({ ...cases.get(id), ...latest.get(id), id, title: cases.get(id)?.title || "Archived test case", status: latest.get(id)?.status || "pending" }));
    return withType(metric === "passRate" ? records.filter((item) => ["passed", "failed", "blocked"].includes(item.status)) : records, "test-case", "/executions");
  }
  return withType(metric === "moduleCaseCount" ? context.testCases.filter((item) => (item.module_ids || []).length) : context.testCases, "test-case", "/test-cases");
};

const evaluateContextGadget = ({ context, metrics, gadget, evaluatedAt = nowIso() }) => {
  const metric = normalizeNativeMetric(gadget?.metric);
  const type = gadget?.type || "metric";
  const groupBy = gadget?.group_by || "status";
  const { records, type: recordType, target } = metricEvidence(context, metric, new Date(evaluatedAt).getTime());
  const value = metric === "count" ? records.length : metrics[metric];
  if (value === undefined) throw Object.assign(new Error("This metric is not available for native project dashboards."), { code: "DASHBOARD_METRIC_UNSUPPORTED", statusCode: 400 });
  let series = [];
  if (!["metric", "table"].includes(type)) {
    if (groupBy === "status" && ["devStoryCompletion", "qaStoryCompletion", "storyTestPassRate", "storyExecutionCoverage", "defectTraceability"].includes(metric)) {
      const isSatisfied = metric === "devStoryCompletion" ? item => DEV_DONE.has(storyStatus(item.status))
        : metric === "qaStoryCompletion" ? item => QA_DONE.has(storyStatus(item.status))
          : metric === "storyTestPassRate" ? item => item.all_cases_passed
            : metric === "storyExecutionCoverage" ? item => item.all_cases_finalized
              : item => buildRelationalEvidence(context).linkedDefects.some(defect => defect.id === item.id);
      const complete = records.filter(isSatisfied).length;
      const labels = metric === "storyTestPassRate" ? ["All Tests Passed", "Not All Passed"]
        : metric === "storyExecutionCoverage" ? ["All Tests Finalized", "Testing Incomplete"]
          : metric === "defectTraceability" ? ["Linked", "Unlinked"] : ["Complete", "Incomplete"];
      series = [{ label: labels[0], value: complete }, { label: labels[1], value: records.length - complete }];
    } else if (groupBy === "status" && metric === "requirementCoverage") {
      const covered = records.filter((item) => (item.test_case_ids || []).length).length;
      series = [{ label: "Covered", value: covered }, { label: "Uncovered", value: records.length - covered }];
    } else if (groupBy === "status" && metric === "automationCoverage") {
      const automated = records.filter((item) => item.automated === "yes" || item.automation_status === "ready").length;
      series = [{ label: "Automated", value: automated }, { label: "Manual", value: records.length - automated }];
    } else if (groupBy === "status" && ["releaseConfidence", "evidenceConfidence"].includes(metric)) {
      // These are component percentages, not counts of records.
      series = [{ label: "Requirement coverage", value: metrics.requirementCoverage }, { label: "Execution completion", value: metrics.executionCompletion }];
      series.push(...(metric === "releaseConfidence"
        ? [{ label: "Pass rate", value: metrics.passRate }, { label: "Defect containment", value: metrics.defectContainment }]
        : [{ label: "Defect traceability", value: metrics.defectTraceability }]));
    } else series = groupRecords(records, metric === "moduleCaseCount" && groupBy === "status" ? "module" : groupBy, context.modules);
  }
  const rows = type === "table" ? records.slice(0, 100).map((item) => ({
    id: item.id, key: item.display_id || item.id,
    title: item.title || item.name || "Untitled", status: item.status || null,
    priority: item.priority == null ? item.severity || null : String(item.priority),
    type: recordType, assignee: item.assignee_name || null,
    updated: item.updated_at || item.created_at || null
  })) : [];
  return {
    project: context.project, jql: "", evaluated_at: evaluatedAt,
    gadget: {
      id: gadget?.id || "preview", title: normalizeText(gadget?.title) || "Quality signal",
      data_source: "hellotest", type, group_by: groupBy, metric, jql: "",
      release: normalizeText(gadget?.release) || undefined, accent: gadget?.accent || "blue"
    },
    total: records.length, value: Number(value || 0),
    value_label: PERCENTAGE_METRICS.has(metric) ? `${Number(value || 0)}%` : metric === "executionCycleHours" ? `${Number(value || 0)} hours` : String(Number(value || 0)),
    returned: type === "table" ? rows.length : records.length,
    truncated: type === "table" && records.length > rows.length,
    series, rows, drilldown_target: target,
    methodology: `${RELATIONAL_METRICS[metric] || "Latest-result-per-case outcomes; N/A and aborted cases count toward completion but not pass rate."} Derived from the selected HelloTest project${context.release ? " and release" : ""}. Full scoped records contribute to metrics and charts; tables show at most 100 rows.${groupBy === "module" || metric === "moduleCaseCount" ? " A case linked to multiple modules contributes to each module." : ""}${["story", "release", "fixVersion", "labels"].includes(groupBy) ? " Records linked to multiple groups appear in each group; grouped counts can exceed the distinct total." : ""}`
  };
};

const evaluateGadget = async ({ projectId, gadget, evaluationCache }) => {
  if (gadget?.data_source === "jira" || normalizeText(gadget?.jql)) {
    throw Object.assign(new Error(gadget?.data_source === "jira"
      ? "Connected work-tracker dashboard queries are not available. Use a native project widget or import linked stories into this project."
      : "Native project widgets do not support JQL. Clear the query and use the release and grouping controls."), { code: "DASHBOARD_QUERY_UNSUPPORTED", statusCode: 400 });
  }
  normalizeNativeMetric(gadget?.metric);
  const scopeKey = JSON.stringify([projectId, lowerText(gadget?.release)]);
  let pending = evaluationCache?.get(scopeKey);
  if (!pending) {
    pending = loadContext(projectId, gadget?.release).then((context) => {
      const now = Date.now();
      return { context, metrics: calculateMetrics(context, now), evaluatedAt: new Date(now).toISOString() };
    });
    evaluationCache?.set(scopeKey, pending);
  }
  return evaluateContextGadget({ ...await pending, gadget });
};

// Per-run evidence cannot be reconstructed from the globally latest result per case.
const loadRunResultSummaries = ({ projectId, release, sprint }) => db.prepare(`WITH ranked_run_results AS (
    SELECT execution_results.execution_id, execution_results.status,
      ROW_NUMBER() OVER (PARTITION BY execution_results.execution_id, execution_results.test_case_id,
        COALESCE(execution_results.data_set_iteration_index::text, execution_results.data_set_iteration_key, 'default')
        ORDER BY execution_results.created_at DESC, execution_results.id DESC) AS attempt_rank
    FROM execution_results JOIN executions ON executions.id = execution_results.execution_id
    WHERE executions.project_id = ?
      AND (? = '' OR LOWER(TRIM(COALESCE(executions.release, ''))) = ?)
      AND (? = '' OR LOWER(TRIM(COALESCE(executions.sprint, ''))) = ?)
      AND execution_results.created_at <= CURRENT_TIMESTAMP
  ) SELECT execution_id, COUNT(*) AS result_count,
      COUNT(*) FILTER (WHERE status = 'passed') AS passed_count,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
      COUNT(*) FILTER (WHERE status = 'blocked') AS blocked_count
    FROM ranked_run_results WHERE attempt_rank = 1 GROUP BY execution_id
  `).all(projectId, lowerText(release), lowerText(release), lowerText(sprint), lowerText(sprint));

const qualityInsights = async ({ projectId, release, sprint }) => {
  const context = await loadContext(projectId, release, sprint);
  const runSummaries = await loadRunResultSummaries({ projectId, release, sprint });
  const summaryByRun = new Map(runSummaries.map(item => [item.execution_id, item]));
  const metrics = calculateMetrics(context);
  const requestId = `quality-${Date.now()}`;
  const generatedAt = nowIso();
  const inputFingerprint = `${projectId}:${normalizeText(release)}:${normalizeText(sprint)}:${context.requirements.length}:${context.executions.length}:${context.results.length}`;
  const confidence = Math.max(0.35, Math.min(0.95, metrics.evidenceConfidence / 100));
  const evidence = [
    ...context.requirements.slice(0, 20).map((item) => item.display_id || item.id),
    ...context.executions.slice(0, 20).map((item) => item.display_id || item.id),
    ...context.issues.slice(0, 20).map((item) => item.id)
  ];
  const findings = [
    metrics.coverageGaps ? { id: "coverage", title: "Requirement coverage gaps", severity: "high", description: `${metrics.coverageGaps} requirement(s) have no linked test case.`, action: "Link or design tests for the highest-priority uncovered requirements." } : null,
    metrics.failedRuns ? { id: "runs", title: "Failed runs remain in scope", severity: "high", description: `${metrics.failedRuns} run(s) are failed in this scope.`, action: "Review failures, evidence, and linked defects before release review." } : null,
    metrics.openDefects ? { id: "defects", title: "Open defects", severity: metrics.criticalDefects ? "high" : "medium", description: `${metrics.openDefects} open defect(s) remain.`, action: "Confirm severity, traceability, and ownership." } : null
  ].filter(Boolean);
  const resultByCaseId = new Map(context.results.map((item) => [item.test_case_id, item]));
  const testCaseIdsInScope = new Set(context.testCases.map((item) => item.id));
  const openIssues = context.issues.filter((item) => isOpen(item.status));
  const defectsByRequirement = new Map();
  const defectsByCase = new Map();
  const indexDefects = (index, ids, issueIndex) => {
    for (const id of Array.isArray(ids) ? ids : []) {
      if (!index.has(id)) index.set(id, new Set());
      index.get(id).add(issueIndex);
    }
  };
  openIssues.forEach((issue, index) => {
    indexDefects(defectsByRequirement, issue.linked_requirement_ids, index);
    indexDefects(defectsByCase, issue.linked_test_case_ids, index);
  });
  const traceability = context.requirements.map((requirement) => {
    const testCaseIds = (Array.isArray(requirement.test_case_ids) ? requirement.test_case_ids : []).filter((id) => testCaseIdsInScope.has(id));
    const latestResults = testCaseIds.map((id) => resultByCaseId.get(id)).filter(Boolean);
    // A defect can link through both a story and several cases; count it once.
    const openDefects = new Set(defectsByRequirement.get(requirement.id));
    for (const id of testCaseIds) for (const issueIndex of defectsByCase.get(id) || []) openDefects.add(issueIndex);
    const failedOrBlocked = latestResults.filter((item) => ["failed", "blocked"].includes(lowerText(item.status))).length;
    const riskScore = (!testCaseIds.length ? 50 : 0)
      + (Number(requirement.priority || 3) <= 2 ? 20 : 0)
      + (failedOrBlocked * 15)
      + (openDefects.size * 10);
    return {
      id: requirement.id,
      key: requirement.display_id || requirement.id,
      title: requirement.title,
      priority: Number(requirement.priority || 3),
      status: requirement.status || null,
      test_case_count: testCaseIds.length,
      executed_count: latestResults.length,
      passed_count: latestResults.filter((item) => lowerText(item.status) === "passed").length,
      failed_or_blocked_count: failedOrBlocked,
      open_defect_count: openDefects.size,
      risk: riskScore >= 50 ? "high" : riskScore >= 20 ? "medium" : "low",
      risk_score: riskScore
    };
  }).sort((left, right) => right.risk_score - left.risk_score || left.key.localeCompare(right.key));
  const executionEvidence = context.executions.map((execution) => {
    const executionSummary = summaryByRun.get(execution.id);
    return {
      id: execution.id,
      key: execution.display_id || execution.id,
      name: execution.name || "Execution run",
      status: execution.status || null,
      release: execution.release || null,
      sprint: execution.sprint || null,
      build: execution.build || null,
      started_at: execution.started_at || null,
      created_at: execution.created_at || null,
      ended_at: execution.ended_at || null,
      result_count: Number(executionSummary?.result_count || 0),
      passed_count: Number(executionSummary?.passed_count || 0),
      failed_count: Number(executionSummary?.failed_count || 0),
      blocked_count: Number(executionSummary?.blocked_count || 0)
    };
  }).sort((left, right) => String(right.started_at || "").localeCompare(String(left.started_at || "")));
  const summary = `${context.requirements.length} scoped stories, ${context.testCases.length} cases and ${context.executions.length} runs. ${metrics.coverageGaps} stories lack test links; ${metrics.openDefects} defects remain open.`;
  const insightEvidence = {
    coverage: context.requirements.filter(item => !(item.test_case_ids || []).length),
    runs: context.executions.filter(item => lowerText(item.status) === "failed"),
    defects: openIssues
  };
  return {
    integration: { id: "hellotest-evidence-graph", name: "HelloTest evidence graph", type: "deterministic", model: null, generation_mode: "deterministic", direct_model_invocation: false },
    generation_mode: "deterministic",
    generated_at: generatedAt,
    request_id: requestId,
    input_fingerprint: inputFingerprint,
    confidence,
    fallback_used: false,
    fallback_reason: null,
    requires_human_review: true,
    preview_only: true,
    project: context.project,
    scope: { kind: normalizeText(release) ? "release" : "project", project_key: context.project.key, project_id: projectId, release: normalizeText(release) || null, sprint: normalizeText(sprint) || null },
    summary,
    release_summary: summary,
    generated_from: evidence,
    metrics,
    findings,
    insights: findings.map(finding => ({
      id: finding.id, title: finding.title, severity: finding.severity,
      explanation: finding.description, recommended_action: finding.action,
      evidence: (insightEvidence[finding.id] || []).slice(0, 20).map(item => ({
        id: item.id, display_id: item.display_id || null, title: item.title || item.name || null,
        kind: finding.id === "coverage" ? "story" : finding.id === "runs" ? "run" : "bug"
      }))
    })),
    traceability,
    execution_evidence: executionEvidence,
    recommended_actions: findings.map((item) => item.action),
    limitations: ["This is an evidence-based advisory score, not a release approval.", "Root cause and product impact require human validation."],
    provenance: {
      capability: "portfolio-quality-insights-preview",
      confidence_basis: "Legacy deterministic advisory heuristic; not measured prediction accuracy or release approval.",
      provider: "HelloTest relational quality engine",
      generation_mode: "deterministic",
      model: null,
      request_id: requestId,
      generated_at: generatedAt,
      confidence,
      evidence,
      input_fingerprint: inputFingerprint,
      fallback_used: false,
      fallback_reason: null,
      requires_human_review: true
    }
  };
};

const explainQualityInsights = async ({ projectId, release, sprint, userId, integrationId }) => {
  const baseline = await qualityInsights({ projectId, release, sprint });
  const reviewer = require("@hellotest/ai/backend/services/structuredReview.service");
  const review = await reviewer.review({ projectId, userId, integrationId, usageKey: "ai.quality.insights",
    task: "Explain the recorded project quality signals. Counts and metrics are fixed code inputs. Linked coverage is not assertion adequacy. An advisory score is not release readiness. Distinguish observed failures from hypotheses and missing evidence.",
    evidence: { ref: "quality:metrics", scope: baseline.scope, metrics: baseline.metrics, findings: baseline.findings, limitations: baseline.limitations },
    contract: '{"summary":"string","findings":[{"id":"existing finding id","explanation":"string","action":"string","evidence_refs":["quality:metrics"]}]}',
    validate: value => {
      if (!value || typeof value.summary !== "string" || !value.summary.trim() || !Array.isArray(value.findings) || value.findings.length !== baseline.findings.length) throw reviewer.invalid();
      const seen = new Set();
      for (const item of value.findings) {
        if (!baseline.findings.some(finding => finding.id === item.id) || seen.has(item.id) || typeof item.explanation !== "string" || !item.explanation.trim() || typeof item.action !== "string" || !item.action.trim() || !Array.isArray(item.evidence_refs) || !item.evidence_refs.length || item.evidence_refs.some(ref => ref !== "quality:metrics")) throw reviewer.invalid();
        seen.add(item.id);
      }
      return value;
    } });
  const findings = baseline.findings.map(finding => { const explanation = review.result.findings.find(item => item.id === finding.id); return { ...finding, description: explanation.explanation.slice(0, 2000), action: explanation.action.slice(0, 1000) }; });
  return { ...baseline, generation_mode: "llm", fallback_used: false, integration: review.integration, model_execution: review.model_execution,
    summary: review.result.summary.slice(0, 2000), release_summary: review.result.summary.slice(0, 2000), findings,
    insights: baseline.insights.map(item => ({ ...item, explanation: findings.find(finding => finding.id === item.id).description, recommended_action: findings.find(finding => finding.id === item.id).action })),
    recommended_actions: findings.map(item => item.action),
    provenance: { ...baseline.provenance, generation_mode: "llm", provider: review.integration.name, model: review.integration.model, input_fingerprint: review.model_execution.input_hash } };
};

module.exports = {
  NATIVE_DASHBOARD_METRICS,
  normalizeNativeMetric,
  calculateMetrics,
  evaluateContextGadget,
  groupRecords,
  evaluateGadget,
  loadContext,
  loadRunResultSummaries,
  qualityInsights,
  explainQualityInsights
};
