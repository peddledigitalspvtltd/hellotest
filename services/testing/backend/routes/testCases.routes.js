const service = require("../services/testCase.service");
const catalogService = require("../services/testCaseCatalog.service");
const appTypeService = require("@hellotest/platform/backend/public/applicationAccess");
const projectService = require("@hellotest/platform/backend/public/projectAccess");
const requirementService = require("@hellotest/manual/backend/services/requirement.service");
const requirementDesignService = require("@hellotest/manual/backend/services/requirementDesign.service");
const aiTestCaseGenerationService = require("@hellotest/ai/backend/services/aiTestCaseGeneration.service");
const aiCaseAuthoringService = require("@hellotest/ai/backend/services/aiCaseAuthoring.service");
const aiAutomationBuilderService = require("@hellotest/automation/backend/services/aiAutomationBuilder.service");
const automationGeneratorService = require("@hellotest/automation/backend/services/automationGenerator.service");
const batchProcessService = require("../services/batchProcess.service");
const workspaceTransactionService = require("@hellotest/platform/backend/services/workspaceTransaction.service");
const testCaseVersionService = require("../services/testCaseVersion.service");
const testCaseVersionRestoreService = require("../services/testCaseVersionRestore.service");
const testDataSetService = require("../services/testDataSet.service");
const mobileFeatureService = require("@hellotest/platform/backend/services/mobileFeature.service");
const testCaseScopeService = require("../services/testCaseScope.service");
const { TEST_CASE_AUTOMATED_VALUES, TEST_CASE_STATUS_VALUES } = require("@hellotest/platform/backend/src/domain/catalog");
const { paginate, shouldPaginate } = require("@hellotest/platform/backend/src/utils/pagination");
const {
  containsMobileStepPayload,
  isMobileAppType,
  isMobileRecorderTarget
} = require("@hellotest/platform/backend/src/utils/mobileFeature");
const AUTOMATION_STATUS_VALUES = ["not_automated", "ready", "incomplete"];
const OBJECT_REPOSITORY_IMPORT_CHUNK_SIZE = 200;

const resolveTestCaseListProjectId = testCaseScopeService.resolveListProjectId;

const resolveScopedRequirements = async (requirementIds = [], projectId, allowEmpty = false) => {
  const ids = [...new Set((Array.isArray(requirementIds) ? requirementIds : []).filter(Boolean))];

  if (!ids.length && !allowEmpty) {
    throw new Error("Select at least one requirement");
  }

  const requirements = [];

  for (const requirementId of ids) {
    const requirement = await requirementService.getRequirement(requirementId);

    if (requirement.project_id !== projectId) {
      throw new Error("Requirement must belong to the same project as the selected app type");
    }

    requirements.push(requirement);
  }

  return requirements;
};

const ensureTestCasePermission = async (fastify, req, permissionCode, testCase = null) => {
  const target = testCase || await service.getTestCase(req.params.id);
  const projectIds = await testCaseScopeService.resolveTestCaseProjectIds(target.id);
  if (projectIds.length > 1) {
    const error = new Error("The Test Case has conflicting project relationships");
    error.statusCode = 409;
    throw error;
  }
  if (!projectIds.length) {
    if (req.user.role !== "admin") {
      const error = new Error("The Test Case does not have a project-scoped application");
      error.statusCode = 403;
      throw error;
    }
    return { testCase: target, projectId: null };
  }
  const projectId = projectIds[0];
  await projectService.getProject(projectId, req.user.id);
  await fastify.requirePermission(permissionCode, { projectId })(req);
  return { testCase: target, projectId };
};

const ensureTestCaseDataSetAccess = async (fastify, req, projectId, dataSetId) => {
  if (!dataSetId) return;
  const dataSet = await testDataSetService.getTestDataSet(dataSetId);
  if (projectId && dataSet.project_id !== projectId) {
    const error = new Error("Test Data Set must belong to the Test Case project");
    error.statusCode = 403;
    throw error;
  }
  await fastify.requirePermission("data.view", { projectId: dataSet.project_id })(req);
};

const ensureSuiteAssignmentAccess = async (fastify, req, projectId, suiteIds = []) => {
  const ids = testCaseScopeService.uniqueIds(suiteIds);
  const suites = await testCaseScopeService.resolveSuiteScopes(ids);
  const suitesById = new Map(suites.map((suite) => [suite.id, suite]));
  for (const suiteId of ids) {
    const suite = suitesById.get(suiteId);
    if (!suite) {
      const error = new Error(`Test Suite not found: ${suiteId}`);
      error.statusCode = 404;
      throw error;
    }
    if (projectId && suite.project_id !== projectId) {
      const error = new Error("Test Suite must belong to the Test Case project");
      error.statusCode = 403;
      throw error;
    }
    await fastify.requirePermission("suite.update", { projectId: suite.project_id })(req);
  }
};

const requireMobileAuthoringPermission = async (fastify, req, projectId, { appType = null, payload = null, testCaseId = null } = {}) => {
  const usesMobile = isMobileAppType(appType?.type)
    || containsMobileStepPayload(payload)
    || (testCaseId ? await mobileFeatureService.testCaseUsesMobile(testCaseId) : false);

  if (usesMobile) {
    await fastify.requirePermission("mobile.manage", { projectId })(req);
  }
};

const chunkItems = (items, size) => {
  const chunks = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
};

module.exports = async function (fastify) {
  fastify.post("/test-cases", async (req) => {
    await fastify.authenticate(req);
    
    fastify.validate({
      app_type_id: { required: false, type: "string" },
      title: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      external_references: { required: false, type: "array", items: "string" },
      labels: { required: false, type: "array", items: "string" },
      parameter_values: { required: false, type: "object" },
      automated: { required: false, type: "string", enum: TEST_CASE_AUTOMATED_VALUES },
      automation_status: { required: false, type: "string", enum: AUTOMATION_STATUS_VALUES },
      automation_start_url: { required: false, type: "string", maxLength: 2000 },
      manual_test_case_id: { required: false, type: "string" },
      manual_test_case_ids: { required: false, type: "array", items: "string" },
      source_issue_id: { required: false, type: "string" },
      authoring_mode: { required: false, type: "string", enum: ["structured", "gherkin"] },
      test_case_type: { required: false, type: "string", minLength: 1, maxLength: 120 },
      gherkin_document: { required: false, type: "string" },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string", enum: TEST_CASE_STATUS_VALUES },
      requirement_id: { required: false, type: "string" },
      requirement_ids: { required: false, type: "array", items: "string" },
      suite_id: { required: false, type: "string" },
      suite_ids: { required: false, type: "array", items: "string" },
      test_data_set_ids: { required: false, type: "array", items: "string", maxItems: 1 },
      test_data_options: { required: false, type: "object" },
      execution_hooks: { required: false, type: "array", maxItems: 20 },
      author_id: { required: false, type: "string" },
      reviewer_id: { required: false, type: "string" },
      review_status: { required: false, type: "string", enum: ["not_requested", "pending", "accepted", "changes_requested"] },
      review_history: { required: false, type: "array" },
      ai_generation_source: { required: false, type: "string", enum: ["interactive"] },
      ai_quality_score: { required: false, type: "number" },
      steps: { required: false, type: "array" }
    }, req.body);

    // Verify access if app_type_id provided
    let scopedProjectId = null;
    let scopedAppType = null;
    if (req.body.app_type_id) {
      const appType = await appTypeService.getAppType(req.body.app_type_id);
      scopedAppType = appType;
      scopedProjectId = appType.project_id;
      await projectService.getProject(appType.project_id, req.user.id);
    }
    if (!scopedProjectId && (req.body.suite_id || req.body.suite_ids?.[0])) {
      const suiteScope = await testCaseScopeService.getSuiteScope(req.body.suite_id || req.body.suite_ids[0]);
      scopedProjectId = suiteScope?.project_id || null;
      scopedAppType = suiteScope?.app_type_id ? await appTypeService.getAppType(suiteScope.app_type_id) : null;
    }
    if (!scopedProjectId && (req.body.requirement_id || req.body.requirement_ids?.[0])) {
      scopedProjectId = (await testCaseScopeService.getRequirementScope(req.body.requirement_id || req.body.requirement_ids[0]))?.project_id || null;
    }
    if (!scopedProjectId && req.user.role !== "admin") {
      const error = new Error("A project-scoped app type, suite, or Story is required to create a Test Case");
      error.statusCode = 400;
      throw error;
    }
    if (scopedProjectId) {
      await projectService.getProject(scopedProjectId, req.user.id);
      await fastify.requirePermission("testcase.create", { projectId: scopedProjectId })(req);
      await requireMobileAuthoringPermission(fastify, req, scopedProjectId, {
        appType: scopedAppType,
        payload: req.body.steps
      });
    }
    const requirementIds = req.body.requirement_ids || (req.body.requirement_id ? [req.body.requirement_id] : []);
    if (req.body.source_issue_id) {
      if (!scopedProjectId) throw Object.assign(new Error("A project is required to convert a Defect to a Test Case"), { statusCode: 400 });
      await fastify.requirePermission("feedback.view", { projectId: scopedProjectId })(req);
    }
    if (requirementIds.length && scopedProjectId) {
      await fastify.requirePermission("requirement.view", { projectId: scopedProjectId })(req);
      await resolveScopedRequirements(requirementIds, scopedProjectId);
    }
    await ensureSuiteAssignmentAccess(
      fastify,
      req,
      scopedProjectId,
      req.body.suite_ids || (req.body.suite_id ? [req.body.suite_id] : [])
    );
    if (req.body.execution_hooks?.length) {
      await fastify.requirePermission("testcase.view", { projectId: scopedProjectId })(req);
      if (req.body.execution_hooks.some(hook => hook?.target_kind === "suite")) await fastify.requirePermission("suite.view", { projectId: scopedProjectId })(req);
    }
    if (req.body.test_data_options !== undefined) {
      await fastify.requirePermission("data.view", { projectId: scopedProjectId })(req);
    }
    if (req.body.test_data_set_ids?.length) {
      const dataSet = await testDataSetService.getTestDataSet(req.body.test_data_set_ids[0]);
      const dataProjectId = dataSet.project_id;
      if (scopedProjectId && dataProjectId !== scopedProjectId) {
        const error = new Error("Test Data Set must belong to the Test Case project");
        error.statusCode = 403;
        throw error;
      }
      await projectService.getProject(dataProjectId, req.user.id);
      await fastify.requirePermission("data.view", { projectId: dataProjectId })(req);
    }

    if (!req.body.ai_generation_source && ["accepted", "changes_requested"].includes(req.body.review_status)) {
      throw Object.assign(new Error("Create the test case before submitting a reviewer decision"), { statusCode: 403 });
    }
    return service.createTestCase({
      ...req.body,
      ai_generation_source: req.body.ai_generation_source || null,
      ai_generation_review_status: req.body.ai_generation_source ? "pending" : null,
      ai_generation_job_id: null,
      ai_generated_at: req.body.ai_generation_source ? new Date().toISOString() : null,
      reviewer_id: req.body.reviewer_id || (req.body.ai_generation_source ? req.user.id : null),
      review_status: req.body.ai_generation_source || req.body.reviewer_id?.trim() ? "pending" : "not_requested",
      review_history: [],
      author_id: req.body.author_id || req.user.id,
      updated_by: req.user.id,
      created_by: req.user.id
    });
  });

  fastify.post("/test-cases/import", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      requirement_id: { required: false, type: "string" },
      import_source: { required: false, type: "string" },
      batches: { required: false, type: "array" },
      rows: { required: false, type: "array" }
    }, req.body);

    if (!Array.isArray(req.body.rows) && !Array.isArray(req.body.batches)) {
      throw new Error("Provide rows or batches to import");
    }

    if (Array.isArray(req.body.rows) && !req.body.rows.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      throw new Error("rows must contain import row objects");
    }

    if (
      Array.isArray(req.body.batches)
      && !req.body.batches.every(
        (batch) =>
          batch
          && typeof batch === "object"
          && !Array.isArray(batch)
          && Array.isArray(batch.rows)
          && batch.rows.every((row) => row && typeof row === "object" && !Array.isArray(row))
      )
    ) {
      throw new Error("batches must contain import batches with row objects");
    }

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    await requireMobileAuthoringPermission(fastify, req, appType.project_id, {
      appType,
      payload: req.body
    });

    const importRows = [...(req.body.rows || []), ...(req.body.batches || []).flatMap(batch => batch.rows || [])];
    if (importRows.some(row => row.shared_groups?.length)) await fastify.requirePermission("shared_step.manage", { projectId: appType.project_id })(req);
    if (importRows.some(row => row.test_data_references || row.test_data_set_ids?.length || row.test_data_options !== undefined
      || row.shared_groups?.some(group => group.test_data_set_id || group.test_data_row_index !== undefined))) {
      await fastify.requirePermission("data.view", { projectId: appType.project_id })(req);
    }
    if (importRows.some(row => row.modules || row.module || row.module_id)) await fastify.requirePermission("testcase.update", { projectId: appType.project_id })(req);

    return batchProcessService.queueTestCaseImport({
      ...req.body,
      created_by: req.user.id
    });
  });

  fastify.post("/test-cases/export", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      test_case_ids: { required: false, type: "array", items: "string" }
    }, req.body);

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    const canExportResource = async permission => {
      try { await fastify.requirePermission(permission, { projectId: appType.project_id })(req); return true; }
      catch (error) { if (error?.statusCode !== 403) throw error; return false; }
    };
    const [includeTestData, includeSharedGroups, includeAutomation] = await Promise.all([
      canExportResource("data.view"), canExportResource("shared_step.view"), canExportResource("automation.code.view")
    ]);

    return batchProcessService.queueTestCaseExport({
      app_type_id: req.body.app_type_id,
      test_case_ids: req.body.test_case_ids,
      include_test_data: includeTestData,
      include_shared_groups: includeSharedGroups,
      include_automation: includeAutomation,
      created_by: req.user.id
    });
  });

  fastify.get("/test-cases/automation/learning-cache", async (req) => {
    await fastify.authenticate(req);

    const { project_id, app_type_id, limit, offset } = req.query;

    if (app_type_id) {
      const appType = await appTypeService.getAppType(app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    } else if (project_id) {
      await projectService.getProject(project_id, req.user.id);
    } else if (req.user?.role !== "admin") {
      throw new Error("Project or app type scope is required");
    }

    return aiAutomationBuilderService.listLearningCache({
      project_id,
      app_type_id,
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined
    });
  });

  fastify.get("/test-cases/automation/repository-context", async (req) => {
    await fastify.authenticate(req);

    const { project_id, app_type_id, limit } = req.query;

    if (app_type_id) {
      const appType = await appTypeService.getAppType(app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    } else if (project_id) {
      await projectService.getProject(project_id, req.user.id);
    } else if (req.user?.role !== "admin") {
      throw new Error("Project or app type scope is required");
    }

    return aiAutomationBuilderService.exportRepositoryContext({
      project_id,
      app_type_id,
      limit: limit !== undefined ? Number(limit) : undefined
    });
  });

  fastify.get("/test-cases/automation/learning-cache/export.csv", async (req, reply) => {
    await fastify.authenticate(req);
    const { app_type_id } = req.query || {};

    if (!app_type_id) {
      throw new Error("App type scope is required");
    }

    const appType = await appTypeService.getAppType(app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    const csv = await aiAutomationBuilderService.exportLearningCacheCsv({ app_type_id });
    const exported = Math.max(0, csv.split(/\r?\n/).length - 1);
    const completedAt = new Date().toISOString();
    const transaction = await workspaceTransactionService.createTransaction({
      project_id: appType.project_id,
      app_type_id,
      category: "bulk_export",
      action: "object_repository_export",
      status: "completed",
      title: "Object repository export",
      description: `Exported ${exported} object repository entr${exported === 1 ? "y" : "ies"} for ${appType.name}.`,
      metadata: {
        export_format: "csv",
        total_items: exported,
        processed_items: exported,
        exported,
        failed: 0,
        progress_percent: 100,
        current_phase: "completed"
      },
      related_kind: "app_type",
      related_id: app_type_id,
      created_by: req.user.id,
      started_at: completedAt,
      completed_at: completedAt
    });
    const artifact = await workspaceTransactionService.createTransactionArtifact(transaction.id, {
      file_name: "object-repository.csv",
      mime_type: "text/csv; charset=utf-8",
      content: csv
    });
    await workspaceTransactionService.appendTransactionEvent(transaction.id, {
      level: "success",
      phase: "complete",
      message: `Object repository CSV export completed with ${exported} entr${exported === 1 ? "y" : "ies"}.`,
      details: {
        artifact_id: artifact.id,
        exported
      }
    });
    await workspaceTransactionService.createTransactionNotification(transaction.id, {
      type: "batch_process.completed",
      title: "Object repository export completed",
      message: "Object repository CSV export is available in TestOps."
    });

    reply
      .header("Content-Disposition", "attachment; filename=\"object-repository.csv\"")
      .header("X-HelloTest-Transaction-Id", transaction.id)
      .header("X-HelloTest-Artifact-Id", artifact.id);
    return reply.type("text/csv; charset=utf-8").send(csv);
  });

  fastify.post("/test-cases/automation/learning-cache/import", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      import_source: { required: false, type: "string" },
      entries: { required: true, type: "array" }
    }, req.body || {});

    if (!req.body.entries.every((entry) => entry && typeof entry === "object" && !Array.isArray(entry))) {
      throw new Error("entries must contain object repository entry objects");
    }

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);

    const entries = req.body.entries;
    const chunks = chunkItems(entries, OBJECT_REPOSITORY_IMPORT_CHUNK_SIZE);
    const startedAt = new Date().toISOString();
    const transaction = await workspaceTransactionService.createTransaction({
      project_id: appType.project_id,
      app_type_id: req.body.app_type_id,
      category: "bulk_import",
      action: "object_repository_import",
      status: "running",
      title: "Object repository import",
      description: `Importing ${entries.length} object repository entr${entries.length === 1 ? "y" : "ies"} for ${appType.name}.`,
      metadata: {
        import_source: req.body.import_source || "object_repository_import",
        total_items: entries.length,
        processed_items: 0,
        imported: 0,
        updated: 0,
        failed: 0,
        progress_percent: 0,
        current_phase: "import"
      },
      related_kind: "app_type",
      related_id: req.body.app_type_id,
      created_by: req.user.id,
      started_at: startedAt
    });

    try {
      const result = { created: 0, updated: 0, failed: 0, errors: [] };

      await workspaceTransactionService.appendTransactionEvent(transaction.id, {
        phase: "start",
        message: `Started object repository import in ${chunks.length || 1} chunk${chunks.length === 1 ? "" : "s"}.`,
        details: {
          total_items: entries.length,
          chunk_count: chunks.length
        }
      });

      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        const chunkResult = await aiAutomationBuilderService.importLearningCacheEntries({
          project_id: appType.project_id,
          app_type_id: req.body.app_type_id,
          import_source: req.body.import_source,
          entries: chunk
        });
        result.created += chunkResult.created;
        result.updated += chunkResult.updated;
        result.failed += chunkResult.failed;
        result.errors.push(...chunkResult.errors.map((error) => ({
          ...error,
          index: error.index + (index * OBJECT_REPOSITORY_IMPORT_CHUNK_SIZE)
        })));

        const processed = Math.min(entries.length, (index + 1) * OBJECT_REPOSITORY_IMPORT_CHUNK_SIZE);
        const progressPercent = entries.length ? Math.round((processed / entries.length) * 100) : 100;
        await workspaceTransactionService.appendTransactionEvent(transaction.id, {
          level: chunkResult.failed ? "warning" : "info",
          phase: "import",
          message: `Processed repository import chunk ${index + 1} of ${chunks.length}.`,
          details: {
            chunk_number: index + 1,
            chunk_count: chunks.length,
            chunk_size: chunk.length,
            processed_items: processed,
            total_items: entries.length,
            created: result.created,
            updated: result.updated,
            failed: result.failed,
            progress_percent: progressPercent
          },
          metadata: {
            processed_items: processed,
            total_items: entries.length,
            imported: result.created + result.updated,
            created: result.created,
            updated: result.updated,
            failed: result.failed,
            progress_percent: progressPercent,
            current_phase: "import",
            chunk_number: index + 1,
            chunk_count: chunks.length
          }
        });
      }

      const completedAt = new Date().toISOString();
      const imported = result.created + result.updated;
      await workspaceTransactionService.updateTransaction(transaction.id, {
        status: "completed",
        description: `Object repository import completed: ${result.created} created, ${result.updated} updated, ${result.failed} failed.`,
        metadata: {
          import_source: req.body.import_source || "object_repository_import",
          total_items: entries.length,
          processed_items: entries.length,
          imported,
          created: result.created,
          updated: result.updated,
          failed: result.failed,
          progress_percent: 100,
          current_phase: "completed"
        },
        completed_at: completedAt
      });
      await workspaceTransactionService.appendTransactionEvent(transaction.id, {
        level: result.failed ? "warning" : "success",
        phase: "complete",
        message: `Object repository import completed: ${result.created} created, ${result.updated} updated, ${result.failed} failed.`,
        details: result
      });
      await workspaceTransactionService.createTransactionNotification(transaction.id, {
        type: result.failed ? "batch_process.completed_with_warnings" : "batch_process.completed",
        title: "Object repository import completed",
        message: `Created ${result.created}, updated ${result.updated}, failed ${result.failed}.`
      });

      return {
        ...result,
        transaction_id: transaction.id
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Object repository import failed";

      await workspaceTransactionService.updateTransaction(transaction.id, {
        status: "failed",
        description: message,
        metadata: {
          current_phase: "failed",
          error: message
        },
        completed_at: new Date().toISOString()
      });
      await workspaceTransactionService.appendTransactionEvent(transaction.id, {
        level: "error",
        phase: "failed",
        message
      });
      await workspaceTransactionService.createTransactionNotification(transaction.id, {
        type: "batch_process.failed",
        title: "Object repository import failed",
        message
      });
      throw error;
    }
  });

  fastify.post("/test-cases/automation/learning-cache/extract-fields", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: false, type: "string" },
      screen_name: { required: true, type: "string", minLength: 1 },
      page_url: { required: false, type: "string" },
      dom_structure: { required: false, type: "string" },
      screenshot_url: { required: false, type: "string" },
      business_meaning: { required: false, type: "string" },
      candidate_fields: { required: false, type: "array" },
      integration_id: { required: false, type: "string" }
    }, req.body || {});

    let projectId = null;
    if (req.body?.app_type_id) {
      const appType = await appTypeService.getAppType(req.body.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
      projectId = appType.project_id;
    } else if (req.user?.role !== "admin") {
      throw new Error("App type scope is required");
    }

    return aiAutomationBuilderService.extractRepositoryFields({
      ...(req.body || {}),
      user_id: req.user.id,
      project_id: projectId
    });
  });

  fastify.get("/test-cases/automation/learning-cache/:id/usage", async (req) => {
    await fastify.authenticate(req);
    const entry = await aiAutomationBuilderService.getLearningCacheEntry(req.params.id);

    if (entry.app_type_id) {
      const appType = await appTypeService.getAppType(entry.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    } else if (entry.project_id) {
      await projectService.getProject(entry.project_id, req.user.id);
    } else if (req.user?.role !== "admin") {
      throw new Error("Object repository entry is not scoped to a project");
    }

    return aiAutomationBuilderService.findLearningCacheUsage(entry);
  });

  fastify.put("/test-cases/automation/learning-cache/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      page_url: { required: false, type: "string" },
      page_key: { required: false, type: "string" },
      locator_intent: { required: false, type: "string" },
      locator: { required: false, type: "string" },
      locator_kind: { required: false, type: "string" },
      confidence: { required: false, type: "number" },
      source: { required: false, type: "string" },
      screen_name: { required: false, type: "string" },
      object_name: { required: false, type: "string" },
      object_role: { required: false, type: "string" },
      target_criteria: { required: false, type: "array" },
      dom_structure: { required: false, type: "string" },
      dom_path: { required: false, type: "string" },
      screenshot_url: { required: false, type: "string" },
      screenshot_path: { required: false, type: "string" },
      fallback_strategy: { required: false, type: "string" },
      platform: { required: false, type: "string" },
      url_pattern_type: { required: false, type: "string" },
      url_pattern_value: { required: false, type: "string" },
      screen_fingerprint: { required: false, type: "string" },
      accessibility_tree: { required: false, type: "string" },
      fallback_locators: { required: false, type: "array" },
      description: { required: false, type: "string" },
      business_meaning: { required: false, type: "string" },
      usage_keywords: { required: false, type: "array" },
      stability_score: { required: false, type: "number" },
      last_validated_at: { required: false, type: "string" },
      validation_history: { required: false, type: "array" },
      ancestor_dom: { required: false, type: "string" },
      ancestor_screenshot_url: { required: false, type: "string" },
      element_screenshot_url: { required: false, type: "string" },
      metadata: { required: false, type: "object" }
    }, req.body || {});

    const entry = await aiAutomationBuilderService.getLearningCacheEntry(req.params.id);

    if (entry.app_type_id) {
      const appType = await appTypeService.getAppType(entry.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    } else if (entry.project_id) {
      await projectService.getProject(entry.project_id, req.user.id);
    } else if (req.user?.role !== "admin") {
      throw new Error("Object repository entry is not scoped to a project");
    }

    return aiAutomationBuilderService.updateLearningCacheEntry(req.params.id, req.body || {});
  });

  fastify.post("/test-cases/automation/learning-cache", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: false, type: "string" },
      app_type_id: { required: false, type: "string" },
      page_url: { required: false, type: "string" },
      page_key: { required: false, type: "string" },
      locator_intent: { required: false, type: "string" },
      locator: { required: true, type: "string" },
      locator_kind: { required: false, type: "string" },
      screen_name: { required: false, type: "string" },
      object_name: { required: false, type: "string" },
      object_role: { required: false, type: "string" },
      dom_structure: { required: false, type: "string" },
      screenshot_url: { required: false, type: "string" },
      fallback_strategy: { required: false, type: "string" },
      screen_dom_compressed: { required: false, type: "string" },
      screen_screenshot_url: { required: false, type: "string" },
      metadata: { required: false, type: "object" }
    }, req.body || {});

    let resolvedProjectId = req.body?.project_id || null;

    if (req.body?.app_type_id) {
      const appType = await appTypeService.getAppType(req.body.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
      if (resolvedProjectId && resolvedProjectId !== appType.project_id) {
        throw new Error("Object repository project scope must match the selected app type");
      }
      resolvedProjectId = appType.project_id;
    } else if (req.body?.project_id) {
      await projectService.getProject(req.body.project_id, req.user.id);
    } else if (req.user?.role !== "admin") {
      throw new Error("Project or app type scope is required");
    }

    return aiAutomationBuilderService.createLearningCacheEntry({
      ...(req.body || {}),
      project_id: resolvedProjectId || undefined
    });
  });

  fastify.delete("/test-cases/automation/learning-cache/:id", async (req) => {
    await fastify.authenticate(req);
    const entry = await aiAutomationBuilderService.getLearningCacheEntry(req.params.id);

    if (entry.app_type_id) {
      const appType = await appTypeService.getAppType(entry.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    } else if (entry.project_id) {
      await projectService.getProject(entry.project_id, req.user.id);
    } else if (req.user?.role !== "admin") {
      throw new Error("Object repository entry is not scoped to a project");
    }

    return aiAutomationBuilderService.deleteLearningCacheEntry(req.params.id, {
      confirmed: req.query?.confirm === "true"
    });
  });

  fastify.delete("/test-cases/automation/learning-cache/screens/:screenName", async (req) => {
    await fastify.authenticate(req);
    const { app_type_id, project_id } = req.query || {};

    if (app_type_id) {
      const appType = await appTypeService.getAppType(app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    } else if (project_id) {
      await projectService.getProject(project_id, req.user.id);
    } else if (req.user?.role !== "admin") {
      throw new Error("App type scope is required");
    }

    return aiAutomationBuilderService.deleteLearningCacheScreen({
      app_type_id,
      project_id,
      screen_name: decodeURIComponent(req.params.screenName),
      confirmed: req.query?.confirm === "true"
    });
  });

  fastify.get("/test-cases/automation/learning-cache/screens/:screenName/usage", async (req) => {
    await fastify.authenticate(req);
    const { app_type_id, project_id } = req.query || {};

    if (app_type_id) {
      const appType = await appTypeService.getAppType(app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    } else if (project_id) {
      await projectService.getProject(project_id, req.user.id);
    } else if (req.user?.role !== "admin") {
      throw new Error("App type scope is required");
    }

    return aiAutomationBuilderService.findLearningCacheScreenUsage({
      app_type_id,
      project_id,
      screen_name: decodeURIComponent(req.params.screenName)
    });
  });

  fastify.put("/test-cases/automation/learning-cache/screens/:screenName", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: false, type: "string" },
      project_id: { required: false, type: "string" },
      new_name: { required: true, type: "string", minLength: 1 }
    }, req.body || {});

    if (req.body?.app_type_id) {
      const appType = await appTypeService.getAppType(req.body.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    } else if (req.body?.project_id) {
      await projectService.getProject(req.body.project_id, req.user.id);
    } else if (req.user?.role !== "admin") {
      throw new Error("App type scope is required");
    }

    return aiAutomationBuilderService.renameLearningCacheScreen({
      app_type_id: req.body?.app_type_id,
      project_id: req.body?.project_id,
      screen_name: decodeURIComponent(req.params.screenName),
      new_name: req.body?.new_name
    });
  });

  fastify.post("/test-cases/automation/learning-cache/:id/ai-improve", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      integration_id: { required: false, type: "string" },
      guidance: { required: false, type: "string" }
    }, req.body || {});

    const entry = await aiAutomationBuilderService.getLearningCacheEntry(req.params.id);

    if (entry.app_type_id) {
      const appType = await appTypeService.getAppType(entry.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    } else if (entry.project_id) {
      await projectService.getProject(entry.project_id, req.user.id);
    } else if (req.user?.role !== "admin") {
      throw new Error("Object repository entry is not scoped to a project");
    }

    return aiAutomationBuilderService.improveLearningCacheEntry({
      id: req.params.id,
      integration_id: req.body?.integration_id,
      user_id: req.user.id,
      guidance: req.body?.guidance
    });
  });

  fastify.put("/test-cases/automation/learning-cache/:id/ai-improve/apply", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      confirmed: { required: true, type: "boolean" },
      locator: { required: true, type: "string", maxLength: 8192 },
      strategy: { required: true, type: "string", maxLength: 100 },
      expected_locator: { required: true, type: "string" },
      confidence: { required: false, type: "number" },
      request_id: { required: false, type: "string", maxLength: 100 }
    }, req.body || {});
    const entry = await aiAutomationBuilderService.getLearningCacheEntry(req.params.id);
    const projectId = entry.app_type_id ? (await appTypeService.getAppType(entry.app_type_id)).project_id : entry.project_id;
    if (!projectId) throw Object.assign(new Error("Object repository entry is not scoped to a project"), { statusCode: 400 });
    await projectService.getProject(projectId, req.user.id);
    await fastify.requirePermission("automation.repository.manage", { projectId })(req);
    return aiAutomationBuilderService.applyLearningCacheImprovement({ ...req.body, id: entry.id, user_id: req.user.id });
  });

  fastify.get("/test-cases/automation/jobs/:transactionId", async (req) => {
    await fastify.authenticate(req);
    const transaction = await workspaceTransactionService.getTransaction(req.params.transactionId);
    if (transaction.category !== "automation_build" || !transaction.project_id) {
      const error = new Error("Automation build not found");
      error.statusCode = 404;
      throw error;
    }
    await projectService.getProject(transaction.project_id, req.user.id);
    for(const code of ["automation.build","automation.view","automation.code.view","automation.ai"])await fastify.requirePermission(code,{projectId:transaction.project_id})(req);
    return require("@hellotest/automation/backend/services/automationAgentActivity.service").activity(transaction,req.query);
  });

  fastify.get("/test-cases/automation/agent-activity",async(req)=>{
    await fastify.authenticate(req);
    fastify.validate({app_type_id:{required:true,type:"string"},test_case_id:{required:false,type:"string"}},req.query||{});
    const app=await appTypeService.getAppType(req.query.app_type_id);
    await projectService.getProject(app.project_id,req.user.id);
    for(const code of ["automation.build","automation.view","automation.code.view","automation.ai"])await fastify.requirePermission(code,{projectId:app.project_id})(req);
    return require("@hellotest/automation/backend/services/automationAgentActivity.service").latest({projectId:app.project_id,appTypeId:app.id,caseId:req.query.test_case_id});
  });

  fastify.get("/test-cases/automation/agent-activities",async(req)=>{
    await fastify.authenticate(req);
    fastify.validate({app_type_id:{required:true,type:"string"},test_case_id:{required:false,type:"string"}},req.query||{});
    const app=await appTypeService.getAppType(req.query.app_type_id);
    await projectService.getProject(app.project_id,req.user.id);
    for(const code of ["automation.build","automation.view","automation.code.view","automation.ai"])await fastify.requirePermission(code,{projectId:app.project_id})(req);
    return require("@hellotest/automation/backend/services/automationAgentActivity.service").history({projectId:app.project_id,appTypeId:app.id,caseId:req.query.test_case_id},req.query);
  });

  fastify.get("/test-cases/automation/jobs/:transactionId/screenshots/:artifactId",async(req)=>{
    await fastify.authenticate(req);
    const transaction=await workspaceTransactionService.getTransaction(req.params.transactionId);
    if(transaction.category!=="automation_build"||!transaction.project_id)throw Object.assign(new Error("Automation build not found"),{statusCode:404});
    await projectService.getProject(transaction.project_id,req.user.id);
    for(const code of ["automation.build","automation.view","automation.code.view","automation.ai"])await fastify.requirePermission(code,{projectId:transaction.project_id})(req);
    return require("@hellotest/automation/backend/services/automationAgentActivity.service").screenshot(transaction,req.params.artifactId);
  });

  // Generated drafts and browser observations are content, not ordinary job metadata.
  // Recheck the generation-content permissions on each read, including old activities.
  const readAutomationActivityContent = (reader) => async (req) => {
      await fastify.authenticate(req);
      const transaction = await workspaceTransactionService.getTransaction(req.params.transactionId);
      if (transaction.category !== "automation_build" || !transaction.project_id) {
        throw Object.assign(new Error("Automation build not found"), { statusCode: 404 });
      }
      await projectService.getProject(transaction.project_id, req.user.id);
      for (const code of ["automation.build", "automation.view", "automation.code.view", "automation.ai"]) {
        await fastify.requirePermission(code, { projectId: transaction.project_id })(req);
      }
      if (reader === "buildData") await fastify.requirePermission("data.view", { projectId: transaction.project_id })(req);
      return require("@hellotest/automation/backend/services/automationAgentActivity.service")[reader](transaction, req.params.artifactId);
  };
  fastify.get("/test-cases/automation/jobs/:transactionId/previews/:artifactId", readAutomationActivityContent("preview"));
  fastify.get("/test-cases/automation/jobs/:transactionId/evidence/:artifactId", readAutomationActivityContent("evidence"));
  fastify.get("/test-cases/automation/jobs/:transactionId/build-data/:artifactId", readAutomationActivityContent("buildData"));

  fastify.post("/test-cases/automation/build-batch", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      test_case_ids: { required: false, type: "array", items: "string" },
      integration_id: { required: false, type: "string" },
      ai_feature: { required: false, type: "string", enum: ["ai.automation.keyword_generation", "ai.automation.review", "ai.automation.gap_analysis", "ai.execution.network_to_api_steps", "ai.agentic.automation-engineer"] },
      allow_browser_actions: { required: false, type: "boolean" },
      verification_mode: { required: false, type: "string", enum: ["generate_only", "verify", "verify_repair"] },
      browser_driver: { required: false, type: "string", enum: ["mcp"] },
      verification_driver: { required: false, type: "string", enum: ["native", "playwright_test_cli"] },
      start_url: { required: false, type: "string" },
      additional_context: { required: false, type: "string" },
      agent_context: { required: false, type: "object" },
      test_environment_id: { required: false, type: "string" },
      test_configuration_id: { required: false, type: "string" },
      test_suite_id: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      failure_threshold: { required: false, type: "number" },
      test_suite_ids_by_case: { required: false, type: "object" },
      parameter_values_by_case: { required: false, type: "object" },
      parameter_plan_keys_by_case: { required: false, type: "object" },
      scheduled_at: { required: false, type: "string" }
    }, req.body);

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    await fastify.requirePermission("automation.build", { projectId: appType.project_id })(req);
    await fastify.requirePermission("automation.ai", { projectId: appType.project_id })(req);
    await ensureTestCaseDataSetAccess(fastify, req, appType.project_id, req.body?.test_data_set_id);
    if(req.body?.test_suite_id||Object.values(req.body?.test_suite_ids_by_case||{}).some(Boolean))await fastify.requirePermission("suite.view",{projectId:appType.project_id})(req);

    return batchProcessService.queueAutomationBuild({
      ...req.body,
      allow_browser_actions: req.body.allow_browser_actions === true,
      created_by: req.user.id
    });
  });

  fastify.post("/test-cases/automation/bulk-delete", async(req)=>{
    await fastify.authenticate(req);
    fastify.validate({project_id:{required:true,type:"string"},app_type_id:{required:true,type:"string"},test_case_ids:{required:true,type:"array",items:"string",minItems:1,maxItems:10000}},req.body||{});
    const {project_id,app_type_id}=req.body;
    await projectService.getProject(project_id,req.user.id);
    await fastify.requirePermission("testcase.delete",{projectId:project_id})(req);
    const app=await appTypeService.getAppType(app_type_id);
    if(app.project_id!==project_id)throw Object.assign(new Error("The application does not belong to this project."),{statusCode:403});
    return require('../services/automationCaseDeletion.service').deleteAutomationCases(req.body,{actorId:req.user.id,ipAddress:req.ip});
  });

  fastify.get("/test-cases/review-summary", async (req, reply) => {
    await fastify.authenticate(req);
    const { project_id, app_type_id } = req.query;
    const scopedProjectId = await resolveTestCaseListProjectId({ project_id, app_type_id });
    if (!scopedProjectId) {
      throw Object.assign(new Error("project_id or app_type_id is required for pending reviews"), { statusCode: 400 });
    }
    await projectService.getProject(scopedProjectId, req.user.id);
    await fastify.requirePermission("testcase.view", { projectId: scopedProjectId })(req);
    reply.header("Cache-Control", "no-store");
    return catalogService.getReviewSummary({ project_id: scopedProjectId, app_type_id, review_user_id: req.user.id });
  });

  fastify.get("/test-cases/metrics", async (req) => {
    await fastify.authenticate(req);
    const scopedProjectId = await resolveTestCaseListProjectId(req.query);
    if (scopedProjectId) {
      await projectService.getProject(scopedProjectId, req.user.id);
      await fastify.requirePermission("testcase.view", { projectId: scopedProjectId })(req);
    } else if (req.user.role !== "admin") {
      throw Object.assign(new Error("project_id or app_type_id is required for Test Case metrics"), { statusCode: 400 });
    }
    if (req.query.include_execution === true || req.query.include_execution === "true") {
      await fastify.requirePermission("run.view", { projectId: scopedProjectId })(req);
      await fastify.requirePermission("result.view", { projectId: scopedProjectId })(req);
    }
    return catalogService.getMetrics({ ...req.query, project_id: scopedProjectId || req.query.project_id,
      review_user_id: req.query.review_queue ? req.user.id : undefined });
  });

  fastify.get("/test-cases", async (req) => {
    await fastify.authenticate(req);
    const { project_id, suite_id, requirement_id, module_id, unassigned_module, status, app_type_id } = req.query;
    const scopedProjectId = await resolveTestCaseListProjectId(req.query);

    if (scopedProjectId) {
      await projectService.getProject(scopedProjectId, req.user.id);
      await fastify.requirePermission("testcase.view", { projectId: scopedProjectId })(req);
    } else if (req.user.role !== "admin") {
      const error = new Error("project_id, app_type_id, suite_id, requirement_id, or module_id is required when listing Test Cases");
      error.statusCode = 400;
      throw error;
    }

    const filters = {
      ...req.query,
      review_user_id: req.query.review_queue ? req.user.id : undefined,
      project_id: scopedProjectId || project_id,
      suite_id, requirement_id, module_id, status, app_type_id,
      unassigned_module: unassigned_module === true || unassigned_module === "true"
    };
    if (req.query.projection !== "picker" && (req.query.include_execution === true || req.query.include_execution === "true")) {
      await fastify.requirePermission("run.view", { projectId: scopedProjectId })(req);
      await fastify.requirePermission("result.view", { projectId: scopedProjectId })(req);
    }
    if (req.query.review_queue !== undefined || req.query.projection === "picker" || shouldPaginate(req.query)) return catalogService.listPage(filters);
    return service.getTestCases(filters);
  });

  fastify.post("/test-cases/resolve-requirements", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      requirement_ids: { required: true, type: "array", items: "string", minItems: 1, maxItems: 100 }
    }, req.body || {});

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    await fastify.requirePermission("testcase.view", { projectId: appType.project_id })(req);
    await fastify.requirePermission("requirement.view", { projectId: appType.project_id })(req);
    const selectedRequirementIds = testCaseScopeService.uniqueIds(req.body.requirement_ids);
    if (!selectedRequirementIds.length) throw Object.assign(new Error("Select at least one requirement"), { statusCode: 400 });
    const scopedRequirements = await testCaseScopeService.resolveRequirementScopes(selectedRequirementIds);
    const byId = new Map(scopedRequirements.map((requirement) => [requirement.id, requirement]));
    for (const id of selectedRequirementIds) {
      if (!byId.has(id)) throw Object.assign(new Error("Requirement not found"), { statusCode: 404 });
      if (byId.get(id).project_id !== appType.project_id) throw Object.assign(new Error("Requirement must belong to the same project as the selected app type"), { statusCode: 403 });
    }

    return service.getTestCasesForRequirements({
      app_type_id: appType.id,
      requirement_ids: scopedRequirements.map((requirement) => requirement.id)
    });
  });

  fastify.get("/test-cases/:id/versions", async (req) => {
    await fastify.authenticate(req);
    await ensureTestCasePermission(fastify, req, "testcase.view");
    return testCaseVersionService.list(req.params.id);
  });

  fastify.get("/test-cases/:id/versions/:revision", async (req) => {
    await fastify.authenticate(req);
    await ensureTestCasePermission(fastify, req, "testcase.view");
    return testCaseVersionService.get(req.params.id, Number(req.params.revision));
  });

  fastify.post("/test-cases/:id/versions/:revision/restore", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      expected_revision: { required: false, type: "number" }
    }, req.body || {});
    await ensureTestCasePermission(fastify, req, "testcase.update");
    return testCaseVersionRestoreService.restore({
      testCaseId: req.params.id,
      revision: Number(req.params.revision),
      userId: req.user.id,
      expectedRevision: req.body?.expected_revision
    });
  });

  fastify.get("/test-cases/:id", async (req) => {
    await fastify.authenticate(req);
    const { testCase,projectId } = await ensureTestCasePermission(fastify, req, "testcase.view");
    let response=testCase;
    if(testCase.automated==='yes'){
      const access=await require('@hellotest/platform/backend/services/optionalEvidenceAccess.service').getOptionalEvidenceAccess(req.user,projectId,['data.view']);
      response=access['data.view']?{...await service.withParameterDefaults(testCase,{projectId}),parameter_defaults_access:'allowed'}:{...testCase,parameter_defaults_access:'restricted'};
    }
    if (req.query.include_execution === true || req.query.include_execution === "true") {
      await fastify.requirePermission("run.view", {projectId})(req);
      await fastify.requirePermission("result.view", {projectId})(req);
      return {...response,automation_coverage:await require('../services/automationCaseCoverage.service').getCoverage(testCase.id)};
    }
    return response;
  });

  fastify.post("/test-cases/:id/automation/parameter-plan", async (req,reply) => {
    await fastify.authenticate(req);
    fastify.validate({
      test_environment_id: { required: false, type: "string" },
      test_configuration_id: { required: false, type: "string" },
      test_suite_id: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      parameter_values: { required: false, type: "object" }
    }, req.body || {});
    const {testCase,projectId}=await ensureTestCasePermission(fastify,req,"automation.build");
    await ensureTestCaseDataSetAccess(fastify,req,projectId,req.body?.test_data_set_id);
    if(req.body?.test_suite_id)await fastify.requirePermission("suite.view",{projectId})(req);
    reply.header('Cache-Control','no-store');
    return require('@hellotest/automation/backend/services/automationBuildParameterPlan.service').load({
      caseId:testCase.id,projectId,userId:req.user.id,
      test_environment_id:req.body?.test_environment_id,
      test_configuration_id:req.body?.test_configuration_id,
      test_suite_id:req.body?.test_suite_id,
      test_data_set_id:req.body?.test_data_set_id,
      parameter_values:req.body?.parameter_values
    });
  });

  fastify.post("/test-cases/:id/automation/build", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      integration_id: { required: false, type: "string" },
      ai_feature: { required: false, type: "string", enum: ["ai.automation.keyword_generation", "ai.automation.review", "ai.automation.gap_analysis", "ai.execution.network_to_api_steps", "ai.agentic.automation-engineer"] },
      allow_browser_actions: { required: false, type: "boolean" },
      verification_mode: { required: false, type: "string", enum: ["generate_only", "verify", "verify_repair"] },
      browser_driver: { required: false, type: "string", enum: ["mcp"] },
      verification_driver: { required: false, type: "string", enum: ["native", "playwright_test_cli"] },
      start_url: { required: false, type: "string" },
      additional_context: { required: false, type: "string" },
      agent_context: { required: false, type: "object" },
      test_environment_id: { required: false, type: "string" },
      test_configuration_id: { required: false, type: "string" },
      test_suite_id: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      captured_actions: { required: false, type: "array" },
      captured_network: { required: false, type: "array" },
      parameter_values: { required: false, type: "object" },
      parameter_plan_key: { required: false, type: "string" }
    }, req.body || {});

    const { projectId } = await ensureTestCasePermission(fastify, req, "automation.build");
    await ensureTestCasePermission(fastify, req, "automation.ai");
    await ensureTestCaseDataSetAccess(fastify, req, projectId, req.body?.test_data_set_id);
    if(req.body?.test_suite_id)await fastify.requirePermission("suite.view",{projectId})(req);

    return aiAutomationBuilderService.buildAutomationForCase({
      test_case_id: req.params.id,
      integration_id: req.body?.integration_id,
      ai_feature: req.body?.ai_feature,
      start_url: req.body?.start_url,
      allow_browser_actions: req.body?.allow_browser_actions === true,
      verification_mode: req.body?.verification_mode,
      browser_driver: req.body?.browser_driver,
      verification_driver: req.body?.verification_driver,
      additional_context: req.body?.additional_context,
      agent_context: req.body?.agent_context,
      test_environment_id: req.body?.test_environment_id,
      test_configuration_id: req.body?.test_configuration_id,
      test_suite_id:req.body?.test_suite_id,
      test_data_set_id: req.body?.test_data_set_id,
      parameter_values: req.body?.parameter_values,
      parameter_plan_key: req.body?.parameter_plan_key,
      captured_actions: req.body?.captured_actions,
      captured_network: req.body?.captured_network,
      created_by: req.user.id
    });
  });

  fastify.post("/test-cases/:id/automation/generator-jobs", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      integration_id: { required: false, type: "string" },
      ai_feature: { required: false, type: "string", enum: ["ai.automation.keyword_generation", "ai.automation.review", "ai.automation.gap_analysis", "ai.execution.network_to_api_steps", "ai.agentic.automation-engineer"] },
      allow_browser_actions: { required: false, type: "boolean" },
      verification_mode: { required: false, type: "string", enum: ["generate_only", "verify", "verify_repair"] },
      browser_driver: { required: false, type: "string", enum: ["mcp"] },
      verification_driver: { required: false, type: "string", enum: ["native", "playwright_test_cli"] },
      start_url: { required: false, type: "string" },
      additional_context: { required: false, type: "string" },
      agent_context: { required: false, type: "object" },
      test_environment_id: { required: false, type: "string" },
      test_configuration_id: { required: false, type: "string" },
      test_suite_id: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      parameter_values: { required: false, type: "object" },
      parameter_plan_key: { required: false, type: "string" },
      scheduled_at: { required: false, type: "string" }
    }, req.body || {});

    const { projectId } = await ensureTestCasePermission(fastify, req, "automation.build");
    await ensureTestCasePermission(fastify, req, "automation.ai");
    await ensureTestCaseDataSetAccess(fastify, req, projectId, req.body?.test_data_set_id);
    if(req.body?.test_suite_id)await fastify.requirePermission("suite.view",{projectId})(req);

    return automationGeneratorService.queueGeneratorJob({
      test_case_id: req.params.id,
      scheduled_at: req.body?.scheduled_at,
      integration_id: req.body?.integration_id,
      ai_feature: req.body?.ai_feature,
      start_url: req.body?.start_url,
      allow_browser_actions: req.body?.allow_browser_actions === true,
      verification_mode: req.body?.verification_mode,
      browser_driver: req.body?.browser_driver,
      verification_driver: req.body?.verification_driver,
      additional_context: req.body?.additional_context,
      agent_context: req.body?.agent_context,
      test_environment_id: req.body?.test_environment_id,
      test_configuration_id: req.body?.test_configuration_id,
      test_suite_id:req.body?.test_suite_id,
      test_data_set_id: req.body?.test_data_set_id,
      parameter_values: req.body?.parameter_values,
      parameter_plan_key: req.body?.parameter_plan_key,
      created_by: req.user.id
    });
  });

  fastify.post("/test-cases/:id/automation/recorder-session", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      start_url: { required: false, type: "string" },
      recorder_mode: { required: false, type: "string" },
      recorder_target: { required: false, type: "string" },
      engine_base_url: { required: false, type: "string" },
      recorder_public_base_url: { required: false, type: "string" },
      reuse_existing: { required: false, type: "boolean" },
      test_environment_id: { required: false, type: "string" },
      test_configuration_id: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      target_step_id: { required: false, type: "string" }
    }, req.body || {});

    const { testCase, projectId } = await ensureTestCasePermission(fastify, req, "automation.recorder");
    const appType = testCase.app_type_id ? await appTypeService.getAppType(testCase.app_type_id) : null;
    if (isMobileRecorderTarget(req.body?.recorder_target) || isMobileAppType(appType?.type)) {
      await fastify.requirePermission("mobile.manage", { projectId })(req);
    }
    await ensureTestCaseDataSetAccess(fastify, req, projectId, req.body?.test_data_set_id);

    return aiAutomationBuilderService.startRecorderSession({
      test_case_id: req.params.id,
      start_url: req.body?.start_url,
      recorder_mode: req.body?.recorder_mode,
      recorder_target: req.body?.recorder_target,
      engine_base_url: req.body?.engine_base_url,
      recorder_public_base_url: req.body?.recorder_public_base_url,
      reuse_existing: req.body?.reuse_existing,
      test_environment_id: req.body?.test_environment_id,
      test_configuration_id: req.body?.test_configuration_id,
      test_data_set_id: req.body?.test_data_set_id,
      target_step_id: req.body?.target_step_id,
      created_by: req.user.id
    });
  });

  fastify.post("/test-cases/:id/automation/recorder-session/:sessionId/finish", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      transaction_id: { required: false, type: "string" },
      integration_id: { required: false, type: "string" },
      additional_context: { required: false, type: "string" },
      recorder_mode: { required: false, type: "string" },
      recorder_target: { required: false, type: "string" },
      engine_base_url: { required: false, type: "string" },
      test_environment_id: { required: false, type: "string" },
      test_configuration_id: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      target_step_id: { required: false, type: "string" },
      included_action_indices: { required: false, type: "array", items: "number" }
    }, req.body || {});

    const { testCase, projectId } = await ensureTestCasePermission(fastify, req, "automation.recorder");
    const appType = testCase.app_type_id ? await appTypeService.getAppType(testCase.app_type_id) : null;
    const recorderTransaction = req.body?.transaction_id
      ? await workspaceTransactionService.getTransaction(req.body.transaction_id).catch(() => null)
      : null;
    const recorderTarget = req.body?.recorder_target || recorderTransaction?.metadata?.recorder_target;
    if (isMobileRecorderTarget(recorderTarget) || isMobileAppType(appType?.type)) {
      await fastify.requirePermission("mobile.manage", { projectId })(req);
    }
    await ensureTestCaseDataSetAccess(fastify, req, projectId, req.body?.test_data_set_id);

    return aiAutomationBuilderService.finishRecorderSession({
      test_case_id: req.params.id,
      recorder_session_id: req.params.sessionId,
      transaction_id: req.body?.transaction_id,
      integration_id: req.body?.integration_id,
      additional_context: req.body?.additional_context,
      recorder_mode: req.body?.recorder_mode,
      recorder_target: req.body?.recorder_target,
      engine_base_url: req.body?.engine_base_url,
      test_environment_id: req.body?.test_environment_id,
      test_configuration_id: req.body?.test_configuration_id,
      test_data_set_id: req.body?.test_data_set_id,
      target_step_id: req.body?.target_step_id,
      included_action_indices: req.body?.included_action_indices,
      created_by: req.user.id
    });
  });

  fastify.post("/test-cases/design-test-cases-preview", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      requirement_ids: { required: false, type: "array", items: "string" },
      integration_id: { required: false, type: "string" },
      max_cases: { required: false, type: "number" },
      authoring_mode: { required: false, type: "string", enum: ["structured", "gherkin"] },
      additional_context: { required: false, type: "string" },
      external_links: { required: false, type: "array", items: "string" },
      images: { required: false, type: "array" }
    }, req.body);

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    const requirements = await resolveScopedRequirements(req.body.requirement_ids, appType.project_id, true);
    await requireMobileAuthoringPermission(fastify, req, appType.project_id, {
      appType,
      payload: req.body.cases
    });

    return requirementDesignService.previewRequirementsTestCases({
      requirements,
      appType,
      integration_id: req.body.integration_id,
      user_id: req.user.id,
      max_cases: req.body.max_cases,
      authoring_mode: req.body.authoring_mode,
      additional_context: req.body.additional_context,
      external_links: req.body.external_links,
      images: req.body.images
    });
  });

  fastify.post("/test-cases/ai-authoring-preview", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      requirement_id: { required: false, type: "string" },
      authoring_mode: { required: false, type: "string", enum: ["structured", "gherkin"] },
      integration_id: { required: false, type: "string" },
      additional_context: { required: false, type: "string" },
      external_links: { required: false, type: "array", items: "string", maxItems: 20 },
      images: { required: false, type: "array", maxItems: 6 },
      test_case: { required: false, type: "object" }
    }, req.body);

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    const [requirement] = await resolveScopedRequirements([req.body.requirement_id], appType.project_id, true);

    return aiCaseAuthoringService.previewCaseAuthoring({
      requirement,
      appType,
      integration_id: req.body.integration_id,
      user_id: req.user.id,
      authoring_mode: req.body.authoring_mode,
      additional_context: req.body.additional_context,
      external_links: req.body.external_links,
      images: req.body.images,
      test_case: req.body.test_case
    });
  });

  fastify.post("/test-cases/ai-step-rephrase", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      requirement_id: { required: false, type: "string" },
      integration_id: { required: false, type: "string" },
      ai_feature: { required: false, type: "string", enum: ["ai.case_authoring.step_rephrase", "ai.automation.step_rephrase"] },
      additional_context: { required: false, type: "string" },
      test_case: { required: false, type: "object" },
      step: { required: true, type: "object" }
    }, req.body);

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    const requirement = req.body.requirement_id
      ? await requirementService.getRequirement(req.body.requirement_id)
      : null;

    if (requirement && requirement.project_id !== appType.project_id) {
      throw new Error("Requirement must belong to the same project as the selected app type");
    }

    return aiCaseAuthoringService.rephraseTestStep({
      requirement,
      appType,
      integration_id: req.body.integration_id,
      ai_feature: req.body.ai_feature,
      user_id: req.user.id,
      additional_context: req.body.additional_context,
      test_case: req.body.test_case,
      step: req.body.step
    });
  });

  fastify.post("/test-cases/design-test-cases-accept", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      requirement_ids: { required: false, type: "array", items: "string" },
      status: { required: false, type: "string", enum: TEST_CASE_STATUS_VALUES },
      cases: { required: true, type: "array" }
    }, req.body);

    if (!req.body.cases.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      throw new Error("cases must contain test case objects");
    }

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    const requirements = await resolveScopedRequirements(req.body.requirement_ids, appType.project_id, true);

    return requirementDesignService.acceptGeneratedTestCases({
      requirements,
      appType,
      status: req.body.status,
      cases: req.body.cases,
      created_by: req.user.id
    });
  });

  fastify.get("/test-cases/ai-generation-jobs", async (req) => {
    await fastify.authenticate(req);

    const { app_type_id, status, limit } = req.query;

    if (!app_type_id) {
      throw new Error("app_type_id is required");
    }

    const appType = await appTypeService.getAppType(app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);

    return aiTestCaseGenerationService.listJobs({ app_type_id, status, limit });
  });

  fastify.post("/test-cases/ai-generation-jobs", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      requirement_ids: { required: true, type: "array", items: "string" },
      integration_id: { required: false, type: "string" },
      max_cases_per_requirement: { required: false, type: "number" },
      parallel_requirement_limit: { required: false, type: "number" },
      additional_context: { required: false, type: "string" },
      external_links: { required: false, type: "array" },
      images: { required: false, type: "array" },
      authoring_mode: { required: false, type: "string", enum: ["structured", "gherkin"] }
    }, req.body);

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);

    const response = await aiTestCaseGenerationService.createJob({
      ...req.body,
      idempotency_key: req.headers["idempotency-key"],
      created_by: req.user.id
    });

    aiTestCaseGenerationService.triggerJobProcessing();
    return response;
  });

  fastify.put("/test-cases/:id", async (req) => {
    await fastify.authenticate(req);
    
    fastify.validate({
      app_type_id: { required: false, type: "string" },
      title: { required: false, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      external_references: { required: false, type: "array", items: "string" },
      labels: { required: false, type: "array", items: "string" },
      parameter_values: { required: false, type: "object" },
      automated: { required: false, type: "string", enum: TEST_CASE_AUTOMATED_VALUES },
      automation_status: { required: false, type: "string", enum: AUTOMATION_STATUS_VALUES },
      automation_start_url: { required: false, type: "string", maxLength: 2000 },
      manual_test_case_id: { required: false, type: "string" },
      manual_test_case_ids: { required: false, type: "array", items: "string" },
      authoring_mode: { required: false, type: "string", enum: ["structured", "gherkin"] },
      test_case_type: { required: false, type: "string", minLength: 1, maxLength: 120 },
      gherkin_document: { required: false, type: "string" },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string", enum: TEST_CASE_STATUS_VALUES },
      requirement_id: { required: false, type: "string" },
      requirement_ids: { required: false, type: "array", items: "string" },
      suite_id: { required: false, type: "string" },
      suite_ids: { required: false, type: "array", items: "string" },
      test_data_set_ids: { required: false, type: "array", items: "string", maxItems: 1 },
      test_data_options: { required: false, type: "object" },
      execution_hooks: { required: false, type: "array", maxItems: 20 },
      author_id: { required: false, type: "string" },
      reviewer_id: { required: false, type: "string" },
      review_status: { required: false, type: "string", enum: ["not_requested", "pending", "accepted", "changes_requested"] },
      review_history: { required: false, type: "array" },
      ai_quality_score: { required: false, type: "number" },
      steps: { required: false, type: "array" }
    }, req.body);

    const testCase = await service.getTestCase(req.params.id);
    let scopedProjectId = null;
    const updateProjectIds = new Set();
    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      scopedProjectId = appType.project_id;
      updateProjectIds.add(appType.project_id);
      await projectService.getProject(appType.project_id, req.user.id);
      await requireMobileAuthoringPermission(fastify, req, appType.project_id, {
        appType,
        payload: req.body.steps,
        testCaseId: testCase.id
      });
    }

    if (req.body.app_type_id && req.body.app_type_id !== testCase.app_type_id) {
      const targetAppType = await appTypeService.getAppType(req.body.app_type_id);
      scopedProjectId = targetAppType.project_id;
      updateProjectIds.add(targetAppType.project_id);
      await projectService.getProject(targetAppType.project_id, req.user.id);
      await requireMobileAuthoringPermission(fastify, req, targetAppType.project_id, {
        appType: targetAppType,
        payload: req.body.steps
      });
    }
    await Promise.all(Array.from(updateProjectIds, (projectId) =>
      fastify.requirePermission("testcase.update", { projectId })(req)
    ));
    const requirementIds = req.body.requirement_ids || (req.body.requirement_id ? [req.body.requirement_id] : []);
    if (requirementIds.length && scopedProjectId) {
      await fastify.requirePermission("requirement.view", { projectId: scopedProjectId })(req);
      await resolveScopedRequirements(requirementIds, scopedProjectId);
    }
    await ensureSuiteAssignmentAccess(
      fastify,
      req,
      scopedProjectId,
      req.body.suite_ids || (req.body.suite_id ? [req.body.suite_id] : [])
    );
    if (req.body.execution_hooks?.length) {
      await fastify.requirePermission("testcase.view", { projectId: scopedProjectId })(req);
      if (req.body.execution_hooks.some(hook => hook?.target_kind === "suite")) await fastify.requirePermission("suite.view", { projectId: scopedProjectId })(req);
    }
    if (req.body.test_data_options !== undefined) {
      await fastify.requirePermission("data.view", { projectId: scopedProjectId })(req);
    }
    if (req.body.test_data_set_ids?.length) {
      const dataSet = await testDataSetService.getTestDataSet(req.body.test_data_set_ids[0]);
      const dataProjectId = dataSet.project_id;
      if (scopedProjectId && dataProjectId !== scopedProjectId) {
        const error = new Error("Test Data Set must belong to the Test Case project");
        error.statusCode = 403;
        throw error;
      }
      await projectService.getProject(dataProjectId, req.user.id);
      await fastify.requirePermission("data.view", { projectId: dataProjectId })(req);
    }

    return service.updateTestCase(req.params.id, {
      ...req.body,
      updated_by: req.user.id
    });
  });

  fastify.post("/test-cases/:id/review", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      review_status: { required: true, type: "string", enum: ["accepted", "changes_requested"] },
      comment: { required: false, type: "string" },
      expected_updated_at: { required: false, type: "string" },
      expected_revision: { required: false, type: "number" }
    }, req.body || {});

    const { testCase } = await ensureTestCasePermission(fastify, req, "testcase.update");

    return service.reviewTestCase(req.params.id, {
      ...req.body,
      expected_updated_at: req.body?.expected_updated_at ?? testCase.updated_at,
      reviewed_by: req.user.id
    });
  });

  fastify.post("/test-cases/:id/accept-generated", async (req) => {
    await fastify.authenticate(req);

    const { testCase } = await ensureTestCasePermission(fastify, req, "testcase.update");

    return service.acceptGeneratedTestCase(req.params.id, {
      ...req.body,
      expected_updated_at: req.body?.expected_updated_at ?? testCase.updated_at,
      reviewed_by: req.user.id
    });
  });

  fastify.delete("/test-cases/:id/reject-generated", async (req) => {
    await fastify.authenticate(req);

    const { testCase } = await ensureTestCasePermission(fastify, req, "testcase.delete");

    return service.rejectGeneratedTestCase(req.params.id, {
      ...req.body,
      expected_updated_at: req.body?.expected_updated_at ?? testCase.updated_at,
      reviewed_by: req.user.id
    });
  });

  fastify.delete("/test-cases/:id", async (req) => {
    await fastify.authenticate(req);
    await ensureTestCasePermission(fastify, req, "testcase.delete");
    return service.deleteTestCase(req.params.id,{deleted_by:req.user.id,ip_address:req.ip});
  });
};
