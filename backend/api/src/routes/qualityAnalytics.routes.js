const projectService = require("../services/project.service");
const analytics = require("../services/qualityAnalytics.service");
const dashboards = require("../services/qualityDashboard.service");

const requireProject = async (req, projectId) => {
  if (!projectId) {
    const error = new Error("Project scope is required.");
    error.statusCode = 400;
    throw error;
  }
  return projectService.getProject(projectId, req.user.id);
};

module.exports = async function (fastify) {
  fastify.get("/quality-dashboards", async (req) => {
    await fastify.authenticate(req);
    await requireProject(req, req.query.project_id);
    return dashboards.list(req.query.project_id);
  });

  fastify.get("/quality-dashboards/:id", async (req) => {
    await fastify.authenticate(req);
    const dashboard = await dashboards.get(req.params.id);
    await requireProject(req, dashboard.project_id);
    return dashboard;
  });

  fastify.post("/quality-dashboards", async (req) => {
    await fastify.authenticate(req);
    await requireProject(req, req.body?.project_id);
    return dashboards.create({ input: req.body || {}, userId: req.user.id });
  });

  fastify.put("/quality-dashboards/:id", async (req) => {
    await fastify.authenticate(req);
    const dashboard = await dashboards.get(req.params.id);
    await requireProject(req, dashboard.project_id);
    return dashboards.update({ id: req.params.id, input: req.body || {}, userId: req.user.id });
  });

  fastify.delete("/quality-dashboards/:id", async (req) => {
    await fastify.authenticate(req);
    const dashboard = await dashboards.get(req.params.id);
    await requireProject(req, dashboard.project_id);
    return dashboards.remove(req.params.id);
  });

  const evaluateOne = async (req) => {
    await fastify.authenticate(req);
    const projectId = req.body?.project_id || req.query?.project_id;
    await requireProject(req, projectId);
    return analytics.evaluateGadget({ projectId, gadget: req.body?.gadget || req.body || {} });
  };
  fastify.post("/analytics/jql", evaluateOne);
  fastify.post("/analytics/query", evaluateOne);

  const evaluateBatch = async (req) => {
    await fastify.authenticate(req);
    const projectId = req.body?.project_id;
    await requireProject(req, projectId);
    return dashboards.evaluateBatch({ projectId, gadgets: req.body?.gadgets || [] });
  };
  fastify.post("/analytics/jql-batch", evaluateBatch);
  fastify.post("/analytics/query-batch", evaluateBatch);

  fastify.post("/analytics/dashboard-design-preview", async (req) => {
    await fastify.authenticate(req);
    await requireProject(req, req.body?.project_id);
    if (req.body?.stakeholder === "automation") {
      await fastify.requirePermission("automation.analytics.view", { projectId: req.body.project_id })(req);
    }
    return dashboards.designPreviewWithAi({
      projectId: req.body.project_id,
      stakeholder: req.body.stakeholder,
      release: req.body.release,
      prompt: req.body.prompt,
      userId: req.user.id
    });
  });

  fastify.get("/ai/quality-insights", async (req) => {
    await fastify.authenticate(req);
    await requireProject(req, req.query.project_id);
    return analytics.qualityInsights({ projectId: req.query.project_id, release: req.query.release, sprint: req.query.sprint });
  });
};
