const service = require("../services/issues.service");
const { ISSUE_STATUS_VALUES } = require("../domain/catalog");

function registerFeedbackRoutes(fastify, basePath) {
  fastify.post(basePath, async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
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
      assignee_id: { required: false, type: "string" },
      root_cause: { required: false, type: "string" },
      retest_result: { required: false, type: "string" },
      status: { required: false, type: "string", enum: ISSUE_STATUS_VALUES }
    }, req.body);

    return service.createIssue(req.body);
  });

  fastify.get(basePath, async (req) => {
    await fastify.authenticate(req);
    const { user_id, status } = req.query;
    return service.getIssues({ user_id, status });
  });

  fastify.get(`${basePath}/:id`, async (req) => {
    await fastify.authenticate(req);
    return service.getIssueItem(req.params.id);
  });

  fastify.put(`${basePath}/:id`, async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
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
      assignee_id: { required: false, type: "string" },
      root_cause: { required: false, type: "string" },
      retest_result: { required: false, type: "string" },
      status: { required: false, type: "string", enum: ISSUE_STATUS_VALUES }
    }, req.body);

    return service.updateIssue(req.params.id, req.body);
  });

  fastify.delete(`${basePath}/:id`, async (req) => {
    await fastify.authenticate(req);
    return service.deleteIssue(req.params.id);
  });
}

module.exports = async function (fastify) {
  registerFeedbackRoutes(fastify, "/feedback");
  registerFeedbackRoutes(fastify, "/issues");
};
