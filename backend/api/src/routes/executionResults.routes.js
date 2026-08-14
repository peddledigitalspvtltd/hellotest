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

module.exports = async function (fastify) {

  fastify.get("/execution-results/release-readiness", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" }, release: { required: false, type: "string" }, sprint: { required: false, type: "string" }, run_limit: { required: false, type: "string" }, result_limit: { required: false, type: "string" } }, req.query || {});
    await projectService.getProject(req.query.project_id, req.user.id);
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
      external_references: { required: false, type: "array", items: "string" },
      defects: { required: false, type: "array", items: "string" },
      executed_by: { required: false, type: "string" }
    }, req.body);

    const execution = await executionService.getExecution(req.body.execution_id);
    await projectService.getProject(execution.project_id, req.user.id);
    return service.createExecutionResult({ ...req.body, executed_by: req.body.executed_by || req.user.id });
  });


  // GET RESULTS (FILTERABLE)
  fastify.get("/execution-results", async (req) => {
    await fastify.authenticate(req);

    const { execution_id, test_case_id, app_type_id } = req.query;

    if (execution_id) {
      const execution = await executionService.getExecution(execution_id);
      await projectService.getProject(execution.project_id, req.user.id);
    }
    return service.getExecutionResults({
      execution_id,
      test_case_id,
      app_type_id
    });
  });


  // GET SINGLE RESULT
  fastify.get("/execution-results/:id", async (req) => {
    await fastify.authenticate(req);
    return (await ensureResultAccess(req.params.id, req.user.id)).result;
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

    await ensureResultAccess(req.params.id, req.user.id);
    return service.updateExecutionResult(req.params.id, req.body);
  });

  fastify.put("/execution-results/:id/defect-links", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ step_id: { required: true, type: "string" }, defect_ids: { required: true, type: "array", items: "string", maxItems: 50 }, expected_revision: { required: false, type: "number" } }, req.body || {});
    const { execution } = await ensureResultAccess(req.params.id, req.user.id);
    await fastify.requirePermission("result.manage", { projectId: execution.project_id })(req);
    return service.linkStepDefects(req.params.id, req.body);
  });


  // DELETE RESULT
  fastify.delete("/execution-results/:id", async (req) => {
    await fastify.authenticate(req);
    await ensureResultAccess(req.params.id, req.user.id);
    return service.deleteExecutionResult(req.params.id);
  });

};
