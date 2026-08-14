const service = require("../services/issues.service");
const aiBugDraftService = require("../services/aiBugDraft.service");
const featureFlagService = require("../services/featureFlag.service");
const { ISSUE_STATUS_VALUES } = require("../domain/catalog");
const projectService = require("../services/project.service");
const workspace = require("../services/issueWorkspace.service");
const { issueMetadata } = require("../utils/nativeIssueMetadata");
const { paginate, shouldPaginate } = require("../utils/pagination");

function registerFeedbackRoutes(fastify, basePath) {
  fastify.get(`${basePath}/create-metadata`, async (req) => {
    await fastify.authenticate(req);
    const project = await projectService.getProject(req.query.project_id, req.user.id);
    return issueMetadata({ project });
  });

  fastify.get(`${basePath}/:id/edit-metadata`, async (req) => {
    await fastify.authenticate(req);
    const item = await service.getIssueItem(req.params.id);
    const project = await projectService.getProject(item.project_id, req.user.id);
    return issueMetadata({ project, mode: "edit", currentValues: item });
  });

  fastify.post(`${basePath}/ai-triage-preview`, async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" }, issue_ids: { required: true, type: "array", items: "string" } }, req.body || {});
    const project = await projectService.getProject(req.body.project_id, req.user.id);
    await fastify.requirePermission("feedback.manage", { projectId: project.id })(req);
    return workspace.previewTriage({ project, issueIds: req.body.issue_ids });
  });

  fastify.post(`${basePath}/export`, async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" }, issue_ids: { required: true, type: "array", items: "string" } }, req.body || {});
    await projectService.getProject(req.body.project_id, req.user.id);
    const issues = [];
    for (const id of [...new Set(req.body.issue_ids)]) {
      const item = await service.getIssueItem(id);
      if (item.project_id !== req.body.project_id) throw Object.assign(new Error("Every exported bug must belong to the current project"), { statusCode: 403 });
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

  fastify.post(`${basePath}/ai-draft-preview`, async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" },
      intent: { required: true, type: "string", minLength: 2 },
      evidence: { required: false, type: "string" },
      additional_context: { required: false, type: "string" },
      linked_test_run_id: { required: false, type: "string" },
      linked_test_case_ids: { required: false, type: "array", items: "string" },
      linked_requirement_ids: { required: false, type: "array", items: "string" },
      integration_id: { required: false, type: "string" }
    }, req.body);
    if (!await featureFlagService.isEnabled("qaira.ai.bug_triage", { user: req.user })) {
      const error = new Error("AI-assisted bug triage is disabled for the workspace.");
      error.statusCode = 403;
      throw error;
    }
    return aiBugDraftService.preview({ ...req.body, user: req.user });
  });

  fastify.post(basePath, async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: false, type: "string" },
      user_id: { required: true, type: "string" },
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
	      status: { required: false, type: "string", enum: ISSUE_STATUS_VALUES }
    }, req.body);

    if (req.body.project_id) await projectService.getProject(req.body.project_id, req.user.id);
    return service.createIssue({ ...req.body, user_id: req.user.id });
  });

  fastify.get(basePath, async (req) => {
    await fastify.authenticate(req);
    const { project_id, user_id, status } = req.query;
    const items = await service.getIssues({
      project_id,
      user_id,
      status,
      viewer_id: req.user.id,
      viewer_is_admin: req.user.role === "admin" || req.user.is_workspace_admin
    });
    const searched = req.query.q ? items.filter((item) => `${item.title || ""} ${item.message || ""} ${item.jira_bug_key || ""}`.toLowerCase().includes(String(req.query.q).toLowerCase())) : items;
    return shouldPaginate(req.query) ? paginate(searched, req.query) : searched;
  });

  fastify.get(`${basePath}/:id`, async (req) => {
    await fastify.authenticate(req);
    const item = await service.getIssueItem(req.params.id);
    await fastify.requirePermission("feedback.view", { projectId: item.project_id })(req);
    return item;
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
	      status: { required: false, type: "string", enum: ISSUE_STATUS_VALUES }
    }, req.body);

    const item = await service.getIssueItem(req.params.id);
    await fastify.requirePermission("feedback.manage", { projectId: item.project_id })(req);
    return service.updateIssue(req.params.id, req.body);
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
