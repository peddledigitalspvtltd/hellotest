const service = require("../services/testCase.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");
const requirementService = require("../services/requirement.service");
const requirementDesignService = require("../services/requirementDesign.service");
const aiTestCaseGenerationService = require("../services/aiTestCaseGeneration.service");
const aiCaseAuthoringService = require("../services/aiCaseAuthoring.service");
const aiAutomationBuilderService = require("../services/aiAutomationBuilder.service");
const automationGeneratorService = require("../services/automationGenerator.service");
const batchProcessService = require("../services/batchProcess.service");
const workspaceTransactionService = require("../services/workspaceTransaction.service");
const testCaseVersionService = require("../services/testCaseVersion.service");
const { TEST_CASE_AUTOMATED_VALUES, TEST_CASE_STATUS_VALUES } = require("../domain/catalog");
const { paginate, shouldPaginate } = require("../utils/pagination");
const AUTOMATION_STATUS_VALUES = ["not_automated", "ready", "incomplete"];
const OBJECT_REPOSITORY_IMPORT_CHUNK_SIZE = 200;

const resolveScopedRequirements = async (requirementIds = [], projectId) => {
  const ids = [...new Set((Array.isArray(requirementIds) ? requirementIds : []).filter(Boolean))];

  if (!ids.length) {
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
      manual_test_case_id: { required: false, type: "string" },
      manual_test_case_ids: { required: false, type: "array", items: "string" },
      authoring_mode: { required: false, type: "string", enum: ["structured", "gherkin"] },
      gherkin_document: { required: false, type: "string" },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string", enum: TEST_CASE_STATUS_VALUES },
      requirement_id: { required: false, type: "string" },
      requirement_ids: { required: false, type: "array", items: "string" },
      suite_id: { required: false, type: "string" },
      suite_ids: { required: false, type: "array", items: "string" },
      reviewer_id: { required: false, type: "string" },
      review_status: { required: false, type: "string", enum: ["not_requested", "pending", "accepted", "changes_requested"] },
      review_history: { required: false, type: "array" },
      ai_quality_score: { required: false, type: "number" },
      steps: { required: false, type: "array" }
    }, req.body);

    // Verify access if app_type_id provided
    if (req.body.app_type_id) {
      const appType = await appTypeService.getAppType(req.body.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }

    return service.createTestCase({
      ...req.body,
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

    return batchProcessService.queueTestCaseExport({
      app_type_id: req.body.app_type_id,
      test_case_ids: req.body.test_case_ids,
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

    if (req.body?.app_type_id) {
      const appType = await appTypeService.getAppType(req.body.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    } else if (req.user?.role !== "admin") {
      throw new Error("App type scope is required");
    }

    return aiAutomationBuilderService.extractRepositoryFields({
      ...(req.body || {}),
      user_id: req.user.id
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

    if (req.body?.app_type_id) {
      const appType = await appTypeService.getAppType(req.body.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    } else if (req.body?.project_id) {
      await projectService.getProject(req.body.project_id, req.user.id);
    } else if (req.user?.role !== "admin") {
      throw new Error("Project or app type scope is required");
    }

    return aiAutomationBuilderService.createLearningCacheEntry(req.body || {});
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
    const { app_type_id } = req.query || {};

    if (app_type_id) {
      const appType = await appTypeService.getAppType(app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    } else if (req.user?.role !== "admin") {
      throw new Error("App type scope is required");
    }

    return aiAutomationBuilderService.deleteLearningCacheScreen({
      app_type_id,
      screen_name: decodeURIComponent(req.params.screenName),
      confirmed: req.query?.confirm === "true"
    });
  });

  fastify.get("/test-cases/automation/learning-cache/screens/:screenName/usage", async (req) => {
    await fastify.authenticate(req);
    const { app_type_id } = req.query || {};

    if (app_type_id) {
      const appType = await appTypeService.getAppType(app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    } else if (req.user?.role !== "admin") {
      throw new Error("App type scope is required");
    }

    return aiAutomationBuilderService.findLearningCacheScreenUsage({
      app_type_id,
      screen_name: decodeURIComponent(req.params.screenName)
    });
  });

  fastify.put("/test-cases/automation/learning-cache/screens/:screenName", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: false, type: "string" },
      new_name: { required: true, type: "string", minLength: 1 }
    }, req.body || {});

    if (req.body?.app_type_id) {
      const appType = await appTypeService.getAppType(req.body.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    } else if (req.user?.role !== "admin") {
      throw new Error("App type scope is required");
    }

    return aiAutomationBuilderService.renameLearningCacheScreen({
      app_type_id: req.body?.app_type_id,
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

  fastify.post("/test-cases/automation/build-batch", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      test_case_ids: { required: false, type: "array", items: "string" },
      integration_id: { required: false, type: "string" },
      start_url: { required: false, type: "string" },
      additional_context: { required: false, type: "string" },
      test_environment_id: { required: false, type: "string" },
      test_configuration_id: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      failure_threshold: { required: false, type: "number" }
    }, req.body);

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);

    return batchProcessService.queueAutomationBuild({
      ...req.body,
      created_by: req.user.id
    });
  });

  fastify.get("/test-cases", async (req) => {
    await fastify.authenticate(req);
    const { suite_id, requirement_id, module_id, unassigned_module, status, app_type_id } = req.query;
    
    // If filtering by app_type, verify access
    if (app_type_id) {
      const appType = await appTypeService.getAppType(app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }
    
    const items = await service.getTestCases({
      suite_id,
      requirement_id,
      module_id,
      unassigned_module: unassigned_module === true || unassigned_module === "true",
      status,
      app_type_id
    });
    return shouldPaginate(req.query) ? paginate(items, req.query) : items;
  });

  fastify.get("/test-cases/:id/versions", async (req) => {
    await fastify.authenticate(req);
    const testCase = await service.getTestCase(req.params.id);
    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }
    return testCaseVersionService.list(req.params.id);
  });

  fastify.get("/test-cases/:id/versions/:revision", async (req) => {
    await fastify.authenticate(req);
    const testCase = await service.getTestCase(req.params.id);
    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }
    return testCaseVersionService.get(req.params.id, Number(req.params.revision));
  });

  fastify.post("/test-cases/:id/versions/:revision/restore", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      expected_revision: { required: false, type: "number" }
    }, req.body || {});
    const testCase = await service.getTestCase(req.params.id);
    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }
    return testCaseVersionService.restore({
      testCaseId: req.params.id,
      revision: Number(req.params.revision),
      userId: req.user.id,
      expectedRevision: req.body?.expected_revision
    });
  });

  fastify.get("/test-cases/:id", async (req) => {
    await fastify.authenticate(req);
    const testCase = await service.getTestCase(req.params.id);
    // Verify access if app_type exists
    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }
    return testCase;
  });

  fastify.post("/test-cases/:id/automation/build", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      integration_id: { required: false, type: "string" },
      start_url: { required: false, type: "string" },
      additional_context: { required: false, type: "string" },
      test_environment_id: { required: false, type: "string" },
      test_configuration_id: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      captured_actions: { required: false, type: "array" },
      captured_network: { required: false, type: "array" }
    }, req.body || {});

    const testCase = await service.getTestCase(req.params.id);

    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }

    return aiAutomationBuilderService.buildAutomationForCase({
      test_case_id: req.params.id,
      integration_id: req.body?.integration_id,
      start_url: req.body?.start_url,
      additional_context: req.body?.additional_context,
      test_environment_id: req.body?.test_environment_id,
      test_configuration_id: req.body?.test_configuration_id,
      test_data_set_id: req.body?.test_data_set_id,
      captured_actions: req.body?.captured_actions,
      captured_network: req.body?.captured_network,
      created_by: req.user.id
    });
  });

  fastify.post("/test-cases/:id/automation/generator-jobs", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      integration_id: { required: false, type: "string" },
      start_url: { required: false, type: "string" },
      additional_context: { required: false, type: "string" },
      test_environment_id: { required: false, type: "string" },
      test_configuration_id: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" }
    }, req.body || {});

    const testCase = await service.getTestCase(req.params.id);

    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }

    return automationGeneratorService.queueGeneratorJob({
      test_case_id: req.params.id,
      integration_id: req.body?.integration_id,
      start_url: req.body?.start_url,
      additional_context: req.body?.additional_context,
      test_environment_id: req.body?.test_environment_id,
      test_configuration_id: req.body?.test_configuration_id,
      test_data_set_id: req.body?.test_data_set_id,
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

    const testCase = await service.getTestCase(req.params.id);

    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }

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

    const testCase = await service.getTestCase(req.params.id);

    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }

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
      requirement_ids: { required: true, type: "array", items: "string" },
      integration_id: { required: false, type: "string" },
      max_cases: { required: false, type: "number" },
      additional_context: { required: false, type: "string" },
      external_links: { required: false, type: "array", items: "string" },
      images: { required: false, type: "array" }
    }, req.body);

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    const requirements = await resolveScopedRequirements(req.body.requirement_ids, appType.project_id);

    return requirementDesignService.previewRequirementsTestCases({
      requirements,
      appType,
      integration_id: req.body.integration_id,
      user_id: req.user.id,
      max_cases: req.body.max_cases,
      additional_context: req.body.additional_context,
      external_links: req.body.external_links,
      images: req.body.images
    });
  });

  fastify.post("/test-cases/ai-authoring-preview", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      requirement_id: { required: true, type: "string" },
      integration_id: { required: false, type: "string" },
      additional_context: { required: false, type: "string" },
      test_case: { required: false, type: "object" }
    }, req.body);

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    const [requirement] = await resolveScopedRequirements([req.body.requirement_id], appType.project_id);

    return aiCaseAuthoringService.previewCaseAuthoring({
      requirement,
      appType,
      integration_id: req.body.integration_id,
      user_id: req.user.id,
      additional_context: req.body.additional_context,
      test_case: req.body.test_case
    });
  });

  fastify.post("/test-cases/ai-step-rephrase", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      requirement_id: { required: false, type: "string" },
      integration_id: { required: false, type: "string" },
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
      requirement_ids: { required: true, type: "array", items: "string" },
      status: { required: false, type: "string", enum: TEST_CASE_STATUS_VALUES },
      cases: { required: true, type: "array" }
    }, req.body);

    if (!req.body.cases.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      throw new Error("cases must contain test case objects");
    }

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    const requirements = await resolveScopedRequirements(req.body.requirement_ids, appType.project_id);

    return requirementDesignService.acceptGeneratedTestCases({
      requirements,
      appType,
      status: req.body.status,
      cases: req.body.cases
    });
  });

  fastify.get("/test-cases/ai-generation-jobs", async (req) => {
    await fastify.authenticate(req);

    const { app_type_id, status } = req.query;

    if (!app_type_id) {
      throw new Error("app_type_id is required");
    }

    const appType = await appTypeService.getAppType(app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);

    return aiTestCaseGenerationService.listJobs({ app_type_id, status });
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
      images: { required: false, type: "array" }
    }, req.body);

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);

    const response = await aiTestCaseGenerationService.createJob({
      ...req.body,
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
      manual_test_case_id: { required: false, type: "string" },
      manual_test_case_ids: { required: false, type: "array", items: "string" },
      authoring_mode: { required: false, type: "string", enum: ["structured", "gherkin"] },
      gherkin_document: { required: false, type: "string" },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string", enum: TEST_CASE_STATUS_VALUES },
      requirement_id: { required: false, type: "string" },
      requirement_ids: { required: false, type: "array", items: "string" },
      suite_id: { required: false, type: "string" },
      suite_ids: { required: false, type: "array", items: "string" },
      reviewer_id: { required: false, type: "string" },
      review_status: { required: false, type: "string", enum: ["not_requested", "pending", "accepted", "changes_requested"] },
      review_history: { required: false, type: "array" },
      ai_quality_score: { required: false, type: "number" },
      steps: { required: false, type: "array" }
    }, req.body);

    const testCase = await service.getTestCase(req.params.id);
    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }

    if (req.body.app_type_id && req.body.app_type_id !== testCase.app_type_id) {
      const targetAppType = await appTypeService.getAppType(req.body.app_type_id);
      await projectService.getProject(targetAppType.project_id, req.user.id);
    }

    return service.updateTestCase(req.params.id, {
      ...req.body,
      updated_by: req.user.id
    });
  });

  fastify.post("/test-cases/:id/review", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      review_status: { required: true, type: "string", enum: ["pending", "accepted", "changes_requested"] },
      comment: { required: false, type: "string" }
    }, req.body || {});

    const testCase = await service.getTestCase(req.params.id);
    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }

    return service.reviewTestCase(req.params.id, {
      ...req.body,
      reviewed_by: req.user.id
    });
  });

  fastify.post("/test-cases/:id/accept-generated", async (req) => {
    await fastify.authenticate(req);

    const testCase = await service.getTestCase(req.params.id);

    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }

    return service.acceptGeneratedTestCase(req.params.id);
  });

  fastify.delete("/test-cases/:id/reject-generated", async (req) => {
    await fastify.authenticate(req);

    const testCase = await service.getTestCase(req.params.id);

    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }

    return service.rejectGeneratedTestCase(req.params.id);
  });

  fastify.delete("/test-cases/:id", async (req) => {
    await fastify.authenticate(req);
    const testCase = await service.getTestCase(req.params.id);
    if (testCase.app_type_id) {
      const appType = await appTypeService.getAppType(testCase.app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }
    return service.deleteTestCase(req.params.id);
  });
};
