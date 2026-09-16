const service = require("../services/executionResult.service");
const lifecycleService = require("../services/executionCaseLifecycle.service");
const executionAttachments = require("../services/executionAttachment.service");
const { EXECUTION_RESULT_STATUS_VALUES } = require("../domain/catalog");
const projectService = require("../services/project.service");
const executionService = require("../services/execution.service");
const db = require("../db");
const { evidenceTime } = require("../services/qualityOverview.service");

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

  fastify.get("/execution-results/:id/attachments", async (req) => {
    await fastify.authenticate(req);
    const { execution } = await ensureResultPermission(fastify, req, "result.view");
    await fastify.requirePermission("attachment.view", { projectId: execution.project_id })(req);
    return executionAttachments.list({ user: req.user, resultId: req.params.id });
  });

  fastify.post("/execution-results/:id/attachments", async (req) => {
    await fastify.authenticate(req);
    const { execution } = await ensureResultPermission(fastify, req, "result.manage");
    await fastify.requirePermission("attachment.create", { projectId: execution.project_id })(req);
    const part = await req.file({ limits: { fileSize: executionAttachments.MAX_EVIDENCE_BYTES, files: 1 } });
    if (!part) throw Object.assign(new Error("Choose a file to upload."), { statusCode: 400 });
    const field = (name) => part.fields?.[name]?.value;
    const expectedRevision = field("expected_revision") === undefined ? undefined : Number(field("expected_revision"));
    if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) {
      part.file.resume();
      throw Object.assign(new Error("expected_revision must be a positive integer."), { statusCode: 400 });
    }
    try {
      return await executionAttachments.upload({ user: req.user, resultId: req.params.id, stepId: field("step_id"), expectedRevision,
        fileName: part.filename, mimeType: part.mimetype, stream: part.file });
    } catch (error) {
      part.file.resume();
      throw error;
    }
  });

  fastify.delete("/execution-results/:id/attachments/:attachmentId", async (req) => {
    await fastify.authenticate(req);
    const { execution } = await ensureResultPermission(fastify, req, "result.manage");
    await fastify.requirePermission("attachment.delete", { projectId: execution.project_id })(req);
    return executionAttachments.remove({ user: req.user, resultId: req.params.id, attachmentId: req.params.attachmentId });
  });

  for (const operation of ["ensure", "lifecycle"]) {
    fastify.post(`/execution-results/${operation}`, async (req) => {
      await fastify.authenticate(req);
      fastify.validate({
        execution_id: { required: true, type: "string" }, test_case_id: { required: true, type: "string" },
        data_set_iteration_index: { required: false, type: "number" }, data_set_iteration_key: { required: false, type: "string" },
        expected_revision: { required: false, type: "number" }, expected_result_id: { required: false, type: "string" },
        ...(operation === "lifecycle" ? { action: { required: true, enum: ["start", "resume", "pause", "abort", "block", "skip", "reset", "pass", "fail"] } } : {})
      }, req.body || {});
      const execution = await executionService.getExecution(req.body.execution_id);
      await projectService.getProject(execution.project_id, req.user.id);
      await fastify.requirePermission("result.manage", { projectId: execution.project_id })(req);
      if (operation === "lifecycle") await fastify.requirePermission("run.execute", { projectId: execution.project_id })(req);
      return operation === "ensure" ? lifecycleService.ensureExecutionCaseResult(req.body, req.user.id) : lifecycleService.transitionExecutionCase(req.body, req.user.id);
    });
  }

  fastify.get("/execution-results/release-readiness", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" }, release: { required: false, type: "string" }, sprint: { required: false, type: "string" }, run_limit: { required: false, type: "string" }, result_limit: { required: false, type: "string" } }, req.query || {});
    await projectService.getProject(req.query.project_id, req.user.id);
    await fastify.requirePermission("result.view", { projectId: req.query.project_id })(req);
    await fastify.requirePermission("run.view", { projectId: req.query.project_id })(req);
    const runLimit = Math.max(1, Math.min(500, Number.parseInt(String(req.query.run_limit || 100), 10) || 100));
    const resultLimit = Math.max(1, Math.min(5000, Number.parseInt(String(req.query.result_limit || 2000), 10) || 2000));
    const conditions = ["project_id = ?"];
    const params = [req.query.project_id];
    if (String(req.query.release || "").trim()) { conditions.push("LOWER(TRIM(COALESCE(release, ''))) = ?"); params.push(String(req.query.release).trim().toLowerCase()); }
    if (String(req.query.sprint || "").trim()) { conditions.push("LOWER(TRIM(COALESCE(sprint, ''))) = ?"); params.push(String(req.query.sprint).trim().toLowerCase()); }
    const executions = await db.prepare(`SELECT id, project_id, app_type_id, name, status, release, sprint, build,
      created_at, started_at, ended_at, start_date, end_date, direct_test_case_ids,
      test_environment_id, test_environment_name,
      test_environment_snapshot->>'id' AS saved_environment_id,
      test_environment_snapshot->>'name' AS saved_environment_name,
      test_configuration_id, test_configuration_name,
      test_configuration_snapshot->>'id' AS saved_configuration_id,
      test_configuration_snapshot->>'name' AS saved_configuration_name
      FROM executions WHERE ${conditions.join(" AND ")} ORDER BY COALESCE(ended_at, started_at, created_at) DESC, id DESC LIMIT ?`).all(...params, runLimit + 1);
    const boundedExecutions = executions.slice(0, runLimit);
    let results = [];
    let snapshots = [];
    if (boundedExecutions.length) {
      const ids = boundedExecutions.map((item) => item.id);
      [results, snapshots] = await Promise.all([
        db.prepare(`SELECT ranked.* FROM (
          SELECT id, execution_id, test_case_id, app_type_id, status, created_at, started_at, timer_started_at, ended_at,
            lifecycle_history->-1->>'at' AS lifecycle_updated_at, data_set_iteration_index, data_set_iteration_key, defects, external_references,
            ROW_NUMBER() OVER (PARTITION BY execution_id, test_case_id, COALESCE(data_set_iteration_index::text, data_set_iteration_key, 'default') ORDER BY created_at DESC, id DESC) AS attempt_rank
          FROM execution_results WHERE execution_id IN (${ids.map(() => "?").join(",")}) AND created_at <= CURRENT_TIMESTAMP
        ) ranked WHERE attempt_rank = 1 ORDER BY GREATEST(ended_at, timer_started_at, started_at, created_at) DESC, created_at DESC, id DESC LIMIT ?`).all(...ids, resultLimit + 1),
        db.prepare(`WITH frozen_cases AS (
          SELECT snapshot.execution_id, snapshot.test_case_id,
            CASE WHEN snapshot.test_data_set_snapshot IS NOT NULL OR snapshot.test_data_set_id IS NOT NULL
              THEN snapshot.test_data_set_snapshot ELSE executions.test_data_set_snapshot END AS data_snapshot
          FROM execution_case_snapshots snapshot JOIN executions ON executions.id = snapshot.execution_id
          WHERE snapshot.execution_id IN (${ids.map(() => "?").join(",")})
        ) SELECT execution_id, test_case_id,
          CASE WHEN data_snapshot->>'mode' = 'key_value' THEN 1
            WHEN jsonb_typeof(data_snapshot->'rows') = 'array' THEN GREATEST(1, jsonb_array_length(data_snapshot->'rows'))
            WHEN jsonb_typeof(data_snapshot->'template_rows') = 'array' THEN GREATEST(1, jsonb_array_length(data_snapshot->'template_rows'))
            ELSE 1 END AS expected_iterations FROM frozen_cases`).all(...ids)
      ]);
    }
    const reasons = [];
    if (executions.length > runLimit) reasons.push(`Run evidence exceeded the ${runLimit}-run limit.`);
    if (results.length > resultLimit) reasons.push(`Execution results exceeded the ${resultLimit}-result limit.`);
    const snapshotsByRun = new Map();
    for (const snapshot of snapshots) {
      if (!snapshotsByRun.has(snapshot.execution_id)) snapshotsByRun.set(snapshot.execution_id, []);
      snapshotsByRun.get(snapshot.execution_id).push({ test_case_id: snapshot.test_case_id, expected_iterations: Number(snapshot.expected_iterations) });
    }
    const contextualExecutions = boundedExecutions.map(execution => {
      const { saved_environment_id, saved_environment_name, saved_configuration_id, saved_configuration_name, ...record } = execution;
      const environmentName = record.test_environment_name || saved_environment_name;
      const configurationName = record.test_configuration_name || saved_configuration_name;
      // Read only the frozen labels. Live resources may have changed or been
      // deleted, and their variables/credentials do not belong in this summary.
      return {
        ...record,
        test_environment: environmentName ? { id: record.test_environment_id || saved_environment_id || null, name: environmentName, snapshot: null } : null,
        test_configuration: configurationName ? { id: record.test_configuration_id || saved_configuration_id || null, name: configurationName, snapshot: null } : null,
        case_snapshots: snapshotsByRun.get(execution.id) || []
      };
    });
    return { executions: contextualExecutions, results: results.slice(0, resultLimit).map((item) => ({ ...item, updated_at: evidenceTime(item), defects: Array.isArray(item.defects) ? item.defects : [], external_references: Array.isArray(item.external_references) ? item.external_references : [] })), complete: reasons.length === 0, reasons, runs_scanned: boundedExecutions.length, results_scanned: Math.min(results.length, resultLimit), candidate_results: results.length, candidate_runs: executions.length, evaluated_at: new Date().toISOString(), limits: { runs: runLimit, results: resultLimit, results_per_run: resultLimit } };
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
    if (req.body.status === "pending") {
      const result = await lifecycleService.ensureExecutionCaseResult(req.body, req.user.id);
      const saved = await service.updateExecutionResult(result.id, {
        error: req.body.error, logs: req.body.logs, external_references: req.body.external_references, defects: req.body.defects,
        require_explicit_start: true, actor_id: req.user.id
      });
      return { id: result.id, revision: saved.revision };
    }
    return service.createExecutionResult({ ...req.body, executed_by: req.body.executed_by || req.user.id, require_explicit_start: true });
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
      projection: { required: false, enum: ["summary", "detail"] },
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
      projection: req.query.projection,
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
    return service.updateExecutionResult(req.params.id, { ...req.body, require_explicit_start: true, actor_id: req.user.id });
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
