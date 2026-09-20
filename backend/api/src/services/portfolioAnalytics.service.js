const db = require("../db");
const projectService = require("./project.service");
const settingsService = require("./settings.service");
const { summarizeLatestRunCases } = require("../utils/latestRunCaseMetrics");

const METRIC_FORMULA_VALUES_KEY = "ai_metric_formula_values";
const TERMINAL_RESULT_STATUSES = new Set(["passed", "failed", "blocked"]);
const CLOSED_BUG_STATUSES = new Set(["closed", "resolved", "done", "accepted"]);

const DEFAULT_FORMULA_VALUES = Object.freeze({
  "metric.project.portfolio_health": Object.freeze({ story_weight: 35, automation_weight: 25, pass_weight: 40 }),
  "metric.project.risky_classification": Object.freeze({ pass_confidence_threshold: 60 }),
  "metric.project.release_ready": Object.freeze({ readiness_threshold: 80 }),
  "metric.project.execution_evidence": Object.freeze({ minimum_coverage_percent: 80 }),
  "metric.project.needs_attention": Object.freeze({ priority_project_limit: 3 }),
  "metric.project.execution_failures": Object.freeze({ priority_impact_limit: 2 }),
  "metric.project.bugs": Object.freeze({ open_bug_attention_threshold: 1, priority_impact_limit: 2 })
});

const CONFIG_LIMITS = Object.freeze({
  "metric.project.portfolio_health": {
    story_weight: [0, 100], automation_weight: [0, 100], pass_weight: [0, 100]
  },
  "metric.project.risky_classification": { pass_confidence_threshold: [0, 100] },
  "metric.project.release_ready": { readiness_threshold: [1, 100] },
  "metric.project.execution_evidence": { minimum_coverage_percent: [0, 100] },
  "metric.project.needs_attention": { priority_project_limit: [1, 8] },
  "metric.project.execution_failures": { priority_impact_limit: [1, 5] },
  "metric.project.bugs": { open_bug_attention_threshold: [0, 1000], priority_impact_limit: [1, 5] }
});

const toNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

const normalizeFormulaValues = (input) => {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const normalized = {};
  Object.entries(DEFAULT_FORMULA_VALUES).forEach(([metricKey, defaults]) => {
    const supplied = source[metricKey] && typeof source[metricKey] === "object" && !Array.isArray(source[metricKey])
      ? source[metricKey]
      : {};
    normalized[metricKey] = Object.fromEntries(Object.entries(defaults).map(([parameterKey, defaultValue]) => {
      const [min, max] = CONFIG_LIMITS[metricKey][parameterKey];
      return [parameterKey, toNumber(supplied[parameterKey], defaultValue, min, max)];
    }));
  });

  const weights = normalized["metric.project.portfolio_health"];
  const weightTotal = weights.story_weight + weights.automation_weight + weights.pass_weight;
  if (weightTotal <= 0) {
    normalized["metric.project.portfolio_health"] = { ...DEFAULT_FORMULA_VALUES["metric.project.portfolio_health"] };
  } else if (weightTotal !== 100) {
    normalized["metric.project.portfolio_health"] = {
      story_weight: (weights.story_weight / weightTotal) * 100,
      automation_weight: (weights.automation_weight / weightTotal) * 100,
      pass_weight: (weights.pass_weight / weightTotal) * 100
    };
  }
  return normalized;
};

const normalizeArray = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const percent = (numerator, denominator) => denominator ? Math.round((numerator / denominator) * 100) : 0;
const calculatePassConfidence = ({ passedCases = 0, finalizedCases = 0, resolvedBugs = 0, totalBugs = 0 } = {}) => {
  const caseTotal = Math.max(0, Number(finalizedCases) || 0);
  const casePassed = Math.min(caseTotal, Math.max(0, Number(passedCases) || 0));
  const bugTotal = Math.max(0, Number(totalBugs) || 0);
  const bugResolved = Math.min(bugTotal, Math.max(0, Number(resolvedBugs) || 0));
  const total = caseTotal + bugTotal;
  const passed = casePassed + bugResolved;

  return {
    total,
    passed,
    percent: percent(passed, total),
    case_total: caseTotal,
    case_passed: casePassed,
    bug_total: bugTotal,
    bug_resolved: bugResolved
  };
};
const timestamp = (value) => {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
};
const groupBy = (items, key) => items.reduce((map, item) => {
  const value = item[key];
  if (!value) return map;
  const group = map.get(value);
  if (group) group.push(item);
  else map.set(value, [item]);
  return map;
}, new Map());
const addToSetMap = (map, key, value) => {
  if (!key || !value) return;
  const current = map.get(key) || new Set();
  current.add(value);
  map.set(key, current);
};
const mergeSetMap = (target, source) => source.forEach((values, key) => values.forEach((value) => addToSetMap(target, key, value)));
const rankImpact = (impactMap, detailMap, limit) => ({
  total: impactMap.size,
  top: [...impactMap.entries()]
    .map(([id, values]) => ({ id, name: detailMap.get(id)?.name || detailMap.get(id)?.title || id, count: values.size }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, limit)
});

// Keep this report from occupying the whole API database pool while people
// sign in, navigate or edit records. Rows remain in the input query order.
const readPortfolioRows = async (readers) => {
  const rows = new Array(readers.length);
  let next = 0;
  let failure;
  await Promise.all(Array.from({ length: Math.min(3, readers.length) }, async () => {
    while (!failure && next < readers.length) {
      const index = next++;
      try {
        rows[index] = await readers[index]();
      } catch (error) {
        failure = error;
      }
    }
  }));
  if (failure) throw failure;
  return rows;
};

const buildPortfolioAnalytics = async (userId) => {
  const [catalog, preferences] = await Promise.all([
    projectService.getProjectCatalog(userId, { projection: "summary" }),
    settingsService.getWorkspacePreferences(userId)
  ]);
  const projects = catalog.filter((project) => project.has_access !== false);
  const configuration = normalizeFormulaValues(preferences?.[METRIC_FORMULA_VALUES_KEY]);

  if (!projects.length) {
    return {
      evaluated_at: new Date().toISOString(),
      configuration,
      summary: {
        total_projects: catalog.length, accessible_projects: 0, locked_projects: catalog.length,
        risky_projects: 0, watch_projects: 0, release_ready_projects: 0, assessed_projects: 0,
        attention_projects: 0, overall_health: 0, average_story_coverage: 0,
        average_automation_coverage: 0, average_pass_confidence: 0,
        evidence_missing_projects: 0, execution_failure_cases: 0, execution_blocked_cases: 0,
        bug_count: 0, open_bug_count: 0, failure_impacts: { modules: { total: 0, top: [] }, requirements: { total: 0, top: [] } },
        bug_impacts: { modules: { total: 0, top: [] }, requirements: { total: 0, top: [] } }
      },
      projects: []
    };
  }

  const projectIds = projects.map((project) => project.id);
  const placeholders = projectIds.map(() => "?").join(", ");
  // Only one run per project contributes to the portfolio. Prefer the newest
  // run with finalized outcomes, preserving the existing metric definition.
  const executions = await db.prepare(`
    SELECT e.id, e.project_id, e.name, e.status, e.trigger,
      e.created_at, e.started_at, e.ended_at, e.duration_ms
    FROM projects p
    JOIN executions e ON e.id = COALESCE(
      (SELECT candidate.id FROM executions candidate
       WHERE candidate.project_id = p.id AND EXISTS (
         SELECT 1 FROM execution_results r WHERE r.execution_id = candidate.id
           AND LOWER(r.status) IN ('passed', 'failed', 'blocked')
       ) ORDER BY candidate.created_at DESC NULLS LAST, candidate.id DESC LIMIT 1),
      (SELECT candidate.id FROM executions candidate
       WHERE candidate.project_id = p.id
       ORDER BY candidate.created_at DESC NULLS LAST, candidate.id DESC LIMIT 1)
    )
    WHERE p.id IN (${placeholders})
  `).all(...projectIds);
  const executionIds = executions.map((execution) => execution.id);
  const runPlaceholders = executionIds.map(() => "?").join(", ") || "NULL";
  const relevantEvidence = `(
    (entity_type = 'execution' AND entity_id IN (${runPlaceholders})) OR
    (entity_type = 'execution_result' AND entity_id IN (
      SELECT id FROM execution_results WHERE execution_id IN (${runPlaceholders})
        AND LOWER(status) IN ('passed', 'failed', 'blocked')
    ))
  )`;
  const evidenceArgs = [...projectIds, ...executionIds, ...executionIds];
  const [appTypes, members, requirements, modules, testCases, caseRequirements, caseModules, results, attachments, comments, bugs, bugRequirements, bugCases, suiteCounts, latestRuns] = await readPortfolioRows([
    () => db.prepare(`SELECT id, project_id, name, type, is_unified FROM app_types WHERE project_id IN (${placeholders})`).all(...projectIds),
    () => db.prepare(`SELECT project_members.project_id, project_members.user_id, users.name FROM project_members LEFT JOIN users ON users.id = project_members.user_id WHERE project_members.project_id IN (${placeholders})`).all(...projectIds),
    () => db.prepare(`SELECT requirements.id, requirements.project_id, requirements.display_id, requirements.title,
      (EXISTS (SELECT 1 FROM requirement_test_cases mapping
        JOIN test_cases linked_case ON linked_case.id = mapping.test_case_id
        JOIN app_types linked_app ON linked_app.id = linked_case.app_type_id
        WHERE mapping.requirement_id = requirements.id AND linked_app.project_id = requirements.project_id)
       OR EXISTS (SELECT 1 FROM test_cases linked_case
        JOIN app_types linked_app ON linked_app.id = linked_case.app_type_id
        WHERE linked_case.requirement_id = requirements.id AND linked_app.project_id = requirements.project_id)) AS is_covered
      FROM requirements WHERE requirements.project_id IN (${placeholders})`).all(...projectIds),
    () => db.prepare(`SELECT test_case_modules.id, test_case_modules.name, app_types.project_id FROM test_case_modules JOIN app_types ON app_types.id = test_case_modules.app_type_id WHERE app_types.project_id IN (${placeholders})`).all(...projectIds),
    () => db.prepare(`SELECT test_cases.id, test_cases.title, test_cases.automated, test_cases.automation_status, app_types.project_id FROM test_cases JOIN app_types ON app_types.id = test_cases.app_type_id WHERE app_types.project_id IN (${placeholders})`).all(...projectIds),
    () => db.prepare(`SELECT requirement_test_cases.test_case_id, requirement_test_cases.requirement_id FROM requirement_test_cases JOIN requirements ON requirements.id = requirement_test_cases.requirement_id WHERE requirements.project_id IN (${placeholders})`).all(...projectIds),
    () => db.prepare(`SELECT test_case_module_cases.test_case_id, test_case_module_cases.module_id FROM test_case_module_cases JOIN test_case_modules ON test_case_modules.id = test_case_module_cases.module_id JOIN app_types ON app_types.id = test_case_modules.app_type_id WHERE app_types.project_id IN (${placeholders})`).all(...projectIds),
    () => db.prepare(`
      WITH latest_case_results AS (
        SELECT DISTINCT ON (e.project_id, r.test_case_id)
          r.id, r.execution_id, r.test_case_id, r.status, r.created_at, e.project_id
        FROM execution_results r JOIN executions e ON e.id = r.execution_id
        WHERE e.project_id IN (${placeholders}) AND LOWER(r.status) IN ('passed', 'failed', 'blocked')
        ORDER BY e.project_id, r.test_case_id, r.created_at DESC NULLS LAST, r.id DESC
      )
      SELECT * FROM latest_case_results
      UNION
      SELECT r.id, r.execution_id, r.test_case_id, r.status, r.created_at, e.project_id
      FROM execution_results r JOIN executions e ON e.id = r.execution_id
      WHERE r.execution_id IN (${runPlaceholders}) AND LOWER(r.status) IN ('passed', 'failed', 'blocked')
      ORDER BY created_at DESC NULLS LAST, id DESC
    `).all(...projectIds, ...executionIds),
    () => db.prepare(`SELECT DISTINCT project_id, entity_type, entity_id, mime_type FROM attachments WHERE project_id IN (${placeholders}) AND ${relevantEvidence} AND (LOWER(mime_type) LIKE 'image/%' OR LOWER(mime_type) LIKE 'video/%')`).all(...evidenceArgs),
    () => db.prepare(`SELECT DISTINCT project_id, entity_type, entity_id FROM entity_comments WHERE project_id IN (${placeholders}) AND ${relevantEvidence} AND BTRIM(body) <> ''`).all(...evidenceArgs),
    () => db.prepare(`SELECT id, project_id, display_id, title, status, severity, priority, linked_test_case_ids, linked_module_ids, linked_requirement_ids FROM feedback WHERE project_id IN (${placeholders})`).all(...projectIds),
    () => db.prepare(`SELECT requirement_defects.issue_id AS bug_id, requirement_defects.requirement_id FROM requirement_defects JOIN requirements ON requirements.id = requirement_defects.requirement_id WHERE requirements.project_id IN (${placeholders})`).all(...projectIds),
    () => db.prepare(`SELECT test_case_defects.issue_id AS bug_id, test_case_defects.test_case_id FROM test_case_defects JOIN test_cases ON test_cases.id = test_case_defects.test_case_id JOIN app_types ON app_types.id = test_cases.app_type_id WHERE app_types.project_id IN (${placeholders})`).all(...projectIds),
    () => db.prepare(`SELECT app_types.project_id, COUNT(*)::INTEGER AS total FROM test_suites JOIN app_types ON app_types.id = test_suites.app_type_id WHERE app_types.project_id IN (${placeholders}) GROUP BY app_types.project_id`).all(...projectIds),
    // The tile describes the actual newest run, including unstarted scope.
    // Keep its selection separate from the portfolio's finalized-evidence run.
    () => db.prepare(`
      SELECT latest_run.*,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('test_case_id', snapshot.test_case_id,
          'expected_iterations', CASE WHEN snapshot.test_data_set_snapshot->>'mode' = 'key_value'
            OR jsonb_typeof(snapshot.test_data_set_snapshot->'rows') IS DISTINCT FROM 'array'
            THEN 1 ELSE GREATEST(1, jsonb_array_length(snapshot.test_data_set_snapshot->'rows')) END))
          FROM execution_case_snapshots snapshot WHERE snapshot.execution_id = latest_run.id), '[]'::jsonb) AS case_scope,
        COALESCE((SELECT jsonb_agg(to_jsonb(current_iteration)) FROM (
          SELECT DISTINCT ON (result.test_case_id, COALESCE(result.data_set_iteration_index::text, result.data_set_iteration_key, 'default'))
            result.id, result.test_case_id, result.status, result.created_at, result.data_set_iteration_index, result.data_set_iteration_key
          FROM execution_results result WHERE result.execution_id = latest_run.id
          ORDER BY result.test_case_id, COALESCE(result.data_set_iteration_index::text, result.data_set_iteration_key, 'default'),
            result.created_at DESC NULLS LAST, result.id DESC
        ) current_iteration), '[]'::jsonb) AS case_results
      FROM projects p JOIN LATERAL (
        SELECT e.id, e.project_id, e.name, e.status, e.trigger, e.created_at, e.started_at, e.ended_at, e.duration_ms
        FROM executions e WHERE e.project_id = p.id
        ORDER BY e.created_at DESC NULLS LAST, e.id DESC LIMIT 1
      ) latest_run ON TRUE WHERE p.id IN (${placeholders})
    `).all(...projectIds)
  ]);

  const appTypesByProject = groupBy(appTypes, "project_id");
  const membersByProject = groupBy(members, "project_id");
  const requirementsByProject = groupBy(requirements, "project_id");
  const modulesByProject = groupBy(modules, "project_id");
  const testCasesByProject = groupBy(testCases, "project_id");
  const executionsByProject = groupBy(executions, "project_id");
  const resultsByProject = groupBy(results, "project_id");
  const bugsByProject = groupBy(bugs, "project_id");
  const suiteCountByProject = new Map(suiteCounts.map(row => [row.project_id, row.total]));
  const latestRunByProject = new Map(latestRuns.map(({ case_scope, case_results, ...execution }) => [execution.project_id,
    { execution, ...summarizeLatestRunCases(case_scope, case_results) }]));
  const requirementById = new Map(requirements.map((item) => [item.id, item]));
  const moduleById = new Map(modules.map((item) => [item.id, item]));
  const caseById = new Map(testCases.map((item) => [item.id, item]));
  const requirementsByCase = new Map();
  const modulesByCase = new Map();
  caseRequirements.forEach((link) => addToSetMap(requirementsByCase, link.test_case_id, link.requirement_id));
  caseModules.forEach((link) => addToSetMap(modulesByCase, link.test_case_id, link.module_id));
  const requirementIdsByBug = new Map();
  const caseIdsByBug = new Map();
  bugRequirements.forEach((link) => addToSetMap(requirementIdsByBug, link.bug_id, link.requirement_id));
  bugCases.forEach((link) => addToSetMap(caseIdsByBug, link.bug_id, link.test_case_id));

  const evidenceKeys = new Set();
  attachments.forEach((attachment) => {
    const mimeType = String(attachment.mime_type || "").toLowerCase();
    if (mimeType.startsWith("image/") || mimeType.startsWith("video/")) evidenceKeys.add(`${attachment.entity_type}:${attachment.entity_id}`);
  });
  comments.forEach((comment) => evidenceKeys.add(`${comment.entity_type}:${comment.entity_id}`));

  const weights = configuration["metric.project.portfolio_health"];
  const riskPassThreshold = configuration["metric.project.risky_classification"].pass_confidence_threshold;
  const readyThreshold = configuration["metric.project.release_ready"].readiness_threshold;
  const evidenceThreshold = configuration["metric.project.execution_evidence"].minimum_coverage_percent;
  const failureImpactLimit = Math.round(configuration["metric.project.execution_failures"].priority_impact_limit);
  const bugImpactLimit = Math.round(configuration["metric.project.bugs"].priority_impact_limit);
  const openBugThreshold = Math.round(configuration["metric.project.bugs"].open_bug_attention_threshold);
  const globalFailureModuleImpact = new Map();
  const globalFailureRequirementImpact = new Map();
  const globalBugModuleImpact = new Map();
  const globalBugRequirementImpact = new Map();

  const analyticsProjects = projects.map((project) => {
    const projectRequirements = requirementsByProject.get(project.id) || [];
    const projectModules = modulesByProject.get(project.id) || [];
    const projectCases = testCasesByProject.get(project.id) || [];
    const projectExecutions = (executionsByProject.get(project.id) || []).slice().sort((left, right) => timestamp(right.created_at) - timestamp(left.created_at));
    const projectResults = resultsByProject.get(project.id) || [];
    const projectBugs = bugsByProject.get(project.id) || [];
    const executionIdsWithFinalizedResults = new Set(projectResults
      .filter((result) => TERMINAL_RESULT_STATUSES.has(String(result.status || "").toLowerCase()))
      .map((result) => result.execution_id));
    const latestExecution = projectExecutions.find((execution) => executionIdsWithFinalizedResults.has(execution.id))
      || projectExecutions[0]
      || null;
    const latestExecutionResults = latestExecution
      ? projectResults.filter((result) => result.execution_id === latestExecution.id && TERMINAL_RESULT_STATUSES.has(String(result.status || "").toLowerCase()))
      : [];
    const latestResultByCase = new Map();
    projectResults.forEach((result) => {
      if (!TERMINAL_RESULT_STATUSES.has(String(result.status || "").toLowerCase())) return;
      const current = latestResultByCase.get(result.test_case_id);
      if (!current || timestamp(result.created_at) > timestamp(current.created_at)) latestResultByCase.set(result.test_case_id, result);
    });

    const coveredStories = projectRequirements.filter((requirement) => Boolean(requirement.is_covered)).length;
    const automatedCases = projectCases.filter((testCase) => testCase.automated === "yes").length;
    const latestFinalizedResults = [...latestResultByCase.values()];
    const passedCases = latestFinalizedResults.filter((result) => String(result.status).toLowerCase() === "passed").length;
    const resolvedBugs = projectBugs.filter((bug) => CLOSED_BUG_STATUSES.has(String(bug.status || "").trim().toLowerCase())).length;
    const storyCoverage = percent(coveredStories, projectRequirements.length);
    const automationCoverage = percent(automatedCases, projectCases.length);
    const passConfidenceMetric = calculatePassConfidence({
      passedCases,
      finalizedCases: latestFinalizedResults.length,
      resolvedBugs,
      totalBugs: projectBugs.length
    });
    const passConfidence = passConfidenceMetric.percent;
    const latestFailedResults = latestExecutionResults.filter((result) => String(result.status).toLowerCase() === "failed");
    const latestBlockedResults = latestExecutionResults.filter((result) => String(result.status).toLowerCase() === "blocked");
    const latestRunHasEvidence = latestExecution ? evidenceKeys.has(`execution:${latestExecution.id}`) : false;
    const evidencedLatestResults = latestExecutionResults.filter((result) => latestRunHasEvidence || evidenceKeys.has(`execution_result:${result.id}`)).length;
    const evidenceCoverage = percent(evidencedLatestResults, latestExecutionResults.length);
    const assessable = Boolean(projectRequirements.length || projectCases.length || projectBugs.length);
    const evidenceViolation = Boolean(evidenceThreshold > 0 && assessable && (latestExecutionResults.length === 0 || evidenceCoverage < evidenceThreshold));
    const openBugs = projectBugs.filter((bug) => !CLOSED_BUG_STATUSES.has(String(bug.status || "").trim().toLowerCase()));
    const openBugViolation = Boolean(openBugThreshold > 0 && openBugs.length >= openBugThreshold);
    const readinessScore = Math.max(0, Math.min(100, Math.round(
      (storyCoverage * weights.story_weight / 100)
      + (automationCoverage * weights.automation_weight / 100)
      + (passConfidence * weights.pass_weight / 100)
    )));
    const hardRisk = latestFailedResults.length > 0
      || latestBlockedResults.length > 0
      || (passConfidenceMetric.total > 0 && passConfidence < riskPassThreshold);
    const health = !assessable && !projectBugs.length
      ? { health_tone: "neutral", health_label: "New", readiness_label: "Not assessed" }
      : hardRisk
        ? { health_tone: "danger", health_label: "Risky", readiness_label: "Not Ready" }
        : readinessScore >= readyThreshold && !evidenceViolation && !openBugViolation
          ? { health_tone: "success", health_label: "Healthy", readiness_label: "Release Ready" }
          : { health_tone: "warning", health_label: "Watch", readiness_label: "Needs Review" };

    const failureModuleImpact = new Map();
    const failureRequirementImpact = new Map();
    latestFailedResults.forEach((result) => {
      (modulesByCase.get(result.test_case_id) || []).forEach((moduleId) => addToSetMap(failureModuleImpact, moduleId, result.test_case_id));
      (requirementsByCase.get(result.test_case_id) || []).forEach((requirementId) => addToSetMap(failureRequirementImpact, requirementId, result.test_case_id));
    });
    mergeSetMap(globalFailureModuleImpact, failureModuleImpact);
    mergeSetMap(globalFailureRequirementImpact, failureRequirementImpact);

    const bugModuleImpact = new Map();
    const bugRequirementImpact = new Map();
    projectBugs.forEach((bug) => {
      const linkedCaseIds = new Set([...(caseIdsByBug.get(bug.id) || []), ...normalizeArray(bug.linked_test_case_ids)]);
      const linkedModuleIds = new Set(normalizeArray(bug.linked_module_ids));
      const linkedRequirementIds = new Set([...(requirementIdsByBug.get(bug.id) || []), ...normalizeArray(bug.linked_requirement_ids)]);
      linkedCaseIds.forEach((caseId) => {
        (modulesByCase.get(caseId) || []).forEach((moduleId) => linkedModuleIds.add(moduleId));
        (requirementsByCase.get(caseId) || []).forEach((requirementId) => linkedRequirementIds.add(requirementId));
      });
      linkedModuleIds.forEach((moduleId) => addToSetMap(bugModuleImpact, moduleId, bug.id));
      linkedRequirementIds.forEach((requirementId) => addToSetMap(bugRequirementImpact, requirementId, bug.id));
    });
    mergeSetMap(globalBugModuleImpact, bugModuleImpact);
    mergeSetMap(globalBugRequirementImpact, bugRequirementImpact);

    const insight = hardRisk
      ? `${latestFailedResults.length} failed and ${latestBlockedResults.length} blocked latest outcomes need review.`
      : evidenceViolation
        ? `Latest execution evidence is ${evidenceCoverage}%, below the ${evidenceThreshold}% policy.`
        : openBugViolation
          ? `${openBugs.length} open Defects cross the configured attention threshold.`
          : automationCoverage < 40 && projectCases.length
            ? "Automation maturity is the strongest current readiness gap."
            : storyCoverage < 80 && projectRequirements.length
              ? "Story traceability is the strongest current readiness gap."
              : "Current evidence does not cross a configured attention threshold.";

    return {
      project_id: project.id,
      display_id: project.display_id || project.id,
      name: project.name,
      counts: {
        members: (membersByProject.get(project.id) || []).length,
        app_types: (appTypesByProject.get(project.id) || []).length,
        stories: projectRequirements.length,
        modules: projectModules.length,
        cases: projectCases.length,
        suites: suiteCountByProject.get(project.id) || 0,
        bugs: projectBugs.length,
        open_bugs: openBugs.length
      },
      members: (membersByProject.get(project.id) || []).map((member) => ({ user_id: member.user_id, name: member.name || "Unnamed member" })),
      app_types: appTypesByProject.get(project.id) || [],
      story_coverage: { total: projectRequirements.length, covered: coveredStories, percent: storyCoverage },
      automation_coverage: { total: projectCases.length, automated: automatedCases, percent: automationCoverage },
      pass_confidence: passConfidenceMetric,
      latest_run_pass_rate: latestRunByProject.get(project.id) || { execution: null, ...summarizeLatestRunCases() },
      execution_evidence: {
        total: latestExecutionResults.length,
        evidenced: evidencedLatestResults,
        missing: Math.max(0, latestExecutionResults.length - evidencedLatestResults),
        percent: evidenceCoverage,
        threshold: evidenceThreshold,
        violates: evidenceViolation
      },
      latest_execution: latestExecution,
      latest_failed_count: latestFailedResults.length,
      latest_blocked_count: latestBlockedResults.length,
      bug_count: projectBugs.length,
      open_bug_count: openBugs.length,
      failure_impacts: {
        modules: rankImpact(failureModuleImpact, moduleById, failureImpactLimit),
        requirements: rankImpact(failureRequirementImpact, requirementById, failureImpactLimit)
      },
      bug_impacts: {
        modules: rankImpact(bugModuleImpact, moduleById, bugImpactLimit),
        requirements: rankImpact(bugRequirementImpact, requirementById, bugImpactLimit)
      },
      readiness_score: readinessScore,
      ...health,
      attention_reasons: [
        ...(hardRisk ? ["Execution risk"] : []),
        ...(evidenceViolation ? ["Evidence policy"] : []),
        ...(openBugViolation ? ["Open Defects"] : []),
        ...(readinessScore < readyThreshold && assessable ? ["Readiness below threshold"] : [])
      ],
      insight
    };
  });

  const risky = analyticsProjects.filter((project) => project.health_tone === "danger");
  const watch = analyticsProjects.filter((project) => project.health_tone === "warning");
  const ready = analyticsProjects.filter((project) => project.health_tone === "success");
  const assessed = analyticsProjects.filter((project) => project.health_tone !== "neutral");
  const passAssessed = analyticsProjects.filter((project) => project.pass_confidence.total > 0);
  const average = (items, select) => items.length ? Math.round(items.reduce((sum, item) => sum + select(item), 0) / items.length) : 0;

  return {
    evaluated_at: new Date().toISOString(),
    configuration,
    summary: {
      total_projects: catalog.length,
      accessible_projects: analyticsProjects.length,
      locked_projects: catalog.length - analyticsProjects.length,
      risky_projects: risky.length,
      watch_projects: watch.length,
      release_ready_projects: ready.length,
      assessed_projects: assessed.length,
      attention_projects: risky.length + watch.length,
      overall_health: average(analyticsProjects, (project) => project.readiness_score),
      average_story_coverage: average(analyticsProjects, (project) => project.story_coverage.percent),
      average_automation_coverage: average(analyticsProjects, (project) => project.automation_coverage.percent),
      average_pass_confidence: average(passAssessed, (project) => project.pass_confidence.percent),
      total_stories: analyticsProjects.reduce((sum, project) => sum + project.story_coverage.total, 0),
      covered_stories: analyticsProjects.reduce((sum, project) => sum + project.story_coverage.covered, 0),
      total_cases: analyticsProjects.reduce((sum, project) => sum + project.automation_coverage.total, 0),
      automated_cases: analyticsProjects.reduce((sum, project) => sum + project.automation_coverage.automated, 0),
      evidence_missing_projects: analyticsProjects.filter((project) => project.execution_evidence.violates).length,
      execution_failure_cases: analyticsProjects.reduce((sum, project) => sum + project.latest_failed_count, 0),
      execution_blocked_cases: analyticsProjects.reduce((sum, project) => sum + project.latest_blocked_count, 0),
      bug_count: analyticsProjects.reduce((sum, project) => sum + project.bug_count, 0),
      open_bug_count: analyticsProjects.reduce((sum, project) => sum + project.open_bug_count, 0),
      failure_impacts: {
        modules: rankImpact(globalFailureModuleImpact, moduleById, failureImpactLimit),
        requirements: rankImpact(globalFailureRequirementImpact, requirementById, failureImpactLimit)
      },
      bug_impacts: {
        modules: rankImpact(globalBugModuleImpact, moduleById, bugImpactLimit),
        requirements: rankImpact(globalBugRequirementImpact, requirementById, bugImpactLimit)
      }
    },
    projects: analyticsProjects.sort((left, right) => {
      const rank = { danger: 0, warning: 1, success: 2, neutral: 3 };
      return rank[left.health_tone] - rank[right.health_tone] || left.readiness_score - right.readiness_score || left.name.localeCompare(right.name);
    })
  };
};

exports.DEFAULT_FORMULA_VALUES = DEFAULT_FORMULA_VALUES;
exports.calculatePassConfidence = calculatePassConfidence;
exports.normalizeFormulaValues = normalizeFormulaValues;
exports.buildPortfolioAnalytics = buildPortfolioAnalytics;
