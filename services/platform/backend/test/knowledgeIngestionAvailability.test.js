const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../src/db");
const rag = require("../../../knowledge/backend/services/knowledgeRag.service");
const selection = require("../../../integration/backend/services/aiLlmSelection.service");
const vector = require("../../../knowledge/backend/services/knowledgeVectorStore.service");
const { config } = require("../src/config");
const { resetServiceResilienceState } = require("../src/utils/resilientHttpClient");

const advance = async (context, milliseconds) => {
  await new Promise((resolve) => setImmediate(resolve));
  context.mock.timers.tick(milliseconds);
};
const runtime = (id) => ({ configured: true, provider: "Fixture", baseUrl: `https://${id}.invalid/v1`,
  model: "embedding-test", integration: { id, api_key: "fixture" } });
const content = "# Checkout verification\nA declined payment preserves the basket. Retry after correcting the billing details and record the gateway outcome.";

// Observe the canonical transaction boundary, independently from network mocks.
// Real PostgreSQL revision/ACL behavior is covered by the lifecycle integration test.
const canonicalStore = (context) => {
  const state = { active: false, revision: "revision-1", embeddingWrites: 0, vectors: [], chunks: [], semanticJob: null, vectorJob: null, model: "hellotest-hash-v1", provider: "postgresql" };
  // This fixture covers canonical/semantic work order; trace persistence has its
  // own bounded transport and PostgreSQL tests and must not open an actual pool.
  const traces=require("../src/utils/llmTraceCapture");
  context.mock.method(traces,"begin",async()=>({id:"fixture-trace",started:Date.now()}));
  context.mock.method(traces,"dispatch",()=>{});
  context.mock.method(traces,"finish",async()=>{});
  context.mock.method(db, "transaction", (task) => async () => task());
  context.mock.method(db, "prepare", (sql) => ({
    all: async () => sql.includes("SELECT chunks.embedding, chunks.metadata") ? [] : sql.includes("FROM ai_knowledge_chunks") ? state.chunks : [],
    get: async (...args) => {
      if (sql.includes("pg_extension")) return { available: false };
      if (sql.includes("FROM ai_knowledge_semantic_jobs jobs")) return state.semanticJob?.status === "queued" ? state.semanticJob : undefined;
      if (sql.includes("UPDATE ai_knowledge_semantic_jobs") && sql.includes("RETURNING *")) return Object.assign(state.semanticJob, {status:"running",lease_owner:args[0],attempts:1});
      if (sql.includes("COUNT(*)")) return {count: state.semanticJob?.status === (sql.includes("status='failed'") ? "failed" : "queued") ? 1 : 0};
      if (sql.includes("FROM ai_knowledge_vector_jobs")) return state.vectorJob;
      if (sql.includes("ai_knowledge_sources")) {
        if (sql.includes("sources.revision_token=?") && args[2] !== state.revision) return undefined;
        return { id: "source-1", revision_token: state.revision, source_kind:"text", created_by:"reviewer", title:"Checkout", document_title:"Checkout", extraction_status:"ready" };
      }
      if (sql.includes("JOIN ai_knowledge_index_states")) return {id:state.documentId,embedding_model:state.model,embedding_dimensions:8};
      if (sql.includes("MAX(version)")) return { version: 1 };
      if (sql.includes("SELECT document_id")) return { document_id: state.documentId };
      if (sql.includes("SELECT * FROM ai_knowledge_documents")) return { id: args[0], is_active: state.active };
      return undefined;
    },
    run: async (...args) => {
      if (sql.includes("INSERT INTO ai_knowledge_documents")) state.documentId = args[0];
      if (sql.includes("INSERT INTO ai_knowledge_chunks")) {
        state.vectors.push(args.at(-4));
        state.chunks.push({id:args[0],index:args[4],chunk_index:args[4],heading:args[5],content:args[6],metadata:args.at(-1),embedding:args.at(-4),embedding_model:args.at(-2)});
      }
      if (sql.includes("INSERT INTO ai_knowledge_semantic_jobs")) state.semanticJob={project_id:args[0],source_id:args[1],document_id:args[2],revision_token:args[3],integration_id:args[4],status:"queued"};
      if (sql.includes("INSERT INTO ai_knowledge_vector_jobs")) state.vectorJob={source_id:args[0],project_id:args[1],document_id:args[2],revision_token:args[3],generation:args[4],status:"queued"};
      if (sql.includes("UPDATE ai_knowledge_semantic_jobs SET status=?")) state.semanticJob.status=args[0];
      if (sql.includes("UPDATE ai_knowledge_semantic_jobs SET status='completed'")) state.semanticJob.status="completed";
      if (sql.includes("UPDATE ai_knowledge_vector_jobs SET status = 'queued'")) state.vectorJob.status="queued";
      if (sql.includes("SET embedding=vector_rows.embedding")) {state.embeddingWrites+=state.chunks.length;state.model=args[0];}
      if (sql.includes("SET is_active = TRUE")) state.active = true;
      if (sql.includes("SET embedding = ?")) { state.embeddingWrites++; state.model = args[1]; }
      if (sql.includes("vector_provider = 'qdrant'")) state.provider = "qdrant";
      return { changes: 1 };
    }
  }));
  context.mock.method(vector, "isConfigured", () => false);
  // The actual same-transaction graph/ledger behavior is exercised against PG
  // in knowledgeRepositoryLifecycle; this fixture observes provider timing.
  context.mock.method(require("../../../knowledge/backend/services/knowledgeGraph.service"), "syncDocument", async () => ({}));
  return state;
};
const persistInput = (extra = {}) => ({ projectId: "project-1",
  source: { id: "source-1", title: "Checkout policy", revision_token: "revision-1" }, content,
  embeddingRuntime: { configured: false }, ...extra });

test("canonical lexical/local indexes activate before durable semantic work resolves an optional model", async (context) => {
  resetServiceResilienceState();
  const state = canonicalStore(context);
  context.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(state.active, true);
    assert.ok(state.vectors.length > 0);
    return new Response(JSON.stringify({ data: JSON.parse(init.body).input.map((_, index) => ({ index, embedding: Array(8).fill(0.2) })) }));
  });
  let resolutions=0;
  context.mock.method(selection,"resolveLlmIntegrationForUsage",async()=>{
    resolutions++;assert.equal(state.active,true);
    return {id:"canonical-first",type:"llm",is_active:true,api_key:"fixture",base_url:"https://canonical-first.invalid/v1",config:{project_id:"project-1",embedding_model:"embedding-test"}};
  });
  const result = await rag._internals.persistDocument(persistInput());
  assert.equal(result.document.is_active,true);assert.equal(resolutions,0);assert.equal(state.semanticJob.status,"queued");
  assert.equal(state.model,"hellotest-hash-v1");assert.equal(state.embeddingWrites,0);
  const work=await rag.processSemanticWork();
  assert.equal(work.processed,1,JSON.stringify(work));assert.equal(state.model,"embedding-test");
  assert.equal(state.embeddingWrites,result.chunks.length);

});

test("a vector projection failure keeps the newly published PostgreSQL revision searchable", async (context) => {
  const state = canonicalStore(context);
  context.mock.method(vector, "isConfigured", () => true);
  context.mock.method(vector, "reconcileDocument", async () => {
    assert.equal(state.active, true);
    throw new Error("Private provider diagnostic must not enter the public warning");
  });
  const result = await rag._internals.persistDocument(persistInput());
  assert.equal(result.document.is_active, true);
  assert.equal(state.provider, "postgresql");
  assert.equal(state.vectorJob.status,"queued");
  const projection=await require("../../../knowledge/backend/services/knowledgeVectorProjection.service").processSource({projectId:"project-1",sourceId:"source-1"});
  assert.equal(projection.status,"retry_scheduled");assert.equal(state.vectorJob.status,"queued");
  assert.doesNotMatch(JSON.stringify(projection),/Private provider/);
  assert.equal(state.active,true);
});

test("late provider enrichment cannot write embeddings after a source revision changes", async (context) => {
  const state = canonicalStore(context);
  context.mock.method(globalThis, "fetch", async () => {
    state.revision = "revision-2";
    return new Response(JSON.stringify({ data: [{ index: 0, embedding: Array(8).fill(0.2) }] }));
  });
  context.mock.method(selection,"resolveLlmIntegrationForUsage",async()=>({id:"superseded-enrichment",type:"llm",is_active:true,api_key:"fixture",base_url:"https://superseded-enrichment.invalid/v1",config:{project_id:"project-1",embedding_model:"embedding-test"}}));
  await rag._internals.persistDocument(persistInput());
  const work=await rag.processSemanticWork();
  assert.equal(work.outcomes[0].status,"superseded",JSON.stringify(work));
  assert.equal(work.outcomes[0].error_code,"KNOWLEDGE_VERSION_SUPERSEDED");
  assert.equal(state.embeddingWrites, 0);
  assert.equal(state.active, true, "Already committed canonical evidence remains intact.");
});

test("all embedding batches share a single deadline and return complete local fallback vectors", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  // Configuration discovery is not the subject of this transport deadline test.
  // Keep its reads deterministic before advancing the mocked request clock.
  context.mock.method(db, "prepare", () => ({ get: async () => undefined, all: async () => [], run: async () => ({ changes: 1 }) }));
  resetServiceResilienceState();
  let calls = 0, aborted = false;
  context.mock.method(globalThis, "fetch", async (_url, init) => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ data: JSON.parse(init.body).input.map((_, index) => ({ index, embedding: Array(8).fill(0.1) })) }));
    return new Promise((_, reject) => init.signal.addEventListener("abort", () => {
      aborted = true; reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    }, { once: true }));
  });
  const input = Array.from({ length: 70 }, (_, index) => `Checkout policy section ${index}`);
  const pending = rag._internals.embedTexts(runtime("multi-batch-deadline"), input, { timeoutMs: 100 });
  await advance(context, 100);
  const result = await pending;
  assert.equal(calls, 2);
  assert.equal(aborted, true);
  assert.equal(result.model, "hellotest-hash-v1");
  assert.equal(result.vectors.length, 70, "Never mix incomplete provider batches with local dimensions.");
  assert.deepEqual(result.vectors, result.fallback);
  assert.equal(result.warning_reason_code, "EMBEDDING_TIMEOUT");
});

test("unresponsive default model selection falls back locally while explicit selections fail visibly", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  context.mock.method(selection, "resolveLlmIntegrationForUsage", () => new Promise(() => {}));
  const pending = rag._internals.resolveEmbeddingRuntime({ projectId: "project-1", timeoutMs: 50 });
  await advance(context, 50);
  const result = await pending;
  assert.equal(result.configured, false);
  assert.equal(result.warning_reason_code, "EMBEDDING_CONFIGURATION_TIMEOUT");
  const explicit = assert.rejects(rag._internals.resolveEmbeddingRuntime({ projectId: "project-1", integrationId: "selected", timeoutMs: 50 }),
    { code: "EMBEDDING_CONFIGURATION_TIMEOUT" });
  await advance(context, 50);
  await explicit;
});

test("model resolution never converts cancellation or cross-project selection into local success", async (context) => {
  const controller = new AbortController();
  context.mock.method(selection, "resolveLlmIntegrationForUsage", async () => { controller.abort(); return null; });
  await assert.rejects(rag._internals.resolveEmbeddingRuntime({ projectId: "project-1", signal: controller.signal }), { name: "AbortError" });
  context.mock.method(selection, "resolveLlmIntegrationForUsage", async () => ({ type: "llm", is_active: true, config: { project_id: "project-2" } }));
  await assert.rejects(rag._internals.resolveEmbeddingRuntime({ projectId: "project-1" }), { code: "LLM_PROJECT_SCOPE_MISMATCH" });
});

test("a configured chat model does not cause an unsupported embedding request", async (context) => {
  const integration = { id: "chat-only", type: "llm", is_active: true, api_key: "fixture",
    base_url: "https://chat-only.invalid/v1", model: "chat-model", config: {} };
  context.mock.method(selection, "resolveLlmIntegrationForUsage", async () => integration);
  context.mock.method(globalThis, "fetch", () => { throw new Error("Chat model must not be sent to embeddings"); });
  const selected = await rag._internals.resolveEmbeddingRuntime({ projectId: "project-1" });
  assert.equal(selected.configured, false);
  const result = await rag._internals.embedTexts(selected, [content]);
  assert.equal(result.model, "hellotest-hash-v1");
  assert.equal(result.warning, null, "Local indexing is the normal available path, not a failed model operation.");
  assert.equal(integration.model, "chat-model");
  integration.config.embedding_model = "dedicated-embedding-model";
  const explicit = await rag._internals.resolveEmbeddingRuntime({ projectId: "project-1" });
  assert.equal(explicit.configured, true);
  assert.equal(explicit.model, "dedicated-embedding-model");
});

test("cancelled cold vector setup aborts its transport before creating indexes or uploading evidence", async (context) => {
  const saved = { ...config.knowledge.vectorStore };
  context.after(() => Object.assign(config.knowledge.vectorStore, saved));
  Object.assign(config.knowledge.vectorStore, { provider: "qdrant", qdrantUrl: "https://setup-cancel.invalid", qdrantCollectionPrefix: "ingestion_cancel" });
  context.mock.method(db,"prepare",()=>({all:async()=>[]}));
  let markStarted;const started=new Promise(resolve=>{markStarted=resolve;});
  const controller = new AbortController();
  const calls = [];
  context.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push(url);markStarted();
    return new Promise((_, reject) => init.signal.addEventListener("abort", () => {
      reject(Object.assign(new Error("Cancelled"), { name: "AbortError" }));
    }, { once: true }));
  });
  const pending = vector.replaceDocument({ projectId: "project-1", source: { id: "source-1" }, documentId: "document-1",
    chunks: [{ id: "chunk-1", content }], vectors: [Array(8).fill(0.2)], embeddingModel: "test", signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls.length, 1);
  assert.equal(vector.getStatus().circuit_open, false);
});

test("LLM enrichment starts after canonical activation and provider failure retains the standard revision", async context => {
  const state = canonicalStore(context);
  context.mock.method(selection, "resolveLlmIntegrationForUsage", async () => ({ id: "model-1", type: "llm", is_active: true, model: "fixture",api_key:"fixture",base_url:"https://enrichment.invalid/v1", config: { project_id: "project-1",embedding_model:"embedding-test" } }));
  context.mock.method(globalThis,"fetch",async(_url,init)=>Response.json({data:JSON.parse(init.body).input.map((_,index)=>({index,embedding:Array(8).fill(0.2)}))}));
  const modelGateway = require("../../../knowledge/backend/services/knowledgeModelGateway.service");
  context.mock.method(modelGateway, "request", async () => {
    assert.equal(state.active, true, "Standard search is already usable while enrichment runs.");
    throw Object.assign(new Error("provider unavailable"), { code: "MODEL_TIMEOUT" });
  });
  const result = await rag._internals.persistDocument(persistInput({content:content.repeat(30), source: { id: "source-1", title: "Checkout", revision_token: "revision-1", created_by: "reviewer" } }));
  assert.equal(result.document.is_active,true);assert.equal(state.model,"hellotest-hash-v1");assert.ok(result.chunks.length);
  const work=await rag.processSemanticWork();assert.equal(work.processed,1,JSON.stringify(work));assert.equal(state.model,"embedding-test");
});

test("successful LLM enrichment stores source-anchored hints without replacing canonical content", async context => {
  const state = canonicalStore(context);
  const prepare = db.prepare.bind(db);
  let profile, hint, canonicalContent;
  context.mock.method(db, "prepare", sql => {
    const statement = prepare(sql);
    const run = statement.run;
    statement.run = async (...args) => {
      if (sql.includes("INSERT INTO ai_knowledge_documents")) canonicalContent = args[4];
      if (sql.includes("UPDATE ai_knowledge_documents SET metadata")) profile = args[0].llm_context_profile;
      if (sql.includes("UPDATE ai_knowledge_chunks SET metadata")) hint = args[0].llm_context_hint;
      return run(...args);
    };
    return statement;
  });
  context.mock.method(selection, "resolveLlmIntegrationForUsage", async () => ({ id: "model-1", type: "llm", is_active: true, model: "fixture",api_key:"fixture",base_url:"https://enrichment.invalid/v1", config: { project_id: "project-1",embedding_model:"embedding-test" } }));
  context.mock.method(globalThis,"fetch",async(_url,init)=>Response.json({data:JSON.parse(init.body).input.map((_,index)=>({index,embedding:Array(8).fill(0.2)}))}));
  const modelGateway = require("../../../knowledge/backend/services/knowledgeModelGateway.service");
  context.mock.method(modelGateway, "request", async request => {
    assert.equal(state.active, true);
    const chunk = JSON.parse(request.messages[1].content).chunks[0];
    return { sections: [{ chunk_index: chunk.chunk_index, excerpt: chunk.content.slice(0, 100).trim(), information_needs: ["How does checkout recover after decline?"] }] };
  });
  await rag._internals.persistDocument(persistInput({content:content.repeat(30), source: { id: "source-1", title: "Checkout", revision_token: "revision-1", created_by: "reviewer" } }));
  const work=await rag.processSemanticWork();assert.equal(work.processed,1,JSON.stringify(work));
  assert.equal(profile.mode, "llm"); assert.ok(canonicalContent.includes(profile.sections[0].excerpt));
  assert.equal(hint.authoritative, false); assert.equal(hint.generated, true);
  assert.ok(canonicalContent.includes("A declined payment preserves the basket."));
});
