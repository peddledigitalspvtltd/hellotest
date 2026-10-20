const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { config } = require("../../../platform/backend/src/config");
const db = require("../../../platform/backend/src/db");
const rag = require("../../backend/services/knowledgeRag.service");

function store(t, prefix = "consistency") {
  const previous = { ...config.knowledge.vectorStore };
  t.after(() => Object.assign(config.knowledge.vectorStore, previous));
  Object.assign(config.knowledge.vectorStore, { provider: "qdrant", qdrantUrl: "https://vectors.example.test", qdrantCollectionPrefix: prefix });
  delete require.cache[require.resolve("../../backend/services/knowledgeVectorStore.service")];
  return require("../../backend/services/knowledgeVectorStore.service");
}
const sha = value => createHash("sha256").update(value).digest("hex");

test("source tombstones discover persisted collections after restart and remain strictly project/source scoped", async t => {
  const vector = store(t);
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url.endsWith("/collections")) return Response.json({ result: { collections: [
      { name: "consistency_d8" }, { name: "consistency_d1536" }, { name: "foreign_d8" }, { name: "consistency_dinvalid" }
    ] } });
    requests.push({ url, body: JSON.parse(init.body) });
    return Response.json({ status: "ok" });
  });
  assert.deepEqual(await vector.deleteSource({ projectId: "project-a", sourceId: "source-a" }), { configured: true, deleted: true, collections: 2 });
  assert.equal(requests.length, 2);
  for (const request of requests) assert.deepEqual(request.body.filter, { must: [
    { key: "project_id", match: { value: "project-a" } }, { key: "source_id", match: { value: "source-a" } }
  ] });
  await assert.rejects(vector.deleteSource({ projectId: "", sourceId: "source-a" }), /Project and source/);
});

test("source cleanup does not acknowledge partial collection failure", async t => {
  const vector = store(t);
  t.mock.method(globalThis, "fetch", async url => url.endsWith("/collections")
    ? Response.json({ result: { collections: [{ name: "consistency_d8" }, { name: "consistency_d384" }] } })
    : url.includes("d384/") ? new Response("Unavailable", { status: 503 }) : Response.json({ status: "ok" }));
  await assert.rejects(vector.deleteSource({ projectId: "project-a", sourceId: "source-a" }), /HTTP 503/);
});

test("partial document upserts retain existing points and retry the same immutable IDs without a delete", async t => {
  const vector = store(t);
  const chunks = Array.from({ length: 200 }, (_, chunk_index) => ({ id: `chunk-${chunk_index}`, chunk_index, content: `Evidence ${chunk_index}` }));
  const points = new Map(chunks.map(chunk => [chunk.id, { id: chunk.id, vector: Array(8).fill(0.1) }]));
  const mutations = [];
  let fail = true, batches = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url.includes("/points?")) {
      mutations.push(init.method);
      batches++;
      if (fail && batches === 2) return new Response("Unavailable", { status: 503 });
      JSON.parse(init.body).points.forEach(point => points.set(point.id, point));
    } else if (url.includes("/points/delete")) assert.fail("Revision replacement must not delete the usable projection first");
    return Response.json({ result: {}, status: "ok" });
  });
  const request = { projectId: "project-a", source: { id: "source-a" }, documentId: "doc-a", chunks,
    vectors: chunks.map(() => Array(8).fill(0.2)), embeddingModel: "model-a" };
  await assert.rejects(vector.replaceDocument(request), /HTTP 503/);
  assert.equal(points.size, 200, "Unacknowledged batches cannot erase the still-usable prior projection");
  assert.equal(points.get("chunk-199").vector[0], 0.1);
  fail = false;
  assert.equal((await vector.replaceDocument(request)).indexed, 200);
  assert.equal(points.size, 200);
  assert.ok([...points.values()].every(point => point.vector[0] === 0.2));
  assert.deepEqual(mutations, ["PUT", "PUT", "PUT", "PUT"]);
});

test("reconciliation checks actual canonical IDs and metadata, including missing collections", async t => {
  const vector = store(t);
  const source = { id: "source-a", source_kind: "text" };
  const chunks = [{ id: "chunk-a", content: "Canonical evidence" }];
  let point = { id: "chunk-a", payload: { project_id: "project-a", source_id: "source-a", document_id: "doc-a", chunk_id: "chunk-a",
    source_kind: "text", source_ref_id: null, chunk_index: 0, allowed_scope: ["__public__"], app_type_id: "__all__", embedding_model: "model-a", content_hash: sha(chunks[0].content), is_current: true } };
  let missing = false;
  t.mock.method(globalThis, "fetch", async () => missing ? new Response("{}", { status: 404 }) : Response.json({ result: point ? [point] : [] }));
  const request = { projectId: "project-a", source, documentId: "doc-a", chunks, embeddingModel: "model-a", dimensions: 8 };
  assert.equal((await vector.verifyDocument(request)).consistent, true);
  point.payload.project_id = "project-b";
  assert.equal((await vector.verifyDocument(request)).consistent, false);
  point = null;
  assert.equal((await vector.verifyDocument(request)).consistent, false);
  missing = true;
  assert.equal((await vector.verifyDocument(request)).consistent, false);
});

test("batch reconciliation preserves a confirmed prefix and transmits only missing chunks", async t => {
  const vector = store(t);
  const points = new Map(), writes = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : {};
    if (url.endsWith("/points")) return Response.json({ result: body.ids.flatMap(id => points.has(id) ? [points.get(id)] : []) });
    if (url.includes("/points?")) {
      writes.push(body.points.length);
      body.points.forEach(point => points.set(point.id, point));
    }
    return Response.json({ result: {}, status: "ok" });
  });
  const chunks = Array.from({ length: 200 }, (_, index) => ({ id: `chunk-${index}`, chunk_index: index,
    content: `Evidence ${index}`, embedding: Array(8).fill(0.2) }));
  const request = { projectId: "project-a", source: { id: "source-a", source_kind: "text" }, documentId: "doc-a", chunks,
    vectors: chunks.map(chunk => chunk.embedding), embeddingModel: "model-a", dimensions: 8 };
  await vector.replaceDocument({ ...request, chunks: chunks.slice(0, 128), vectors: request.vectors.slice(0, 128) });
  const result = await vector.reconcileDocument(request);
  assert.equal(result.repaired, 72);
  assert.equal(result.indexed, 200);
  assert.deepEqual(writes, [128, 72]);
  assert.equal((await vector.reconcileDocument(request)).repaired, 0);
  assert.deepEqual(writes, [128, 72], "An accepted prefix is verified rather than resent on later worker ticks");
});

test("collection initialization is not reused across Qdrant endpoint changes", async t => {
  const vector = store(t);
  const requests = [];
  t.mock.method(globalThis, "fetch", async url => { requests.push(url); return Response.json({ result: {}, status: "ok" }); });
  await vector._internals.ensureCollection(8);
  config.knowledge.vectorStore.qdrantUrl = "https://replacement.example.test";
  await vector._internals.ensureCollection(8);
  assert.ok(requests.some(url => url === "https://replacement.example.test/collections/consistency_d8"));
});

test("optional payload index failures do not open the vector read/write circuit", async t => {
  const vector = store(t, "optional_indexes");
  let pointWrites = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url.includes("/index?")) return new Response("Index unavailable", { status: 503 });
    if (url.includes("/points?")) pointWrites++;
    return Response.json({ result: {}, status: "ok" });
  });
  const result = await vector.replaceDocument({ projectId: "project-a", source: { id: "source-a" }, documentId: "doc-a",
    chunks: [{ id: "chunk-a", content: "Canonical evidence" }], vectors: [Array(8).fill(0.2)], embeddingModel: "model-a" });
  assert.equal(result.indexed, 1);
  assert.equal(pointWrites, 1);
  assert.equal(vector.getStatus().circuit_open, false);
});

test("incremental embeddings send only changed complete inputs and preserve canonical source/project scoping", async t => {
  const runtime = { configured: true, model: "embedding-test", provider: "Fixture", baseUrl: "https://incremental.example.test/v1",
    integration: { id: "integration-a", api_key: "fixture" } };
  const texts = ["Document: Checkout\nSection: Recovery\nUnchanged text", "Document: Checkout\nSection: Retry\nChanged text"];
  const prior = Array(8).fill(0.2), next = Array(8).fill(0.4);
  t.mock.method(db, "prepare", sql => ({ get: async () => undefined, all: async (...args) => {
    if (!sql.includes("AS input_hash")) return [];
    assert.match(sql, /chunks\.project_id = \? AND chunks\.source_id = \?/);
    assert.deepEqual(args.slice(0, 4), ["project-a", "source-a", runtime.model, rag._internals.embeddingConfigurationHash(runtime)]);
    return [{ input_hash: sha(texts[0]), embedding: prior }];
  } }));
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    calls.push(JSON.parse(init.body).input);
    return Response.json({ data: [{ index: 0, embedding: next }] });
  });
  const result = await rag._internals.embedDocumentTexts({ projectId: "project-a", sourceId: "source-a", runtime, texts });
  assert.deepEqual(calls, [[texts[1]]]);
  assert.deepEqual(result.vectors, [prior, next]);
  assert.equal(result.reused_chunk_count, 1);
});

test("all unchanged embedding inputs make no model request; dimension drift never mixes old and new vectors", async t => {
  const runtime = { configured: true, model: "embedding-test", provider: "Fixture", baseUrl: "https://dimension.example.test/v1",
    integration: { id: "integration-b", api_key: "fixture" } };
  const texts = ["Stable complete input", "Changed complete input"];
  t.mock.method(db, "prepare", sql => ({ get: async () => undefined, all: async () => sql.includes("AS input_hash") ? [{ input_hash: sha(texts[0]), embedding: Array(8).fill(0.2) }] : [] }));
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ data: [{ index: 0, embedding: Array(16).fill(0.4) }] }); });
  const same = await rag._internals.embedDocumentTexts({ projectId: "project-a", sourceId: "source-a", runtime, texts: [texts[0]] });
  assert.equal(calls, 0);
  assert.equal(same.reused_chunk_count, 1);
  const changed = await rag._internals.embedDocumentTexts({ projectId: "project-a", sourceId: "source-a", runtime, texts });
  assert.equal(calls, 1);
  assert.equal(changed.model, "hellotest-hash-v1");
  assert.deepEqual(changed.vectors, changed.fallback);
  assert.equal(new Set(changed.vectors.map(vector => vector.length)).size, 1);
});

test("graph or ingestion failures cannot prevent the independently scheduled vector reconciliation task", async t => {
  const graph = require("../../backend/services/knowledgeGraph.service");
  const projection = require("../../backend/services/knowledgeVectorProjection.service");
  let vectorTicks = 0, vectorSignal;
  t.mock.method(graph, "processBackfill", async () => { throw new Error("Graph fixture unavailable"); });
  t.mock.method(rag, "processQueuedIngestions", async () => { throw new Error("Ingestion fixture unavailable"); });
  t.mock.method(projection, "processDue", async options => { vectorTicks++; vectorSignal = options.signal; return []; });
  const { tasks, close } = require("../../backend/workers")();
  const chosen = tasks.filter(task => /graph evidence|vector projections|queued Knowledge Repo/.test(task.label));
  assert.equal(chosen.length, 3);
  const outcomes = await Promise.allSettled(chosen.map(task => task.run()));
  assert.equal(outcomes.filter(result => result.status === "rejected").length, 2);
  assert.equal(vectorTicks, 1);
  assert.equal(vectorSignal.aborted, false);
  await close();
  assert.equal(vectorSignal.aborted, true, "Shutdown cancels vector IO before awaiting in-flight worker tasks");
});

test("a late provider response after the vector deadline cannot write PostgreSQL readiness", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  delete require.cache[require.resolve("../../backend/services/knowledgeVectorProjection.service")];
  const projection = require("../../backend/services/knowledgeVectorProjection.service");
  const vector = require("../../backend/services/knowledgeVectorStore.service");
  t.mock.method(vector, "isConfigured", () => true);
  t.mock.method(vector, "configurationKey", () => "configuration-a");
  let finishProvider, providerSignal;
  t.mock.method(vector, "reconcileDocument", request => {
    providerSignal = request.signal;
    return new Promise(resolve => { finishProvider = resolve; });
  });
  const writes = [];
  t.mock.method(db, "transaction", task => async () => task());
  t.mock.method(db, "prepare", sql => ({
    get: async () => sql.includes("FROM ai_knowledge_sources") ? { id: "source-a", project_id: "project-a", extraction_status: "ready", revision_token: "revision-a" }
      : sql.includes("FROM ai_knowledge_vector_jobs") ? { generation: "generation-a" }
        : { id: "document-a", embedding_model: "model-a", embedding_dimensions: 8 },
    all: async () => [{ id: "chunk-a", content: "Evidence", chunk_index: 0, embedding: Array(8).fill(0.2), embedding_model: "model-a" }],
    run: async () => { writes.push(sql); return { changes: 1 }; }
  }));
  const pending = projection.processSource({ projectId: "project-a", sourceId: "source-a" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof finishProvider, "function");
  t.mock.timers.tick(8000);
  assert.equal((await pending).status, "retry_scheduled");
  assert.equal(providerSignal.aborted, true);
  finishProvider({ configured: true, indexed: 1 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 1);
  assert.match(writes[0], /status = 'queued'/);
  assert.ok(writes.every(sql => !sql.includes("vector_provider = 'qdrant'") && !sql.includes("status = ?")), "Late external completion cannot mark a released transaction ready");
});
