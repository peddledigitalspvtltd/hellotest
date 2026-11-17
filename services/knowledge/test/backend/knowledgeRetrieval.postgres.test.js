const test = require("node:test");
const assert = require("node:assert/strict");

// Real PostgreSQL, real migrated schema. Run through
// scripts/checks/test-knowledge-retrieval-postgres.mjs, which supplies a
// disposable database. Nothing here talks to a model or a network service.
test("lexical retrieval finds the relevant chunk, uses the indexes and upgrades legacy rows", {
  skip: process.env.KNOWLEDGE_RETRIEVAL_POSTGRES_TEST !== "1", timeout: 240_000
}, async (t) => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_knowledge_retrieval_[0-9]+$/);
  const db = require("../../../platform/backend/src/db");
  const obsDb = require("../../../platform/backend/src/obsDb");
  await require("../../../platform/backend/src/migrate").migrate();
  const rag = require("../../backend/services/knowledgeRag.service");
  const maintenance = require("../../backend/services/knowledgeMaintenance.service");
  const lexical = require("../../backend/services/knowledgeLexicalQuery");
  const project = "lex-project";
  const user = { id: "lex-user" };
  t.after(async () => { await Promise.allSettled([db.close(), obsDb.close()]); });

  await db.query("INSERT INTO projects(id,name) VALUES ('lex-project','Lexical fixture')");

  let sourceCounter = 0;
  // Ingest through the real persistence path so the weighted vectors written by
  // production code are the ones under test.
  const addDocument = async ({ title, content, createdAt }) => {
    const id = `lex-source-${++sourceCounter}`;
    const revision = `rev-${id}`;
    await db.prepare(`INSERT INTO ai_knowledge_sources(id,project_id,source_kind,title,extraction_status,required_permission,revision_token,metadata)
      VALUES (?,?,'text',?,'processing',NULL,?,'{}'::jsonb)`).run(id, project, title, revision);
    await db.prepare(`INSERT INTO ai_knowledge_security_bindings(id,project_id,source_id,principal_type,principal_id,effect,inherited)
      VALUES (?,?,?,'PROJECT',?,'ALLOW',TRUE)`).run(`${id}:project-read`, project, id, project);
    const persisted = await rag._internals.persistDocument({
      projectId: project, content, embeddingRuntime: { configured: false },
      source: { id, project_id: project, title, source_kind: "text", revision_token: revision, metadata: {}, required_permission: null }
    });
    if (createdAt) await db.prepare("UPDATE ai_knowledge_chunks SET created_at = ? WHERE source_id = ?").run(createdAt, id);
    return { id, chunkIds: persisted.chunks.map((chunk) => chunk.id) };
  };

  // The one genuinely relevant chunk is OLD; everything else is newer noise.
  const relevant = await addDocument({
    title: "Checkout payment rules",
    content: "The checkout flow must reject expired credit cards and show a retry message to returning customers.",
    createdAt: "2024-01-01T00:00:00Z"
  });
  const titleHit = await addDocument({ title: "Idempotency keys", content: "Clients send a unique header with each write request.", createdAt: "2025-01-01T00:00:00Z" });
  const bodyHit = await addDocument({ title: "Release notes", content: "We added support for idempotency keys on write requests.", createdAt: "2025-06-01T00:00:00Z" });

  // 3,000 newer, unrelated documents of 10 chunks each (30,000 chunks). Many
  // documents matter: a project with few documents would let the planner drive
  // from documents, which hides whether the match predicate is index-compatible.
  await db.query(`INSERT INTO ai_knowledge_sources(id,project_id,source_kind,title,extraction_status,revision_token,metadata)
    SELECT 'lex-noise-' || d, 'lex-project', 'text', 'Weekly status ' || d, 'ready', 'noise', '{}'::jsonb FROM generate_series(1, 3000) d`);
  await db.query(`INSERT INTO ai_knowledge_documents(id,project_id,source_id,title,content,checksum_sha256)
    SELECT 'lex-noise-doc-' || d, 'lex-project', 'lex-noise-' || d, 'Weekly status ' || d, 'noise', 'noise' FROM generate_series(1, 3000) d`);
  await db.query(`INSERT INTO ai_knowledge_index_states(document_id,project_id,source_id,document_version,is_current,lexical_state,dense_state,required_indexes_ready)
    SELECT 'lex-noise-doc-' || d, 'lex-project', 'lex-noise-' || d, 1, TRUE, 'ready', 'not_configured', TRUE FROM generate_series(1, 3000) d`);
  await db.query(`INSERT INTO ai_knowledge_security_bindings(id,project_id,source_id,principal_type,principal_id,effect,inherited)
    SELECT 'lex-noise-' || d || ':project-read', 'lex-project', 'lex-noise-' || d, 'PROJECT', 'lex-project', 'ALLOW', TRUE FROM generate_series(1, 3000) d`);
  await db.query(`INSERT INTO ai_knowledge_chunks(id,project_id,document_id,source_id,chunk_index,content,search_vector,search_vector_prose,lexical_version,created_at)
    SELECT 'lex-noise-chunk-' || d || '-' || c, 'lex-project', 'lex-noise-doc-' || d, 'lex-noise-' || d, c,
      txt, to_tsvector('simple', txt), to_tsvector('english', txt), 2, now() - ((d * 10 + c) || ' seconds')::interval
    FROM (SELECT d, c, 'Weekly status item ' || d || ' covering weather sports calendar lunch and parking topic ' || md5(((d * 10 + c) % 977)::text) AS txt
          FROM generate_series(1, 3000) d, generate_series(0, 9) c) rows`);
  await db.query("ANALYZE ai_knowledge_chunks");
  await db.query("ANALYZE ai_knowledge_documents");
  await db.query("ANALYZE ai_knowledge_sources");
  await db.query("ANALYZE ai_knowledge_index_states");

  const search = (query, extra = {}) => rag.search({ projectId: project, user, query, mode: "keyword",
    allowedSourcePermissions: [], timeoutMs: 8_000, limit: 10, ...extra });

  await t.test("control: the previous query shape cannot find the relevant chunk", async () => {
    const question = "how does the checkout flow handle expired credit cards for returning customers";
    const legacy = await db.prepare(`SELECT chunks.source_id, ts_rank_cd(chunks.search_vector, plainto_tsquery('simple', ?)) AS lexical_rank
      FROM ai_knowledge_chunks chunks WHERE chunks.project_id = ?
      ORDER BY lexical_rank DESC, chunks.created_at DESC LIMIT 250`).all(question, project);
    assert.ok(legacy.every((row) => Number(row.lexical_rank) === 0), "an AND query over a whole sentence ranks every chunk 0");
    assert.ok(!legacy.some((row) => row.source_id === relevant.id), "so ties fall back to newest-first and the old relevant chunk is never returned");
  });

  await t.test("a sentence-length question finds the old relevant chunk first", async () => {
    const response = await search("How does the checkout flow handle expired credit cards for returning customers?");
    assert.equal(response.results[0]?.source_id, relevant.id, JSON.stringify(response.results.map((r) => r.title)));
    assert.ok(response.results[0].lexical_score > 0);
  });

  await t.test("the lexical read is served by the GIN indexes, not a scan of every chunk", async () => {
    const captured = [];
    const original = db.prepare;
    db.prepare = (sql) => {
      const statement = original(sql);
      if (!/search_vector @@/.test(sql)) return statement;
      return { ...statement, all: async (...params) => { captured.push({ sql, params }); return statement.all(...params); } };
    };
    try { await search("How does the checkout flow handle expired credit cards for returning customers?"); }
    finally { db.prepare = original; }
    assert.equal(captured.length, 1, "exactly one lexical statement");
    const plan = (await original(`EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) ${captured[0].sql}`).all(...captured[0].params))
      .map((row) => row["QUERY PLAN"]).join("\n");
    assert.match(plan, /Bitmap Index Scan on idx_ai_knowledge_chunks_search\b/, plan);
    assert.doesNotMatch(plan, /Seq Scan on ai_knowledge_chunks/, plan);
  });

  await t.test("a title match outranks the same words in a body", async () => {
    const response = await search("idempotency keys");
    const order = response.results.map((item) => item.source_id);
    assert.ok(order.includes(titleHit.id) && order.includes(bodyHit.id), JSON.stringify(order));
    assert.ok(order.indexOf(titleHit.id) < order.indexOf(bodyHit.id), "title is weighted above body");
  });

  await t.test("freshly ingested chunks carry weighted simple and stemmed vectors", async () => {
    const row = await db.prepare("SELECT search_vector::text AS simple, search_vector_prose::text AS prose, lexical_version FROM ai_knowledge_chunks WHERE id = ?").get(relevant.chunkIds[0]);
    assert.equal(row.lexical_version, lexical.LEXICAL_VERSION);
    assert.match(row.simple, /'checkout':\d+A/, "the title token carries weight A");
    assert.match(row.simple, /'cards':\d+C/, "body tokens carry weight C");
    assert.match(row.prose, /'card':/, "the prose vector is stemmed");
    assert.doesNotMatch(row.simple, /'document'|'section'/, "embedding-prefix words are not indexed");
  });

  await t.test("hostile and degenerate questions never fail the query", async () => {
    for (const query of ["foo' ) | !bar & (baz:*  ; DROP TABLE ai_knowledge_chunks;--", "what is this", "\\ \\\\ ''", "a"]) {
      const response = await search(query);
      assert.ok(Array.isArray(response.results), query);
    }
    assert.equal((await db.prepare("SELECT to_regclass('public.ai_knowledge_chunks') AS name").get()).name, "ai_knowledge_chunks");
  });

  await t.test("legacy unweighted rows stay searchable and are upgraded in place by the reindex job", async () => {
    await db.query(`INSERT INTO ai_knowledge_sources(id,project_id,source_kind,title,extraction_status,revision_token,metadata)
      VALUES ('lex-legacy','lex-project','text','Refund policy','ready','legacy','{}'::jsonb)`);
    await db.query(`INSERT INTO ai_knowledge_documents(id,project_id,source_id,title,content,checksum_sha256)
      VALUES ('lex-legacy-doc','lex-project','lex-legacy','Refund policy','legacy','legacy')`);
    await db.query(`INSERT INTO ai_knowledge_index_states(document_id,project_id,source_id,document_version,is_current,lexical_state,dense_state,required_indexes_ready)
      VALUES ('lex-legacy-doc','lex-project','lex-legacy',1,TRUE,'ready','not_configured',TRUE)`);
    await db.query(`INSERT INTO ai_knowledge_security_bindings(id,project_id,source_id,principal_type,principal_id,effect,inherited)
      VALUES ('lex-legacy:project-read','lex-project','lex-legacy','PROJECT','lex-project','ALLOW',TRUE)`);
    // The exact shape ingestion wrote before weighting: one unweighted vector over the prefixed text.
    await db.query(`INSERT INTO ai_knowledge_chunks(id,project_id,document_id,source_id,chunk_index,heading,content,search_vector,metadata)
      VALUES ('lex-legacy-chunk','lex-project','lex-legacy-doc','lex-legacy',0,'Eligibility',
        'Customers may request a chargeback within thirty days.',
        to_tsvector('simple', E'Document: Refund policy\\nSection: Eligibility\\nCustomers may request a chargeback within thirty days.'),
        '{"section_path":["Refunds","Eligibility"]}'::jsonb)`);
    const before = await db.prepare("SELECT lexical_version, search_vector_prose IS NULL AS no_prose FROM ai_knowledge_chunks WHERE id = 'lex-legacy-chunk'").get();
    assert.equal(before.lexical_version, 0);
    assert.equal(before.no_prose, true);
    assert.ok((await search("chargeback within thirty days")).results.some((item) => item.chunk_id === "lex-legacy-chunk"), "legacy vectors are matched during the transition");

    const progress = await maintenance.lexicalReindexProgress();
    assert.equal(progress.pending, 1);
    assert.equal(progress.complete, false);
    const outcome = await maintenance.processLexicalReindex({ batchSize: 50 });
    assert.equal(outcome.upgraded, 1);
    assert.deepEqual(await maintenance.lexicalReindexProgress(), { version: lexical.LEXICAL_VERSION, pending: 0, complete: true });

    const after = await db.prepare("SELECT lexical_version, search_vector::text AS simple, search_vector_prose::text AS prose FROM ai_knowledge_chunks WHERE id = 'lex-legacy-chunk'").get();
    assert.equal(after.lexical_version, lexical.LEXICAL_VERSION);
    assert.match(after.simple, /'refund':\d+A/, "title is now weight A");
    assert.match(after.simple, /'eligibility':\d+B/, "headings are now weight B");
    assert.match(after.simple, /'chargeback':\d+C/, "body is now weight C");
    assert.match(after.prose, /'chargeback'/);
    assert.ok((await search("chargeback within thirty days")).results.some((item) => item.chunk_id === "lex-legacy-chunk"));
    assert.equal((await maintenance.processLexicalReindex()).upgraded, 0, "an upgraded table is idle");
  });

  await t.test("provider-backed pgvector dimensions get a typed HNSW index and a KNN-compatible query shape", async (t) => {
    const extension = await db.prepare("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') AS available").get();
    if (!extension.available) return t.skip('pgvector extension is unavailable in this PostgreSQL instance');
    const vectors = ['[1,0,0,0,0,0,0,0]','[0.9,0.1,0,0,0,0,0,0]','[0,0.9,0.1,0,0,0,0,0]'];
    for (const [index,vector] of vectors.entries()) await db.prepare(`UPDATE ai_knowledge_chunks SET embedding_vector=?::vector,embedding_model='provider-test-model' WHERE id=?`)
      .run(vector,relevant.chunkIds[index]);
    const indexer=require('../../backend/services/knowledgeVectorIndex.service');
    const result=await indexer.processPgvectorIndexMaintenance({limit:2,minRows:1});
    assert.ok(result.dimensions.includes(8));
    const definition=await db.prepare("SELECT pg_get_indexdef(to_regclass('idx_ai_knowledge_chunks_embedding_hnsw_d8')) AS definition").get();
    assert.match(definition.definition,/USING hnsw .*embedding_vector.*vector\(8\).*vector_cosine_ops/);
    assert.match(definition.definition,/embedding_model <> 'hellotest-hash-v1'/,'deterministic fallback vectors are excluded');
    const plan=await db.transaction(async()=>{
      await db.query('SET LOCAL enable_seqscan=off');
      return db.prepare(`EXPLAIN (COSTS OFF) SELECT id FROM ai_knowledge_chunks
        WHERE embedding_vector IS NOT NULL AND embedding_model='provider-test-model'
          AND embedding_model <> 'hellotest-hash-v1' AND vector_dims(embedding_vector)=8
        ORDER BY embedding_vector::vector(8) <=> '[1,0,0,0,0,0,0,0]'::vector(8) LIMIT 2`).all();
    })();
    assert.match(plan.map(row=>row['QUERY PLAN']).join('\n'),/idx_ai_knowledge_chunks_embedding_hnsw_d8/);
  });
});
