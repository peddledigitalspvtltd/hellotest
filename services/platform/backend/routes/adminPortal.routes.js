const adminPortalService = require("../services/adminPortal.service");
const instanceSetupService = require("../services/instanceSetup.service");
const userService = require("../services/user.service");
const featureFlagService = require("../services/featureFlag.service");
const integrationService = require("@hellotest/integration/backend/services/integration.service");
const dropdownCatalogService = require("../services/dropdownCatalog.service");
const { INTEGRATION_TYPE_OPTIONS } = require("../src/domain/catalog");

const clientIp = (req) => req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null;

module.exports = async function (fastify) {
  fastify.addHook("onClose", () => adminPortalService.stopPerformanceIndexing());
  fastify.get("/admin-portal/status", () => adminPortalService.getPublicStatus());

  fastify.post("/admin-portal/auth/login", async (req) => {
    fastify.validate({
      username: { required: true, type: "string", minLength: 3, maxLength: 200 },
      password: { required: true, type: "string", minLength: 1, maxLength: 128 }
    }, req.body);
    return adminPortalService.login(req.body);
  });

  const metricGovernance = require("../services/metricGovernance.service");
  fastify.get("/admin-portal/metric-governance", { preHandler: [fastify.requireAdmin] }, async (_req, reply) => {
    reply.header("Cache-Control", "no-store"); return metricGovernance.list();
  });
  fastify.get("/admin-portal/metric-governance/:id", { preHandler: [fastify.requireAdmin] }, async (req, reply) => {
    reply.header("Cache-Control", "no-store"); return metricGovernance.detail(req.params.id);
  });
  for (const mode of ["draft", "publish", "rollback"]) {
    fastify.post(`/admin-portal/metric-governance/:id/${mode}`, { preHandler: [fastify.requireAdmin] }, (req) =>
      metricGovernance.mutate(req.params.id, req.body, { actorId: req.user.id, ipAddress: clientIp(req) }, mode));
  }

  const aiConfiguration = require("../services/aiConfiguration.service");
  fastify.get("/admin-portal/ai-configuration", { preHandler: [fastify.requireAdmin] }, async (_req, reply) => {
    reply.header("Cache-Control", "no-store"); return aiConfiguration.list();
  });
  fastify.get("/admin-portal/ai-configuration/metrics", { preHandler: [fastify.requireAdmin] }, async (_req, reply) => {
    reply.header("Cache-Control", "no-store"); return aiConfiguration.metrics();
  });
  fastify.get("/admin-portal/ai-configuration/:id", { preHandler: [fastify.requireAdmin] }, async (req, reply) => {
    reply.header("Cache-Control", "no-store"); return aiConfiguration.detail(req.params.id);
  });
  for (const mode of ["draft", "publish", "rollback"]) {
    fastify.post(`/admin-portal/ai-configuration/:id/${mode}`, { preHandler: [fastify.requireAdmin] }, (req) =>
      aiConfiguration.mutate(req.params.id, req.body, { actorId: req.user.id, ipAddress: clientIp(req) }, mode));
  }
  fastify.post("/admin-portal/ai-configuration/:id/optimize", { preHandler: [fastify.requireAdmin] }, (req) => {
    if (!req.body || Object.keys(req.body).some(key => !["config", "integration_id"].includes(key))) throw Object.assign(new Error("Only configuration and optional integration are accepted."), { statusCode: 400 });
    return aiConfiguration.optimize(req.params.id, req.body, { actorId: req.user.id, ipAddress: clientIp(req) });
  });

  fastify.get("/admin-portal/overview", { preHandler: [fastify.requireAdmin] }, () => adminPortalService.getOverview());

  fastify.get("/admin-portal/dropdowns", { preHandler: [fastify.requireAdmin] }, async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    return dropdownCatalogService.getCatalog();
  });

  fastify.put("/admin-portal/dropdowns/:key", { preHandler: [fastify.requireAdmin] }, async (req, reply) => {
    fastify.validate({ expected_revision: { required: true, type: "number" }, options: { required: true, type: "array", maxItems: 200 } }, req.body || {});
    reply.header("Cache-Control", "no-store");
    return dropdownCatalogService.updateField(req.params.key, req.body, { actorId: req.user.id, ipAddress: clientIp(req) });
  });

  fastify.post("/admin-portal/setup/schema", { preHandler: [fastify.requireAdmin] }, async (req) =>
    adminPortalService.applySchema({ actorId: req.user.id, ipAddress: clientIp(req) }));

  fastify.get("/admin-portal/setup/performance-indexing", { preHandler: [fastify.requireAdmin] }, async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    return adminPortalService.getPerformanceIndexing();
  });

  fastify.post("/admin-portal/setup/performance-indexing", { preHandler: [fastify.requireAdmin] }, async (req, reply) => {
    if (req.body != null && (typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length)) {
      throw Object.assign(new Error("Performance indexing accepts no parameters."), { statusCode: 400 });
    }
    reply.code(202).header("Cache-Control", "no-store");
    return adminPortalService.startPerformanceIndexing({ actorId: req.user.id, ipAddress: clientIp(req) });
  });

  fastify.get("/admin-portal/setup/sample-data", { preHandler: [fastify.requireAdmin] }, () =>
    adminPortalService.getSampleCatalog());

  fastify.get("/admin-portal/setup/sample-data/status", { preHandler: [fastify.requireAdmin] }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    return instanceSetupService.getStatus({ jobId: req.query?.job_id });
  });

  fastify.post("/admin-portal/setup/sample-data", { preHandler: [fastify.requireAdmin] }, async (req, reply) => {
    fastify.validate({ modules: { required: false, type: "array", items: "string", maxItems: 64 } }, req.body || {});
    const result = await instanceSetupService.start({ modules: req.body?.modules, actorId: req.user.id, ipAddress: clientIp(req) });
    reply.code(202).header("Cache-Control", "no-store");
    return result;
  });

  fastify.post("/admin-portal/setup/sample-data/:jobId/retry", { preHandler: [fastify.requireAdmin] }, async (req, reply) => {
    if (req.body != null && (typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length)) {
      throw Object.assign(new Error("Retry setup accepts no parameters."), { statusCode: 400 });
    }
    const result = await instanceSetupService.retry({ jobId: req.params.jobId, actorId: req.user.id, ipAddress: clientIp(req) });
    reply.code(202).header("Cache-Control", "no-store");
    return result;
  });

  fastify.post("/admin-portal/users", { preHandler: [fastify.requireAdmin] }, async (req) => {
    fastify.validate({
      email: { required: true, type: "string", minLength: 3, maxLength: 320 },
      password: { required: true, type: "string", minLength: 6, maxLength: 128 },
      name: { required: true, type: "string", minLength: 2, maxLength: 120 },
      role_id: { required: true, type: "string" }
    }, req.body);
    const created = await userService.createUser(req.body);
    await adminPortalService.recordAudit({ actorId: req.user.id, action: "admin_user.create", targetType: "user", targetId: created.id, summary: `Onboarded administrator ${req.body.email}.`, metadata: { email: req.body.email }, ipAddress: clientIp(req) });
    return created;
  });

  fastify.put("/admin-portal/users/:id/status", { preHandler: [fastify.requireAdmin] }, async (req) => {
    fastify.validate({ status: { required: true, type: "string", enum: ["active", "suspended"] } }, req.body);
    if (req.params.id === req.user.id && req.body.status === "suspended") {
      const error = new Error("You cannot suspend your current administrator account.");
      error.statusCode = 400;
      throw error;
    }
    const result = await require("../src/db").prepare("UPDATE users SET status = ? WHERE id = ?").run(req.body.status, req.params.id);
    if (!result.changes) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }
    await adminPortalService.recordAudit({ actorId: req.user.id, action: "admin_user.status", targetType: "user", targetId: req.params.id, summary: `Changed administrator status to ${req.body.status}.`, metadata: { status: req.body.status }, ipAddress: clientIp(req) });
    return { updated: true };
  });

  fastify.put("/admin-portal/feature-flags", { preHandler: [fastify.requireAdmin] }, async (req) => {
    fastify.validate({ flags: { required: true, type: "object" } }, req.body);
    return require("../src/db").transaction(async () => {
      const result = await featureFlagService.updateLocalFlags(req.body.flags);
      await adminPortalService.recordAudit({ actorId: req.user.id, action: "feature_flags.update", targetType: "workspace", summary: "Updated workspace feature availability.", metadata: { changed_keys: Object.keys(req.body.flags), changes: req.body.flags }, ipAddress: clientIp(req) });
      return result;
    })();
  });

  fastify.get("/admin-portal/integration-types", { preHandler: [fastify.requireAdmin] }, async () => INTEGRATION_TYPE_OPTIONS);

  fastify.post("/admin-portal/integrations", { preHandler: [fastify.requireAdmin] }, async (req) => {
    const created = await integrationService.createIntegration(req.body);
    await adminPortalService.recordAudit({ actorId: req.user.id, action: "integration.create", targetType: "integration", targetId: created.id, summary: `Created backend integration ${req.body.name}.`, metadata: { type: req.body.type }, ipAddress: clientIp(req) });
    return created;
  });

  fastify.delete("/admin-portal/integrations/:id", { preHandler: [fastify.requireAdmin] }, async (req) => {
    const integration = await integrationService.getIntegration(req.params.id);
    const result = await integrationService.deleteIntegration(req.params.id);
    await adminPortalService.recordAudit({ actorId: req.user.id, action: "integration.delete", targetType: "integration", targetId: req.params.id, summary: `Deleted backend integration ${integration.name}.`, metadata: { type: integration.type }, ipAddress: clientIp(req) });
    return result;
  });

  fastify.put("/admin-portal/security/password", { preHandler: [fastify.requireAdmin] }, async (req) => {
    fastify.validate({
      current_password: { required: true, type: "string", minLength: 1, maxLength: 128 },
      new_password: { required: true, type: "string", minLength: 8, maxLength: 128 }
    }, req.body);
    const result = await userService.changeOwnPassword({ id: req.user.id, ...req.body });
    await adminPortalService.recordAudit({ actorId: req.user.id, action: "security.password", targetType: "user", targetId: req.user.id, summary: "Replaced the administrator account password.", ipAddress: clientIp(req) });
    return result;
  });

  fastify.get("/admin-portal/audit", { preHandler: [fastify.requireAdmin] }, (req) =>
    adminPortalService.listAudit({ limit: req.query.limit }));
};
