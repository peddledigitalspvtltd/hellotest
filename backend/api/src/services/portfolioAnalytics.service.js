const db = require("../db");
const projectService = require("./project.service");
const settingsService = require("./settings.service");

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
const timestamp = (value) => {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
};
const groupBy = (items, key) => items.reduce((map, item) => {
  const value = item[key];
  if (!value) return map;
  map.set(value, [...(map.get(value) || []), item]);
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

const buildPortfolioAnalytics = async (userId) => {
  const [catalog, preferences] = await Promise.all([
    projectService.getProjectCatalog(userId),
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
  const [appTypes, members, requirements, modules, testCases, caseRequirements, caseModules, executions, results, attachments, comments, bugs, bugRequirements, bugCases] = await Promise.all([
    db.prepare(`SELECT id, project_id, name, type, is_unified FROM app_types WHERE project_id IN (${placeholders})`).all(...projectIds),
    db.prepare(`SELECT project_members.project_id, project_members.user_id, users.name FROM project_members LEFT JOIN users ON users.id = project_members.user_id WHERE project_members.project_id IN (${placeholders})`).all(...projectIds),
    db.prepare(`SELECT requirements.id, requirements.project_id, requirements.display_id, requirements.title, EXISTS (SELECT 1 FROM requirement_test_cases WHERE requirement_test_cases.requirement_id = requirements.id) AS is_covered FROM requirements WHERE requirements.project_id IN (${placeholders})`).all(...projectIds),
    db.prepare(`SELECT test_case_modules.id, test_case_modules.name, app_types.project_id FROM test_case_modules JOIN app_types ON app_types.id = test_case_modules.app_type_id WHERE app_types.project_id IN (${placeholders})`).all(...projectIds),
    db.prepare(`SELECT test_cases.id, test_cases.title, test_cases.automated, test_cases.automation_status, app_types.project_id FROM test_cases JOIN app_types ON app_types.id = test_cases.app_type_id WHERE app_types.project_id IN (${placeholders})`).all(...projectIds),
    db.prepare(`SELECT requirement_test_cases.test_case_id, requirement_test_cases.requirement_id FROM requirement_test_cases JOIN requirements ON requirements.id = requirement_test_cases.requirement_id WHERE requirements.project_id IN (${placeholders})`).all(...projectIds),
    db.prepare(`SELECT test_case_module_cases.test_case_id, test_case_module_cases.module_id FROM test_case_module_cases JOIN test_case_modules ON test_case_modules.id = test_case_module_cases.module_id JOIN app_types ON app_types.id = test_case_modules.app_type_id WHERE app_types.project_id IN (${placeholders})`).all(...projectIds),
    db.prepare(`SELECT * FROM executions WHERE project_id IN (${placeholders}) ORDER BY created_at DESC`).all(...projectIds),
    db.prepare(`SELECT execution_results.*, executions.project_id FROM execution_results JOIN executions ON executions.id = execution_results.execution_id WHERE executions.project_id IN (${placeholders}) ORDER BY execution_results.created_at DESC`).all(...projectIds),
    db.prepare(`SELECT project_id, entity_type, entity_id, mime_type FROM attachments WHERE project_id IN (${placeholders}) AND entity_type IN ('execution', 'execution_result')`).all(...projectIds),
    db.prepare(`SELECT project_id, entity_type, entity_id FROM entity_comments WHERE project_id IN (${placeholders}) AND entity_type IN ('execution', 'execution_result') AND BTRIM(body) <> ''`).all(...projectIds),
    db.prepare(`SELECT id, project_id, display_id, title, status, severity, priority, linked_test_case_ids, linked_module_ids, linked_requirement_ids FROM feedback WHERE project_id IN (${placeholders})`).all(...projectIds),
    db.prepare(`SELECT requirement_defects.issue_id AS bug_id, requirement_defects.requirement_id FROM requirement_defects JOIN requirements ON requirements.id = requirement_defects.requirement_id WHERE requirements.project_id IN (${placeholders})`).all(...projectIds),
    db.prepare(`SELECT test_case_defects.issue_id AS bug_id, test_case_defects.test_case_id FROM test_case_defects JOIN test_cases ON test_cases.id = test_case_defects.test_case_id JOIN app_types ON app_types.id = test_cases.app_type_id WHERE app_types.project_id IN (${placeholders})`).all(...projectIds)
  ]);

  const appTypesByProject = groupBy(appTypes, "project_id");
  const membersByProject = groupBy(members, "project_id");
  const requirementsByProject = groupBy(requirements, "project_id");
  const modulesByProject = groupBy(modules, "project_id");
  const testCasesByProject = groupBy(testCases, "project_id");
  const executionsByProject = groupBy(executions, "project_id");
  const resultsByProject = groupBy(results, "project_id");
  const bugsByProject = groupBy(bugs, "project_id");
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
    const storyCoverage = percent(coveredStories, projectRequirements.length);
    const automationCoverage = percent(automatedCases, projectCases.length);
    const passConfidence = percent(passedCases, latestFinalizedResults.length);
    const latestFailedResults = latestExecutionResults.filter((result) => String(result.status).toLowerCase() === "failed");
    const latestBlockedResults = latestExecutionResults.filter((result) => String(result.status).toLowerCase() === "blocked");
    const latestRunHasEvidence = latestExecution ? evidenceKeys.has(`execution:${latestExecution.id}`) : false;
    const evidencedLatestResults = latestExecutionResults.filter((result) => latestRunHasEvidence || evidenceKeys.has(`execution_result:${result.id}`)).length;
    const evidenceCoverage = percent(evidencedLatestResults, latestExecutionResults.length);
    const assessable = Boolean(projectRequirements.length || projectCases.length);
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
      || (latestFinalizedResults.length > 0 && passConfidence < riskPassThreshold);
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
          ? `${openBugs.length} open Bugs cross the configured attention threshold.`
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
        bugs: projectBugs.length,
        open_bugs: openBugs.length
      },
      members: (membersByProject.get(project.id) || []).map((member) => ({ user_id: member.user_id, name: member.name || "Unnamed member" })),
      app_types: appTypesByProject.get(project.id) || [],
      story_coverage: { total: projectRequirements.length, covered: coveredStories, percent: storyCoverage },
      automation_coverage: { total: projectCases.length, automated: automatedCases, percent: automationCoverage },
      pass_confidence: { total: latestFinalizedResults.length, passed: passedCases, percent: passConfidence },
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
        ...(openBugViolation ? ["Open Bugs"] : []),
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
exports.normalizeFormulaValues = normalizeFormulaValues;
exports.buildPortfolioAnalytics = buildPortfolioAnalytics;
