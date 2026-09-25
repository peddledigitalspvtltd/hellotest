const service = require("../services/execution.service");
const executionPlanningService = require("../services/executionPlanning.service");
const executionAiAnalysisService = require("../services/executionAiAnalysis.service");
const executionReportService = require("../services/executionReport.service");
const workspaceTransactionService = require("@hellotest/platform/backend/services/workspaceTransaction.service");
const appTypeService = require("@hellotest/platform/backend/public/applicationAccess");
const projectService = require("@hellotest/platform/backend/public/projectAccess");
const featureFlagService = require("@hellotest/platform/backend/services/featureFlag.service");
const testDataSetService = require("../services/testDataSet.service");
const mobileFeatureService = require("@hellotest/platform/backend/services/mobileFeature.service");
const executionHistoryService = require("../services/executionHistory.service");
const { EXECUTION_FINAL_STATUS_VALUES } = require("@hellotest/platform/backend/src/domain/catalog");

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

const requireFeaturePermission = async (fastify, req, permissionCode, projectId = null) => {
  await fastify.requirePermission(permissionCode, projectId ? { projectId } : {})(req);
  const featureKeys = featureFlagService.getFeatureKeysForPermission(permissionCode);

  if (featureKeys.length && !await featureFlagService.areEnabled(featureKeys, { user: req.user })) {
    throw createAccessError("This feature is disabled for the workspace.");
  }
};

const requireSelectedTestDataAccess = async (fastify, req, projectId, dataSetId) => {
  if (!dataSetId) return;
  const dataSet = await testDataSetService.getTestDataSet(dataSetId);
  if (dataSet.project_id !== projectId) {
    throw createAccessError("Test Data Set must belong to the Run project.");
  }
  await fastify.requirePermission("data.view", { projectId: dataSet.project_id })(req);
};

const ensureExecutionPermission = async (fastify, req, permissionCode, execution = null) => {
  const target = execution || await service.getExecution(req.params.id);
  await projectService.getProject(target.project_id, req.user.id);
  await fastify.requirePermission(permissionCode, { projectId: target.project_id })(req);
  return target;
};

const requireMobileExecutionPermission = async (fastify, req, executionInput, permissionCode = "mobile.manage") => {
  if (await mobileFeatureService.executionUsesMobile(executionInput)) {
    await fastify.requirePermission(permissionCode, { projectId: executionInput.project_id })(req);
  }
};

module.exports = async function (fastify) {
  fastify.post("/executions/parameter-plan", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" }, app_type_id: { required: true, type: "string" },
      execution_id: { required: false, type: "string", maxLength: 255 },
      data_scope: { required: false, type: "string", enum: ["suite", "run"] },
      suite_context_id: { required: false, type: "string", maxLength: 255 },
      suite_ids: { required: false, type: "array", items: "string", maxItems: 1000 },
      test_case_ids: { required: false, type: "array", items: "string", maxItems: 5000 },
      test_data_set_id: { required: false, type: "string" },
      test_data_options: { required: false, type: "object" }, test_environment_id: { required: false, type: "string" },
      parameter_values: { required: false, type: "object" },
      test_configuration_id: { required: false, type: "string" }
    }, req.body || {});
    const projectId = req.body.project_id;
    await projectService.getProject(projectId, req.user.id);
    let frozenRun = null;
    if (req.body.execution_id) {
      await fastify.requirePermission("run.view", { projectId })(req);
      frozenRun = await service.getExecution(req.body.execution_id, true);
      if (frozenRun.project_id !== projectId || frozenRun.app_type_id !== req.body.app_type_id) {
        throw createAccessError("The run is unavailable in this application.", 404);
      }
    }
    // A saved Run owns its frozen cases and parameters. Authoring access is
    // needed only when a preview introduces live cases or suites.
    const savedCases = new Set(frozenRun?.test_case_ids || []);
    const savedSuites = new Set(frozenRun?.suite_ids || []);
    const addsCases = (req.body.test_case_ids || []).some(id => !savedCases.has(id));
    const addsSuites = (req.body.suite_ids || []).some(id => !savedSuites.has(id));
    if (!frozenRun || addsCases || addsSuites) await fastify.requirePermission("testcase.view", { projectId })(req);
    if (addsSuites || req.body.suite_context_id) await fastify.requirePermission("suite.view", { projectId })(req);
    if (req.body.test_environment_id && req.body.test_environment_id !== frozenRun?.test_environment_id) await fastify.requirePermission("environment.view", { projectId })(req);
    if (req.body.test_configuration_id && req.body.test_configuration_id !== frozenRun?.test_configuration_id) await fastify.requirePermission("configuration.view", { projectId })(req);
    if (req.body.test_data_set_id !== frozenRun?.test_data_set_id) await requireSelectedTestDataAccess(fastify, req, projectId, req.body.test_data_set_id);
    return require("../services/runParameterPlan.service").buildRunParameterPlan(req.body);
  });


  fastify.get("/executions/history", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" }, app_type_id: { required: false, type: "string" }, requirement_id: { required: false, type: "string" }, test_case_id: { required: false, type: "string" }, page_size: { required: false, type: "string" } }, req.query || {});
    await projectService.getProject(req.query.project_id, req.user.id);
    return executionHistoryService.list({
      projectId: req.query.project_id,
      appTypeId: req.query.app_type_id,
      requirementId: req.query.requirement_id,
      testCaseId: req.query.test_case_id,
      pageSize: req.query.page_size
    });
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

    await requireFeaturePermission(fastify, req, "run.ai", req.body.project_id);
    await projectService.getProject(req.body.project_id, req.user.id);
    await requireSelectedTestDataAccess(fastify, req, req.body.project_id, req.body.test_data_set_id);
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
      test_data_options: req.body.test_data_options,
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
      test_data_options: { required: false, type: "object" },
      additional_context: { required: false, type: "string" },
      integration_id: { required: false, type: "string" }
    }, req.body);

    await projectService.getProject(req.body.project_id, req.user.id);
    await requireSelectedTestDataAccess(fastify, req, req.body.project_id, req.body.test_data_set_id);
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
      test_data_options: req.body.test_data_options,
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
      test_data_options: { required: false, type: "object" },
      execution_hooks: { required: false, type: "array" },
      parallel_enabled: { required: false, type: "boolean" },
      parallel_count: { required: false, type: "number" },
      execution_mode: { required: false, type: "string" },
      engine_base_url: { required: false, type: "string" },
      assigned_to: { required: false, type: "string" },
      assigned_to_ids: { required: false, type: "array", items: "string" },
      release: { required: false, type: "string" },
      sprint: { required: false, type: "string" },
      release_id: { required: false, type: "string" },
      iteration_id: { required: false, type: "string" },
      build: { required: false, type: "string" },
      name: { required: false, type: "string" },
      scope_source: { required: false, type: "string", enum: ["smart-run"] },
      start_date: { required: false, type: "string", maxLength: 10 },
      end_date: { required: false, type: "string", maxLength: 10 },
      smart_plan: { required: false, type: "object" },
      created_by: { required: true, type: "string" }
    }, req.body);

    await requireFeaturePermission(
      fastify,
      req,
      resolveExecutionModePermission(req.body.execution_mode, "run.create"),
      req.body.project_id
    );

    if (req.body.parallel_enabled || Number(req.body.parallel_count || 1) > 1) {
      await requireFeaturePermission(fastify, req, "automation.run.parallel", req.body.project_id);
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
      await requireFeaturePermission(fastify, req, "run.ai", req.body.project_id);
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
    await requireMobileExecutionPermission(fastify, req, req.body);
    await requireSelectedTestDataAccess(fastify, req, req.body.project_id, req.body.test_data_set_id);

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
      test_data_options: { required: false, type: "object" },
      assigned_to: { required: false, type: "string" },
      assigned_to_ids: { required: false, type: "array", items: "string" },
      release: { required: false, type: "string" },
      sprint: { required: false, type: "string" },
      release_id: { required: false, type: "string" },
      iteration_id: { required: false, type: "string" },
      build: { required: false, type: "string" },
      name: { required: false, type: "string" },
      created_by: { required: true, type: "string" },
      start_date: { required: false, type: "string", maxLength: 10 },
      end_date: { required: false, type: "string", maxLength: 10 },
      engine_base_url: { required: false, type: "string" }
    }, req.body);

    await requireFeaturePermission(fastify, req, "automation.run.local", req.body.project_id);

    await projectService.getProject(req.body.project_id, req.user.id);
    await requireMobileExecutionPermission(fastify, req, req.body);
    await requireSelectedTestDataAccess(fastify, req, req.body.project_id, req.body.test_data_set_id);

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

    if (scopedProjectId) {
      await fastify.requirePermission("run.view", { projectId: scopedProjectId })(req);
    } else if (req.user.role !== "admin") {
      const error = new Error("project_id or app_type_id is required when listing Runs");
      error.statusCode = 400;
      throw error;
    }

    return service.getExecutions({ project_id: scopedProjectId, app_type_id, status });
  });


  // GET ONE EXECUTION
  fastify.get("/executions/:id", async (req) => {
    await fastify.authenticate(req);
    return ensureExecutionPermission(fastify, req, "run.view");
  });

  fastify.put("/executions/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      name: { required: false, type: "string", maxLength: 255 },
      start_date: { required: false, type: "string", maxLength: 10 },
      end_date: { required: false, type: "string", maxLength: 10 },
      suite_ids: { required: false, type: "array", items: "string" },
      test_case_ids: { required: false, type: "array", items: "string" },
      test_environment_id: { required: false, type: "string" },
      test_configuration_id: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      test_data_options: { required: false, type: "object" },
      parallel_enabled: { required: false, type: "boolean" },
      parallel_count: { required: false, type: "number" },
      execution_mode: { required: false, type: "string", enum: ["manual", "remote", "local"] },
      assigned_to: { required: false, type: "string" },
      assigned_to_ids: { required: false, type: "array", items: "string" },
      release: { required: false, type: "string" },
      sprint: { required: false, type: "string" },
      release_id: { required: false, type: "string" },
      iteration_id: { required: false, type: "string" },
      build: { required: false, type: "string" },
      expected_revision: { required: false, type: "number" }
    }, req.body);

    const execution = await ensureExecutionPermission(fastify, req, "run.update");
    await requireMobileExecutionPermission(fastify, req, execution);
    if (req.body.execution_mode && req.body.execution_mode !== "manual") await requireFeaturePermission(
      fastify, req, resolveExecutionModePermission(req.body.execution_mode, "run.update"), execution.project_id);
    if (req.body.parallel_enabled || Number(req.body.parallel_count || 1) > 1) await requireFeaturePermission(fastify, req, "automation.run.parallel", execution.project_id);
    await requireSelectedTestDataAccess(fastify, req, execution.project_id, req.body.test_data_set_id);

    return service.updateExecution(req.params.id, req.body);
  });

  fastify.put("/executions/:id/cases/:testCaseId/assignment", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      assigned_to: { required: false, type: "string" },
      assigned_to_ids: { required: false, type: "array", items: "string" },
      expected_revision: { required: false, type: "number" }
    }, req.body);

    await ensureExecutionPermission(fastify, req, "run.update");

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

    await ensureExecutionPermission(fastify, req, "run.update");
    return service.updateExecutionScopeAssignment(req.params.id, req.params.level, req.params.scopeId, req.body);
  });

  fastify.post("/executions/:id/rerun", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      failed_only: { required: false, type: "boolean" },
      created_by: { required: true, type: "string" },
      name: { required: false, type: "string" }
    }, req.body);

    const execution = await ensureExecutionPermission(fastify, req, "run.execute");
    await requireMobileExecutionPermission(fastify, req, execution);

    return service.rerunExecution(req.params.id, { ...req.body, created_by: req.user.id });
  });


  // START EXECUTION
  fastify.post("/executions/:id/start", async (req) => {
    await fastify.authenticate(req);
    const execution = await service.getExecution(req.params.id);
    const executionMode = service.resolveExecutionStartMode(execution, req.body?.execution_mode);
    await ensureExecutionPermission(fastify, req, "run.execute", execution);
    await requireMobileExecutionPermission(fastify, req, execution);
    await requireFeaturePermission(
      fastify,
      req,
      resolveExecutionModePermission(executionMode, "run.execute"),
      execution.project_id
    );
    return service.startExecution(req.params.id, {
      initiated_by: req.user.id,
      execution_mode: executionMode,
      engine_base_url: req.body?.engine_base_url,
      expected_revision: req.body?.expected_revision
    });
  });

  fastify.post("/executions/:id/cases/:testCaseId/steps/:stepId/run", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      data_set_iteration_index: { required: false, type: "number" }
    }, req.body || {});

    await ensureExecutionPermission(fastify, req, "run.execute");

    return service.runExecutionApiStep(req.params.id, req.params.testCaseId, req.params.stepId, {
      executed_by: req.user.id,
      data_set_iteration_index: req.body?.data_set_iteration_index
    });
  });

  fastify.post("/executions/:id/cases/:testCaseId/ai-analysis", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      instruction: { required: false, type: "string" },
      interaction_mode: { required: false, type: "string" }
    }, req.body || {});

    const execution = await service.getExecution(req.params.id);
    await ensureExecutionPermission(fastify, req, "run.ai", execution);

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
    await ensureExecutionPermission(fastify, req, "run.report.export", execution);

    const pdf = await executionReportService.renderReportPdf(req.params.id, { user_id: req.user.id });
    const safeName = String(execution.name || execution.id || "hellotest-run-report")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      || "hellotest-run-report";
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
    await ensureExecutionPermission(fastify, req, "run.report.export", execution);
    const pdf = await executionReportService.renderCaseReportPdf(req.params.id, req.params.testCaseId);
    const safeName = `${String(execution.name || execution.id).replace(/[^A-Za-z0-9._-]+/g, "-")}-${String(req.params.testCaseId).replace(/[^A-Za-z0-9._-]+/g, "-")}`;
    reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
    return reply.send(pdf);
  });

  fastify.get("/executions/:id/report.html", async (req, reply) => {
    await fastify.authenticate(req);

    const execution = await service.getExecution(req.params.id);
    await ensureExecutionPermission(fastify, req, "run.report.export", execution);

    let includeAttachments = true;
    for (const permission of ["attachment.view", "result.view"]) {
      try { await fastify.requirePermission(permission, { projectId: execution.project_id })(req); }
      catch (error) { if (error.statusCode !== 403) throw error; includeAttachments = false; }
    }
    const html = await executionReportService.renderReportHtml(req.params.id, { user: req.user, include_attachments: includeAttachments });
    const safeName = String(execution.name || "hellotest-run-report").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "hellotest-run-report";
    reply.header("Content-Type", "text/html; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${safeName}.html"`);
    reply.header("Cache-Control", "private, no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Content-Security-Policy", executionReportService.REPORT_CSP);
    return reply.send(html);
  });

  fastify.post("/executions/:id/share-report", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      recipients: { required: true, type: "array", items: "string" }
    }, req.body || {});

    const execution = await service.getExecution(req.params.id);
    await ensureExecutionPermission(fastify, req, "run.report.share", execution);

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
    await ensureExecutionPermission(fastify, req, "run.report.share", execution);
    return executionReportService.emailCaseReport({ execution_id: req.params.id, test_case_id: req.params.testCaseId, recipients: req.body.recipients, requested_by: req.user.id });
  });


  // COMPLETE EXECUTION
  fastify.post("/executions/:id/complete", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      status: { required: true, enum: EXECUTION_FINAL_STATUS_VALUES },
      expected_revision: { required: false, type: "number" }
    }, req.body);

    await ensureExecutionPermission(fastify, req, "run.execute");

    return service.completeExecution(req.params.id, req.body.status, {
      expected_revision: req.body.expected_revision,
      completed_by: req.user.id
    });
  });


  // DELETE EXECUTION
  fastify.delete("/executions/:id", async (req) => {
    await fastify.authenticate(req);
    await ensureExecutionPermission(fastify, req, "run.delete");
    return service.deleteExecution(req.params.id);
  });

};
