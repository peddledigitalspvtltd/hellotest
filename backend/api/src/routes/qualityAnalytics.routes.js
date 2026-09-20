const projectService = require("../services/project.service");
const analytics = require("../services/qualityAnalytics.service");
const overview = require("../services/qualityOverview.service");
const dashboards = require("../services/qualityDashboard.service");
const reports = require("../services/qualityDashboardReport.service");
const { config } = require("../config");
const dashboardPermissions = require("../services/qualityDashboardPermissions");

const requireProject = async (req, projectId) => {
  if (!projectId) {
    const error = new Error("Project scope is required.");
    error.statusCode = 400;
    throw error;
  }
  return projectService.getProject(projectId, req.user.id);
};

module.exports = async function (fastify) {
  const authorizeGadget = (req, projectId) => {
    const checks = new Map();
    return async gadget => {
      for (const permission of dashboardPermissions(gadget)) {
        if (!checks.has(permission)) checks.set(permission, Promise.resolve().then(() => fastify.requirePermission(permission, { projectId })(req)));
        await checks.get(permission);
      }
    };
  };
  const authorizeDashboard = async (req, dashboard) => {
    const authorize = authorizeGadget(req, dashboard.project_id);
    for (const gadget of dashboard.gadgets || []) await authorize(gadget);
  };
  fastify.get("/analytics/overview", async (req, reply) => {
    await fastify.authenticate(req);
    const projectId = req.query.project_id;
    const window = overview.windowFor(req.query.days || 30);
    const project = await requireProject(req, projectId);
    const can = async (...permissions) => {
      try {
        for (const permission of permissions) await fastify.requirePermission(permission, { projectId })(req);
        return true;
      } catch (error) {
        if (error?.statusCode === 403) return false;
        throw error;
      }
    };
    const entries = await Promise.all([
      ["stories", ["requirement.view"]], ["cases", ["testcase.view"]], ["suites", ["suite.view"]],
      ["runs", ["run.view", "result.view"]], ["bugs", ["feedback.view"]],
      ["automation", ["automation.view", "automation.analytics.view"]]
    ].map(async ([source, permissions]) => [source, await can(...permissions)]));
    reply.header("Cache-Control", "private, no-store");
    return overview.getOverview({ projectId, project, days: window.days, visibility: Object.fromEntries(entries) });
  });

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

  const downloadDashboardReport = async (req, reply) => {
    await fastify.authenticate(req);
    const dashboard = await dashboards.get(req.params.id);
    await requireProject(req, dashboard.project_id);
    await authorizeDashboard(req, dashboard);
    const { pdf } = await reports.renderPdf(dashboard, req.body || {});
    const fileName = `${String(dashboard.name || "HelloTest-quality-report").replace(/[^A-Za-z0-9._-]+/g, "-") || "HelloTest-quality-report"}.pdf`;
    reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="${fileName}"`);
    return reply.send(pdf);
  };
  fastify.get("/quality-dashboards/:id/report.pdf", downloadDashboardReport);
  fastify.post("/quality-dashboards/:id/report.pdf", {
    bodyLimit: config.http.largeBodyLimitBytes
  }, downloadDashboardReport);

  fastify.post("/quality-dashboards/:id/share-report", {
    bodyLimit: config.http.largeBodyLimitBytes
  }, async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ recipients: { required: true, type: "array", items: "string" } }, req.body || {});
    const dashboard = await dashboards.get(req.params.id);
    await requireProject(req, dashboard.project_id);
    await authorizeDashboard(req, dashboard);
    return reports.share({ dashboard, recipients: req.body.recipients, requestedBy: req.user.id, snapshotPayload: req.body || {} });
  });

  const evaluateOne = async (req) => {
    await fastify.authenticate(req);
    const projectId = req.body?.project_id || req.query?.project_id;
    await requireProject(req, projectId);
    const gadget = req.body?.gadget || req.body || {};
    await authorizeGadget(req, projectId)(gadget);
    return analytics.evaluateGadget({ projectId, gadget });
  };
  fastify.post("/analytics/jql", evaluateOne);
  fastify.post("/analytics/query", evaluateOne);

  const evaluateBatch = async (req) => {
    await fastify.authenticate(req);
    const projectId = req.body?.project_id;
    await requireProject(req, projectId);
    return dashboards.evaluateBatch({ projectId, gadgets: req.body?.gadgets || [], authorizeGadget: authorizeGadget(req, projectId) });
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
      additionalContext: req.body.additional_context,
      userId: req.user.id
    });
  });

  fastify.get("/ai/quality-insights", async (req) => {
    await fastify.authenticate(req);
    await requireProject(req, req.query.project_id);
    // This compatibility endpoint returns source records as well as counts.
    // The insight grant alone must never bypass the permissions on that evidence.
    for (const permission of ["requirement.view", "testcase.view", "suite.view", "run.view", "result.view", "feedback.view"]) {
      await fastify.requirePermission(permission, { projectId: req.query.project_id })(req);
    }
    let includeAutomation = false;
    try {
      await fastify.requirePermission("automation.view", { projectId: req.query.project_id })(req);
      await fastify.requirePermission("automation.analytics.view", { projectId: req.query.project_id })(req);
      includeAutomation = true;
    } catch (error) {
      if (error?.statusCode !== 403) throw error;
    }
    const result = await analytics.qualityInsights({ projectId: req.query.project_id, release: req.query.release, sprint: req.query.sprint });
    if (!includeAutomation) delete result.metrics.automationCoverage;
    return result;
  });
};
