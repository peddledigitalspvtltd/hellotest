const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

// Requires a local disposable PG connection and a running local Qdrant. Every
// SQL fixture is TEMP and every Qdrant point belongs to a random test prefix.
test("real PostgreSQL/Qdrant reconcile uncertain writes, index loss, tombstones and hard deletes", {
  skip: process.env.KNOWLEDGE_VECTOR_POSTGRES_TEST !== "1", timeout: 60_000
}, async t => {
  const db = require("../../../platform/backend/src/db");
  const { config } = require("../../../platform/backend/src/config");
  const vector = require("../../backend/services/knowledgeVectorStore.service");
  const projection = require("../../backend/services/knowledgeVectorProjection.service");
  const schema = require("../../backend/vectorProjectionSchema");
  const previous = { ...config.knowledge.vectorStore };
  const endpoint = new URL(process.env.QDRANT_TEST_URL || "http://127.0.0.1:6333");
  assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(endpoint.hostname), "Verification must target local Qdrant");
  const prefix = `agent_verify_vector_${randomUUID().replaceAll("-", "")}`;
  const collection = `${prefix}_d8`;
  Object.assign(config.knowledge.vectorStore, { provider: "qdrant", qdrantUrl: endpoint.origin,
    qdrantCollectionPrefix: prefix, qdrantApiKey: process.env.QDRANT_TEST_API_KEY || "", qdrantTimeoutMs: 4000 });
  const originalFetch = globalThis.fetch;
  const headers = config.knowledge.vectorStore.qdrantApiKey ? { "api-key": config.knowledge.vectorStore.qdrantApiKey } : {};
  let loseAcknowledgement = false, writes = 0;
  const operations = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const response = await originalFetch(url, init);
    operations.push({ path: new URL(url).pathname, method: init?.method || "GET", status: response.status });
    if (String(url).includes(`/collections/${collection}/points?`)) {
      writes++;
      if (response.ok && loseAcknowledgement) {
        loseAcknowledgement = false;
        await response.arrayBuffer();
        throw new Error("Fixture lost the successful Qdrant acknowledgement");
      }
    }
    return response;
  });
  try {
    // Collection/index provisioning is an independent fixture prerequisite.
    // Keep real cold setup outside the command's production eight-second
    // deadline: this scenario must lose an actual accepted point-write ACK,
    // not mistake a provisioning timeout for an uncertain successful upsert.
    await vector._internals.ensureCollection(8, { signal: AbortSignal.timeout(20_000) });
    assert.equal(writes, 0, "Collection provisioning must not create test evidence");
    operations.length = 0;
    loseAcknowledgement = true;
    await db.transaction(async () => {
      await db.query(`CREATE TEMP TABLE projects(id TEXT PRIMARY KEY) ON COMMIT DROP`);
      await db.query(`INSERT INTO projects VALUES ('project-a'), ('project-b')`);
      await db.query(`CREATE TEMP TABLE ai_knowledge_sources(
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT, source_kind TEXT, source_ref_id TEXT, app_type_id TEXT, required_permission TEXT,
        revision_token TEXT, extraction_status TEXT, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP) ON COMMIT DROP`);
      await db.query(`CREATE TEMP TABLE ai_knowledge_documents(
        id TEXT PRIMARY KEY, source_id TEXT REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
        project_id TEXT, version INTEGER, is_active BOOLEAN, effective_to TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP) ON COMMIT DROP`);
      await db.query(`CREATE TEMP TABLE ai_knowledge_chunks(
        id TEXT PRIMARY KEY, project_id TEXT, source_id TEXT, document_id TEXT REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE,
        chunk_index INTEGER, content TEXT, embedding JSONB, embedding_model TEXT,
        metadata JSONB DEFAULT '{}'::jsonb) ON COMMIT DROP`);
      await db.query(`CREATE TEMP TABLE ai_knowledge_index_states(
        document_id TEXT PRIMARY KEY REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE,
        project_id TEXT, source_id TEXT, is_current BOOLEAN, required_indexes_ready BOOLEAN,
        embedding_model TEXT, embedding_dimensions INTEGER, vector_provider TEXT DEFAULT 'postgresql',
        error_fingerprint TEXT, indexed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP) ON COMMIT DROP`);
      for (const statement of schema) await db.query(statement.replace("CREATE TABLE IF NOT EXISTS ai_knowledge_vector_jobs", "CREATE TEMP TABLE ai_knowledge_vector_jobs"));
      const sourceId = randomUUID(), documentId = randomUUID(), chunkId = randomUUID();
      await db.prepare(`INSERT INTO ai_knowledge_sources(id,project_id,title,source_kind,revision_token,extraction_status)
        VALUES (?, 'project-a', 'Canonical evidence', 'text', 'revision-a', 'ready')`).run(sourceId);
      await db.prepare(`INSERT INTO ai_knowledge_documents(id,source_id,project_id,version,is_active)
        VALUES (?, ?, 'project-a', 1, TRUE)`).run(documentId, sourceId);
      await db.prepare(`INSERT INTO ai_knowledge_chunks(id,project_id,source_id,document_id,chunk_index,content,embedding,embedding_model)
        VALUES (?, 'project-a', ?, ?, 0, 'Canonical evidence', ?, 'model-a')`).run(chunkId, sourceId, documentId, Array(8).fill(0.25));
      await db.prepare(`INSERT INTO ai_knowledge_index_states(document_id,project_id,source_id,is_current,required_indexes_ready,embedding_model,embedding_dimensions)
        VALUES (?, 'project-a', ?, TRUE, TRUE, 'model-a', 8)`).run(documentId, sourceId);
      const run = () => projection.processSource({ projectId: "project-a", sourceId });
      const job = () => db.prepare(`SELECT * FROM ai_knowledge_vector_jobs WHERE source_id = ?`).get(sourceId);
      assert.equal(await projection.discoverPending(), 1, "Existing canonical revisions without a journal are recovered after upgrade/restart");
      await assert.rejects(projection.queueSource({ projectId: "project-b", sourceId, documentId, revisionToken: "revision-a" }), /different project/);
      assert.equal((await run()).status, "retry_scheduled");
      assert.equal((await job()).status, "queued");
      assert.equal((await job()).attempts, 1);
      assert.equal(writes, 1, `The actual Qdrant upsert must execute before acknowledgement loss is tested: ${JSON.stringify(operations)}`);
      assert.ok((await job()).error_fingerprint && !(await job()).error_fingerprint.includes("Fixture"));
      const source = await db.prepare(`SELECT * FROM ai_knowledge_sources WHERE id = ?`).get(sourceId);
      const check = () => vector.verifyDocument({ projectId: "project-a", source, documentId,
        chunks: [{ id: chunkId, content: "Canonical evidence" }], embeddingModel: "model-a", dimensions: 8 });
      const initial = await check();
      if (!initial.consistent) {
        const observed = await originalFetch(`${endpoint.origin}/collections/${collection}/points`, {
          method: "POST", headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ ids: [chunkId], with_payload: true, with_vector: false }) });
        assert.fail(`Qdrant committed despite an unknown acknowledgement: ${await observed.text()}`);
      }
      await db.prepare(`UPDATE ai_knowledge_vector_jobs SET next_attempt_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE source_id = ?`).run(sourceId);
      assert.equal((await run()).status, "ready");
      assert.equal(writes, 1, "Recovery checks the original immutable IDs without replaying an accepted upsert");
      assert.equal((await job()).attempts, 0);
      assert.equal((await job()).status, "ready");

      // Simulate loss of an already-acknowledged index; canonical rows remain.
      await originalFetch(`${endpoint.origin}/collections/${collection}/points/delete?wait=true`, {
        method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ points: [chunkId] }) });
      assert.equal((await check()).consistent, false);
      await db.prepare(`UPDATE ai_knowledge_vector_jobs SET next_attempt_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE source_id = ?`).run(sourceId);
      assert.equal((await run()).status, "ready");
      assert.equal(writes, 2);
      assert.equal((await check()).consistent, true);

      // Publication and journal insertion are one SQL transaction: a process
      // interruption cannot leave a committed target with no recovery command.
      await assert.rejects(db.transaction(async () => {
        await projection.queueSource({ projectId: "project-a", sourceId, documentId: "uncommitted", revisionToken: "uncommitted" });
        throw new Error("Fixture crash before commit");
      })(), /crash before commit/);
      assert.equal((await job()).document_id, documentId);

      const foreignSource = { id: randomUUID(), source_kind: "text" }, foreignDoc = randomUUID(), foreignChunk = { id: randomUUID(), content: "Other project evidence" };
      await db.prepare(`INSERT INTO ai_knowledge_sources(id,project_id,title,source_kind,revision_token,extraction_status)
        VALUES (?, 'project-b', 'Other project evidence', 'text', 'revision-b', 'ready')`).run(foreignSource.id);
      await db.prepare(`INSERT INTO ai_knowledge_documents(id,source_id,project_id,version,is_active)
        VALUES (?, ?, 'project-b', 1, TRUE)`).run(foreignDoc, foreignSource.id);
      await db.prepare(`INSERT INTO ai_knowledge_chunks(id,project_id,source_id,document_id,chunk_index,content,embedding,embedding_model)
        VALUES (?, 'project-b', ?, ?, 0, 'Other project evidence', ?, 'model-a')`).run(foreignChunk.id, foreignSource.id, foreignDoc, Array(8).fill(0.25));
      await vector.replaceDocument({ projectId: "project-b", source: foreignSource, documentId: foreignDoc,
        chunks: [foreignChunk], vectors: [Array(8).fill(0.25)], embeddingModel: "model-a" });

      // Source/project hard deletion must leave enough durable identity for
      // cleanup, including a project removed while Qdrant was disabled.
      await db.query(`DELETE FROM projects WHERE id = 'project-a'`);
      assert.equal((await job()).project_id, "project-a");
      await db.prepare(`UPDATE ai_knowledge_vector_jobs SET next_attempt_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE source_id = ?`).run(sourceId);
      assert.equal((await run()).status, "deleted");
      assert.equal((await check()).consistent, false);
      assert.equal((await job()).status, "deleted");
      assert.equal((await vector.verifyDocument({ projectId: "project-b", source: foreignSource, documentId: foreignDoc,
        chunks: [foreignChunk], embeddingModel: "model-a", dimensions: 8 })).consistent, true, "Deleting a missing source/project preserves another project's vectors in the same collection");
    })();
  } finally {
    // A unique generated name is the only collection this fixture may delete.
    assert.match(collection, /^agent_verify_vector_[a-f0-9]{32}_d8$/);
    await originalFetch(`${endpoint.origin}/collections/${collection}`, { method: "DELETE", headers }).catch(() => undefined);
    Object.assign(config.knowledge.vectorStore, previous);
    await db.close();
  }
});
