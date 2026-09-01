const agenticWorkflowService = require("../services/agenticWorkflow.service");
const agenticAssistantService = require("../services/agenticAssistant.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");

module.exports = async function (fastify) {
  fastify.post("/agentic-assistant/sessions", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" },
      app_type_id: { required: false, type: "string" },
      mode: { required: false, type: "string" },
      agent_id: { required: false, type: "string" },
      prompt: { required: true, type: "string" },
      context_scopes: { required: false, type: "array" },
      smart_context: { required: false, type: "object" },
      integration_id: { required: false, type: "string" },
      history: { required: false, type: "array" }
    }, req.body || {});

    await projectService.getProject(req.body.project_id, req.user.id);

    if (req.body.app_type_id) {
      const appType = await appTypeService.getAppType(req.body.app_type_id);
      if (appType.project_id !== req.body.project_id) {
        throw new Error("Selected app type must belong to the current project");
      }
    }

    return agenticAssistantService.respond({ ...req.body, user: req.user });
  });

  fastify.get("/agentic-workflows", async (req) => {
    await fastify.authenticate(req);

    if (req.query.project_id) {
      await projectService.getProject(req.query.project_id, req.user.id);
    }

    return agenticWorkflowService.listWorkflows({
      project_id: req.query.project_id,
      app_type_id: req.query.app_type_id,
      status: req.query.status
    });
  });

  fastify.post("/agentic-workflows", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" },
      app_type_id: { required: false, type: "string" },
      name: { required: true, type: "string" },
      description: { required: false, type: "string" },
      status: { required: false, type: "string" },
      trigger_kind: { required: false, type: "string" },
      nodes: { required: false, type: "array" },
      edges: { required: false, type: "array" },
      settings: { required: false, type: "object" },
      n8n_payload: { required: false, type: "object" }
    }, req.body);

    await projectService.getProject(req.body.project_id, req.user.id);
    return agenticWorkflowService.createWorkflow(req.body, req.user.id);
  });

  fastify.post("/agentic-workflows/api-agent-test", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      method: { required: false, type: "string" },
      url: { required: true, type: "string" },
      auth: { required: false, type: "string" },
      responseStyle: { required: false, type: "string" },
      body: { required: false, type: "string" },
      credential: { required: false, type: "object" }
    }, req.body || {});

    return agenticWorkflowService.testApiAgent(req.body || {});
  });

  fastify.get("/agentic-workflows/:id", async (req) => {
    await fastify.authenticate(req);
    const workflow = await agenticWorkflowService.getWorkflow(req.params.id);
    await projectService.getProject(workflow.project_id, req.user.id);
    return workflow;
  });

  fastify.put("/agentic-workflows/:id", async (req) => {
    await fastify.authenticate(req);
    const workflow = await agenticWorkflowService.getWorkflow(req.params.id);
    await projectService.getProject(workflow.project_id, req.user.id);

    if (req.body?.project_id && req.body.project_id !== workflow.project_id) {
      await projectService.getProject(req.body.project_id, req.user.id);
    }

    fastify.validate({
      project_id: { required: false, type: "string" },
      app_type_id: { required: false, type: "string" },
      name: { required: false, type: "string" },
      description: { required: false, type: "string" },
      status: { required: false, type: "string" },
      trigger_kind: { required: false, type: "string" },
      nodes: { required: false, type: "array" },
      edges: { required: false, type: "array" },
      settings: { required: false, type: "object" },
      n8n_payload: { required: false, type: "object" }
    }, req.body);

    return agenticWorkflowService.updateWorkflow(req.params.id, req.body, req.user.id);
  });

  fastify.delete("/agentic-workflows/:id", async (req) => {
    await fastify.authenticate(req);
    const workflow = await agenticWorkflowService.getWorkflow(req.params.id);
    await projectService.getProject(workflow.project_id, req.user.id);
    return agenticWorkflowService.deleteWorkflow(req.params.id);
  });

  fastify.post("/agentic-workflows/:id/runs", async (req) => {
    await fastify.authenticate(req);
    const workflow = await agenticWorkflowService.getWorkflow(req.params.id);
    await projectService.getProject(workflow.project_id, req.user.id);
    fastify.validate({
      trigger_kind: { required: false, type: "string" },
      input_payload: { required: false, type: "object" },
      payload: { required: false, type: "object" }
    }, req.body || {});

    return agenticWorkflowService.createWorkflowRun(req.params.id, req.body || {}, req.user.id);
  });

  fastify.get("/agentic-workflow-runs", async (req) => {
    await fastify.authenticate(req);

    if (req.query.project_id) {
      await projectService.getProject(req.query.project_id, req.user.id);
    }

    return agenticWorkflowService.listWorkflowRuns({
      project_id: req.query.project_id,
      app_type_id: req.query.app_type_id,
      workflow_id: req.query.workflow_id,
      status: req.query.status
    });
  });

  fastify.get("/agentic-workflow-runs/:id", async (req) => {
    await fastify.authenticate(req);
    const run = await agenticWorkflowService.getWorkflowRun(req.params.id);
    await projectService.getProject(run.project_id, req.user.id);
    return run;
  });
};
