const knowledgeAssistantService = require("../services/knowledgeAssistant.service");
const execution = require("@hellotest/knowledge/backend/services/knowledgeExecution.service");
const { streamAssistant, runConnectedAssistant } = require("../http/assistantStream");


const { validateAppTypeScope, prepareKnowledgeRequest, createProjectAccess } = require("@hellotest/knowledge/backend/http/requestScope");

module.exports = async function (fastify) {
  const ensureProjectAccess = createProjectAccess(fastify);
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
    return streamAssistant(req, reply, (stream) => knowledgeAssistantService.respond({ ...input, ...stream }));
  });

  fastify.post("/knowledge/assistant/sessions/:id/messages", async (req, reply) => {
    const input = await prepareTurn(req, reply);
    const result = await runConnectedAssistant(req, reply, (connection) => knowledgeAssistantService.respond({ ...input, ...connection }));
    if (result.pending) reply.code(202).header("Retry-After", String(result.retry_after_seconds || 3));
    return result;
  });
};
