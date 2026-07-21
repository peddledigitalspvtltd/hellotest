const db = require("../db");

const nowIso = () => new Date().toISOString();
const normalizeText = (value) => String(value || "").trim();
const lowerText = (value) => normalizeText(value).toLowerCase();
const percent = (numerator, denominator) => denominator ? Math.round((numerator / denominator) * 100) : 0;
const isOpen = (status) => !["closed", "resolved", "done", "accepted"].includes(lowerText(status));

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
      SELECT requirements.*,
        COALESCE((SELECT jsonb_agg(requirement_test_cases.test_case_id) FROM requirement_test_cases WHERE requirement_test_cases.requirement_id = requirements.id), '[]'::jsonb) AS test_case_ids
      FROM requirements WHERE project_id = ?
    `).all(projectId),
    db.prepare(`
      SELECT test_cases.*,
        COALESCE((SELECT jsonb_agg(requirement_test_cases.requirement_id) FROM requirement_test_cases WHERE requirement_test_cases.test_case_id = test_cases.id), '[]'::jsonb) AS requirement_ids,
        COALESCE((SELECT jsonb_agg(test_case_module_cases.module_id) FROM test_case_module_cases WHERE test_case_module_cases.test_case_id = test_cases.id), '[]'::jsonb) AS module_ids
      FROM test_cases JOIN app_types ON app_types.id = test_cases.app_type_id
      WHERE app_types.project_id = ?
    `).all(projectId),
    db.prepare(`SELECT test_suites.* FROM test_suites JOIN app_types ON app_types.id = test_suites.app_type_id WHERE app_types.project_id = ?`).all(projectId),
    db.prepare("SELECT * FROM executions WHERE project_id = ?").all(projectId),
    db.prepare(`
      SELECT ranked.* FROM (
        SELECT execution_results.*, ROW_NUMBER() OVER (
          PARTITION BY execution_results.test_case_id
          ORDER BY execution_results.created_at DESC, execution_results.id DESC
        ) AS result_rank
        FROM execution_results
        JOIN executions ON executions.id = execution_results.execution_id
        WHERE executions.project_id = ?
          AND (? = '' OR LOWER(COALESCE(executions.release, '')) = ?)
          AND (? = '' OR LOWER(COALESCE(executions.sprint, '')) = ?)
      ) ranked WHERE ranked.result_rank = 1
    `).all(projectId, normalizedRelease, normalizedRelease, normalizedSprint, normalizedSprint),
    db.prepare(`
      SELECT DISTINCT execution_case_snapshots.test_case_id
      FROM execution_case_snapshots
      JOIN executions ON executions.id = execution_case_snapshots.execution_id
      WHERE executions.project_id = ?
        AND (? = '' OR LOWER(COALESCE(executions.release, '')) = ?)
        AND (? = '' OR LOWER(COALESCE(executions.sprint, '')) = ?)
    `).all(projectId, normalizedRelease, normalizedRelease, normalizedSprint, normalizedSprint),
    db.prepare(`
      SELECT DISTINCT feedback.*,
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
         OR executions.project_id = ?
         OR defect_requirements.project_id = ?
         OR defect_app_types.project_id = ?
    `).all(projectId, projectId, projectId, projectId),
    db.prepare(`SELECT test_case_modules.* FROM test_case_modules JOIN app_types ON app_types.id = test_case_modules.app_type_id WHERE app_types.project_id = ?`).all(projectId)
  ]);

  const scopedRequirements = normalizedRelease
    ? requirements.filter((item) => [item.release, item.fix_version].some((value) => lowerText(value) === normalizedRelease))
    : requirements;
  const sprintScopedRequirements = normalizedSprint
    ? scopedRequirements.filter((item) => lowerText(item.sprint) === normalizedSprint)
    : scopedRequirements;
  const scopedExecutions = executions.filter((item) =>
    (!normalizedRelease || lowerText(item.release) === normalizedRelease)
    && (!normalizedSprint || lowerText(item.sprint) === normalizedSprint)
  );
  const requirementIds = new Set(sprintScopedRequirements.map((item) => item.id));
  const executionIds = new Set(scopedExecutions.map((item) => item.id));
  const plannedCaseIds = new Set(plannedCases.map((item) => item.test_case_id).filter(Boolean));
  const hasPlanningScope = Boolean(normalizedRelease || normalizedSprint);
  const scopedTestCases = hasPlanningScope
    ? testCases.filter((item) => plannedCaseIds.has(item.id) || (item.requirement_ids || []).some((id) => requirementIds.has(id)))
    : testCases;
  const testCaseIds = new Set(scopedTestCases.map((item) => item.id));
  const scopedResults = results.filter((item) => executionIds.has(item.execution_id) || (!hasPlanningScope && testCaseIds.has(item.test_case_id)));
  const scopedIssues = issues.filter((item) =>
    (!normalizedRelease || [item.release, item.fix_version].some((value) => lowerText(value) === normalizedRelease) || executionIds.has(item.linked_test_run_id))
    && (!normalizedSprint || lowerText(item.sprint) === normalizedSprint || executionIds.has(item.linked_test_run_id))
  );

  return {
    project: { id: project.id, key: project.display_id || project.id, name: project.name },
    release: normalizeText(release) || null,
    sprint: normalizeText(sprint) || null,
    requirements: sprintScopedRequirements,
    testCases: scopedTestCases,
    suites,
    executions: scopedExecutions,
    results: scopedResults,
    plannedCaseIds,
    issues: scopedIssues,
    modules
  };
};

const calculateMetrics = (context) => {
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
  const plannedCaseIds = context.plannedCaseIds?.size ? context.plannedCaseIds : resultCaseIds;
  const completedCaseIds = new Set(completedResults.map((item) => item.test_case_id).filter(Boolean));
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
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const latestEvidenceAt = context.results.reduce((latest, item) => {
    const timestamp = new Date(item.updated_at || item.created_at || 0).getTime();
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0);
  const evidenceAgeDays = latestEvidenceAt ? Math.max(0, Math.floor((Date.now() - latestEvidenceAt) / 86_400_000)) : -1;
  const traceableDefects = context.issues.filter((item) => [
    item.linked_test_run_id,
    ...(Array.isArray(item.linked_test_case_ids) ? item.linked_test_case_ids : []),
    ...(Array.isArray(item.linked_requirement_ids) ? item.linked_requirement_ids : [])
  ].some(Boolean)).length;
  const defectTraceability = context.issues.length ? percent(traceableDefects, context.issues.length) : 100;

  return {
    releaseConfidence,
    requirementCoverage: coverage,
    coverageGaps: Math.max(context.requirements.length - coveredRequirements, 0),
    automationCoverage: percent(automatedCases, context.testCases.length),
    openDefects,
    failedRuns,
    executionCycleHours: completedDurations.length ? Math.round((completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length / 3_600_000) * 10) / 10 : 0,
    completedRuns30d: context.executions.filter((item) => ["completed", "failed"].includes(item.status) && new Date(item.ended_at || item.started_at || 0).getTime() >= thirtyDaysAgo).length,
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
    evidenceConfidence: Math.round((coverage * 0.4) + (completion * 0.4) + (defectTraceability * 0.2))
  };
};

const groupRecords = (records, groupBy) => {
  const counts = new Map();
  const add = (label) => counts.set(label || "Unspecified", (counts.get(label || "Unspecified") || 0) + 1);
  records.forEach((item) => {
    if (groupBy === "priority") add(normalizeText(item.priority) || "Unspecified");
    else if (groupBy === "labels") (Array.isArray(item.labels) && item.labels.length ? item.labels : ["Unlabeled"]).forEach(add);
    else if (groupBy === "sprint") add(normalizeText(item.sprint) || "No sprint");
    else if (groupBy === "fixVersion") add(normalizeText(item.fix_version || item.release) || "No release");
    else add(normalizeText(item.status) || "Unspecified");
  });
  return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
};

const evaluateGadget = async ({ projectId, gadget }) => {
  const context = await loadContext(projectId, gadget?.release);
  const metrics = calculateMetrics(context);
  const metric = gadget?.metric || "count";
  const isIssueMetric = ["count", "resolved", "unresolved", "highPriority", "unassigned", "stale30d", "created30d", "resolved30d", "resolutionRate", "averageAgeDays", "averageResolutionDays"].includes(metric);
  let records = isIssueMetric ? context.issues : context.testCases;
  let value = metrics[metric];
  if (metric === "count") value = records.length;
  if (metric === "resolved") value = records.filter((item) => !isOpen(item.status)).length;
  if (metric === "unresolved") value = records.filter((item) => isOpen(item.status)).length;
  if (metric === "highPriority") value = records.filter((item) => ["critical", "highest", "high", "1", "2"].includes(lowerText(item.priority || item.severity))).length;
  if (value === undefined) value = 0;
  const series = metric === "moduleCaseCount"
    ? context.modules.map((module) => ({
        label: module.name,
        value: context.testCases.filter((item) => (item.module_ids || []).includes(module.id)).length
      })).sort((left, right) => right.value - left.value)
    : groupRecords(records, gadget?.group_by || "status");
  const total = records.length;
  return {
    project: context.project,
    jql: normalizeText(gadget?.jql),
    evaluated_at: nowIso(),
    gadget: {
      id: gadget?.id || "preview",
      title: normalizeText(gadget?.title) || "Quality signal",
      data_source: gadget?.data_source || "qaira",
      type: gadget?.type || "metric",
      group_by: gadget?.group_by || "status",
      metric,
      jql: normalizeText(gadget?.jql),
      release: normalizeText(gadget?.release) || undefined,
      accent: gadget?.accent || "blue"
    },
    total,
    value: Number(value || 0),
    value_label: ["releaseConfidence", "requirementCoverage", "automationCoverage", "resolutionRate", "executionCompletion", "passRate", "evidenceConfidence"].includes(metric) ? `${Number(value || 0)}%` : String(Number(value || 0)),
    returned: Math.min(records.length, 100),
    truncated: records.length > 100,
    series,
    rows: records.slice(0, 100).map((item) => ({
      id: item.id,
      key: item.display_id || item.id,
      title: item.title || item.name || "Untitled",
      status: item.status || null,
      priority: item.priority === undefined ? null : String(item.priority),
      type: isIssueMetric ? "issue" : "test-case",
      assignee: item.assignee_name || null,
      updated: item.updated_at || item.created_at || null
    })),
    drilldown_target: isIssueMetric ? "/issues" : "/test-cases",
    methodology: "Derived from the selected QAira project using bounded relational queries and latest-result-per-case semantics."
  };
};

const qualityInsights = async ({ projectId, release, sprint }) => {
  const context = await loadContext(projectId, release, sprint);
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
  const openIssues = context.issues.filter((item) => isOpen(item.status));
  const traceability = context.requirements.map((requirement) => {
    const testCaseIds = (Array.isArray(requirement.test_case_ids) ? requirement.test_case_ids : []).filter((id) => context.testCases.some((item) => item.id === id));
    const latestResults = testCaseIds.map((id) => resultByCaseId.get(id)).filter(Boolean);
    const openDefects = openIssues.filter((issue) => {
      const requirementIds = Array.isArray(issue.linked_requirement_ids) ? issue.linked_requirement_ids : [];
      const issueCaseIds = Array.isArray(issue.linked_test_case_ids) ? issue.linked_test_case_ids : [];
      return requirementIds.includes(requirement.id) || issueCaseIds.some((id) => testCaseIds.includes(id));
    });
    const failedOrBlocked = latestResults.filter((item) => ["failed", "blocked"].includes(lowerText(item.status))).length;
    const riskScore = (!testCaseIds.length ? 50 : 0)
      + (Number(requirement.priority || 3) <= 2 ? 20 : 0)
      + (failedOrBlocked * 15)
      + (openDefects.length * 10);
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
      open_defect_count: openDefects.length,
      risk: riskScore >= 50 ? "high" : riskScore >= 20 ? "medium" : "low",
      risk_score: riskScore
    };
  }).sort((left, right) => right.risk_score - left.risk_score || left.key.localeCompare(right.key));
  const executionEvidence = context.executions.map((execution) => {
    const executionResults = context.results.filter((item) => item.execution_id === execution.id);
    return {
      id: execution.id,
      key: execution.display_id || execution.id,
      name: execution.name || "Execution run",
      status: execution.status || null,
      release: execution.release || null,
      sprint: execution.sprint || null,
      build: execution.build || null,
      started_at: execution.started_at || execution.created_at || null,
      ended_at: execution.ended_at || null,
      result_count: executionResults.length,
      passed_count: executionResults.filter((item) => lowerText(item.status) === "passed").length,
      failed_count: executionResults.filter((item) => lowerText(item.status) === "failed").length,
      blocked_count: executionResults.filter((item) => lowerText(item.status) === "blocked").length
    };
  }).sort((left, right) => String(right.started_at || "").localeCompare(String(left.started_at || "")));
  return {
    integration: { id: "qaira-evidence-graph", name: "QAira evidence graph", type: "deterministic", model: null, generation_mode: "deterministic", direct_model_invocation: false },
    generation_mode: "deterministic",
    generated_at: generatedAt,
    request_id: requestId,
    input_fingerprint: inputFingerprint,
    confidence,
    fallback_used: false,
    fallback_reason: null,
    requires_human_review: true,
    preview_only: true,
    scope: { project_id: projectId, release: normalizeText(release) || null, sprint: normalizeText(sprint) || null },
    summary: `Release confidence is ${metrics.releaseConfidence}% with ${metrics.evidenceConfidence}% evidence confidence.`,
    metrics,
    findings,
    traceability,
    execution_evidence: executionEvidence,
    recommended_actions: findings.map((item) => item.action),
    limitations: ["This is an evidence-based advisory score, not a release approval.", "Root cause and product impact require human validation."],
    provenance: {
      capability: "portfolio-quality-insights-preview",
      provider: "QAira relational quality engine",
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

module.exports = {
  calculateMetrics,
  evaluateGadget,
  loadContext,
  qualityInsights
};
