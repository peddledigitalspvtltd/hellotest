const service = require("../services/requirementIteration.service");
const projectService = require("../services/project.service");
const db = require("../db");

const HEALTH_LIMITS = Object.freeze({
  sprints: 100,
  stories_per_sprint: 5000,
  linked_cases: 5000,
  runs: 5000,
  execution_results: 10000,
  bugs: 5000
});

const healthMethodology = {
  scope_population: { definition: "Stories assigned to the selected HelloTest iteration.", completeness_boundary: "All records in the HelloTest PostgreSQL workspace are evaluated." },
  counting_units: { linked_cases: "Distinct linked test cases.", bugs: "Distinct defects linked to in-scope stories." },
  completed_percent: { numerator: "Stories whose status reached QA Done or Done.", denominator: "All in-scope stories.", zero_denominator: null },
  coverage_percent: { numerator: "Stories with at least one linked test case.", denominator: "All in-scope stories.", zero_denominator: null, covered_definition: "At least one requirement-test-case mapping exists." },
  pass_percent: { numerator: "Linked cases whose latest recorded result passed.", denominator: "Linked cases with a recorded result.", zero_denominator: null, execution_definition: "Latest execution result per linked case." },
  defect_density: { numerator: "Open linked defects.", denominator: "All in-scope stories.", zero_denominator: null, bug_definition: "A linked HelloTest issue whose status is not closed." },
  at_risk_stories: { denominator: "All in-scope stories.", definition: "Blocked stories, priority 1-2 Stories without test coverage, or Stories that missed a Dev/QA target before reaching the corresponding Done stage." },
  slippage_stories: { denominator: "All in-scope stories.", definition: "Distinct Stories past Dev target without Dev Done, or past QA target without QA Done." },
  on_course_stories: { denominator: "All in-scope stories.", definition: "Stories that are complete or have not missed a Dev/QA target." },
  bounded_evidence: { exact_rule: "Values are exact while the configured workspace limits are not exceeded.", partial_rule: "A field becomes partial when its source population exceeds the disclosed limit." }
};

const buildIterationHealth = async (iteration, sourceRequirements) => {
  const storiesPartial = sourceRequirements.length > HEALTH_LIMITS.stories_per_sprint;
  const requirements = sourceRequirements.slice(0, HEALTH_LIMITS.stories_per_sprint);
  const requirementIds = requirements.map((item) => item.id);
  const placeholders = requirementIds.map(() => "?").join(",");
  const linkedRows = requirementIds.length ? await db.prepare(`
    SELECT requirement_test_cases.requirement_id, requirement_test_cases.test_case_id
    FROM requirement_test_cases
    WHERE requirement_test_cases.requirement_id IN (${placeholders})
    ORDER BY requirement_test_cases.requirement_id, requirement_test_cases.test_case_id
    LIMIT ?
  `).all(...requirementIds, HEALTH_LIMITS.linked_cases + 1) : [];
  const linksPartial = linkedRows.length > HEALTH_LIMITS.linked_cases;
  const boundedLinkedRows = linkedRows.slice(0, HEALTH_LIMITS.linked_cases);
  const linkedCaseIds = [...new Set(boundedLinkedRows.map((item) => item.test_case_id))];
  const casePlaceholders = linkedCaseIds.map(() => "?").join(",");
  const latestResults = linkedCaseIds.length ? await db.prepare(`
    SELECT DISTINCT ON (execution_results.test_case_id) execution_results.test_case_id, execution_results.status
    FROM execution_results
    JOIN executions ON executions.id = execution_results.execution_id
    WHERE execution_results.test_case_id IN (${casePlaceholders})
      AND executions.project_id = ?
    ORDER BY execution_results.test_case_id, execution_results.created_at DESC, execution_results.id DESC
  `).all(...linkedCaseIds, iteration.project_id) : [];
  const bugs = requirementIds.length ? await db.prepare(`
    SELECT DISTINCT feedback.id, feedback.status, feedback.priority, feedback.severity
    FROM requirement_defects
    JOIN feedback ON feedback.id = requirement_defects.issue_id
    WHERE requirement_defects.requirement_id IN (${placeholders})
    ORDER BY feedback.id
    LIMIT ?
  `).all(...requirementIds, HEALTH_LIMITS.bugs + 1) : [];
  const bugsPartial = bugs.length > HEALTH_LIMITS.bugs;
  const boundedBugs = bugs.slice(0, HEALTH_LIMITS.bugs);
  const coveredIds = new Set(boundedLinkedRows.map((item) => item.requirement_id));
  const statusRank = (value) => ({
    open: 0, in_progress: 2, ready: 4, blocked: 2, dev_ready: 1, dev_in_progress: 2, dev_blocked: 2, dev_done: 3,
    qa_ready: 4, qa_in_progress: 5, qa_blocked: 5, qa_done: 6, done: 7
  }[String(value || "").trim().toLowerCase()] ?? 0);
  const hasMissedTarget = (item) => {
    const now = Date.now();
    const devMissed = item.dev_completion_target_date
      && Date.parse(item.dev_completion_target_date) < now
      && statusRank(item.status) < statusRank("dev_done");
    const qaMissed = item.qa_completion_target_date
      && Date.parse(item.qa_completion_target_date) < now
      && statusRank(item.status) < statusRank("qa_done");
    return Boolean(devMissed || qaMissed);
  };
  const completed = requirements.filter((item) => statusRank(item.status) >= statusRank("qa_done")).length;
  const passed = latestResults.filter((item) => item.status === "passed").length;
  const slipped = requirements.filter(hasMissedTarget).length;
  const atRisk = requirements.filter((item) => String(item.status || "").toLowerCase().includes("blocked") || hasMissedTarget(item) || (Number(item.priority || 5) <= 2 && !coveredIds.has(item.id))).length;
  const openPriorityBugs = boundedBugs.filter((item) => item.status !== "closed" && (["highest", "high"].includes(String(item.priority || "").toLowerCase()) || ["critical", "high"].includes(String(item.severity || "").toLowerCase()))).length;
  const partialReasons = [
    storiesPartial ? `Story scan exceeded ${HEALTH_LIMITS.stories_per_sprint} records.` : "",
    linksPartial ? `Traceability scan exceeded ${HEALTH_LIMITS.linked_cases} links.` : "",
    bugsPartial ? `Bug scan exceeded ${HEALTH_LIMITS.bugs} records.` : ""
  ].filter(Boolean);
  const partial = partialReasons.length > 0;
  const exactFields = partial ? [] : ["total_stories", "completed_stories", "completed_percent", "covered_stories", "coverage_percent", "linked_cases", "executed_linked_cases", "passed_cases", "pass_percent", "at_risk_stories", "slippage_stories", "on_course_stories", "open_p1_p2_bugs", "total_bugs"];
  const percent = (numerator, denominator) => denominator ? Math.round((numerator / denominator) * 1000) / 10 : null;
  return {
    iteration_id: iteration.id,
    jira_sprint_id: iteration.jira_sprint_id || null,
    name: iteration.name,
    state: iteration.state || null,
    total_stories: requirements.length,
    completed_stories: completed,
    completed_percent: percent(completed, requirements.length),
    covered_stories: coveredIds.size,
    coverage_percent: percent(coveredIds.size, requirements.length),
    linked_cases: linkedCaseIds.length,
    executed_linked_cases: latestResults.length,
    passed_cases: passed,
    pass_percent: percent(passed, latestResults.length),
    at_risk_stories: atRisk,
    slippage_stories: slipped,
    on_course_stories: Math.max(requirements.length - slipped, 0),
    open_p1_p2_bugs: openPriorityBugs,
    total_bugs: boundedBugs.length,
    observed: { stories_scanned: requirements.length, completed_stories: completed, covered_stories: coveredIds.size, linked_cases: linkedCaseIds.length, executed_linked_cases: latestResults.length, passed_cases: passed, at_risk_stories: atRisk, slippage_stories: slipped, on_course_stories: Math.max(requirements.length - slipped, 0), open_p1_p2_bugs: openPriorityBugs, total_bugs: boundedBugs.length },
    exact_fields: exactFields,
    completeness: {
      complete: !partial, partial, reasons: partialReasons, exact_fields: exactFields,
      stories: { state: storiesPartial ? "partial" : "complete", scanned: requirements.length, limit: HEALTH_LIMITS.stories_per_sprint },
      executions: { state: linksPartial ? "partial" : linkedCaseIds.length ? "complete" : "not_needed", linked_cases_scoped: linkedCaseIds.length, runs_scanned: latestResults.length, results_scanned: latestResults.length, case_limit: HEALTH_LIMITS.linked_cases, run_limit: HEALTH_LIMITS.runs, result_limit: HEALTH_LIMITS.execution_results },
      bugs: { state: bugsPartial ? "partial" : requirementIds.length ? "complete" : "not_needed", bugs_scanned: boundedBugs.length, limit: HEALTH_LIMITS.bugs }
    }
  };
};

const ensureProjectAccess = async (projectId, userId) => {
  if (!projectId) {
    return null;
  }

  return projectService.getProject(projectId, userId);
};

const ensureIterationAccess = async (iterationId, userId) => {
  const iteration = await service.getIterationSummary(iterationId);
  await ensureProjectAccess(iteration.project_id, userId);
  return iteration;
};

const ensureIterationPermission = async (fastify, req, permissionCode) => {
  const iteration = await ensureIterationAccess(req.params.id, req.user.id);
  await fastify.requirePermission(permissionCode, { projectId: iteration.project_id })(req);
  return iteration;
};

module.exports = async function (fastify) {
  fastify.get("/requirement-iterations/health", async (req) => {
    await fastify.authenticate(req);
    if (req.query.project_id) {
      await ensureProjectAccess(req.query.project_id, req.user.id);
      await fastify.requirePermission("requirement_iteration.view", { projectId: req.query.project_id })(req);
    } else if (req.user.role !== "admin") {
      const error = new Error("project_id is required when reading Sprint health");
      error.statusCode = 400;
      throw error;
    }
    const requestedIds = String(req.query.sprint_ids || "").split(",").map((value) => value.trim()).filter(Boolean);
    const iterations = await service.listIterations({ project_id: req.query.project_id });
    const matched = requestedIds.length ? iterations.filter((iteration) => requestedIds.includes(iteration.id)) : iterations;
    const selected = matched.slice(0, HEALTH_LIMITS.sprints);
    const items = await Promise.all(selected.map(async (iteration) => buildIterationHealth(
      iteration,
      await service.listRequirements(iteration.id, { limit: HEALTH_LIMITS.stories_per_sprint + 1 })
    )));
    let backlog = null;
    if (req.query.include_backlog === "true" && req.query.project_id) {
      const backlogRequirements = await db.prepare(`SELECT * FROM requirements WHERE project_id = ? AND iteration_id IS NULL ORDER BY created_at DESC LIMIT ?`).all(req.query.project_id, HEALTH_LIMITS.stories_per_sprint + 1);
      backlog = await buildIterationHealth({ id: "backlog", project_id: req.query.project_id, name: "Backlog", state: null }, backlogRequirements);
    }
    const foundIds = new Set(selected.map((item) => item.id));
    const skippedIds = requestedIds.filter((id) => !foundIds.has(id));
    const responseReasons = [
      matched.length > HEALTH_LIMITS.sprints ? `Sprint scan exceeded ${HEALTH_LIMITS.sprints} records.` : "",
      ...items.flatMap((item) => item.completeness.reasons),
      ...(backlog?.completeness?.reasons || [])
    ].filter(Boolean);
    const partial = responseReasons.length > 0;
    return {
      items,
      backlog,
      partial,
      requested_ids: requestedIds,
      skipped_ids: skippedIds,
      unavailable_ids: skippedIds,
      generated_at: new Date().toISOString(),
      completeness: { complete: !partial, partial, reasons: responseReasons },
      metric_methodology: healthMethodology,
      limits: HEALTH_LIMITS
    };
  });
  fastify.get("/requirement-iterations", async (req) => {
    await fastify.authenticate(req);
    const { project_id } = req.query;

    if (project_id) {
      await ensureProjectAccess(project_id, req.user.id);
      await fastify.requirePermission("requirement_iteration.view", { projectId: project_id })(req);
    } else if (req.user.role !== "admin") {
      const error = new Error("project_id is required when listing Sprints");
      error.statusCode = 400;
      throw error;
    }

    return service.listIterations({ project_id });
  });

  fastify.post("/requirement-iterations", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string" },
      name: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      goal: { required: false, type: "string" },
      labels: { required: false, type: "array", items: "string" },
      external_references: { required: false, type: "array", items: "string" },
      state: { required: false, type: "string", enum: ["future", "active", "closed"] },
      start_date: { required: false, type: "string" },
      end_date: { required: false, type: "string" },
      assignee_id: { required: false, type: "string" },
      effort_points: { required: false, type: "number" },
      original_dev_id: { required: false, type: "string" },
      original_qa_id: { required: false, type: "string" },
      requirement_ids: { required: false, type: "array", items: "string" }
    }, req.body || {});

    await ensureProjectAccess(req.body.project_id, req.user.id);
    await fastify.requirePermission("requirement_iteration.create", { projectId: req.body.project_id })(req);
    if (req.body.requirement_ids?.length) {
      await fastify.requirePermission("requirement_iteration.update", { projectId: req.body.project_id })(req);
    }

    return service.createIteration({
      ...req.body,
      created_by: req.user.id
    });
  });

  fastify.get("/requirement-iterations/:id", async (req) => {
    await fastify.authenticate(req);
    return ensureIterationPermission(fastify, req, "requirement_iteration.view");
  });

  fastify.put("/requirement-iterations/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      name: { required: false, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      goal: { required: false, type: "string" },
      labels: { required: false, type: "array", items: "string" },
      external_references: { required: false, type: "array", items: "string" },
      state: { required: false, type: "string", enum: ["future", "active", "closed"] },
      start_date: { required: false, type: "string" },
      end_date: { required: false, type: "string" },
      assignee_id: { required: false, type: "string" },
      effort_points: { required: false, type: "number" },
      original_dev_id: { required: false, type: "string" },
      original_qa_id: { required: false, type: "string" },
      requirement_ids: { required: false, type: "array", items: "string" }
    }, req.body || {});

    await ensureIterationPermission(fastify, req, "requirement_iteration.update");

    return service.updateIteration(req.params.id, {
      ...req.body,
      updated_by: req.user.id
    });
  });

  fastify.post("/requirement-iterations/:id/requirements", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      requirement_ids: { required: true, type: "array", items: "string" },
      append: { required: false, type: "boolean" }
    }, req.body || {});

    await ensureIterationPermission(fastify, req, "requirement_iteration.update");

    return service.assignRequirements(req.params.id, req.body.requirement_ids, {
      append: req.body.append !== false
    });
  });

  fastify.get("/requirement-iterations/:id/requirements", async (req) => {
    await fastify.authenticate(req);
    const iteration = await ensureIterationPermission(fastify, req, "requirement_iteration.view");
    if (req.query.include_execution === "true") {
      await fastify.requirePermission("run.view", { projectId: iteration.project_id })(req);
      await fastify.requirePermission("result.view", { projectId: iteration.project_id })(req);
    }
    return require("../services/requirement.service").getRequirementsPage({ ...req.query, project_id: iteration.project_id, sprint_id: req.params.id });
  });

  fastify.put("/requirement-iterations/:id/requirements", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      requirement_ids: { required: true, type: "array", items: "string" },
      append: { required: false, type: "boolean" }
    }, req.body || {});
    const iteration = await ensureIterationPermission(fastify, req, "requirement_iteration.update");
    const result = await service.assignRequirements(req.params.id, req.body.requirement_ids, {
      append: req.body.append !== false
    });
    return {
      ...result,
      sprint: result.sprint || { id: iteration.id, name: iteration.name, state: iteration.state }
    };
  });

  fastify.delete("/requirement-iterations/:id/requirements", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      requirement_ids: { required: true, type: "array", items: "string" }
    }, req.body || {});

    await ensureIterationPermission(fastify, req, "requirement_iteration.update");
    return service.removeRequirements(req.params.id, req.body.requirement_ids);
  });

  fastify.delete("/requirement-iterations/:id", async (req) => {
    await fastify.authenticate(req);
    await ensureIterationPermission(fastify, req, "requirement_iteration.delete");
    return service.deleteIteration(req.params.id);
  });
};
