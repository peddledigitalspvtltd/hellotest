const agenticWorkflowService = require("../services/agenticWorkflow.service");
const agenticAssistantService = require("../services/agenticAssistant.service");
const workflowExecution = require("../services/agenticWorkflowExecution.service");
const appTypeService = require("@hellotest/platform/backend/public/applicationAccess");
const projectService = require("@hellotest/platform/backend/public/projectAccess");

module.exports = async function (fastify) {
  const requireProjectPermission = async (req, projectId, permission) => {
    await projectService.getProject(projectId, req.user.id);
    await fastify.requirePermission(permission, { projectId })(req);
  };
  const validateApp = async (projectId, appTypeId) => {
    if (!appTypeId) return;
    const app = await appTypeService.getAppType(appTypeId);
    if (projectId && app.project_id !== projectId) throw Object.assign(new Error("Selected app must belong to the current project."), { statusCode: 400 });
    return app;
  };
  const withConnection = async (req, reply, task) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    req.raw.once("aborted", cancel);
    reply.raw.once("close", cancel);
    if (req.raw.aborted || reply.raw.destroyed) controller.abort();
    try { return await task(controller.signal); }
    finally {
      req.raw.removeListener("aborted", cancel);
      reply.raw.removeListener("close", cancel);
    }
  };
  fastify.post("/agentic-assistant/sessions", async (req, reply) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" },
      app_type_id: { required: false, type: "string" },
      mode: { required: false, type: "string" },
      agent_id: { required: false, type: "string" },
      agent_version: { required: false, type: "number" },
      inputs: { required: false, type: "object" },
      prompt: { required: true, type: "string" },
      context_scopes: { required: false, type: "array" },
      smart_context: { required: false, type: "object" },
      integration_id: { required: false, type: "string" },
      history: { required: false, type: "array" }
    }, req.body || {});

    await requireProjectPermission(req, req.body.project_id, "agentic_workflow.run");
    await validateApp(req.body.project_id, req.body.app_type_id);
    return withConnection(req, reply, (signal) => agenticAssistantService.respond({ ...Object.fromEntries(["project_id", "app_type_id", "mode", "agent_id", "agent_version", "inputs", "prompt", "context_scopes", "smart_context", "integration_id", "history"].filter(key => Object.hasOwn(req.body, key)).map(key => [key, req.body[key]])), user: req.user, signal }));
  });

  fastify.get("/agentic-assistant/sessions", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string", minLength: 1, maxLength: 255 },
      app_type_id: { required: false, type: "string", maxLength: 255 }
    }, req.query || {});
    if (!req.query.project_id.trim()) throw Object.assign(new Error("Select a project to list specialist reviews."), { statusCode: 400 });
    await fastify.requirePermission("agentic_workflow.view", { projectId: req.query.project_id })(req);
    return agenticAssistantService.listSessions(req.query, req.user);
  });

  fastify.get("/agentic-assistant/sessions/:id", async (req) => {
    await fastify.authenticate(req);
    const review = await agenticAssistantService.getSession(req.params.id, req.user);
    await fastify.requirePermission("agentic_workflow.view", { projectId: review.transaction.project_id })(req);
    return review;
  });

  const registry = require("../agents/agentRegistry.service");
  const agentAccess = async (req, permission, projectId) => {
    await fastify.authenticate(req);
    if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 255) throw Object.assign(new Error("Select a project."), { statusCode: 400 });
    await requireProjectPermission(req, projectId, permission);
  };
  fastify.get("/agentic-workflows/agents", async req => {
    await agentAccess(req, "agentic_workflow.view", req.query.project_id);
    return registry.list(req.query.project_id);
  });
  fastify.post("/agentic-workflows/agents", async req => {
    await agentAccess(req, "agentic_workflow.manage", req.body?.project_id);
    return registry.save(req.body || {}, null, req.user.id);
  });
  fastify.put("/agentic-workflows/agents/:agentId", async req => {
    await agentAccess(req, "agentic_workflow.manage", req.body?.project_id);
    return registry.save(req.body || {}, req.params.agentId, req.user.id);
  });
  fastify.delete("/agentic-workflows/agents/:agentId", async req => {
    await agentAccess(req, "agentic_workflow.manage", req.query.project_id);
    return registry.archive(req.params.agentId, req.query.project_id, Number(req.query.version));
  });

  fastify.get("/agentic-workflows", async (req) => {
    await fastify.authenticate(req);

    if (req.query.project_id) {
      await requireProjectPermission(req, req.query.project_id, "agentic_workflow.view");
    }
    const app = await validateApp(req.query.project_id, req.query.app_type_id);
    if (app && !req.query.project_id) await requireProjectPermission(req, app.project_id, "agentic_workflow.view");

    return agenticWorkflowService.listWorkflows({
      project_id: req.query.project_id,
      app_type_id: req.query.app_type_id,
      status: req.query.status,
      user: req.user,
      limit: req.query.limit
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

    await requireProjectPermission(req, req.body.project_id, "agentic_workflow.manage");
    return agenticWorkflowService.createWorkflow(req.body, req.user.id);
  });

  fastify.post("/agentic-workflows/api-agent-test", async (req, reply) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string", minLength: 1, maxLength: 255 },
      method: { required: false, type: "string" },
      url: { required: true, type: "string" },
      auth: { required: false, type: "string" },
      responseStyle: { required: false, type: "string" },
      body: { required: false, type: "string" },
      credential: { required: false, type: "object" }
    }, req.body || {});

    if (!req.body.project_id.trim()) throw Object.assign(new Error("Choose a project before testing an API endpoint."), { statusCode: 400 });
    await requireProjectPermission(req, req.body.project_id, "agentic_workflow.run");
    return withConnection(req, reply, (signal) => agenticWorkflowService.testApiAgent({ ...(req.body || {}), signal }));
  });

  fastify.get("/agentic-workflows/connections", async req => {
    await fastify.authenticate(req);
    if (!req.query.project_id) throw Object.assign(new Error("Choose a project."), { statusCode: 400 });
    await requireProjectPermission(req, req.query.project_id, "agentic_workflow.view");
    return require("../workflows/connections").list(req.query.project_id);
  });
  const connectionSettings = require("../workflows/connectionSettings");
  const adminConnectionAccess = async (req, permission, projectId) => {
    await fastify.authenticate(req);
    await fastify.requirePermission(permission)(req);
    if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 255) throw Object.assign(new Error("Select a project to manage workflow connections."), { statusCode: 400 });
    await projectService.getProject(projectId, req.user.id);
  };
  fastify.get("/agentic-workflows/admin/connections", async req => {
    await adminConnectionAccess(req, "integration.view", req.query.project_id);
    return connectionSettings.list(req.query.project_id);
  });
  fastify.post("/agentic-workflows/admin/connections", async req => {
    await adminConnectionAccess(req, "integration.manage", req.body?.project_id);
    return connectionSettings.save(req.body || {}, null, req.user.id);
  });
  fastify.post("/agentic-workflows/admin/connections/discover", async (req, reply) => {
    await adminConnectionAccess(req, "integration.manage", req.body?.project_id);
    const row = await connectionSettings.preview(req.body || {}, req.body?.connection_id);
    return withConnection(req, reply, signal => require("../workflows/mcpClient").inspect({ projectId: req.body.project_id, draftConnection: row, signal }));
  });
  fastify.put("/agentic-workflows/admin/connections/:connectionId", async req => {
    await adminConnectionAccess(req, "integration.manage", req.body?.project_id);
    return connectionSettings.save(req.body || {}, req.params.connectionId, req.user.id);
  });
  fastify.delete("/agentic-workflows/admin/connections/:connectionId", async req => {
    await adminConnectionAccess(req, "integration.manage", req.query.project_id);
    return connectionSettings.remove(req.params.connectionId, req.query.project_id);
  });
  fastify.post("/agentic-workflows/admin/connections/:connectionId/discover", async (req, reply) => {
    await adminConnectionAccess(req, "integration.manage", req.query.project_id);
    const row = await connectionSettings.get(req.params.connectionId, req.query.project_id);
    return withConnection(req, reply, signal => require("../workflows/mcpClient").discover({ projectId: req.query.project_id, connectionId: row.id, signal, discoverAll: true }));
  });
  fastify.post("/agentic-workflows/connections/mcp-tools", async (req, reply) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" }, connection_id: { required: true, type: "string" } }, req.body || {});
    await requireProjectPermission(req, req.body.project_id, "agentic_workflow.run");
    return withConnection(req, reply, signal => require("../workflows/mcpClient").discover({ projectId: req.body.project_id, connectionId: req.body.connection_id, signal }));
  });
  fastify.post("/agentic-workflows/connections/http-test", async (req, reply) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" }, data: { required: true, type: "object" } }, req.body || {});
    await requireProjectPermission(req, req.body.project_id, "agentic_workflow.run");
    return withConnection(req, reply, signal => require("../workflows/connections").callHttp({ projectId: req.body.project_id, data: req.body.data, signal }));
  });

  fastify.get("/agentic-workflows/:id", async (req) => {
    await fastify.authenticate(req);
    const workflow = await agenticWorkflowService.getWorkflow(req.params.id);
    await requireProjectPermission(req, workflow.project_id, "agentic_workflow.view");
    return workflow;
  });

  fastify.put("/agentic-workflows/:id", async (req) => {
    await fastify.authenticate(req);
    const workflow = await agenticWorkflowService.getWorkflow(req.params.id);
    await requireProjectPermission(req, workflow.project_id, "agentic_workflow.manage");

    if (req.body?.project_id && req.body.project_id !== workflow.project_id) {
      await requireProjectPermission(req, req.body.project_id, "agentic_workflow.manage");
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
    await requireProjectPermission(req, workflow.project_id, "agentic_workflow.manage");
    return agenticWorkflowService.deleteWorkflow(req.params.id);
  });

  fastify.post("/agentic-workflows/:id/runs", async (req) => {
    await fastify.authenticate(req);
    const workflow = await agenticWorkflowService.getWorkflow(req.params.id);
    await requireProjectPermission(req, workflow.project_id, "agentic_workflow.run");
    fastify.validate({
      trigger_kind: { required: false, type: "string" },
      input_payload: { required: false, type: "object" },
      payload: { required: false, type: "object" }
    }, req.body || {});

    return agenticWorkflowService.createWorkflowRun(req.params.id, req.body || {}, req.user.id);
  });

  fastify.get("/agentic-workflows/:id/readiness", async (req) => {
    await fastify.authenticate(req);
    const workflow = await agenticWorkflowService.getWorkflow(req.params.id);
    await requireProjectPermission(req, workflow.project_id, "agentic_workflow.view");
    return workflowExecution.checkReadiness(workflow, req.query.target_node_id || "", req.user);
  });

  fastify.post("/agentic-workflows/:id/executions", async (req, reply) => {
    await fastify.authenticate(req);
    const workflow = await agenticWorkflowService.getWorkflow(req.params.id);
    await requireProjectPermission(req, workflow.project_id, "agentic_workflow.run");
    fastify.validate({
      request_id: { required: false, type: "string", minLength: 8, maxLength: 128 },
      target_node_id: { required: false, type: "string", minLength: 1, maxLength: 160 },
      input_payload: { required: false, type: "object" }
    }, req.body || {});
    const run = await workflowExecution.start(workflow, req.body || {}, req.user);
    return reply.code(202).send(run);
  });

  fastify.post("/agentic-workflow-runs/:id/cancel", async (req) => {
    await fastify.authenticate(req);
    const run = await agenticWorkflowService.getWorkflowRun(req.params.id);
    await requireProjectPermission(req, run.project_id, "agentic_workflow.run");
    return workflowExecution.cancel(run, req.user);
  });

  fastify.get("/agentic-workflow-runs", async (req) => {
    await fastify.authenticate(req);

    if (req.query.project_id) {
      await requireProjectPermission(req, req.query.project_id, "agentic_workflow.view");
    }
    const app = await validateApp(req.query.project_id, req.query.app_type_id);
    if (app && !req.query.project_id) await requireProjectPermission(req, app.project_id, "agentic_workflow.view");
    if (req.query.workflow_id) {
      const workflow = await agenticWorkflowService.getWorkflow(req.query.workflow_id);
      await requireProjectPermission(req, workflow.project_id, "agentic_workflow.view");
      if (req.query.project_id && req.query.project_id !== workflow.project_id) throw Object.assign(new Error("Workflow must belong to the selected project."), { statusCode: 400 });
    }

    return agenticWorkflowService.listWorkflowRuns({
      project_id: req.query.project_id,
      app_type_id: req.query.app_type_id,
      workflow_id: req.query.workflow_id,
      status: req.query.status,
      user: req.user,
      limit: req.query.limit,
      summary_only: req.query.summary_only === true || req.query.summary_only === "true"
    });
  });

  fastify.get("/agentic-workflow-runs/:id", async (req) => {
    await fastify.authenticate(req);
    const run = await agenticWorkflowService.getWorkflowRun(req.params.id);
    await requireProjectPermission(req, run.project_id, "agentic_workflow.view");
    return run;
  });
};
