const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../src/db");
const assistant = require("../../../chatbot/backend/services/knowledgeAssistant.service");
const rag = require("../../../knowledge/backend/services/knowledgeRag.service");
const auth = require("../../../knowledge/backend/services/knowledgeAuthorization.service");
const orchestrator = require("../../../ai/backend/services/aiContextOrchestrator.service");
const integrations = require("../../../integration/backend/services/integration.service");
const permissions = require("../services/permission.service");
const projects = require("../services/project.service");
const llmSelection = require("../../../integration/backend/services/aiLlmSelection.service");

const fixture = async (task) => {
  const saved = { prepare: db.prepare, search: rag.searchMany, permissions: rag.resolveAllowedSourcePermissions, parents: rag.expandEvidence, relations: rag.expandRelationships, access: auth.getEvidenceAccess, live: orchestrator.buildLiveProjectEvidence, integrations: integrations.getIntegrations, hasPermission: permissions.hasPermission, project: projects.getProject };
  const session = { id: "session-1", project_id: "project-1", created_by: "user-1", status: "active", filters: {} };
  const messages = [];
  const state = { revoked: false, searches: 0, models: 0, liveRequests: [] };
  permissions.hasPermission = async () => !state.projectRevoked;
  projects.getProject = async () => ({ id: session.project_id });
  db.prepare = (sql) => ({
    get: async (...args) => {
      if (sql.includes("COUNT(*)")) return { message_count: messages.length };
      if (sql.includes("SELECT * FROM ai_knowledge_assistant_sessions")) return session;
      if (sql.includes("WITH removed AS")) {
        const assistantIndex = messages.findIndex((item) => item.id === args[0] && item.status === "provider_unavailable");
        const userMessage = messages.find((item) => item.id === args[1] && item.role === "user");
        if (assistantIndex < 0 || !userMessage) return null;
        messages.splice(assistantIndex, 1);
        userMessage.status = "pending";
        return userMessage;
      }
      if (sql.includes("INSERT INTO ai_knowledge_assistant_messages")) {
        const [id, session_id, project_id, role, content, status, citations, retrieval, safety, provider, model, client_turn_id, content_fingerprint] = args;
        if (messages.some((item) => item.role === role && item.client_turn_id === client_turn_id)) return null;
        const row = { id, session_id, project_id, role, content, status, citations, retrieval, safety, provider, model, client_turn_id, content_fingerprint };
        messages.push(row); return row;
      }
      if (sql.includes("RETURNING *") && sql.includes("UPDATE ai_knowledge_assistant_messages")) {
        const row = messages.find((item) => item.id === args[0] && (sql.includes("AND role = 'user'") || item.status === "error"));
        if (row) row.status = "pending";
        return row;
      }
      if (sql.includes("role = 'assistant'")) return messages.find((item) => item.role === "assistant" && item.client_turn_id === args[1]);
      if (sql.includes("role = 'user'")) return messages.find((item) => item.role === "user" && item.client_turn_id === args[1]);
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
  orchestrator.buildLiveProjectEvidence = async (request) => { state.liveRequests.push(request); return { hits: [], counts: {} }; };
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

test("intent planning runs once before scoped project reads and grounded synthesis", async (context) => fixture(async ({ input, state }) => {
  context.mock.method(llmSelection, "resolveLlmIntegrationForUsage", async () => ({ id: "model", type: "llm", is_active: true, api_key: "test-credential", base_url: "https://intent.invalid/v1", model: "test", config: {} }));
  context.mock.method(llmSelection, "recordSuccessfulLlmIntegration", async () => {});
  const modelPrompts = [];
  const modelCallTimes = [];
  const modelInputs = [];
  context.mock.method(global, "fetch", async (_, init) => {
    modelCallTimes.push(Date.now());
    const systemPrompt = JSON.parse(init.body).messages[0].content;
    modelPrompts.push(systemPrompt);
    modelInputs.push(JSON.parse(JSON.parse(init.body).messages[1].content));
    const candidate = systemPrompt.includes("You plan evidence retrieval")
      ? { information_needs: ["Story readiness", "recent run outcomes", "open defects"], source_kinds: ["requirement", "execution", "bug"], search_queries: ["checkout release Story runs Defects"], stop_if_sufficient: false }
      : { status: "answered", supported_claims: [{ statement: "Release approval requires a passing checkout test.", citation_ids: ["K-chunk-1"] }] };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(candidate) }, finish_reason: "stop" }] }));
  });
  const events = [];
  const result = await assistant.respond({ ...input, responseMode: "answer", onProgress: (event) => events.push(event) });
  assert.equal(result.assistant_message.status, "answered");
  assert.equal(modelPrompts.filter((prompt) => prompt.includes("You plan evidence retrieval")).length, 1);
  assert.equal(modelPrompts.length, 2, "one intent call and one final synthesis call are made");
  assert.equal(modelInputs[1].retrieval_outcome.evidence_count, modelInputs[1].context_packet.evidence.length);
  assert.match(modelPrompts[1], /ONE coherent answer/);
  assert.ok(modelInputs[1].retrieval_outcome.information_needs.includes("Story readiness"));
  assert.ok(modelCallTimes[1] - modelCallTimes[0] >= 280, `model calls must retain the 300ms pacing window (${modelCallTimes[1] - modelCallTimes[0]}ms observed)`);
  assert.ok(state.liveRequests.length >= 1);
  assert.deepEqual(state.liveRequests[0].route.live_scopes.slice(0, 3), ["stories", "runs", "bugs"]);
  assert.ok(state.liveRequests[0].sourceKinds.includes("requirement"));
  assert.ok(state.liveRequests[0].sourceKinds.includes("execution"));
  assert.ok(state.liveRequests[0].sourceKinds.includes("bug"));
  const intentIndex = events.findIndex((event) => event.stage === "INTENT_ANALYSIS" && event.status === "COMPLETE");
  const retrievalIndex = events.findIndex((event) => event.stage === "KNOWLEDGE_REPO_SEARCH" && event.status === "IN_PROGRESS");
  const generationIndex = events.findIndex((event) => event.stage === "GENERATION" && event.status === "IN_PROGRESS");
  assert.ok(intentIndex >= 0 && retrievalIndex > intentIndex && generationIndex > retrievalIndex);
  assert.match(events[intentIndex].message, /Stories.*Test Runs.*Defects/);
}));

test("provider-unavailable answers can retry and replace the same persisted turn", async (context) => fixture(async ({ input, messages }) => {
  context.mock.method(llmSelection, "resolveLlmIntegrationForUsage", async () => ({ id: "model", type: "llm", is_active: true, api_key: "test-credential", base_url: "https://retry-provider.invalid/v1", model: "test", config: {} }));
  context.mock.method(llmSelection, "recordSuccessfulLlmIntegration", async () => {});
  let available = false;
  context.mock.method(global, "fetch", async (_, init) => {
    if (!available) return new Response(JSON.stringify({ error: "not accepted" }), { status: 401 });
    const systemPrompt = JSON.parse(init.body).messages[0].content;
    const candidate = systemPrompt.includes("You plan evidence retrieval")
      ? { information_needs: ["release approval"], source_kinds: ["text"], search_queries: [] }
      : { status: "answered", supported_claims: [{ statement: "Release approval requires a passing checkout test.", citation_ids: ["K-chunk-1"] }] };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(candidate) }, finish_reason: "stop" }] }));
  });
  const failed = await assistant.respond({ ...input, responseMode: "answer" });
  assert.equal(failed.assistant_message.status, "provider_unavailable");
  const originalUserId = failed.user_message.id;
  assert.equal(messages.length, 2);
  available = true;
  const retried = await assistant.respond({ ...input, responseMode: "answer", retryProvider: true });
  assert.equal(retried.assistant_message.status, "answered");
  assert.equal(retried.user_message.id, originalUserId);
  assert.equal(retried.idempotent_replay, false);
  assert.equal(messages.length, 2, "retry replaces the failed assistant result without duplicating the user turn");
}));

test("claim-only text-block LLM output is saved, rendered, and replayed as one grounded answer", async (context) => fixture(async ({ input, messages }) => {
  context.mock.method(llmSelection, "resolveLlmIntegrationForUsage", async () => ({ id: "model", type: "llm", is_active: true, api_key: "test-credential", base_url: "https://claim-only.invalid/v1", model: "test", config: {} }));
  context.mock.method(llmSelection, "recordSuccessfulLlmIntegration", async () => {});
  let modelCalls = 0;
  context.mock.method(global, "fetch", async () => {
    modelCalls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: JSON.stringify({ status: "answered", supported_claims: [{ statement: "Release approval requires a passing checkout test.", citation_ids: ["K-chunk-1"] }] }) }] }, finish_reason: "stop" }] }));
  });
  const first = await assistant.respond({ ...input, responseMode: "answer" });
  assert.equal(first.assistant_message.status, "answered");
  assert.equal(first.answer_contract.claims.length, 1);
  assert.equal(first.answer_contract.claims[0].classification, "SUPPORTED");
  assert.match(first.assistant_message.content, /Release approval requires a passing checkout test/);
  const calls = modelCalls;
  const replay = await assistant.respond({ ...input, responseMode: "answer" });
  assert.equal(replay.idempotent_replay, true);
  assert.equal(modelCalls, calls);
  assert.equal(messages.length, 2);
}));

test("rejected model citation contracts return useful authorized passages instead of an empty answer", async (context) => fixture(async ({ input }) => {
  context.mock.method(llmSelection, "resolveLlmIntegrationForUsage", async () => ({ id: "model", type: "llm", is_active: true, api_key: "test-credential", base_url: "https://invalid-citation.invalid/v1", model: "test", config: {} }));
  context.mock.method(llmSelection, "recordSuccessfulLlmIntegration", async () => {});
  context.mock.method(global, "fetch", async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ status: "answered", supported_claims: [{ statement: "Invented response", citation_ids: ["K-invented"] }] }) }, finish_reason: "stop" }] })));
  const result = await assistant.respond({ ...input, responseMode: "answer" });
  assert.equal(result.retrieval.provider_error_code, "MODEL_INVALID_RESPONSE");
  assert.equal(result.assistant_message.status, "provider_unavailable");
  assert.match(result.assistant_message.content, /passing checkout test/);
  assert.doesNotMatch(result.assistant_message.content, /Invented response/);
  assert.equal(result.answer_contract.claims[0].classification, "SUPPORTED");
}));

test("a transient synthesis failure recovers into one saved answer and same-turn replay performs no new model calls", async (context) => fixture(async ({ input, messages }) => {
  context.mock.method(llmSelection, "resolveLlmIntegrationForUsage", async () => ({ id: "model", type: "llm", is_active: true, api_key: "test-credential", base_url: "https://turn-retry.invalid/v1", model: "test", config: {} }));
  let synthesisCalls = 0, allCalls = 0;
  context.mock.method(global, "fetch", async (_, init) => {
    allCalls++;
    if (JSON.parse(init.body).messages[0].content.includes("You plan evidence retrieval")) return new Response(JSON.stringify({ choices: [{ message: { content: '{"search_queries":[]}' } }] }));
    if (++synthesisCalls === 1) return new Response("Temporary failure", { status: 503, headers: { "retry-after": "0" } });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ status: "answered", executive_summary: "Approval requires a passing checkout test. [K-chunk-1]", supported_claims: [{ statement: "Approval requires a passing checkout test.", citation_ids: ["K-chunk-1"] }] }) } }] }));
  });
  const events = [];
  const result = await assistant.respond({ ...input, responseMode: "answer", onProgress: (event) => events.push(event) });
  assert.equal(synthesisCalls, 2);
  assert.equal(messages.length, 2);
  assert.equal(result.assistant_message.status, "answered");
  assert.equal(result.retrieval.model_budget.retries_used, 1);
  assert.equal(result.citations.length, 1);
  assert.equal(events.filter((event) => event.stage === "COMPLETED").length, 1);
  assert.ok(events.some((event) => event.stage === "GENERATION" && event.metrics.model_attempt === 2));
  assert.ok(!events.some((event) => event.stage === "GENERATION" && event.status === "FAILED"));
  const callsBeforeReplay = allCalls;
  const replay = await assistant.respond({ ...input, responseMode: "answer" });
  assert.equal(replay.idempotent_replay, true);
  assert.equal(allCalls, callsBeforeReplay);
  assert.equal(messages.length, 2);
}));

test("exhausted synthesis retries save one grounded fallback with usable citations", async (context) => fixture(async ({ input, messages }) => {
  context.mock.method(llmSelection, "resolveLlmIntegrationForUsage", async () => ({ id: "model", type: "llm", is_active: true, api_key: "test-credential", base_url: "https://turn-exhausted.invalid/v1", model: "test", config: {} }));
  let synthesisCalls = 0;
  context.mock.method(global, "fetch", async (_, init) => {
    if (JSON.parse(init.body).messages[0].content.includes("You plan evidence retrieval")) return new Response(JSON.stringify({ choices: [{ message: { content: '{"search_queries":[]}' } }] }));
    synthesisCalls++;
    return new Response("PRIVATE_PROVIDER_BODY", { status: 503, headers: { "retry-after": "0" } });
  });
  const result = await assistant.respond({ ...input, responseMode: "answer" });
  assert.equal(synthesisCalls, 3);
  assert.equal(messages.length, 2);
  assert.equal(result.assistant_message.status, "provider_unavailable");
  assert.equal(result.retrieval.provider_error_code, "MODEL_UNAVAILABLE");
  assert.equal(result.retrieval.model_budget.retries_used, 2);
  assert.equal(result.citations.length, 1);
  assert.match(result.assistant_message.content, /passing checkout test/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PROVIDER_BODY/);
}));

test("a late retrieval leaves a saved cited fallback instead of starting a model beyond the turn budget", async (context) => fixture(async ({ input, messages }) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  context.mock.method(llmSelection, "resolveLlmIntegrationForUsage", async () => ({ id: "model", type: "llm", is_active: true,
    api_key: "test-credential", base_url: "https://turn-budget.invalid/v1", model: "test", config: {} }));
  let synthesisCalls = 0;
  context.mock.method(global, "fetch", async (_, init) => {
    if (!JSON.parse(init.body).messages[0].content.includes("You plan evidence retrieval")) synthesisCalls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"search_queries":[]}' } }] }));
  });
  const result = await assistant.respond({ ...input, responseMode: "answer", onProgress: (event) => {
    if (event.stage === "GENERATION" && event.status === "IN_PROGRESS") context.mock.timers.tick(109_000);
  } });
  assert.equal(synthesisCalls, 0);
  assert.equal(messages.length, 2);
  assert.equal(result.retrieval.provider_error_code, "MODEL_TIMEOUT");
  assert.equal(result.citations.length, 1);
  assert.match(result.assistant_message.content, /passing checkout test/);
}));

test("the whole turn deadline bounds a stalled idempotency read and prevents late message writes", async (context) => fixture(async ({ input, messages }) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  const prepare = db.prepare;
  let release;
  db.prepare = (sql) => sql.includes("role = 'assistant'")
    ? { get: () => new Promise((resolve) => { release = resolve; }) } : prepare(sql);
  const pending = assert.rejects(assistant.respond(input), { code: "DEADLINE_EXCEEDED" });
  await new Promise((resolve) => setImmediate(resolve));
  context.mock.timers.tick(120_000);
  await pending;
  release(null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(messages.length, 0);
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
