const service = require("../services/executionResult.service");
const { EXECUTION_RESULT_STATUS_VALUES } = require("../domain/catalog");
const projectService = require("../services/project.service");
const executionService = require("../services/execution.service");
const db = require("../db");

const ensureResultAccess = async (id, userId) => {
  const result = await service.getExecutionResult(id);
  const execution = await executionService.getExecution(result.execution_id);
  await projectService.getProject(execution.project_id, userId);
  return { result, execution };
};

const ensureResultPermission = async (fastify, req, permissionCode, id = req.params.id) => {
  const scoped = await ensureResultAccess(id, req.user.id);
  await fastify.requirePermission(permissionCode, { projectId: scoped.execution.project_id })(req);
  return scoped;
};

module.exports = async function (fastify) {

  fastify.get("/execution-results/release-readiness", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" }, release: { required: false, type: "string" }, sprint: { required: false, type: "string" }, run_limit: { required: false, type: "string" }, result_limit: { required: false, type: "string" } }, req.query || {});
    await projectService.getProject(req.query.project_id, req.user.id);
    await fastify.requirePermission("result.view", { projectId: req.query.project_id })(req);
    const runLimit = Math.max(1, Math.min(500, Number.parseInt(String(req.query.run_limit || 100), 10) || 100));
    const resultLimit = Math.max(1, Math.min(5000, Number.parseInt(String(req.query.result_limit || 2000), 10) || 2000));
    const conditions = ["project_id = ?"];
    const params = [req.query.project_id];
    if (req.query.release) { conditions.push("(release = ? OR build = ?)"); params.push(req.query.release, req.query.release); }
    if (req.query.sprint) { conditions.push("sprint = ?"); params.push(req.query.sprint); }
    const executions = await db.prepare(`SELECT * FROM executions WHERE ${conditions.join(" AND ")} ORDER BY COALESCE(ended_at, started_at, created_at) DESC LIMIT ?`).all(...params, runLimit + 1);
    const boundedExecutions = executions.slice(0, runLimit);
    let results = [];
    if (boundedExecutions.length) {
      const ids = boundedExecutions.map((item) => item.id);
      results = await db.prepare(`SELECT * FROM execution_results WHERE execution_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at DESC LIMIT ?`).all(...ids, resultLimit + 1);
    }
    const reasons = [];
    if (executions.length > runLimit) reasons.push(`Run evidence exceeded the ${runLimit}-run limit.`);
    if (results.length > resultLimit) reasons.push(`Execution results exceeded the ${resultLimit}-result limit.`);
    return { executions: boundedExecutions, results: results.slice(0, resultLimit).map((item) => ({ ...item, defects: Array.isArray(item.defects) ? item.defects : [], external_references: Array.isArray(item.external_references) ? item.external_references : [] })), complete: reasons.length === 0, reasons, runs_scanned: boundedExecutions.length, results_scanned: Math.min(results.length, resultLimit), candidate_results: results.length, limits: { runs: runLimit, results: resultLimit, results_per_run: resultLimit } };
  });

  // CREATE RESULT
  fastify.post("/execution-results", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      execution_id: { required: true, type: "string" },
      test_case_id: { required: true, type: "string" },
      app_type_id: { required: true, type: "string" },
      status: { required: true, enum: EXECUTION_RESULT_STATUS_VALUES },
      duration_ms: { required: false, type: "number" },
      error: { required: false, type: "string" },
      logs: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      test_data_set_name: { required: false, type: "string" },
      data_set_iteration_index: { required: false, type: "number" },
      data_set_iteration_key: { required: false, type: "string" },
      data_set_row_snapshot: { required: false, type: "object" },
      external_references: { required: false, type: "array", items: "string" },
      defects: { required: false, type: "array", items: "string" },
      executed_by: { required: false, type: "string" }
    }, req.body);

    const execution = await executionService.getExecution(req.body.execution_id);
    await projectService.getProject(execution.project_id, req.user.id);
    await fastify.requirePermission("result.manage", { projectId: execution.project_id })(req);
    return service.createExecutionResult({ ...req.body, executed_by: req.body.executed_by || req.user.id });
  });


  // GET RESULTS (FILTERABLE)
  fastify.get("/execution-results", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: false, type: "string" },
      execution_id: { required: false, type: "string" },
      test_case_id: { required: false, type: "string" },
      app_type_id: { required: false, type: "string" },
      run_limit: { required: false, type: "string" },
      limit: { required: false, type: "string" }
    }, req.query || {});

    const { project_id, execution_id, test_case_id, app_type_id } = req.query;
    const accessibleProjectIds = new Set();

    if (project_id) {
      accessibleProjectIds.add(project_id);
    }

    if (execution_id) {
      const execution = await executionService.getExecution(execution_id);
      accessibleProjectIds.add(execution.project_id);
    }
    if (app_type_id) {
      const appType = await db.prepare("SELECT project_id FROM app_types WHERE id = ?").get(app_type_id);
      if (appType?.project_id) accessibleProjectIds.add(appType.project_id);
    }
    if (test_case_id) {
      const testCase = await db.prepare(`
        SELECT app_types.project_id
        FROM test_cases
        JOIN app_types ON app_types.id = test_cases.app_type_id
        WHERE test_cases.id = ?
      `).get(test_case_id);
      if (testCase?.project_id) accessibleProjectIds.add(testCase.project_id);
    }
    if (!accessibleProjectIds.size) {
      const error = new Error("A project, execution, app type, or test case scope is required");
      error.statusCode = 400;
      throw error;
    }
    await Promise.all(Array.from(accessibleProjectIds, (scopedProjectId) =>
      projectService.getProject(scopedProjectId, req.user.id)
    ));
    await Promise.all(Array.from(accessibleProjectIds, (scopedProjectId) =>
      fastify.requirePermission("result.view", { projectId: scopedProjectId })(req)
    ));

    const runLimit = req.query.run_limit
      ? Math.max(1, Math.min(500, Number.parseInt(String(req.query.run_limit), 10) || 1))
      : undefined;
    const limit = Math.max(1, Math.min(5000, Number.parseInt(String(req.query.limit || 5000), 10) || 5000));
    return service.getExecutionResults({
      project_id,
      execution_id,
      test_case_id,
      app_type_id,
      run_limit: runLimit,
      limit
    });
  });


  // GET SINGLE RESULT
  fastify.get("/execution-results/:id", async (req) => {
    await fastify.authenticate(req);
    return (await ensureResultPermission(fastify, req, "result.view")).result;
  });


  // UPDATE RESULT
  fastify.put("/execution-results/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      status: { required: false, enum: EXECUTION_RESULT_STATUS_VALUES },
      duration_ms: { required: false, type: "number" },
      error: { required: false, type: "string" },
      logs: { required: false, type: "string" },
      external_references: { required: false, type: "array", items: "string" },
      defects: { required: false, type: "array", items: "string" },
      expected_revision: { required: false, type: "number" }
    }, req.body);

    await ensureResultPermission(fastify, req, "result.manage");
    return service.updateExecutionResult(req.params.id, req.body);
  });

  fastify.put("/execution-results/:id/defect-links", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ step_id: { required: true, type: "string" }, defect_ids: { required: true, type: "array", items: "string", maxItems: 50 }, expected_revision: { required: false, type: "number" } }, req.body || {});
    await ensureResultPermission(fastify, req, "result.manage");
    return service.linkStepDefects(req.params.id, req.body);
  });


  // DELETE RESULT
  fastify.delete("/execution-results/:id", async (req) => {
    await fastify.authenticate(req);
    await ensureResultPermission(fastify, req, "result.manage");
    return service.deleteExecutionResult(req.params.id);
  });

};
