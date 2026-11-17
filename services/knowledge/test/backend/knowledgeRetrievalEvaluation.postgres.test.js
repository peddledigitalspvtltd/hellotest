const test = require("node:test");
const assert = require("node:assert/strict");

// End-to-end retrieval evaluation on the real schema. The hand-written documents go
// through the real ingestion path; the 3,000 filler documents are bulk-inserted with
// the same weighted vectors. Run through scripts/checks/test-knowledge-retrieval-postgres.mjs.
test("search finds the right sources for a golden set, far better than the previous query shape", {
  skip: process.env.KNOWLEDGE_RETRIEVAL_POSTGRES_TEST !== "1", timeout: 280_000
}, async (t) => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_knowledge_retrieval_[0-9]+$/);
  const db = require("../../../platform/backend/src/db");
  const obsDb = require("../../../platform/backend/src/obsDb");
  await require("../../../platform/backend/src/migrate").migrate();
  const rag = require("../../backend/services/knowledgeRag.service");
  const evaluation = require("../support/knowledgeRetrievalEvaluation");
  const lexical = require("../../backend/services/knowledgeLexicalQuery");
  const { APPLICATION_CONTEXT_PROFILE } = require("../../backend/services/knowledgeAuthorization.service");
  t.after(async () => { await Promise.allSettled([db.close(), obsDb.close()]); });

  // KNOWLEDGE_GOLDEN_SET=/path/to/your.json evaluates your own questions and sources instead of the
  // bundled synthetic seed set. Floors for a custom set come from KNOWLEDGE_GOLDEN_FLOORS (JSON), if given.
  const customPath = process.env.KNOWLEDGE_GOLDEN_SET ? require("node:path").resolve(process.env.KNOWLEDGE_GOLDEN_SET) : null;
  const golden = evaluation.loadGolden(customPath ? JSON.parse(require("node:fs").readFileSync(customPath, "utf8")) : require("../golden/retrieval.golden.json"));
  const project = "eval-project";
  const user = { id: "eval-user" };
  await db.query("INSERT INTO projects(id,name) VALUES ('eval-project','Evaluation')");
  const handWritten = golden.corpus.filter((doc) => !doc.key.startsWith("filler-"));
  const filler = golden.corpus.filter((doc) => doc.key.startsWith("filler-"));
  const sourceOf = (key) => `golden-${key}`;

  for (const [index, doc] of handWritten.entries()) {
    const id = sourceOf(doc.key), revision = `rev-${index}`;
    const sourceKind = doc.source_kind || "text";
    const sourceRefId = doc.source_ref_id || null;
    const sourcePermission = doc.required_permission || null;
    const sourceMetadata = {
      ...(doc.display_id ? { display_id: doc.display_id } : {}),
      ...(sourceKind === "test_case" ? { context_permission_profile: APPLICATION_CONTEXT_PROFILE } : {})
    };
    await db.prepare(`INSERT INTO ai_knowledge_sources(id,project_id,source_kind,source_ref_id,title,extraction_status,required_permission,revision_token,metadata)
      VALUES (?,?,?,?,?,'processing',?,?,?::jsonb)`).run(id, project, sourceKind, sourceRefId, doc.title, sourcePermission, revision, JSON.stringify(sourceMetadata));
    await db.prepare(`INSERT INTO ai_knowledge_security_bindings(id,project_id,source_id,principal_type,principal_id,effect,inherited)
      VALUES (?,?,?,'PROJECT',?,'ALLOW',TRUE)`).run(`${id}:project-read`, project, id, project);
    await rag._internals.persistDocument({ projectId: project, content: `${doc.title}\n\n${doc.content}`, embeddingRuntime: { configured: false },
      metadata: {},
      source: { id, project_id: project, source_ref_id: sourceRefId, title: doc.title, source_kind: sourceKind,
        revision_token: revision, metadata: sourceMetadata, required_permission: sourcePermission } });
  }
  // Filler is newer than every real document, exactly the situation that hid the defect.
  const simple = (column) => `setweight(to_tsvector('simple', f.title), 'A') || setweight(to_tsvector('simple', ${column}), 'C')`;
  const prose = (column) => `setweight(to_tsvector('english', f.title), 'A') || setweight(to_tsvector('english', ${column}), 'C')`;
  const rows = "jsonb_to_recordset($2::jsonb) AS f(key text, title text, content text)";
  await db.query(`INSERT INTO ai_knowledge_sources(id,project_id,source_kind,title,extraction_status,revision_token,metadata)
    SELECT 'golden-' || f.key, $1, 'text', f.title, 'ready', 'filler', '{}'::jsonb FROM ${rows}`, [project, filler]);
  await db.query(`INSERT INTO ai_knowledge_documents(id,project_id,source_id,title,content,checksum_sha256)
    SELECT 'doc-' || f.key, $1, 'golden-' || f.key, f.title, f.content, 'filler' FROM ${rows}`, [project, filler]);
  await db.query(`INSERT INTO ai_knowledge_index_states(document_id,project_id,source_id,document_version,is_current,lexical_state,dense_state,required_indexes_ready)
    SELECT 'doc-' || f.key, $1, 'golden-' || f.key, 1, TRUE, 'ready', 'not_configured', TRUE FROM ${rows}`, [project, filler]);
  await db.query(`INSERT INTO ai_knowledge_security_bindings(id,project_id,source_id,principal_type,principal_id,effect,inherited)
    SELECT 'golden-' || f.key || ':project-read', $1, 'golden-' || f.key, 'PROJECT', $1, 'ALLOW', TRUE FROM ${rows}`, [project, filler]);
  await db.query(`INSERT INTO ai_knowledge_chunks(id,project_id,document_id,source_id,chunk_index,heading,content,search_vector,search_vector_prose,lexical_version,created_at)
    SELECT 'chunk-' || f.key, $1, 'doc-' || f.key, 'golden-' || f.key, 0, NULL, f.content, ${simple("f.content")}, ${prose("f.content")}, ${lexical.LEXICAL_VERSION}, now() + (row_number() OVER ()) * interval '1 second'
    FROM ${rows}`, [project, filler]);
  await db.query("ANALYZE ai_knowledge_chunks");

  const keyOf = (sourceId) => sourceId.replace(/^golden-/, "");
  const sourceKinds = [...new Set(handWritten.map((doc) => doc.source_kind || "text"))];
  const sourcePermissions = [...new Set(handWritten.map((doc) => doc.required_permission).filter(Boolean))];
  const current = await evaluation.evaluate({ golden, k: 10, search: async (question) => {
    const response = await rag.search({ projectId: project, user, query: question, mode: "keyword", allowedSourcePermissions: sourcePermissions, timeoutMs: 8_000, limit: 10,
      filters: { source_kinds: sourceKinds } });
    return response.results.map((item) => keyOf(item.source_id));
  } });
  // The previous lexical channel: an AND query ranked over every chunk, ties newest first.
  const legacy = await evaluation.evaluate({ golden, k: 10, search: async (question) => {
    const rows = await db.prepare(`SELECT chunks.source_id FROM ai_knowledge_chunks chunks WHERE chunks.project_id = ?
      ORDER BY ts_rank_cd(chunks.search_vector, plainto_tsquery('simple', ?)) DESC, chunks.created_at DESC LIMIT 250`).all(project, question);
    return rows.map((row) => keyOf(row.source_id));
  } });
  console.log(`\n${evaluation.formatReport(legacy, { label: "previous lexical channel" })}\n\n${evaluation.formatReport(current, { label: "current search" })}\n`);

  await t.test("search meets the quality floors on the golden set", () => {
    if (customPath) {
      const floors = process.env.KNOWLEDGE_GOLDEN_FLOORS ? JSON.parse(process.env.KNOWLEDGE_GOLDEN_FLOORS) : golden.overall_floors || {};
      const classFloors = process.env.KNOWLEDGE_GOLDEN_CLASS_FLOORS ? JSON.parse(process.env.KNOWLEDGE_GOLDEN_CLASS_FLOORS) : golden.class_floors || {};
      assert.equal(current.overall.questions, golden.questions.length, "every curated question was evaluated");
      assert.deepEqual(evaluation.checkFloors(current, floors, classFloors), [], `${evaluation.formatReport(current)}\nFloors failed`);
      return;
    }
    // Measured with keyword retrieval only (no embedding provider): recall@10 0.899, MRR 0.9015, nDCG@10 0.8586.
    // The floors leave headroom for ordinary change but sit far above the previous channel (0.303 / 0.303 / 0.303).
    const failures = evaluation.checkFloors(current, { recall_at_10: 0.85, mrr: 0.8, ndcg_at_10: 0.8 });
    assert.deepEqual(failures, [], `${failures.join("; ")}\n${evaluation.formatReport(current)}`);
  });

  await t.test("natural-language questions, the failing class, are now found", { skip: Boolean(customPath) }, () => {
    const natural = current.by_class.natural;
    assert.ok(natural.recall_at_10 >= 0.7, `natural recall@10 ${natural.recall_at_10}; missed ${natural.missed}`);
    assert.ok(natural.mrr >= 0.65, `natural MRR ${natural.mrr}`);
    // Known, documented gap: n3 ("ship a release" vs "A release requires ...") and n6 ("most urgent" vs
    // "severity one") are synonym questions. Keyword retrieval cannot bridge them; that is the dense
    // channel's job once an embedding provider is configured. Anything NEW missing is a regression.
    const unexpected = natural.missed.filter((id) => !["n3", "n6"].includes(id));
    assert.deepEqual(unexpected, [], `unexpected natural-language misses: ${unexpected}`);
  });

  await t.test("every class holds up: identifiers, short terms, stemming, titles and common-word distractors", { skip: Boolean(customPath) }, () => {
    for (const name of ["identifier", "short", "stemming", "title", "distractor"]) {
      assert.ok(current.by_class[name].recall_at_10 >= 0.8, `${name}: recall@10 ${current.by_class[name].recall_at_10}, missed ${current.by_class[name].missed}`);
    }
  });

  await t.test("the previous query shape was far worse, and the gap is the point of the change", { skip: Boolean(customPath) }, () => {
    assert.ok(legacy.overall.recall_at_10 < 0.5, `the legacy channel's recall@10 was ${legacy.overall.recall_at_10}`);
    assert.ok(legacy.by_class.natural.recall_at_10 < 0.2, `it found almost no sentence questions (${legacy.by_class.natural.recall_at_10})`);
    assert.ok(current.overall.recall_at_10 - legacy.overall.recall_at_10 > 0.4, "the improvement is large, not marginal");
    assert.ok(current.overall.mrr > legacy.overall.mrr * 1.5);
  });
});
