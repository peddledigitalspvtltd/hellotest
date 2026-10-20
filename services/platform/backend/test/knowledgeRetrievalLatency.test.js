const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../src/db");
const rag = require("../../../knowledge/backend/services/knowledgeRag.service");
const authorization = require("../../../knowledge/backend/services/knowledgeAuthorization.service");
const permissions = require("../services/permission.service");
const selection = require("../../../integration/backend/services/aiLlmSelection.service");
const vectorStore = require("../../../knowledge/backend/services/knowledgeVectorStore.service");
const cache = require("../src/utils/cache");
const { config } = require("../src/config");
const { localEmbedding } = require("../../../knowledge/backend/services/knowledgeProcessing.service");
const advanceClock = async (context, milliseconds) => {
  await new Promise((resolve) => setImmediate(resolve));
  context.mock.timers.tick(milliseconds);
};

const candidate = (id = "visible-chunk") => ({
  chunk_id: id, document_id: "document-1", source_id: "source-1", content: "Release checkout failed in RUN-1.",
  chunk_index: 0, metadata: {}, title: "Release checklist", source_kind: "text", source_ref_id: "RUN-1",
  lexical_rank: 1, embedding_model: "hellotest-hash-v1", fallback_embedding: localEmbedding("Release checkout failed in RUN-1."),
  collection_ids: [], is_current: true
});
const stubSearchDatabase = (context, { onLexical = () => {}, failVisibility = false } = {}) => {
  context.mock.method(db, "prepare", (sql) => ({
    get: async () => ({ available: false }),
    all: async () => {
      if (sql.includes("ts_rank_cd")) { onLexical(); return [candidate()]; }
      if (sql.includes("TRUE AS exact_match")) return [{ ...candidate(), exact_match: true }];
      if (sql.includes("SELECT DISTINCT sources.id") && failVisibility) throw new Error("Visibility aggregate unavailable");
      return [];
    }
  }));
  context.mock.method(vectorStore, "isConfigured", () => false);
  context.mock.method(permissions, "hasPermission", async () => true);
};
test('AT case IDs use the exact indexed lookup while ordinary at-prefixed words do not',async context=>{
 const exact=[];
 context.mock.method(db.pool,'query',async()=>({rows:[],rowCount:0}));
 context.mock.method(db,'prepare',sql=>({get:async()=>({available:false}),all:async(...params)=>{
  if(sql.includes('TRUE AS exact_match')){exact.push(params);return [{...candidate(),exact_match:true}];}
  return [];
 }}));context.mock.method(vectorStore,'isConfigured',()=>false);context.mock.method(permissions,'hasPermission',async()=>true);
 await rag.search({projectId:'project-1',query:'Inspect AT_0042',mode:'keyword',allowedSourcePermissions:[],filters:{source_ids:['source-1']},timeoutMs:100});assert.ok(exact[0].includes('AT_0042'));
 exact.length=0;await rag.search({projectId:'project-1',query:'Inspect attributes and attempts',mode:'keyword',allowedSourcePermissions:[],filters:{source_ids:['source-1']},timeoutMs:100});assert.equal(exact.length,0);
});

test("an unresponsive embedding cannot delay lexical dispatch or discard authorized results", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  const calls = [];
  stubSearchDatabase(context, { onLexical: () => calls.push("lexical") });
  const started = Date.now();
  const pending = rag.search({
    projectId: "project-1", query: "release checkout", mode: "hybrid", allowedSourcePermissions: [],
    preparedEmbedding: () => { calls.push("embedding"); return new Promise(() => {}); },
    filters: { source_ids: ["source-1"] }, timeoutMs: 90, maxCandidates: 10
  });
  await advanceClock(context, 80);
  const response = await pending;
  assert.deepEqual(calls, ["lexical", "embedding"]);
  assert.ok(Date.now() - started < 350);
  assert.equal(response.results[0].chunk_id, "visible-chunk");
  assert.ok(response.retrieval.error_codes.includes("SEMANTIC_SEARCH_TIMEOUT"));
  assert.equal(response.retrieval.degraded, true);
});

test("visibility aggregate failures mark authorized fragments partial instead of losing their content", async (context) => {
  stubSearchDatabase(context, { failVisibility: true });
  const response = await rag.search({ projectId: "project-1", query: "release checkout", mode: "keyword",
    allowedSourcePermissions: [], filters: { source_ids: ["source-1"] }, timeoutMs: 100 });
  assert.equal(response.results[0].chunk_id, "visible-chunk");
  assert.deepEqual(response.results[0].visibility, { state: "PARTIAL" });
  assert.equal(response.retrieval.source_acl.partial, true);
  assert.ok(response.retrieval.error_codes.includes("VISIBILITY_CHECK_UNAVAILABLE"));
});

test("multi-query retrieval starts every lexical read and shares one bounded embedding request", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  let lexicalReads = 0;
  let providerCalls = 0;
  let cancelled = false;
  stubSearchDatabase(context, { onLexical: () => lexicalReads++ });
  context.mock.method(cache, "getCache", async () => null);
  context.mock.method(cache, "setCache", async () => undefined);
  context.mock.method(selection, "resolveLlmIntegrationForUsage", async () => ({
    id: "shared-slow-embedding", type: "llm", is_active: true, model: "chat-model", api_key: "test-key",
    base_url: "https://shared-embedding.invalid/v1", config: { embedding_model: "embedding-model" }
  }));
  context.mock.method(globalThis, "fetch", async (_url, init) => {
    providerCalls++;
    assert.equal(lexicalReads, 2, "Both lexical reads run before the provider returns.");
    assert.equal(JSON.parse(init.body).model, "embedding-model");
    assert.equal(JSON.parse(init.body).input.length, 2);
    return new Promise((_, reject) => init.signal.addEventListener("abort", () => {
      cancelled = true; reject(Object.assign(new Error("Cancelled"), { name: "AbortError" }));
    }, { once: true }));
  });
  const started = Date.now();
  const pending = rag.searchMany({ projectId: "project-1", queries: ["release checkout", "release regression"],
    mode: "hybrid", user: { id: "reader" }, filters: { source_ids: ["source-1"] }, timeoutMs: 300, maxCandidates: 20 });
  await advanceClock(context, 150);
  const response = await pending;
  assert.ok(Date.now() - started < 700);
  assert.equal(providerCalls, 1);
  assert.equal(cancelled, true);
  assert.equal(response.embedding_batch_count, 1);
  assert.equal(response.results.length, 2);
  assert.ok(response.results.every((entry) => entry.result.results.some((hit) => hit.chunk_id === "visible-chunk")));
});

test("rejected embedding configuration uses a scoped cooldown without changing the integration", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(JSON.stringify({ error: "Model does not support embeddings" }), { status: 400 });
  });
  const runtime = { configured: true, baseUrl: "https://rejected-embedding.invalid/v1", model: "chat-only-model",
    integration: { id: "rejected-embedding", api_key: "test-key" } };
  const first = await rag._internals.embedTexts(runtime, ["release"], { timeoutMs: 100 });
  const second = await rag._internals.embedTexts(runtime, ["another release"], { timeoutMs: 100 });
  assert.equal(calls, 1);
  assert.equal(first.model, "hellotest-hash-v1");
  assert.equal(first.warning_code, "embedding_fallback", "Ingestion keeps the canonical Studio warning category.");
  assert.equal(second.warning_code, "embedding_fallback");
  assert.equal(second.warning_reason_code, "EMBEDDING_PROVIDER_COOLDOWN");
  assert.equal(runtime.model, "chat-only-model");
  await rag._internals.embedTexts({ ...runtime, integration: { ...runtime.integration, api_key: "new-key" } }, ["release"], { timeoutMs: 100 });
  assert.equal(calls, 2, "Changing credentials allows a new attempt.");
});

test("request cancellation is not converted into partial retrieval", async (context) => {
  stubSearchDatabase(context);
  const controller = new AbortController();
  const pending = rag.search({ projectId: "project-1", query: "release checkout", mode: "hybrid", allowedSourcePermissions: [],
    preparedEmbedding: () => { controller.abort(); return new Promise(() => {}); },
    filters: { source_ids: ["source-1"] }, signal: controller.signal, timeoutMs: 100 });
  await assert.rejects(pending, { name: "AbortError" });
});

test("source permission checks run concurrently and fail closed only for unavailable gates", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  context.mock.method(db, "prepare", () => ({ all: async () => [
    { id: "public", required_permission: null }, { id: "case", required_permission: "testcase.view" },
    { id: "bug", required_permission: "feedback.view" }
  ] }));
  const dispatched = [];
  context.mock.method(permissions, "hasPermission", async (_user, permission) => {
    dispatched.push(permission);
    if (permission === "feedback.view") return new Promise(() => {});
    return true;
  });
  const pending = authorization.getEvidenceAccess({ projectId: "project-1", user: { id: "reader" }, timeoutMs: 60,
    evidence: ["public", "case", "bug"].map((chunk_id) => ({ chunk_id, source_id: "source-1" })) });
  await advanceClock(context, 60);
  const result = await pending;
  assert.equal(dispatched.length, 2);
  assert.deepEqual(result.allowed.map((hit) => hit.chunk_id), ["public", "case"]);
  assert.deepEqual(result.denied_ids, ["bug"]);
  assert.equal(result.partial, true);
});

test("cold Qdrant retrieval performs only its authorized query and cancellation does not open its circuit", async (context) => {
  const saved = { ...config.knowledge.vectorStore };
  context.after(() => Object.assign(config.knowledge.vectorStore, saved));
  Object.assign(config.knowledge.vectorStore, { provider: "qdrant", qdrantUrl: "https://cold-vector.invalid", qdrantCollectionPrefix: "latency_test" });
  const calls = [];
  context.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ result: { points: [] } }), { status: 200 });
  });
  const input = { projectId: "project-1", queryVector: Array(8).fill(0.2), embeddingModel: "test",
    allowedPermissions: [], authorizedChunkIds: ["visible-chunk"] };
  await vectorStore.search(input);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/points\/query$/);
  assert.equal(calls[0].init.method, "POST");
  assert.ok(JSON.parse(calls[0].init.body).filter.must.some((filter) => filter.has_id?.includes("visible-chunk")));
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    context.mock.method(globalThis, "fetch", async () => { controller.abort(); throw Object.assign(new Error("Cancelled"), { name: "AbortError" }); });
    await assert.rejects(vectorStore.search({ ...input, signal: controller.signal }));
  }
  assert.equal(vectorStore.getStatus().circuit_open, false);
});
