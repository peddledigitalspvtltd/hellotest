const service = require("../services/execution.service");
const executionPlanningService = require("../services/executionPlanning.service");
const executionAiAnalysisService = require("../services/executionAiAnalysis.service");
const executionReportService = require("../services/executionReport.service");
const workspaceTransactionService = require("../services/workspaceTransaction.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");
const featureFlagService = require("../services/featureFlag.service");
const { EXECUTION_FINAL_STATUS_VALUES } = require("../domain/catalog");
const db = require("../db");
const { normalizeStoredReferenceList } = require("../utils/externalReferences");

const createAccessError = (message, statusCode = 403) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeExecutionMode = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "local" || normalized === "remote" ? normalized : "manual";
};

const resolveExecutionModePermission = (mode, manualPermission) => {
  const normalizedMode = normalizeExecutionMode(mode);
  if (normalizedMode === "local") return "automation.run.local";
  if (normalizedMode === "remote") return "automation.run.remote";
  return manualPermission;
};

const requireFeaturePermission = async (fastify, req, permissionCode) => {
  await fastify.requirePermission(permissionCode)(req);
  const featureKeys = featureFlagService.getFeatureKeysForPermission(permissionCode);

  if (featureKeys.length && !await featureFlagService.areEnabled(featureKeys, { user: req.user })) {
    throw createAccessError("This feature is disabled for the workspace.");
  }
};

module.exports = async function (fastify) {

  fastify.get("/executions/history", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" }, app_type_id: { required: false, type: "string" }, requirement_id: { required: false, type: "string" }, test_case_id: { required: false, type: "string" }, page_size: { required: false, type: "string" } }, req.query || {});
    await projectService.getProject(req.query.project_id, req.user.id);
    const conditions = ["executions.project_id = ?"];
    const params = [req.query.project_id];
    if (req.query.app_type_id) { conditions.push("execution_results.app_type_id = ?"); params.push(req.query.app_type_id); }
    if (req.query.test_case_id) { conditions.push("execution_results.test_case_id = ?"); params.push(req.query.test_case_id); }
    if (req.query.requirement_id) { conditions.push("EXISTS (SELECT 1 FROM requirement_test_cases WHERE requirement_test_cases.requirement_id = ? AND requirement_test_cases.test_case_id = execution_results.test_case_id)"); params.push(req.query.requirement_id); }
    const limit = Math.max(1, Math.min(200, Number.parseInt(String(req.query.page_size || 50), 10) || 50));
    const rows = await db.prepare(`
      SELECT execution_results.id, executions.id AS execution_id, executions.display_id AS execution_display_id,
             executions.name AS execution_name, executions.status AS execution_status, executions.trigger,
             executions.suite_ids, execution_results.test_case_id,
             COALESCE(execution_results.test_case_title, test_cases.title) AS test_case_title,
             execution_results.status AS result_status, execution_results.defects, execution_results.created_at AS result_created_at,
             executions.started_at, executions.ended_at, executions.release, executions.sprint, executions.build
      FROM execution_results
      JOIN executions ON executions.id = execution_results.execution_id
      LEFT JOIN test_cases ON test_cases.id = execution_results.test_case_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY execution_results.created_at DESC, execution_results.id DESC
      LIMIT ?
    `).all(...params, limit);
    return rows.map((row) => ({ ...row, defects: normalizeStoredReferenceList(row.defects), suite_ids: normalizeStoredReferenceList(row.suite_ids) }));
  });

  fastify.post("/executions/smart-plan-preview", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string", maxLength: 255 },
      app_type_id: { required: true, type: "string", maxLength: 255 },
      integration_id: { required: false, type: "string", maxLength: 255 },
      release: { required: false, type: "string", maxLength: 255 },
      sprint: { required: false, type: "string", maxLength: 255 },
      build: { required: false, type: "string", maxLength: 255 },
      scope_description: { required: false, type: "string", maxLength: 4_000 },
      release_scope: { required: false, type: "string", maxLength: 4_000 },
      additional_context: { required: false, type: "string", maxLength: 4_000 },
      prompt_guidance: { required: false, type: "string", maxLength: 4_000 },
      impacted_requirement_ids: { required: false, type: "array", items: "string", maxItems: 100 },
      test_environment_id: { required: false, type: "string", maxLength: 255 },
      test_configuration_id: { required: false, type: "string", maxLength: 255 },
      test_data_set_id: { required: false, type: "string", maxLength: 255 }
    }, req.body);

    await requireFeaturePermission(fastify, req, "run.ai");
    await projectService.getProject(req.body.project_id, req.user.id);
    const appType = await appTypeService.getAppType(req.body.app_type_id);

    if (appType.project_id !== req.body.project_id) {
      throw new Error("App type must belong to the selected project");
    }

    return executionPlanningService.previewSmartExecution({
      project_id: req.body.project_id,
      appType,
      integration_id: req.body.integration_id,
      user_id: req.user.id,
      release: req.body.release,
      sprint: req.body.sprint,
      build: req.body.build,
      scope_description: req.body.scope_description,
      release_scope: req.body.release_scope,
      additional_context: req.body.additional_context,
      prompt_guidance: req.body.prompt_guidance,
      impacted_requirement_ids: req.body.impacted_requirement_ids,
      test_environment_id: req.body.test_environment_id,
      test_configuration_id: req.body.test_configuration_id,
      test_data_set_id: req.body.test_data_set_id
    });
  });

  fastify.post("/executions/manual-run-suggestion", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string" },
      app_type_id: { required: true, type: "string" },
      selected_suite_ids: { required: false, type: "array", items: "string" },
      test_environment_id: { required: false, type: "string" },
      test_configuration_id: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      additional_context: { required: false, type: "string" },
      integration_id: { required: false, type: "string" }
    }, req.body);

    await projectService.getProject(req.body.project_id, req.user.id);
    const appType = await appTypeService.getAppType(req.body.app_type_id);

    if (appType.project_id !== req.body.project_id) {
      throw new Error("App type must belong to the selected project");
    }

    return executionPlanningService.suggestManualExecutionSetup({
      project_id: req.body.project_id,
      appType,
      selected_suite_ids: req.body.selected_suite_ids || [],
      test_environment_id: req.body.test_environment_id,
      test_configuration_id: req.body.test_configuration_id,
      test_data_set_id: req.body.test_data_set_id,
      additional_context: req.body.additional_context,
      integration_id: req.body.integration_id
    });
  });

  // CREATE EXECUTION
  fastify.post("/executions", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string" },
      app_type_id: { required: false, type: "string" },
      suite_ids: { required: false, type: "array", items: "string" },
      test_case_ids: { required: false, type: "array", items: "string" },
      test_environment_id: { required: false, type: "string" },
      test_configuration_id: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      execution_hooks: { required: false, type: "array" },
      parallel_enabled: { required: false, type: "boolean" },
      parallel_count: { required: false, type: "number" },
      execution_mode: { required: false, type: "string" },
      engine_base_url: { required: false, type: "string" },
      assigned_to: { required: false, type: "string" },
      assigned_to_ids: { required: false, type: "array", items: "string" },
      release: { required: false, type: "string" },
      sprint: { required: false, type: "string" },
      build: { required: false, type: "string" },
      name: { required: false, type: "string" },
      scope_source: { required: false, type: "string", enum: ["smart-run"] },
      smart_plan: { required: false, type: "object" },
      created_by: { required: true, type: "string" }
    }, req.body);

    await requireFeaturePermission(
      fastify,
      req,
      resolveExecutionModePermission(req.body.execution_mode, "run.create")
    );

    if (req.body.parallel_enabled || Number(req.body.parallel_count || 1) > 1) {
      await requireFeaturePermission(fastify, req, "automation.run.parallel");
    }

    let verifiedSmartPlan = null;
    let smartRunTransaction = null;

    if (req.body.smart_plan && req.body.scope_source !== "smart-run") {
      throw createAccessError("smart_plan is only valid when scope_source is smart-run.", 400);
    }

    if (req.body.scope_source === "smart-run") {
      if (!req.body.app_type_id) {
        throw createAccessError("app_type_id is required for Smart Run creation.", 400);
      }
      await requireFeaturePermission(fastify, req, "run.ai");
      fastify.validate({
        acceptance_token: { required: true, type: "string", maxLength: 10_000 },
        request_id: { required: true, type: "string", maxLength: 255 },
        input_fingerprint: { required: true, type: "string", maxLength: 128 },
        selected_test_case_ids: { required: true, type: "array", items: "string", minItems: 1, maxItems: 30 }
      }, req.body.smart_plan || {});

      const requestedCaseIds = [...new Set(req.body.test_case_ids || [])];
      const reviewedCaseIds = [...new Set(req.body.smart_plan.selected_test_case_ids || [])];
      if (
        requestedCaseIds.length !== reviewedCaseIds.length
        || requestedCaseIds.some((id) => !reviewedCaseIds.includes(id))
      ) {
        throw createAccessError("Smart Run selected Test Cases must match the accepted preview selection.", 400);
      }

      verifiedSmartPlan = executionPlanningService.verifySmartExecutionAcceptance({
        token: req.body.smart_plan.acceptance_token,
        projectId: req.body.project_id,
        appTypeId: req.body.app_type_id,
        userId: req.user.id,
        requestId: req.body.smart_plan.request_id,
        inputFingerprint: req.body.smart_plan.input_fingerprint,
        selectedTestCaseIds: reviewedCaseIds
      });
    }

    // Verify user is member of project
    await projectService.getProject(req.body.project_id, req.user.id);

    if (verifiedSmartPlan) {
      const startedAt = new Date().toISOString();
      smartRunTransaction = await workspaceTransactionService.createTransaction({
        project_id: req.body.project_id,
        app_type_id: req.body.app_type_id,
        category: "ai",
        action: "smart_run_acceptance",
        status: "running",
        title: `Smart Run review accepted for ${req.body.name || "new execution"}`,
        description: `${verifiedSmartPlan.selected_test_case_ids.length} reviewed Test Case${verifiedSmartPlan.selected_test_case_ids.length === 1 ? "" : "s"} accepted for direct impacted scope.`,
        metadata: {
          capability: "ai-smart-run",
          preview_request_id: verifiedSmartPlan.request_id,
          input_fingerprint: verifiedSmartPlan.input_fingerprint,
          accepted_test_case_ids: verifiedSmartPlan.selected_test_case_ids,
          allowed_test_case_count: verifiedSmartPlan.allowed_test_case_ids.length,
          human_decision: "accepted",
          preview: verifiedSmartPlan.preview,
          current_phase: "creating_execution"
        },
        related_kind: "smart_run_preview",
        related_id: verifiedSmartPlan.request_id,
        created_by: req.user.id,
        started_at: startedAt
      });
    }

    let created;
    try {
      created = await service.createExecution({ ...req.body, created_by: req.user.id });
    } catch (error) {
      if (smartRunTransaction) {
        await workspaceTransactionService.updateTransaction(smartRunTransaction.id, {
          status: "failed",
          completed_at: new Date().toISOString(),
          metadata: { current_phase: "failed" }
        });
        await workspaceTransactionService.appendTransactionEvent(smartRunTransaction.id, {
          level: "error",
          phase: "create-failed",
          message: "Smart Run creation failed after review acceptance.",
          details: { preview_request_id: verifiedSmartPlan.request_id }
        });
      }
      throw error;
    }

    if (smartRunTransaction) {
      try {
        const completedAt = new Date().toISOString();
        await workspaceTransactionService.updateTransaction(smartRunTransaction.id, {
          status: "completed",
          related_kind: "execution",
          related_id: created.id,
          completed_at: completedAt,
          metadata: {
            execution_id: created.id,
            current_phase: "completed"
          }
        });
        await workspaceTransactionService.appendTransactionEvent(smartRunTransaction.id, {
          level: "success",
          phase: "review-accepted",
          message: `Created Smart Run with ${verifiedSmartPlan.selected_test_case_ids.length} accepted Test Case${verifiedSmartPlan.selected_test_case_ids.length === 1 ? "" : "s"}.`,
          details: {
            execution_id: created.id,
            preview_request_id: verifiedSmartPlan.request_id,
            accepted_test_case_ids: verifiedSmartPlan.selected_test_case_ids
          }
        });
      } catch {
        return { ...created, transaction_id: smartRunTransaction.id, audit_status: "acceptance-recorded" };
      }

      return { ...created, transaction_id: smartRunTransaction.id, audit_status: "completed" };
    }

    return created;
  });

  fastify.post("/executions/local-run", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string" },
      app_type_id: { required: true, type: "string" },
      test_case_ids: { required: true, type: "array", items: "string" },
      test_environment_id: { required: false, type: "string" },
      test_configuration_id: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      assigned_to: { required: false, type: "string" },
      assigned_to_ids: { required: false, type: "array", items: "string" },
      release: { required: false, type: "string" },
      sprint: { required: false, type: "string" },
      build: { required: false, type: "string" },
      name: { required: false, type: "string" },
      created_by: { required: true, type: "string" },
      engine_base_url: { required: false, type: "string" }
    }, req.body);

    await requireFeaturePermission(fastify, req, "automation.run.local");

    await projectService.getProject(req.body.project_id, req.user.id);

    return service.createLocalRun({
      ...req.body,
      created_by: req.user.id
    });
  });


  // GET ALL EXECUTIONS
  fastify.get("/executions", async (req) => {
    await fastify.authenticate(req);

    const { project_id, app_type_id, status } = req.query;
    let scopedProjectId = project_id;

    if (app_type_id) {
      const appType = await appTypeService.getAppType(app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);

      if (project_id && project_id !== appType.project_id) {
        throw new Error("Selected app type must belong to the current project");
      }

      scopedProjectId = appType.project_id;
    } else if (project_id) {
      await projectService.getProject(project_id, req.user.id);
    }

    return service.getExecutions({ project_id: scopedProjectId, app_type_id, status });
  });


  // GET ONE EXECUTION
  fastify.get("/executions/:id", async (req) => {
    await fastify.authenticate(req);
    const execution = await service.getExecution(req.params.id);
    // Verify user is member of the execution's project
    await projectService.getProject(execution.project_id, req.user.id);
    return execution;
  });

  fastify.put("/executions/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      assigned_to: { required: false, type: "string" },
      assigned_to_ids: { required: false, type: "array", items: "string" },
      release: { required: false, type: "string" },
      sprint: { required: false, type: "string" },
      build: { required: false, type: "string" },
      expected_revision: { required: false, type: "number" }
    }, req.body);

    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);

    return service.updateExecution(req.params.id, req.body);
  });

  fastify.put("/executions/:id/cases/:testCaseId/assignment", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      assigned_to: { required: false, type: "string" },
      assigned_to_ids: { required: false, type: "array", items: "string" },
      expected_revision: { required: false, type: "number" }
    }, req.body);

    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);

    return service.updateExecutionCaseAssignment(req.params.id, req.params.testCaseId, req.body);
  });

  fastify.put("/executions/:id/:level/:scopeId/assignment", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      assigned_to: { required: false, type: "string" },
      assigned_to_ids: { required: false, type: "array", items: "string" },
      expected_revision: { required: false, type: "number" }
    }, req.body);

    if (!["suites", "modules", "cases"].includes(req.params.level)) {
      const error = new Error("Assignment level must be suites, modules, or cases");
      error.statusCode = 400;
      throw error;
    }

    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);
    return service.updateExecutionScopeAssignment(req.params.id, req.params.level, req.params.scopeId, req.body);
  });

  fastify.post("/executions/:id/rerun", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      failed_only: { required: false, type: "boolean" },
      created_by: { required: true, type: "string" },
      name: { required: false, type: "string" }
    }, req.body);

    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);

    return service.rerunExecution(req.params.id, req.body);
  });


  // START EXECUTION
  fastify.post("/executions/:id/start", async (req) => {
    await fastify.authenticate(req);
    const execution = await service.getExecution(req.params.id);
    await requireFeaturePermission(
      fastify,
      req,
      resolveExecutionModePermission(req.body?.execution_mode || execution.trigger, "run.execute")
    );
    // Verify user is member of the execution's project
    await projectService.getProject(execution.project_id, req.user.id);
    return service.startExecution(req.params.id, {
      initiated_by: req.user.id,
      execution_mode: req.body?.execution_mode,
      engine_base_url: req.body?.engine_base_url,
      expected_revision: req.body?.expected_revision
    });
  });

  fastify.post("/executions/:id/cases/:testCaseId/steps/:stepId/run", async (req) => {
    await fastify.authenticate(req);

    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);

    return service.runExecutionApiStep(req.params.id, req.params.testCaseId, req.params.stepId, {
      executed_by: req.user.id
    });
  });

  fastify.post("/executions/:id/cases/:testCaseId/ai-analysis", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      instruction: { required: false, type: "string" },
      interaction_mode: { required: false, type: "string" }
    }, req.body || {});

    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);

    return executionAiAnalysisService.analyzeExecutionCase({
      execution,
      testCaseId: req.params.testCaseId,
      requestedBy: req.user.id,
      instruction: req.body?.instruction,
      interactionMode: req.body?.interaction_mode
    });
  });

  fastify.get("/executions/:id/report.pdf", async (req, reply) => {
    await fastify.authenticate(req);

    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);

    const pdf = await executionReportService.renderReportPdf(req.params.id, { user_id: req.user.id });
    const safeName = String(execution.name || execution.id || "qaira-run-report")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      || "qaira-run-report";
    const completedAt = new Date().toISOString();
    const transaction = await workspaceTransactionService.createTransaction({
      project_id: execution.project_id,
      app_type_id: execution.app_type_id || null,
      category: "bulk_export",
      action: "run_report_export",
      status: "completed",
      title: `Run report export for ${execution.name || execution.id}`,
      description: `Exported PDF report ${safeName}.pdf.`,
      metadata: {
        export_format: "pdf",
        total_items: 1,
        processed_items: 1,
        exported: 1,
        failed: 0,
        progress_percent: 100,
        current_phase: "completed",
        execution_id: req.params.id
      },
      related_kind: "execution",
      related_id: req.params.id,
      created_by: req.user.id,
      started_at: completedAt,
      completed_at: completedAt
    });
    const artifact = await workspaceTransactionService.createTransactionArtifact(transaction.id, {
      file_name: `${safeName}.pdf`,
      mime_type: "application/pdf",
      content: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`
    });
    await workspaceTransactionService.appendTransactionEvent(transaction.id, {
      level: "success",
      phase: "complete",
      message: `Exported PDF report ${safeName}.pdf.`,
      details: {
        execution_id: req.params.id,
        artifact_id: artifact.id,
        exported: 1
      }
    });
    await workspaceTransactionService.createTransactionNotification(transaction.id, {
      type: "batch_process.completed",
      title: "Run report export completed",
      message: `${safeName}.pdf is available in TestOps.`
    });

    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${safeName}.pdf"`)
      .header("X-HelloTest-Transaction-Id", transaction.id)
      .header("X-HelloTest-Artifact-Id", artifact.id);
    return reply.send(pdf);
  });

  fastify.get("/executions/:id/cases/:testCaseId/report.pdf", async (req, reply) => {
    await fastify.authenticate(req);
    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);
    const pdf = await executionReportService.renderCaseReportPdf(req.params.id, req.params.testCaseId);
    const safeName = `${String(execution.name || execution.id).replace(/[^A-Za-z0-9._-]+/g, "-")}-${String(req.params.testCaseId).replace(/[^A-Za-z0-9._-]+/g, "-")}`;
    reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
    return reply.send(pdf);
  });

  fastify.get("/executions/:id/report.html", async (req, reply) => {
    await fastify.authenticate(req);

    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);

    const html = await executionReportService.renderReportHtml(req.params.id, { user_id: req.user.id });
    reply.header("Content-Type", "text/html; charset=utf-8");
    return reply.send(html);
  });

  fastify.post("/executions/:id/share-report", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      recipients: { required: true, type: "array", items: "string" }
    }, req.body || {});

    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);

    return executionReportService.emailReport({
      execution_id: req.params.id,
      recipients: req.body.recipients,
      requested_by: req.user.id
    });
  });

  fastify.post("/executions/:id/cases/:testCaseId/share-report", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ recipients: { required: true, type: "array", items: "string" } }, req.body || {});
    const execution = await service.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);
    return executionReportService.emailCaseReport({ execution_id: req.params.id, test_case_id: req.params.testCaseId, recipients: req.body.recipients, requested_by: req.user.id });
  });


  // COMPLETE EXECUTION
  fastify.post("/executions/:id/complete", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      status: { required: true, enum: EXECUTION_FINAL_STATUS_VALUES },
      expected_revision: { required: false, type: "number" }
    }, req.body);

    const execution = await service.getExecution(req.params.id);
    // Verify user is member of the execution's project
    await projectService.getProject(execution.project_id, req.user.id);

    return service.completeExecution(req.params.id, req.body.status, {
      expected_revision: req.body.expected_revision
    });
  });


  // DELETE EXECUTION
  fastify.delete("/executions/:id", async (req) => {
    await fastify.authenticate(req);
    const execution = await service.getExecution(req.params.id);
    // Verify user is member of the execution's project
    await projectService.getProject(execution.project_id, req.user.id);
    return service.deleteExecution(req.params.id);
  });

};
