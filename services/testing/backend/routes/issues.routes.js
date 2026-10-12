const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const service = require("../services/issues.service");
const aiBugDraftService = require("@hellotest/ai/backend/services/aiBugDraft.service");
const aiBugTriageService = require("@hellotest/ai/backend/services/aiBugTriage.service");
const featureFlagService = require("@hellotest/platform/backend/services/featureFlag.service");
const { ISSUE_STATUS_VALUES } = require("@hellotest/platform/backend/src/domain/catalog");
const projectService = require("@hellotest/platform/backend/public/projectAccess");
const workspace = require("../services/issueWorkspace.service");
const { issueMetadata } = require("@hellotest/platform/backend/src/utils/nativeIssueMetadata");
const { shouldPaginate } = require("@hellotest/platform/backend/src/utils/pagination");

function registerFeedbackRoutes(fastify, basePath) {
  const validateReporter = async (req, projectId, previousReporterId) => {
    if (req.body.user_id === undefined) return;
    const reporterId = typeof req.body.user_id === "string" ? req.body.user_id.trim() : "";
    if (!reporterId) throw Object.assign(new Error("Select a reported-by user."), { statusCode: 400 });
    req.body.user_id = reporterId;
    // Preserve existing reporters, including people who have left the project.
    if (reporterId === previousReporterId || reporterId === req.user.id) return;
    await fastify.requirePermission("project_member.view", { projectId })(req);
    try {
      await projectService.getProject(projectId, reporterId);
    } catch {
      throw Object.assign(new Error("Select a reported-by user who belongs to this project."), { statusCode: 400 });
    }
  };
  fastify.get(`${basePath}/create-metadata`, async (req) => {
    await fastify.authenticate(req);
    const project = await projectService.getProject(req.query.project_id, req.user.id);
    await fastify.requirePermission("feedback.view", { projectId: project.id })(req);
    return issueMetadata({ project });
  });

  fastify.get(`${basePath}/:id/edit-metadata`, async (req) => {
    await fastify.authenticate(req);
    const item = await service.getIssueItem(req.params.id);
    const project = await projectService.getProject(item.project_id, req.user.id);
    await fastify.requirePermission("feedback.view", { projectId: item.project_id })(req);
    return issueMetadata({ project, mode: "edit", currentValues: item });
  });

  fastify.post(`${basePath}/ai-triage-preview`, async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" },
      issue_ids: { required: true, type: "array", items: "string", maxItems: aiBugTriageService.MAX_TRIAGE_ITEMS },
      integration_id: { required: false, type: "string" },
      prompt_guidance: { required: false, type: "string", maxLength: 4_000 },
      smart_context: { required: false, type: "object" }
    }, req.body || {});
    if (!await featureFlagService.isEnabled("hellotest.ai.bug_triage", { user: req.user })) {
      const error = new Error("AI-assisted Defect drafting and triage are disabled for the workspace.");
      error.statusCode = 403;
      throw error;
    }
    const project = await projectService.getProject(req.body.project_id, req.user.id);
    await fastify.requirePermission("feedback.manage", { projectId: project.id })(req);
    return aiBugTriageService.preview({
      project,
      issueIds: req.body.issue_ids,
      user: req.user,
      integrationId: req.body.integration_id,
      promptGuidance: req.body.prompt_guidance,
      smartContext: req.body.smart_context
    });
  });

  const prepareImport = async req => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" },
      rows: { required: true, type: "array", maxItems: 500 }
    }, req.body || {});
    await projectService.getProject(req.body.project_id, req.user.id);
    await fastify.requirePermission("feedback.create", { projectId: req.body.project_id })(req);
    if (req.body.rows.some(row => row?.assignee_id || (row?.user_id && row.user_id !== req.user.id))) {
      await fastify.requirePermission("project_member.view", { projectId: req.body.project_id })(req);
    }
    return require("../services/issueImport.service").validateRows({ ...req.body, created_by: req.user.id });
  };
  fastify.get(`${basePath}/imports/:id`, async req => {
    await fastify.authenticate(req);
    await projectService.getProject(req.query.project_id, req.user.id);
    await fastify.requirePermission("feedback.create", { projectId: req.query.project_id })(req);
    const transaction = await require("@hellotest/platform/backend/services/workspaceTransaction.service").getTransaction(req.params.id);
    if (transaction.action !== "bug_import" || transaction.project_id !== req.query.project_id || transaction.created_by !== req.user.id) throw Object.assign(new Error("Bug import not found"), { statusCode: 404 });
    return { id: transaction.id, status: transaction.status, description: transaction.description, metadata: transaction.metadata };
  });
  fastify.post(`${basePath}/import-preview`, async req => prepareImport(req));
  fastify.post(`${basePath}/bulk-import`, async req => {
    const preview = await prepareImport(req);
    if (preview.errors.length) throw Object.assign(new Error(preview.errors.map(error => `Row ${error.row}: ${error.message}`).join("\n")), { statusCode: 400 });
    if (typeof req.body.import_id !== "string" || !/^[a-zA-Z0-9-]{16,100}$/.test(req.body.import_id)) throw Object.assign(new Error("A valid import ID is required."), { statusCode: 400 });
    return require("../services/batchProcess.service").queueIssueImport({
      project_id: req.body.project_id, rows: preview.rows, import_id: req.body.import_id, created_by: req.user.id
    });
  });

  fastify.post(`${basePath}/export`, async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" }, issue_ids: { required: true, type: "array", items: "string" } }, req.body || {});
    await projectService.getProject(req.body.project_id, req.user.id);
    await fastify.requirePermission("feedback.view", { projectId: req.body.project_id })(req);
    const issues = [];
    for (const id of [...new Set(req.body.issue_ids)]) {
      const item = await service.getIssueItem(id);
      if (item.project_id !== req.body.project_id) throw Object.assign(new Error("Every exported defect must belong to the current project"), { statusCode: 403 });
      issues.push(item);
    }
    return { bugs: issues, exported: issues.length };
  });

  fastify.delete(`${basePath}/bulk-delete`, async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" }, issue_ids: { required: true, type: "array", items: "string" } }, req.body || {});
    await projectService.getProject(req.body.project_id, req.user.id);
    await fastify.requirePermission("feedback.manage", { projectId: req.body.project_id })(req);
    return workspace.bulkDelete({ projectId: req.body.project_id, issueIds: req.body.issue_ids });
  });

  fastify.post(`${basePath}/ai-improve-preview`, { schema: { body: {
    type: "object", additionalProperties: true,
    required: ["project_id", "intent", "evidence", "linked_test_case_ids"],
    properties: {
      project_id: { type: "string" }, issue_id: { type: "string" },
      intent: { type: "string", minLength: 2, maxLength: 4000 },
      evidence: { type: "string", maxLength: 12000 },
      linked_test_case_ids: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" } },
      integration_id: { type: "string" }, prompt_guidance: { type: "string", maxLength: 4000 }
    }
  } } }, async (req) => {
    await fastify.authenticate(req);
    await projectService.getProject(req.body.project_id, req.user.id);
    await fastify.requirePermission(req.body.issue_id ? "feedback.manage" : "feedback.create", { projectId: req.body.project_id })(req);
    if (req.body.issue_id) {
      const issue = await service.getIssueItem(req.body.issue_id);
      if (issue.project_id !== req.body.project_id) throw Object.assign(new Error("Defect does not belong to this project"), { statusCode: 403 });
    }
    if (!await featureFlagService.isEnabled("hellotest.ai.bug_triage", { user: req.user })) throw Object.assign(new Error("AI Defect improvement is disabled"), { statusCode: 403 });
    if (!req.body.linked_test_case_ids.length) throw Object.assign(new Error("Select at least one Test Case as context"), { statusCode: 400 });
    await fastify.requirePermission("testcase.view", { projectId: req.body.project_id })(req);
    // Deliberately allow only Test Case context. Preview never saves a defect.
    return aiBugDraftService.preview({
      user: req.user, project_id: req.body.project_id,
      intent: req.body.intent, evidence: req.body.evidence,
      linked_test_case_ids: req.body.linked_test_case_ids, require_case_context: true,
      integration_id: req.body.integration_id,
      prompt_guidance: aiInstructionBlock("ai.bug.draft", "aiBugDraft.improveExisting") + (req.body.prompt_guidance || "")
    });
  });

  fastify.post(`${basePath}/ai-draft-preview`, async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" },
      intent: { required: true, type: "string", minLength: 2 },
      evidence: { required: false, type: "string" },
      additional_context: { required: false, type: "string" },
      external_links: { required: false, type: "array", items: "string", maxItems: 12 },
      reference_photos: { required: false, type: "array", maxItems: 6 },
      linked_test_run_id: { required: false, type: "string" },
      linked_test_case_ids: { required: false, type: "array", items: "string" },
      linked_requirement_ids: { required: false, type: "array", items: "string" },
      integration_id: { required: false, type: "string" },
      prompt_guidance: { required: false, type: "string", maxLength: 4_000 }
    }, req.body);
    if (!await featureFlagService.isEnabled("hellotest.ai.bug_triage", { user: req.user })) {
      const error = new Error("AI-assisted Defect drafting and triage are disabled for the workspace.");
      error.statusCode = 403;
      throw error;
    }
    await projectService.getProject(req.body.project_id, req.user.id);
    await fastify.requirePermission("feedback.create", { projectId: req.body.project_id })(req);
    // Drafting may read linked evidence; creating Bugs alone must not expose
    // test results, cases, or Stories that this role cannot view.
    const evidencePermissions = [
      ...(req.body.linked_test_run_id ? ["run.view", "result.view"] : []),
      ...(req.body.linked_test_case_ids?.length ? ["testcase.view"] : []),
      ...(req.body.linked_requirement_ids?.length ? ["requirement.view"] : [])
    ];
    for (const permission of evidencePermissions) {
      await fastify.requirePermission(permission, { projectId: req.body.project_id })(req);
    }
    return aiBugDraftService.preview({ ...req.body, user: req.user });
  });

  fastify.post(basePath, async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" },
      user_id: { required: false, type: "string" },
      title: { required: true, type: "string", minLength: 2 },
      message: { required: true, type: "string", minLength: 2 },
      steps_to_reproduce: { required: false, type: "string" },
      expected_result: { required: false, type: "string" },
      actual_result: { required: false, type: "string" },
      severity: { required: false, type: "string" },
      priority: { required: false, type: "string" },
      environment: { required: false, type: "string" },
      build: { required: false, type: "string" },
      jira_bug_key: { required: false, type: "string" },
	      linked_test_run_id: { required: false, type: "string" },
	      linked_test_case_ids: { required: false, type: "array", items: "string" },
	      linked_test_suite_ids: { required: false, type: "array", items: "string" },
	      linked_module_ids: { required: false, type: "array", items: "string" },
	      linked_requirement_ids: { required: false, type: "array", items: "string" },
	      labels: { required: false, type: "array", items: "string" },
	      sprint: { required: false, type: "string" },
	      fix_version: { required: false, type: "string" },
	      release: { required: false, type: "string" },
	      assignee_id: { required: false, type: "string" },
	      root_cause: { required: false, type: "string" },
	      qa_root_cause: { required: false, type: "string" },
	      status: { required: false, type: "string", enum: ISSUE_STATUS_VALUES }
    }, req.body);

    if (req.body.project_id) {
      await projectService.getProject(req.body.project_id, req.user.id);
      await fastify.requirePermission("feedback.create", { projectId: req.body.project_id })(req);
    }
    await validateReporter(req, req.body.project_id);
    return service.createIssue({ ...req.body, user_id: req.body.user_id || req.user.id }, { actorId: req.user.id });
  });

  const catalogFilters = async (req) => {
    await fastify.authenticate(req);
    const { project_id } = req.query;
    if (project_id) {
      await projectService.getProject(project_id, req.user.id);
      await fastify.requirePermission("feedback.view", { projectId: project_id })(req);
    } else if (req.user.role !== "admin" && !req.user.is_workspace_admin) {
      throw Object.assign(new Error("project_id is required when listing Defects"), { statusCode: 400 });
    }
    return {
      ...req.query,
      viewer_id: req.user.id,
      viewer_is_admin: req.user.role === "admin" || req.user.is_workspace_admin
    };
  };

  fastify.get(`${basePath}/metrics`, async (req) => service.getIssueMetrics(await catalogFilters(req)));

  fastify.get(basePath, async (req) => {
    const filters = await catalogFilters(req);
    return shouldPaginate(req.query) ? service.getIssuePage(filters) : service.getIssues(filters);
  });

  fastify.get(`${basePath}/:id`, async (req) => {
    await fastify.authenticate(req);
    const item = await service.getIssueItem(req.params.id, { project_id: req.query.project_id, resolveReference: true });
    await fastify.requirePermission("feedback.view", { projectId: item.project_id })(req);
    return item;
  });

  fastify.get(`${basePath}/:id/history`, async (req) => {
    await fastify.authenticate(req);
    const item = await service.getIssueItem(req.params.id);
    await fastify.requirePermission("feedback.view", { projectId: item.project_id })(req);
    return service.getIssueHistory(item.id);
  });

  fastify.put(`${basePath}/:id`, async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: false, type: "string" },
      user_id: { required: false, type: "string" },
      title: { required: false, type: "string", minLength: 2 },
      message: { required: false, type: "string", minLength: 2 },
      steps_to_reproduce: { required: false, type: "string" },
      expected_result: { required: false, type: "string" },
      actual_result: { required: false, type: "string" },
      severity: { required: false, type: "string" },
      priority: { required: false, type: "string" },
      environment: { required: false, type: "string" },
      build: { required: false, type: "string" },
      jira_bug_key: { required: false, type: "string" },
	      linked_test_run_id: { required: false, type: "string" },
	      linked_test_case_ids: { required: false, type: "array", items: "string" },
	      linked_test_suite_ids: { required: false, type: "array", items: "string" },
	      linked_module_ids: { required: false, type: "array", items: "string" },
	      linked_requirement_ids: { required: false, type: "array", items: "string" },
	      labels: { required: false, type: "array", items: "string" },
	      sprint: { required: false, type: "string" },
	      fix_version: { required: false, type: "string" },
	      release: { required: false, type: "string" },
	      assignee_id: { required: false, type: "string" },
	      root_cause: { required: false, type: "string" },
	      qa_root_cause: { required: false, type: "string" },
	      status: { required: false, type: "string", enum: ISSUE_STATUS_VALUES }
    }, req.body);

    const item = await service.getIssueItem(req.params.id);
    await fastify.requirePermission("feedback.manage", { projectId: item.project_id })(req);
    if (req.body.project_id && req.body.project_id !== item.project_id) {
      await projectService.getProject(req.body.project_id, req.user.id);
      await fastify.requirePermission("feedback.manage", { projectId: req.body.project_id })(req);
    }
    await validateReporter(req, req.body.project_id || item.project_id, item.user_id);
    return service.updateIssue(req.params.id, req.body, { actorId: req.user.id });
  });

  fastify.delete(`${basePath}/:id`, async (req) => {
    await fastify.authenticate(req);
    const item = await service.getIssueItem(req.params.id);
    await fastify.requirePermission("feedback.manage", { projectId: item.project_id })(req);
    return service.deleteIssue(req.params.id);
  });
}

module.exports = async function (fastify) {
  registerFeedbackRoutes(fastify, "/feedback");
  registerFeedbackRoutes(fastify, "/issues");
};
