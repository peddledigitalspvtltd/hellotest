const aiKnowledgeService = require("../services/aiKnowledge.service");
const knowledgeRagService = require("../services/knowledgeRag.service");
const knowledgeAssistantService = require("../services/knowledgeAssistant.service");
const attachmentService = require("../services/attachment.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");
const knowledgeSourceLifecycleService = require("../services/knowledgeSourceLifecycle.service");
const knowledgeAuthorization = require("../services/knowledgeAuthorization.service");
const execution = require("../services/knowledgeExecution.service");
const { streamKnowledge } = require("../utils/knowledgeStream");
const { publicKnowledgeError } = require("../utils/knowledgeAssistantErrors");
const { config } = require("../config");

const parseJsonField = (value, fallback) => {
  if (!value) return fallback;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const validateAppTypeScope = async (projectId, appTypeId) => {
  if (!appTypeId) return;
  const appType = await appTypeService.getAppType(appTypeId);
  if (appType.project_id !== projectId) {
    const error = new Error("Selected app type must belong to the current project.");
    error.statusCode = 403;
    throw error;
  }
};

const getIdempotencyKey = (req) => {
  const value = String(req.headers["idempotency-key"] || "").trim();
  if (value && !/^[A-Za-z0-9._:-]{8,255}$/.test(value)) {
    const error = new Error("Idempotency-Key must be 8-255 characters using letters, numbers, dot, underscore, colon, or hyphen.");
    error.statusCode = 400;
    throw error;
  }
  return value || null;
};

// Keep the entire read-only preflight within one deadline, before either JSON
// execution or SSE takes ownership of the response. Late reads cannot start
// subsequent permission checks or a turn after this request has ended.
const prepareKnowledgeRequest = async (req, reply, task) => {
  const controller = new AbortController();
  const disconnect = () => controller.abort();
  req.raw.once("aborted", disconnect);
  reply.raw.once("close", disconnect);
  if (req.raw.aborted || reply.raw.destroyed) controller.abort();
  try {
    return await execution.bounded(async () => {
      execution.assertActive();
      const input = await task();
      execution.assertActive();
      return input;
    }, { timeoutMs: 5_000, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw execution.abortError();
    if (error.code === "DEADLINE_EXCEEDED") {
      const code = "ASSISTANT_SETUP_TIMEOUT";
      const message = publicKnowledgeError({ code });
      throw Object.assign(new Error(message), { code, statusCode: 503, publicMessage: message });
    }
    throw error;
  } finally {
    req.raw.removeListener("aborted", disconnect);
    reply.raw.removeListener("close", disconnect);
  }
};

module.exports = async function (fastify) {
  const ensureProjectAccess = async (req, projectId, permissionCode, checkActive = () => {}) => {
    checkActive();
    await projectService.getProject(projectId, req.user.id);
    checkActive();
    await fastify.requirePermission(permissionCode, { projectId })(req);
    checkActive();
  };

  fastify.get("/projects/:project_id/knowledge", async (req) => {
    await fastify.authenticate(req);
    await ensureProjectAccess(req, req.params.project_id, "knowledge.view");
    return aiKnowledgeService.listKnowledge(req.params.project_id);
  });

  fastify.get("/projects/:project_id/knowledge/overview", async (req) => {
    await fastify.authenticate(req);
    await ensureProjectAccess(req, req.params.project_id, "knowledge.view");
    return knowledgeRagService.getOverview({ projectId: req.params.project_id, userId: req.user.id, user: req.user });
  });

  fastify.post("/projects/:project_id/knowledge", async (req) => {
    await fastify.authenticate(req);
    await ensureProjectAccess(req, req.params.project_id, "knowledge.manage");
    await validateAppTypeScope(req.params.project_id, req.body?.app_type_id);
    return aiKnowledgeService.createKnowledge(req.params.project_id, req.body || {}, req.user.id);
  });

  fastify.put("/projects/:project_id/knowledge/:id", async (req) => {
    await fastify.authenticate(req);
    await ensureProjectAccess(req, req.params.project_id, "knowledge.manage");
    await validateAppTypeScope(req.params.project_id, req.body?.app_type_id);
    return aiKnowledgeService.updateKnowledgeItem(req.params.project_id, req.params.id, req.body || {}, req.user.id);
  });

  fastify.get("/projects/:project_id/knowledge/search", async (req) => {
    await fastify.authenticate(req);
    await ensureProjectAccess(req, req.params.project_id, "knowledge.view");
    return aiKnowledgeService.searchKnowledge(req.params.project_id, {
      app_type_id: req.query.app_type_id,
      asset_type: req.query.asset_type,
      module_name: req.query.module_name,
      feature_name: req.query.feature_name,
      item_status: req.query.item_status,
      source: req.query.source,
      priority: req.query.priority,
      item_version: req.query.item_version,
      query: req.query.query,
      limit: Number(req.query.limit || 20)
    });
  });

  fastify.get("/projects/:project_id/knowledge/context-package", async (req) => {
    await fastify.authenticate(req);
    await ensureProjectAccess(req, req.params.project_id, "knowledge.view");
    return aiKnowledgeService.buildKnowledgeContextPackage(req.params.project_id, {
      app_type_id: req.query.app_type_id,
      asset_type: req.query.asset_type,
      module_name: req.query.module_name,
      feature_name: req.query.feature_name,
      item_version: req.query.item_version,
      priority: req.query.priority,
      query: req.query.query,
      source_id: req.query.source_id,
      limit: Number(req.query.limit || 12),
      user: req.user
    });
  });

  fastify.post("/projects/:project_id/knowledge/relations", async (req) => {
    await fastify.authenticate(req);
    await ensureProjectAccess(req, req.params.project_id, "knowledge.manage");
    return aiKnowledgeService.createKnowledgeRelation(req.params.project_id, req.body, req.user);
  });

  fastify.get("/projects/:project_id/knowledge/relations/source/:source_id", async (req) => {
    await fastify.authenticate(req);
    await ensureProjectAccess(req, req.params.project_id, "knowledge.view");
    return aiKnowledgeService.getKnowledgeRelationsBySource(req.params.project_id, req.params.source_id, req.user);
  });

  fastify.get("/projects/:project_id/knowledge/relations/target/:target_id", async (req) => {
    await fastify.authenticate(req);
    await ensureProjectAccess(req, req.params.project_id, "knowledge.view");
    return aiKnowledgeService.getKnowledgeRelationsByTarget(req.params.project_id, req.params.target_id, req.user);
  });

  fastify.delete("/projects/:project_id/knowledge/:id", async (req) => {
    await fastify.authenticate(req);
    await ensureProjectAccess(req, req.params.project_id, "knowledge.manage");
    return aiKnowledgeService.deleteKnowledgeItem(req.params.project_id, req.params.id);
  });

  fastify.post("/knowledge/ingestions", async (req, reply) => {
    await fastify.authenticate(req);
    const idempotencyKey = getIdempotencyKey(req);
    if (req.isMultipart()) {
      const fields = {};
      let file = null;
      const maxFileBytes = Math.min(Number(config.knowledge.maxFileBytes), Number(config.objectStorage.maxAttachmentBytes));
      for await (const part of req.parts({ limits: { files: 1, fields: 16, fileSize: maxFileBytes, fieldSize: 2_100_000 } })) {
        if (part.type === "file") {
          const buffer = await part.toBuffer();
          file = { filename: part.filename, mimetype: part.mimetype, file: { truncated: Boolean(part.file?.truncated) }, toBuffer: async () => buffer };
        } else {
          fields[part.fieldname] = part.value;
        }
      }
      if (!file) {
        const error = new Error("Choose one supported file to ingest.");
        error.statusCode = 400;
        throw error;
      }
      fields.chunking = parseJsonField(fields.chunking, {});
      await ensureProjectAccess(req, fields.project_id, "knowledge.manage");
      await validateAppTypeScope(fields.project_id, fields.app_type_id);
      const accepted = await knowledgeRagService.ingestUpload({ user: req.user, fields, file, idempotencyKey });
      reply.code(202).header("Location", accepted.status_url).header("Retry-After", "3");
      return accepted;
    }

    fastify.validate({
      project_id: { required: true, type: "string" },
      collection_id: { required: false, type: "string" },
      app_type_id: { required: false, type: "string" },
      title: { required: false, type: "string" },
      inputs: { required: false, type: "array" },
      selected_records: { required: false, type: "object" },
      chunking: { required: false, type: "object" }
    }, req.body || {});
    await ensureProjectAccess(req, req.body.project_id, "knowledge.manage");
    await validateAppTypeScope(req.body.project_id, req.body.app_type_id);
    const accepted = await knowledgeRagService.enqueueIngestion({
      projectId: req.body.project_id,
      collectionId: req.body.collection_id,
      appTypeId: req.body.app_type_id,
      title: req.body.title,
      inputs: req.body.inputs,
      selectedRecords: req.body.selected_records,
      chunking: req.body.chunking,
      idempotencyKey,
      user: req.user
    });
    reply.code(202).header("Location", accepted.status_url).header("Retry-After", "3");
    return accepted;
  });

  fastify.get("/knowledge/ingestions/:id", async (req) => {
    await fastify.authenticate(req);
    const job = await knowledgeRagService.getIngestionJob(req.params.id, { user: req.user });
    await ensureProjectAccess(req, job.project_id, "knowledge.view");
    return job;
  });

  fastify.post("/knowledge/ingestions/:id/retry", async (req, reply) => {
    await fastify.authenticate(req);
    const job = await knowledgeRagService.getIngestionJob(req.params.id, { user: req.user });
    await ensureProjectAccess(req, job.project_id, "knowledge.manage");
    const accepted = await knowledgeRagService.retryIngestion({ id: req.params.id, user: req.user });
    reply.code(202).header("Location", accepted.status_url).header("Retry-After", "3");
    return accepted;
  });

  fastify.post("/knowledge/search", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" }, query: { required: true, type: "string" } }, req.body || {});
    await ensureProjectAccess(req, req.body.project_id, "knowledge.view");
    return knowledgeRagService.search({
      projectId: req.body.project_id,
      query: req.body.query,
      mode: req.body.mode,
      limit: req.body.limit,
      filters: req.body.filters,
      user: req.user
    });
  });

  fastify.get("/knowledge/sources", async (req) => {
    await fastify.authenticate(req);
    await ensureProjectAccess(req, req.query.project_id, "knowledge.view");
    const allowedSourcePermissions = await knowledgeRagService.resolveAllowedSourcePermissions(req.user, req.query.project_id);
    return knowledgeSourceLifecycleService.list({
      projectId: req.query.project_id,
      allowedSourcePermissions, user: req.user, includeArchived: req.query.include_archived === "true"
    });
  });

  fastify.get("/knowledge/sources/:id/file", async (req, reply) => {
    await fastify.authenticate(req);
    const source = await knowledgeSourceLifecycleService.getDownload(req.params.id, { user: req.user });
    await ensureProjectAccess(req, source.project_id, "knowledge.view");
    if (source.required_permission) {
      await fastify.requirePermission(source.required_permission, { projectId: source.project_id })(req);
    }
    const { row, stream } = await attachmentService.download({ user: req.user, id: source.attachment_id, permissionCode: "knowledge.view" });
    const fileName = attachmentService.safeFileName(row.file_name).replace(/\"/g, "");
    reply.header("Content-Disposition", `attachment; filename="${fileName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    reply.type(row.mime_type || "application/octet-stream");
    return reply.send(stream);
  });

  fastify.delete("/knowledge/sources/:id", async (req) => {
    await fastify.authenticate(req);
    const source = await knowledgeSourceLifecycleService.get(req.params.id);
    await ensureProjectAccess(req, source.project_id, "knowledge.manage");
    if (source.required_permission) {
      await fastify.requirePermission(source.required_permission, { projectId: source.project_id })(req);
    }
    return knowledgeSourceLifecycleService.remove({ source, user: req.user });
  });

  fastify.get("/knowledge/collections", async (req) => {
    await fastify.authenticate(req);
    await ensureProjectAccess(req, req.query.project_id, "knowledge.view");
    const allowedSourcePermissions = await knowledgeRagService.resolveAllowedSourcePermissions(req.user, req.query.project_id);
    return knowledgeRagService.listCollections(req.query.project_id, { allowedSourcePermissions });
  });

  fastify.post("/knowledge/collections", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" }, name: { required: true, type: "string" } }, req.body || {});
    await ensureProjectAccess(req, req.body.project_id, "knowledge.manage");
    await validateAppTypeScope(req.body.project_id, req.body.app_type_id);
    return knowledgeRagService.createCollection({ projectId: req.body.project_id, appTypeId: req.body.app_type_id, name: req.body.name, description: req.body.description, color: req.body.color, retrievalConfig: req.body.retrieval_config, userId: req.user.id });
  });

  fastify.get("/knowledge/collections/:id", async (req) => {
    await fastify.authenticate(req);
    const collection = await knowledgeRagService.getCollection(req.params.id);
    await ensureProjectAccess(req, collection.project_id, "knowledge.view");
    const allowedSourcePermissions = await knowledgeRagService.resolveAllowedSourcePermissions(req.user, collection.project_id);
    return knowledgeRagService.getCollection(req.params.id, { allowedSourcePermissions });
  });

  fastify.put("/knowledge/collections/:id", async (req) => {
    await fastify.authenticate(req);
    const collection = await knowledgeRagService.getCollection(req.params.id);
    await ensureProjectAccess(req, collection.project_id, "knowledge.manage");
    await validateAppTypeScope(collection.project_id, req.body?.app_type_id);
    await knowledgeRagService.updateCollection(req.params.id, req.body || {});
    const allowedSourcePermissions = await knowledgeRagService.resolveAllowedSourcePermissions(req.user, collection.project_id);
    return knowledgeRagService.getCollection(req.params.id, { allowedSourcePermissions });
  });

  fastify.delete("/knowledge/collections/:id", async (req) => {
    await fastify.authenticate(req);
    const collection = await knowledgeRagService.getCollection(req.params.id);
    await ensureProjectAccess(req, collection.project_id, "knowledge.manage");
    return knowledgeRagService.deleteCollection(req.params.id);
  });

  fastify.post("/knowledge/collections/:id/sources", async (req) => {
    await fastify.authenticate(req);
    const collection = await knowledgeRagService.getCollection(req.params.id);
    await ensureProjectAccess(req, collection.project_id, "knowledge.manage");
    return knowledgeRagService.linkCollectionSources(req.params.id, req.body?.source_ids, req.user);
  });

  fastify.delete("/knowledge/collections/:id/sources", async (req) => {
    await fastify.authenticate(req);
    const collection = await knowledgeRagService.getCollection(req.params.id);
    await ensureProjectAccess(req, collection.project_id, "knowledge.manage");
    return knowledgeRagService.unlinkCollectionSources(req.params.id, req.body?.source_ids, req.user);
  });

  fastify.get("/knowledge/assistant/integrations", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" } }, req.query || {});
    await ensureProjectAccess(req, req.query.project_id, "knowledge.view");
    return knowledgeAssistantService.listAvailableLlmIntegrations({ projectId: req.query.project_id, userId: req.user.id });
  });

  fastify.get("/knowledge/assistant/sessions", async (req) => {
    await fastify.authenticate(req);
    await ensureProjectAccess(req, req.query.project_id, "knowledge.view");
    return knowledgeAssistantService.listSessions({ projectId: req.query.project_id, user: req.user });
  });

  fastify.post("/knowledge/assistant/sessions", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" },
      integration_id: { required: false, type: "string", maxLength: 255 }
    }, req.body || {});
    await ensureProjectAccess(req, req.body.project_id, "knowledge.view");
    await validateAppTypeScope(req.body.project_id, req.body.app_type_id);
    return knowledgeAssistantService.createSession({ projectId: req.body.project_id, appTypeId: req.body.app_type_id, title: req.body.title, filters: req.body.filters, integrationId: req.body.integration_id, user: req.user });
  });

  fastify.get("/knowledge/assistant/sessions/:id", async (req) => {
    await fastify.authenticate(req);
    const session = await knowledgeAssistantService.getSession({ id: req.params.id, user: req.user, includeMessages: false });
    await ensureProjectAccess(req, session.project_id, "knowledge.view");
    return knowledgeAssistantService.getSession({ id: req.params.id, user: req.user, includeMessages: true });
  });

  fastify.get("/knowledge/sources/:id", async (req) => {
    await fastify.authenticate(req);
    const source = await knowledgeSourceLifecycleService.get(req.params.id);
    await ensureProjectAccess(req, source.project_id, "knowledge.view");
    return knowledgeSourceLifecycleService.getDetail(req.params.id, { user: req.user, revisionId: req.query.revision_id, asOf: req.query.as_of });
  });

  fastify.get("/knowledge/sources/:id/revisions", async (req) => {
    await fastify.authenticate(req);
    const source = await knowledgeSourceLifecycleService.get(req.params.id);
    await ensureProjectAccess(req, source.project_id, "knowledge.manage");
    return knowledgeSourceLifecycleService.listRevisions(req.params.id, { user: req.user });
  });

  fastify.put("/knowledge/sources/:id/security", async (req) => {
    await fastify.authenticate(req);
    const source = await knowledgeSourceLifecycleService.get(req.params.id);
    await ensureProjectAccess(req, source.project_id, "knowledge.manage");
    return knowledgeAuthorization.replaceBindings({ sourceId: req.params.id, bindings: req.body?.bindings, user: req.user });
  });

  fastify.patch("/knowledge/assistant/sessions/:id", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ title: { required: false, type: "string", maxLength: 240 }, status: { required: false, type: "string" } }, req.body || {});
    const session = await knowledgeAssistantService.getSession({ id: req.params.id, user: req.user, includeMessages: false });
    await ensureProjectAccess(req, session.project_id, "knowledge.view");
    return knowledgeAssistantService.updateSession({ id: req.params.id, title: req.body?.title, status: req.body?.status, user: req.user });
  });

  const prepareTurn = (req, reply) => prepareKnowledgeRequest(req, reply, async () => {
    await fastify.authenticate(req);
    execution.assertActive();
    fastify.validate({ message: { required: true, type: "string", maxLength: 8000 }, integration_id: { required: false, type: "string", maxLength: 255 }, retry_provider: { required: false, type: "boolean" }, smart_context: { required: false, type: "object" }, retrieval_budgets: { required: false, type: "object" }, filters: { required: false, type: "object" } }, req.body || {});
    if (req.body.response_mode && !["answer", "evidence"].includes(req.body.response_mode)) {
      throw Object.assign(new Error("response_mode must be answer or evidence."), { statusCode: 400 });
    }
    const session = await knowledgeAssistantService.getSession({ id: req.params.id, user: req.user, includeMessages: false });
    execution.assertActive();
    await ensureProjectAccess(req, session.project_id, "knowledge.view", execution.assertActive);
    if (session.status !== "active") throw Object.assign(new Error("This knowledge conversation is archived."), { statusCode: 409 });
    const clientTurnId = String(req.body.client_turn_id || req.headers["idempotency-key"] || "").trim();
    if (clientTurnId && !/^[A-Za-z0-9._:-]{8,255}$/.test(clientTurnId)) throw Object.assign(new Error("client_turn_id must be 8-255 characters using letters, numbers, dot, underscore, colon, or hyphen."), { statusCode: 400 });
    return { sessionId: req.params.id, message: req.body.message, filters: req.body.filters, smartContext: req.body.smart_context, integrationId: req.body.integration_id, retrievalBudgets: req.body.retrieval_budgets, responseMode: req.body.response_mode || "answer", clientTurnId: clientTurnId || null, retryProvider: req.body.retry_provider === true, user: req.user };
  });

  fastify.post("/knowledge/assistant/sessions/:id/messages/stream", async (req, reply) => {
    const input = await prepareTurn(req, reply);
    return streamKnowledge(req, reply, (stream) => knowledgeAssistantService.respond({ ...input, ...stream }));
  });

  const prepareContext = (req, reply) => prepareKnowledgeRequest(req, reply, async () => {
    await fastify.authenticate(req);
    execution.assertActive();
    const version = req.body?.contract_version;
    if ((req.body?.contract_type && req.body.contract_type !== "RetrievalRequest") || (version && !["1.0", "RetrievalRequest.v1"].includes(version))) {
      throw Object.assign(new Error("Only RetrievalRequest contract version 1.0 is supported."), { statusCode: 422, code: "ERR_CONTRACT_VERSION" });
    }
    fastify.validate({ project_id: { required: true, type: "string" }, query: { required: true, type: "string", maxLength: 8000 }, filters: { required: false, type: "object" }, budgets: { required: false, type: "object" } }, req.body || {});
    await ensureProjectAccess(req, req.body.project_id, "knowledge.view", execution.assertActive);
    const appTypeId = req.body.app_type_id || req.body.filters?.app_type_id;
    await validateAppTypeScope(req.body.project_id, appTypeId);
    // Identity, roles, and permission filters are never accepted from the body.
    return { projectId: req.body.project_id, appTypeId, query: req.body.query, filters: req.body.filters, budgets: req.body.budgets, user: req.user };
  });

  fastify.post("/v1/context/retrieve", async (req, reply) => knowledgeAssistantService.retrieve(await prepareContext(req, reply)));
  fastify.post("/v1/context/retrieve-stream", async (req, reply) => {
    const input = await prepareContext(req, reply);
    return streamKnowledge(req, reply, (stream) => knowledgeAssistantService.retrieve({ ...input, ...stream }));
  });

  fastify.post("/knowledge/assistant/sessions/:id/messages", async (req, reply) => {
    const input = await prepareTurn(req, reply);
    const result = await knowledgeAssistantService.respond(input);
    if (result.pending) reply.code(202).header("Retry-After", String(result.retry_after_seconds || 3));
    return result;
  });
};
