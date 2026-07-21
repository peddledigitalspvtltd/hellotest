const service = require("../services/issues.service");
const aiBugDraftService = require("../services/aiBugDraft.service");
const featureFlagService = require("../services/featureFlag.service");
const { ISSUE_STATUS_VALUES } = require("../domain/catalog");

function registerFeedbackRoutes(fastify, basePath) {
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

    return service.createIssue({ ...req.body, user_id: req.user.id });
  });

  fastify.get(basePath, async (req) => {
    await fastify.authenticate(req);
    const { project_id, user_id, status } = req.query;
    return service.getIssues({
      project_id,
      user_id,
      status,
      viewer_id: req.user.id,
      viewer_is_admin: req.user.role === "admin" || req.user.is_workspace_admin
    });
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
