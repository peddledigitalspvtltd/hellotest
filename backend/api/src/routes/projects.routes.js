const service = require("../services/project.service");
const portfolioAnalytics = require("../services/portfolioAnalytics.service");
const qualityDashboardReport = require("../services/qualityDashboardReport.service");
const { config } = require("../config");
const projectDeletion = require("../services/projectDeletion.service");

module.exports = async function (fastify) {

  fastify.post("/projects", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      name: { required: true, type: "string", minLength: 1 },
      description: { required: false, type: "string" },
      visibility: { required: false, type: "string", enum: ["private", "public"] },
      members: { required: false, type: "array" },
      app_types: { required: false, type: "array" }
    }, req.body || {});
    return service.createProject({
      ...req.body,
      created_by: req.user.id
    });
  });

  // Get only projects user is a member of
  fastify.get("/projects", async (req) => {
    await fastify.authenticate(req);
    return service.getProjects(req.user.id, { projection: req.query?.projection });
  });

  fastify.get("/projects/catalog", async (req) => {
    await fastify.authenticate(req);
    return service.getProjectCatalog(req.user.id, { projection: req.query?.projection });
  });

  fastify.get("/projects/portfolio-analytics", async (req) => {
    await fastify.authenticate(req);
    return portfolioAnalytics.buildPortfolioAnalytics(req.user.id);
  });

  fastify.post("/projects/portfolio-attention-report.pdf", {
    bodyLimit: config.http.largeBodyLimitBytes
  }, async (req, reply) => {
    await fastify.authenticate(req);
    const pdf = qualityDashboardReport.renderedSnapshotPdf(req.body || {});
    if (!pdf) {
      const error = new Error("A rendered portfolio attention snapshot is required.");
      error.statusCode = 400;
      throw error;
    }
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", 'attachment; filename="HelloTest-projects-needing-attention.pdf"');
    return reply.send(pdf);
  });

  fastify.put("/projects/:id/favorite", async (req) => {
    await fastify.authenticate(req);
    return service.favoriteProject(req.params.id, req.user.id);
  });

  fastify.delete("/projects/:id/favorite", async (req) => {
    await fastify.authenticate(req);
    return service.unfavoriteProject(req.params.id, req.user.id);
  });

  // Get project details with access control
  fastify.get("/projects/:id", async (req) => {
    await fastify.authenticate(req);
    return service.getProject(req.params.id, req.user.id);
  });

  fastify.put("/projects/:id", async (req) => {
    await fastify.authenticate(req);
    // Verify access
    await service.getProject(req.params.id, req.user.id);
    await fastify.requirePermission("project.update", { projectId: req.params.id })(req);
    return service.updateProject(req.params.id, req.body);
  });

  fastify.get("/projects/:id/deletion", async (req, reply) => {
    await fastify.authenticate(req);
    reply.header("Cache-Control", "no-store");
    return projectDeletion.getStatus(req.params.id, req.user);
  });

  fastify.delete("/projects/:id", async (req, reply) => {
    await fastify.authenticate(req);
    const accepted = await projectDeletion.enqueue(req.params.id, req.user, {
      authorize: () => fastify.requirePermission("project.delete", { projectId: req.params.id })(req)
    });
    return reply.code(202).header("Location", `/projects/${encodeURIComponent(req.params.id)}/deletion`)
      .header("Cache-Control", "no-store").send(accepted);
  });

};
