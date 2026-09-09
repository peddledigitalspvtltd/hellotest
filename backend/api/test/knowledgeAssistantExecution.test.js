const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../src/db");
const assistant = require("../src/services/knowledgeAssistant.service");
const rag = require("../src/services/knowledgeRag.service");
const auth = require("../src/services/knowledgeAuthorization.service");
const orchestrator = require("../src/services/aiContextOrchestrator.service");
const integrations = require("../src/services/integration.service");
const permissions = require("../src/services/permission.service");
const projects = require("../src/services/project.service");
const llmSelection = require("../src/services/aiLlmSelection.service");

const fixture = async (task) => {
  const saved = { prepare: db.prepare, search: rag.searchMany, permissions: rag.resolveAllowedSourcePermissions, parents: rag.expandEvidence, relations: rag.expandRelationships, access: auth.getEvidenceAccess, live: orchestrator.buildLiveProjectEvidence, integrations: integrations.getIntegrations, hasPermission: permissions.hasPermission, project: projects.getProject };
  const session = { id: "session-1", project_id: "project-1", created_by: "user-1", status: "active", filters: {} };
  const messages = [];
  const state = { revoked: false, searches: 0, models: 0 };
  permissions.hasPermission = async () => !state.projectRevoked;
  projects.getProject = async () => ({ id: session.project_id });
  db.prepare = (sql) => ({
    get: async (...args) => {
      if (sql.includes("COUNT(*)")) return { message_count: messages.length };
      if (sql.includes("SELECT * FROM ai_knowledge_assistant_sessions")) return session;
      if (sql.includes("INSERT INTO ai_knowledge_assistant_messages")) {
        const [id, session_id, project_id, role, content, status, citations, retrieval, safety, provider, model, client_turn_id, content_fingerprint] = args;
        if (messages.some((item) => item.role === role && item.client_turn_id === client_turn_id)) return null;
        const row = { id, session_id, project_id, role, content, status, citations, retrieval, safety, provider, model, client_turn_id, content_fingerprint };
        messages.push(row); return row;
      }
      if (sql.includes("role = 'assistant'")) return messages.find((item) => item.role === "assistant" && item.client_turn_id === args[1]);
      if (sql.includes("role = 'user'")) return messages.find((item) => item.role === "user" && item.client_turn_id === args[1]);
      if (sql.includes("RETURNING *") && sql.includes("UPDATE ai_knowledge_assistant_messages")) {
        const row = messages.find((item) => item.id === args[0] && item.status === "error");
        if (row) row.status = "pending";
        return row;
      }
      throw new Error(`Unhandled fixture read: ${sql}`);
    },
    all: async (...args) => messages.filter((item) => !sql.includes("id <>") || (item.id !== args[1] && !["pending", "error"].includes(item.status))),
    run: async (...args) => {
      if (sql.includes("SET status = 'error'")) { const row = messages.find((item) => item.id === args[0]); if (row?.status === "pending") row.status = "error"; }
      if (sql.includes("SET status = 'answered'")) { const row = messages.find((item) => item.id === args[0]); if (row) row.status = "answered"; }
    }
  });
  rag.resolveAllowedSourcePermissions = async () => [];
  rag.searchMany = async () => {
    state.searches++;
    return { results: [{ query: "release", result: { results: [{ source_id: "source-1", chunk_id: "chunk-1", source_kind: "text", title: "Release decision", content: "Release approval requires a passing checkout test.", score: 0.95, citation: { id: "K-chunk-1", source_id: "source-1", chunk_id: "chunk-1", excerpt: "Release approval requires a passing checkout test." } }], retrieval: {} } }], errors: [] };
  };
  rag.expandEvidence = async () => ({ results: [] });
  rag.expandRelationships = async () => ({ results: [], relationships: [] });
  auth.getEvidenceAccess = async ({ evidence }) => ({ allowed: state.revoked ? [] : evidence, denied_ids: state.revoked ? evidence.map((item) => item.chunk_id) : [], partial: state.revoked });
  orchestrator.buildLiveProjectEvidence = async () => ({ hits: [], counts: {} });
  integrations.getIntegrations = async () => { state.models++; throw new Error("Evidence-only mode must not select a model"); };
  const input = { sessionId: session.id, message: "What is the release approval requirement?", clientTurnId: "turn-123456", responseMode: "evidence", user: { id: "user-1" } };
  try { await task({ input, messages, state }); }
  finally {
    db.prepare = saved.prepare; rag.searchMany = saved.search; rag.resolveAllowedSourcePermissions = saved.permissions;
    rag.expandEvidence = saved.parents; rag.expandRelationships = saved.relations; auth.getEvidenceAccess = saved.access;
    orchestrator.buildLiveProjectEvidence = saved.live; integrations.getIntegrations = saved.integrations;
    permissions.hasPermission = saved.hasPermission; projects.getProject = saved.project;
  }
};

test("evidence-only turns persist validated claims and replay without duplicate retrieval", async () => fixture(async ({ input, messages, state }) => {
  const first = await assistant.respond(input);
  assert.equal(first.assistant_message.status, "answered");
  assert.match(first.assistant_message.content, /passing checkout test/);
  assert.equal(first.assistant_message.safety.rendered_from_validated_claims, true);
  assert.equal(first.citations.length, 1);
  assert.equal(first.answer_contract.claims[0].classification, "SUPPORTED");
  const searches = state.searches;
  const replay = await assistant.respond(input);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(state.searches, searches);
  assert.equal(state.models, 0);
  assert.equal(messages.length, 2);
}));

test("revoked sources are removed from complete stored answers and idempotent replays", async () => fixture(async ({ input, state }) => {
  await assistant.respond(input);
  state.revoked = true;
  const history = await assistant.getSession({ id: input.sessionId, user: input.user });
  const storedAnswer = history.messages.find((item) => item.role === "assistant");
  assert.equal(storedAnswer.safety.evidence_access_changed, true);
  assert.ok(!JSON.stringify(storedAnswer).includes("passing checkout"));
  const replay = await assistant.respond(input);
  assert.equal(replay.context_packet, null);
  assert.equal(replay.citations.length, 0);
  assert.ok(!JSON.stringify(replay.assistant_message).includes("passing checkout"));
}));

test("a cancelled turn can be retried immediately under the same client turn ID", async () => fixture(async ({ input, messages }) => {
  const controller = new AbortController();
  await assert.rejects(assistant.respond({ ...input, signal: controller.signal, onProgress: (event) => {
    if (event.stage === "HYBRID_SEARCH") controller.abort();
  } }), { name: "AbortError" });
  assert.equal(messages[0].status, "error");
  const resumed = await assistant.respond(input);
  assert.equal(resumed.assistant_message.status, "answered");
  assert.equal(messages.length, 2);
}));

test("same-turn retries reject a changed scope or response mode", async () => fixture(async ({ input }) => {
  await assistant.respond(input);
  await assert.rejects(assistant.respond({ ...input, filters: { source_ids: ["other"] } }), { statusCode: 409 });
  await assert.rejects(assistant.respond({ ...input, responseMode: "answer" }), { statusCode: 409 });
}));

test("revoking knowledge permission invalidates project-readable text evidence", async () => fixture(async ({ input, state }) => {
  await assistant.respond(input);
  state.projectRevoked = true;
  const replay = await assistant.respond(input);
  assert.equal(replay.citations.length, 0);
  assert.equal(replay.context_packet, null);
  assert.equal(replay.assistant_message.safety.evidence_access_changed, true);
}));

test("model connection failure returns authorized evidence with an actionable error and failed generation event", async (context) => fixture(async ({ input }) => {
  context.mock.method(llmSelection, "resolveLlmIntegrationForUsage", async () => ({ id: "model", type: "llm", is_active: true, api_key: "test-credential", base_url: "https://answer.invalid/v1", model: "test", config: {} }));
  context.mock.method(global, "fetch", async () => new Response(JSON.stringify({ error: "PRIVATE_ACCOUNT_DETAIL" }), { status: 401 }));
  const events = [];
  const result = await assistant.respond({ ...input, responseMode: "answer", onProgress: (event) => events.push(event) });
  assert.equal(result.assistant_message.status, "provider_unavailable");
  assert.match(result.assistant_message.content, /passing checkout test/);
  assert.equal(result.citations.length, 1);
  assert.equal(result.retrieval.provider_error_code, "MODEL_AUTHENTICATION_FAILED");
  assert.match(result.retrieval.provider_error_message, /connection credentials/);
  assert.ok(events.some((event) => event.stage === "GENERATION" && event.status === "FAILED" && event.error_code === "MODEL_AUTHENTICATION_FAILED"));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ACCOUNT_DETAIL/);
}));

test("access revoked during generation removes claims and source contents before saving an answer", async (context) => fixture(async ({ input, state }) => {
  context.mock.method(llmSelection, "resolveLlmIntegrationForUsage", async () => ({ id: "model", type: "llm", is_active: true, api_key: "test-credential", base_url: "https://revocation.invalid/v1", model: "test", config: {} }));
  context.mock.method(global, "fetch", async (_, init) => {
    if (JSON.parse(init.body).messages[0].content.includes("You plan evidence retrieval")) return new Response(JSON.stringify({ choices: [{ message: { content: '{"search_queries":[]}' } }] }), { status: 200 });
    state.revoked = true;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ status: "answered", executive_summary: "Approval requires a passing checkout test. [K-chunk-1]", supported_claims: [{ statement: "Approval requires a passing checkout test.", citation_ids: ["K-chunk-1"] }] }) } }] }), { status: 200 });
  });
  const result = await assistant.respond({ ...input, responseMode: "answer" });
  assert.equal(result.citations.length, 0);
  assert.equal(result.context_packet.evidence.length, 0);
  assert.doesNotMatch(result.assistant_message.content, /passing checkout test/);
  assert.equal(result.retrieval.access_changed_during_answer, true);
}));

test("a slow optional history read still completes the current question with fresh evidence", async () => fixture(async ({ input }) => {
  const prepare = db.prepare;
  db.prepare = (sql) => sql.includes("id <> ?") ? { all: () => new Promise(() => {}) } : prepare(sql);
  const result = await assistant.respond(input);
  assert.equal(result.assistant_message.status, "answered");
  assert.equal(result.retrieval.history_unavailable, true);
  assert.match(result.assistant_message.content, /passing checkout test/);
  assert.match(result.assistant_message.content, /Previous conversation context was unavailable/);
}));

test("a stalled final access check saves no answer and the same turn can be retried", async () => fixture(async ({ input, messages }) => {
  let stall = false;
  let firstAttempt = true;
  const getEvidenceAccess = auth.getEvidenceAccess;
  auth.getEvidenceAccess = (args) => stall ? new Promise(() => {}) : getEvidenceAccess(args);
  await assert.rejects(assistant.respond({ ...input, onProgress: (event) => {
    if (firstAttempt && event.stage === "VALIDATION") stall = true;
  } }), { code: "ANSWER_AUTHORIZATION_TIMEOUT" });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].status, "error");
  firstAttempt = false;
  stall = false;
  const result = await assistant.respond(input);
  assert.equal(result.assistant_message.status, "answered");
  assert.equal(messages.length, 2);
}));
