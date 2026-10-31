const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");
const workspaceTransactionService = require("../services/workspaceTransaction.service");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const requireTransactionPermission = async (fastify, req, transaction, permissionCode) => {
  if (transaction.project_id) {
    await projectService.getProject(transaction.project_id, req.user.id);
    await fastify.requirePermission(permissionCode, { projectId: transaction.project_id })(req);
  } else if (req.user?.role !== "admin") {
    throw createError("Project scope is required.", 403);
  }
};

module.exports = async function (fastify) {
  fastify.get("/workspace-transactions", async (req) => {
    await fastify.authenticate(req);

    const { project_id, app_type_id, category, limit, include_global } = req.query;
    const includeGlobal = include_global === true || include_global === "true";
    if (includeGlobal && req.user?.role !== "admin") {
      throw createError("Workspace administrator access is required for global transactions.", 403);
    }
    let scopedProjectId = project_id || null;

    if (app_type_id) {
      const appType = await appTypeService.getAppType(app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);

      if (project_id && project_id !== appType.project_id) {
        throw new Error("Selected app type must belong to the current project");
      }

      scopedProjectId = appType.project_id;
    } else if (project_id) {
      await projectService.getProject(project_id, req.user.id);
    } else if (req.user?.role !== "admin") {
      throw createError("Project scope is required.", 403);
    }

    if (scopedProjectId) {
      await fastify.requirePermission("transaction.view", { projectId: scopedProjectId })(req);
    }

    return workspaceTransactionService.listTransactions({
      project_id: scopedProjectId || undefined,
      app_type_id: app_type_id || undefined,
      category: category || undefined,
      include_global: includeGlobal,
      limit: limit !== undefined ? Number(limit) : undefined
    });
  });

  fastify.get("/workspace-transactions/:id", async (req) => {
    await fastify.authenticate(req);
    const transaction = await workspaceTransactionService.getTransaction(req.params.id);
    await requireTransactionPermission(fastify, req, transaction, "transaction.view");
    return transaction;
  });

  fastify.get("/workspace-transactions/:id/events", async (req) => {
    await fastify.authenticate(req);

    const transaction = await workspaceTransactionService.getTransaction(req.params.id);

    await requireTransactionPermission(fastify, req, transaction, "transaction.view");

    return workspaceTransactionService.listTransactionEvents(transaction.id);
  });

  fastify.get("/workspace-transactions/:id/artifacts", async (req) => {
    await fastify.authenticate(req);

    const transaction = await workspaceTransactionService.getTransaction(req.params.id);

    await requireTransactionPermission(fastify, req, transaction, "transaction.view");

    return workspaceTransactionService.listTransactionArtifacts(transaction.id);
  });

  fastify.get("/workspace-transactions/:id/artifacts/:artifactId/download", async (req, reply) => {
    await fastify.authenticate(req);

    const transaction = await workspaceTransactionService.getTransaction(req.params.id);

    await requireTransactionPermission(fastify, req, transaction, "transaction.artifact.download");

    const artifact = await workspaceTransactionService.getTransactionArtifact(req.params.artifactId);

    if (artifact.transaction_id !== transaction.id) {
      throw createError("Artifact does not belong to this transaction.", 404);
    }

    const protectedAutomationContent = [
      "application/vnd.hellotest.automation-section-preview+json",
      "application/vnd.hellotest.automation-browser-evidence+json",
      "application/vnd.hellotest.automation-browser-diagnostic+json",
      "application/vnd.hellotest.automation-build-data+json",
      "application/vnd.hellotest.automation-used-objects+json"
    ].includes(artifact.mime_type)
      || (transaction.category === "automation_build" && transaction.metadata?.agent_activity === true);
    if (protectedAutomationContent) {
      if (transaction.category !== "automation_build" || !transaction.project_id) {
        throw createError("Automation activity content is unavailable.", 404);
      }
      for (const code of ["automation.build", "automation.view", "automation.code.view", "automation.ai"]) {
        await requireTransactionPermission(fastify, req, transaction, code);
      }
    }
    if (artifact.mime_type === "application/vnd.hellotest.automation-build-data+json") {
      await requireTransactionPermission(fastify, req, transaction, "data.view");
    }

    const content = artifact.content || "";
    const dataUrlMatch = typeof content === "string"
      ? content.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/s)
      : null;
    const responseBody = dataUrlMatch
      ? Buffer.from(dataUrlMatch[2] || "", "base64")
      : content;
    const responseMimeType = dataUrlMatch?.[1] || artifact.mime_type || "application/octet-stream";

    reply
      .header("Content-Type", responseMimeType)
      .header("Content-Disposition", `attachment; filename="${String(artifact.file_name || "artifact.txt").replace(/"/g, "")}"`);

    return responseBody;
  });

  fastify.delete("/workspace-transactions/:id", async (req) => {
    await fastify.authenticate(req);
    const transaction = await workspaceTransactionService.getTransaction(req.params.id);
    await requireTransactionPermission(fastify, req, transaction, "transaction.manage");
    return workspaceTransactionService.deleteTransaction(req.params.id);
  });
};
