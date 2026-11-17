const test = require("node:test");
const assert = require("node:assert/strict");

// Real PostgreSQL, real migrated schema, real ingestion path (serializers ->
// persistDocument -> graph projection). Run through
// scripts/checks/test-knowledge-retrieval-postgres.mjs.
test("graph projection, resolution, visibility and tracing behave on the real schema", {
  skip: process.env.KNOWLEDGE_RETRIEVAL_POSTGRES_TEST !== "1", timeout: 240_000
}, async (t) => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_knowledge_retrieval_[0-9]+$/);
  const db = require("../../../platform/backend/src/db");
  const obsDb = require("../../../platform/backend/src/obsDb");
  await require("../../../platform/backend/src/migrate").migrate();
  const rag = require("../../backend/services/knowledgeRag.service");
  const graph = require("../../backend/services/knowledgeGraph.service");
  const authorization = require("../../backend/services/knowledgeAuthorization.service");
  const ontology = require("../../backend/services/knowledgeOntology");
  t.after(async () => { await Promise.allSettled([db.close(), obsDb.close()]); });

  const project = "gp";
  const full = { id: "g-user" };
  const limited = { id: "g-limited" };
  const permissionsFull = ["project.view", "app_type.view", "knowledge.view", "requirement.view", "testcase.view", "run.view", "feedback.view"];
  await db.query("INSERT INTO roles(id,name) VALUES ('g-role','Graph full'),('g-role-limited','Graph limited')");
  await db.query(`INSERT INTO role_permissions(role_id,permission_id) SELECT 'g-role',id FROM permissions WHERE code IN (SELECT jsonb_array_elements_text($1::jsonb))`, [permissionsFull]);
  await db.query(`INSERT INTO role_permissions(role_id,permission_id) SELECT 'g-role-limited',id FROM permissions WHERE code IN (SELECT jsonb_array_elements_text($1::jsonb))`,
    [permissionsFull.filter((code) => code !== "requirement.view")]);
  await db.query(`INSERT INTO users(id,email,password_hash,name,default_role_id) VALUES
    ('g-user','g-user@example.test','x','Full','g-role'),('g-limited','g-limited@example.test','x','Limited','g-role-limited')`);
  await db.query("INSERT INTO projects(id,name,visibility,created_by) VALUES ('gp','Graph project','private','g-user')");
  await db.query("INSERT INTO projects(id,name,visibility,created_by) VALUES ('gp-fair','Fairness project','private','g-user')");
  await db.query(`INSERT INTO project_members(id,project_id,user_id,role_id) VALUES ('g-m1','gp','g-user','g-role'),('g-m2','gp','g-limited','g-role-limited')`);
  await db.query("INSERT INTO app_types(id,project_id,name,type) VALUES ('g-app','gp','Web','web')");
  await db.query("INSERT INTO requirements(id,project_id,title,display_id) VALUES ('g-story-12','gp','Checkout refunds','STORY-12')");
  await db.query("INSERT INTO test_cases(id,app_type_id,title,display_id,requirement_id) VALUES ('g-tc-1','g-app','Refund is issued','TC-1','g-story-12')");
  await db.query(`INSERT INTO feedback(id,project_id,user_id,title,message,display_id,linked_test_case_ids,linked_requirement_ids)
    VALUES ('g-bug-1','gp','g-user','Refund fails','Refund fails for expired cards','BUG-1','["g-tc-1"]'::jsonb,'[]'::jsonb)`);

  await t.test("ingestion queue rotates fairly between projects before serving a second job", async () => {
    await db.query(`INSERT INTO ai_knowledge_ingestion_jobs(id,project_id,status,created_by,created_at) VALUES
      ('g-fair-a1','gp','queued','g-user',CURRENT_TIMESTAMP-INTERVAL '3 seconds'),
      ('g-fair-a2','gp','queued','g-user',CURRENT_TIMESTAMP-INTERVAL '2 seconds'),
      ('g-fair-b1','gp-fair','queued','g-user',CURRENT_TIMESTAMP-INTERVAL '1 second')`);
    const claim=()=>rag._internals.claimQueuedIngestion('fairness-test',20);
    const first=await claim(),second=await claim(),third=await claim();
    assert.deepEqual([first.project_id,second.project_id,third.project_id],['gp','gp-fair','gp']);
    await db.query("UPDATE ai_knowledge_ingestion_jobs SET status='completed',completed_at=CURRENT_TIMESTAMP WHERE id IN ('g-fair-a1','g-fair-a2','g-fair-b1')");
  });

  const sources = new Map();
  let revisions = 0;
  // Ingest through the real persistence path; `serialized` comes from the real serializers.
  const ingest = async ({ id, kind, refId, serialized, requiredPermission, content, title, appTypeId = null }) => {
    const revision = `rev-${++revisions}`;
    const existing = await db.prepare("SELECT id FROM ai_knowledge_sources WHERE id = ?").get(id);
    const metadata = { ...(serialized?.metadata || {}),
      ...(["test_case", "execution"].includes(kind) ? { context_permission_profile: authorization.APPLICATION_CONTEXT_PROFILE } : {}) };
    if (!existing) {
      await db.prepare(`INSERT INTO ai_knowledge_sources(id,project_id,source_kind,source_ref_id,title,extraction_status,required_permission,revision_token,metadata,app_type_id)
        VALUES (?,?,?,?,?,'processing',?,?,?,?)`).run(id, project, kind, refId, title || serialized.title, requiredPermission, revision, metadata, appTypeId);
      await db.prepare(`INSERT INTO ai_knowledge_security_bindings(id,project_id,source_id,principal_type,principal_id,effect,inherited)
        VALUES (?,?,?,'PROJECT',?,'ALLOW',TRUE)`).run(`${id}:project-read`, project, id, project);
    } else {
      await db.prepare("UPDATE ai_knowledge_sources SET revision_token = ?, extraction_status = 'processing', metadata = ? WHERE id = ?").run(revision, metadata, id);
    }
    const source = { id, project_id: project, title: title || serialized.title, source_kind: kind, source_ref_id: refId, revision_token: revision,
      metadata, required_permission: requiredPermission, app_type_id: appTypeId };
    sources.set(id, source);
    return rag._internals.persistDocument({ projectId: project, content: content ?? serialized.content, embeddingRuntime: { configured: false }, source });
  };
  const edgesOf = (type) => db.prepare(`SELECT edges.*, ARRAY(SELECT evidence.span_start || '-' || evidence.span_end FROM ai_knowledge_graph_edge_evidence evidence WHERE evidence.edge_id = edges.id) AS spans
    FROM ai_knowledge_graph_edges edges WHERE edges.project_id = ? AND edges.relation_type = ? ORDER BY edges.id`).all(project, type);

  await t.test("the ontology migration adds MENTIONS to existing databases exactly once", async () => {
    const applied = await db.prepare("SELECT id FROM knowledge_schema_migrations WHERE id LIKE 'ontology-constraints-%'").all();
    assert.deepEqual(applied.map((row) => row.id), [`ontology-constraints-${ontology.ontologyVersion()}`]);
    await require("../../../platform/backend/src/db/bootstrap").reapplyRuntimeSchema();
    assert.equal((await db.prepare("SELECT COUNT(*)::INT AS n FROM knowledge_schema_migrations WHERE id LIKE 'ontology-constraints-%'").get()).n, 1, "re-applying the schema does not repeat the migration");
    const constraint = await db.prepare("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'ai_knowledge_graph_edges_relation_type_check'").get();
    assert.match(constraint.definition, /MENTIONS/);
  });

  // The test case references a story that is not indexed yet.
  const tcRow = await db.prepare("SELECT * FROM test_cases WHERE id = 'g-tc-1'").get();
  const tcSerialized = await rag._internals.serializeTestCase(tcRow);
  await ingest({ id: "src-tc-1", kind: "test_case", refId: "g-tc-1", serialized: tcSerialized, requiredPermission: "testcase.view", appTypeId: "g-app" });

  await t.test("a link to a record that is not indexed yet is recorded, backed off exponentially and not retried every minute", async () => {
    const refs = await db.prepare("SELECT target_kind, target_ref, reason FROM ai_knowledge_graph_unresolved_refs WHERE project_id = ?").all(project);
    assert.deepEqual(refs, [{ target_kind: "requirement", target_ref: "g-story-12", reason: "target_not_indexed" }]);
    const state = () => db.prepare("SELECT unresolved_count, attempt_count, EXTRACT(EPOCH FROM (next_attempt_at - CURRENT_TIMESTAMP))::INT AS seconds FROM ai_knowledge_graph_projection_states WHERE document_id = (SELECT id FROM ai_knowledge_documents WHERE source_id = 'src-tc-1' AND is_active)").get();
    const first = await state();
    assert.equal(first.unresolved_count, 1);
    assert.equal(first.attempt_count, 0);
    assert.ok(first.seconds > 30 && first.seconds <= 60, `first retry in about a minute, got ${first.seconds}s`);
    // Each pass that is still unresolved doubles the wait.
    for (const [attempt, expected] of [[1, 120], [2, 240], [3, 480]]) {
      await db.query("UPDATE ai_knowledge_graph_projection_states SET next_attempt_at = CURRENT_TIMESTAMP - INTERVAL '1 second'");
      assert.equal((await graph.processBackfill({ limit: 5 })).processed, 1);
      const next = await state();
      assert.equal(next.attempt_count, attempt);
      assert.ok(next.seconds > expected - 30 && next.seconds <= expected, `attempt ${attempt}: expected ~${expected}s, got ${next.seconds}s`);
    }
    await db.query("UPDATE ai_knowledge_graph_projection_states SET next_attempt_at = CURRENT_TIMESTAMP + INTERVAL '10 minutes'");
    assert.equal((await graph.processBackfill({ limit: 5 })).processed, 0, "nothing is retried before its backoff expires");
  });

  // The story arrives: it links to the test case.
  const storyRow = await db.prepare("SELECT * FROM requirements WHERE id = 'g-story-12'").get();
  const storySerialized = rag._internals.serializeRequirement(storyRow, ["g-tc-1"]);
  await ingest({ id: "src-story-12", kind: "requirement", refId: "g-story-12", serialized: storySerialized, requiredPermission: "requirement.view" });

  await t.test("the arrival of the missing record re-queues the waiting document immediately and connects both ends", async () => {
    const state = await db.prepare("SELECT attempt_count, next_attempt_at <= CURRENT_TIMESTAMP AS due FROM ai_knowledge_graph_projection_states WHERE document_id = (SELECT id FROM ai_knowledge_documents WHERE source_id = 'src-tc-1' AND is_active)").get();
    assert.equal(state.due, true, "no waiting for a 10 minute backoff");
    assert.equal(state.attempt_count, 0, "and the backoff restarts from the beginning");
    assert.equal((await graph.processBackfill({ limit: 5 })).processed, 1);
    assert.equal((await db.prepare("SELECT COUNT(*)::INT AS n FROM ai_knowledge_graph_unresolved_refs WHERE project_id = ?").get(project)).n, 0);
    const tests = await edgesOf("TESTS");
    assert.equal(tests.length, 1, "story and test case are linked exactly once, from either side");
    assert.equal(tests[0].source_node_id, "src-tc-1");
    assert.equal(tests[0].target_node_id, "src-story-12");
    assert.equal(tests[0].provenance_type, "DETERMINISTIC");
  });

  await t.test("display IDs resolve typed seeds and exact queries, and are written as aliases", async () => {
    const alias = await db.prepare("SELECT aliases FROM ai_knowledge_graph_nodes WHERE id = 'src-story-12'").get();
    assert.deepEqual(alias.aliases, ["STORY-12"]);
    const typed = await graph.resolve({ projectId: project, user: full, identifiers: [{ kind: "requirement", ref_id: "story-12" }] });
    assert.deepEqual(typed.nodes.map((node) => node.id), ["src-story-12"]);
    const byQuery = await graph.resolve({ projectId: project, user: full, query: "STORY-12" });
    assert.deepEqual(byQuery.nodes.map((node) => node.id), ["src-story-12"]);
    const lower = await graph.resolve({ projectId: project, user: full, query: "tc-1" });
    assert.deepEqual(lower.nodes.map((node) => node.id), ["src-tc-1"]);
    const wrongKind = await graph.resolve({ projectId: project, user: full, identifiers: [{ kind: "bug", ref_id: "STORY-12" }] });
    assert.deepEqual(wrongKind.nodes, [], "a display ID never resolves to a record of another kind");
  });

  await t.test("a curated alias survives re-projection alongside the display ID", async () => {
    await db.query(`UPDATE ai_knowledge_graph_nodes SET aliases = '["Refund epic"]'::jsonb WHERE id = 'src-story-12'`);
    await ingest({ id: "src-story-12", kind: "requirement", refId: "g-story-12", serialized: storySerialized, requiredPermission: "requirement.view" });
    const alias = await db.prepare("SELECT aliases FROM ai_knowledge_graph_nodes WHERE id = 'src-story-12'").get();
    assert.deepEqual([...alias.aliases].sort(), ["Refund epic", "STORY-12"]);
  });

  await t.test("the batched adjacency query applies source permissions before fanout", async () => {
    const both = await graph.expand({ projectId: project, user: full, seeds: [{ kind: "requirement", ref_id: "STORY-12" }], hops: 1 });
    assert.deepEqual(both.nodes.map((node) => node.id).sort(), ["src-story-12", "src-tc-1"]);
    assert.equal(both.edges.length, 1);
    assert.equal(both.stats.frontier_queries, 1);
    // Without requirement.view the story is invisible: neither seed nor edge leaks.
    const hidden = await graph.expand({ projectId: project, user: limited, seeds: ["src-story-12"], hops: 1 });
    assert.deepEqual(hidden.nodes, []);
    assert.deepEqual(hidden.edges, []);
    assert.ok(!JSON.stringify(hidden).includes("Checkout refunds"), "the hidden story's title never appears");
    const fromCase = await graph.expand({ projectId: project, user: limited, seeds: ["src-tc-1"], hops: 1 });
    assert.deepEqual(fromCase.edges, [], "an edge to a source the caller cannot see is not returned from the visible side either");
    assert.deepEqual(fromCase.nodes.map((node) => node.id), ["src-tc-1"]);
  });

  await t.test("an explicit DENY binding hides a source from the batched walk without consuming fanout", async () => {
    await db.query(`INSERT INTO ai_knowledge_security_bindings(id,project_id,source_id,principal_type,principal_id,effect,inherited)
      VALUES ('g-deny','gp','src-tc-1','USER','g-user','DENY',FALSE)`);
    try {
      const result = await graph.expand({ projectId: project, user: full, seeds: ["src-story-12"], hops: 1 });
      assert.deepEqual(result.edges, []);
      assert.deepEqual(result.nodes.map((node) => node.id), ["src-story-12"]);
    } finally { await db.query("DELETE FROM ai_knowledge_security_bindings WHERE id = 'g-deny'"); }
  });

  // A defect linked to the test case, then trace story -> defect (two hops).
  const bugRow = await db.prepare("SELECT * FROM feedback WHERE id = 'g-bug-1'").get();
  await ingest({ id: "src-bug-1", kind: "bug", refId: "g-bug-1", serialized: rag._internals.serializeBug(bugRow), requiredPermission: "feedback.view" });
  await graph.processBackfill({ limit: 10 });

  await t.test("trace walks from both ends and meets in the middle on real SQL", async () => {
    const result = await graph.trace({ projectId: project, user: full, source: { kind: "requirement", ref_id: "STORY-12" },
      target: { kind: "bug", ref_id: "BUG-1" }, hops: 2, maxPaths: 2, maxBytes: 8000 });
    assert.equal(result.budget.truncated, false, "real citations carry several hashes each; two fit the maximum budget");
    assert.equal(result.stats.trace, "bidirectional");
    assert.equal(result.stats.forward_hops, 1);
    assert.equal(result.stats.backward_hops, 1);
    assert.equal(result.paths.length, 1, JSON.stringify(result.limitations));
    assert.deepEqual(result.paths[0].nodes, ["src-story-12", "src-tc-1", "src-bug-1"]);
    assert.equal(result.paths[0].edges.length, 2);
    assert.ok(result.paths[0].evidence_ids.length >= 2);
    const tooShort = await graph.trace({ projectId: project, user: full, source: { kind: "requirement", ref_id: "STORY-12" },
      target: { kind: "bug", ref_id: "BUG-1" }, hops: 1, maxBytes: 8000 });
    assert.equal(tooShort.paths.length, 0);
    assert.match(tooShort.limitations.gaps.join(" "), /within the requested bounds/);
  });

  await t.test("preferred relation types survive a tight fanout cap", async () => {
    const access = { projectId: project, user: full, kinds: [...ontology.NODE_KINDS], permissions: ["knowledge.view", ...permissionsFull] };
    const work = { run: (task) => task(), signal: undefined, remaining: () => 5000 };
    const ranked = async (preferRelations) => graph._internals.adjacent(JSON.stringify(["src-tc-1"]),
      { direction: "both", relationTypes: [], fanout: 1, preferRelations }, access, work);
    const withDefect = await ranked(["HAS_DEFECT"]);
    assert.equal(withDefect.length, 1, "the fanout window caps each anchor at one edge");
    assert.equal(withDefect[0].relation_type, "HAS_DEFECT");
    const withTests = await ranked(["TESTS"]);
    assert.equal(withTests[0].relation_type, "TESTS");
    assert.equal(withTests[0].anchor_id, "src-tc-1");
    assert.ok(!("search_vector" in withTests[0]), "the witness text-search vector is not shipped to the caller");
  });

  await t.test("each direction expands on its own, and a trace is valid in whichever direction it is asked", async () => {
    const access = { projectId: project, user: full, kinds: [...ontology.NODE_KINDS], permissions: ["knowledge.view", ...permissionsFull] };
    const work = { run: (task) => task(), signal: undefined, remaining: () => 5000 };
    const rows = async (node, direction) => graph._internals.adjacent(JSON.stringify([node]), { direction, relationTypes: [], fanout: 12, preferRelations: [] }, access, work);
    let leavingSeen = 0, arrivingSeen = 0;
    const seedFor = { both: "src-tc-1" };
    for (const node of ["src-story-12", "src-tc-1", "src-bug-1"]) {
      const touching = await db.prepare(`SELECT id, source_node_id, target_node_id FROM ai_knowledge_graph_edges WHERE project_id = ? AND status = 'ACTIVE'
        AND (source_node_id = ? OR target_node_id = ?) ORDER BY id`).all(project, node, node);
      const leaving = touching.filter((edge) => edge.source_node_id === node).map((edge) => edge.id).sort();
      const arriving = touching.filter((edge) => edge.target_node_id === node).map((edge) => edge.id).sort();
      leavingSeen += leaving.length; arrivingSeen += arriving.length;
      if (leaving.length) seedFor.outbound ??= node;
      if (arriving.length) seedFor.inbound ??= node;
      assert.deepEqual((await rows(node, "outbound")).map((row) => row.id).sort(), leaving, `${node} outbound`);
      assert.deepEqual((await rows(node, "inbound")).map((row) => row.id).sort(), arriving, `${node} inbound`);
      assert.deepEqual((await rows(node, "both")).map((row) => row.id).sort(), [...leaving, ...arriving].sort(), `${node} both`);
      assert.ok((await rows(node, "inbound")).every((row) => row.anchor_id === node), "every row names the frontier node it was found from");
    }
    assert.ok(leavingSeen > 0 && arrivingSeen > 0, "the fixture exercises edges leaving and arriving, so both single-direction queries return rows");

    // The public calls accept every direction. A trace walks the far end in the opposite direction, so an
    // outbound or inbound trace uses a single-direction half on each side.
    for (const direction of ["outbound", "inbound", "both"]) {
      const expanded = await graph.expand({ projectId: project, user: full, seeds: [seedFor[direction]], hops: 1, direction, maxBytes: 8000 });
      assert.ok(expanded.edges.length > 0, `${direction} expand from ${seedFor[direction]} finds edges`);
      const traced = await graph.trace({ projectId: project, user: full, source: { kind: "requirement", ref_id: "STORY-12" },
        target: { kind: "bug", ref_id: "BUG-1" }, hops: 2, direction, maxBytes: 8000 });
      assert.ok(Array.isArray(traced.paths), `${direction} trace completes without a query error`);
    }
    const forward = await graph.trace({ projectId: project, user: full, source: { kind: "requirement", ref_id: "STORY-12" },
      target: { kind: "bug", ref_id: "BUG-1" }, hops: 2, direction: "both", maxBytes: 8000 });
    const reverse = await graph.trace({ projectId: project, user: full, source: { kind: "bug", ref_id: "BUG-1" },
      target: { kind: "requirement", ref_id: "STORY-12" }, hops: 2, direction: "both", maxBytes: 8000 });
    assert.deepEqual(reverse.paths.map((path) => [...path.nodes].reverse()), forward.paths.map((path) => path.nodes), "the same path, read from the other end");
  });

  await t.test("free-form text that quotes an exact display ID gets a weaker, witnessed MENTIONS edge", async () => {
    const notes = "Release notes\n\nWe fixed the refund flow for STORY-12 (verified by tc-1). The partner ticket UNKNOWN-99 is unrelated.";
    await ingest({ id: "src-notes", kind: "text", refId: null, content: notes, title: "Release notes", requiredPermission: null,
      serialized: { metadata: {}, title: "Release notes" } });
    const mentions = await edgesOf("MENTIONS");
    assert.deepEqual(mentions.map((edge) => [edge.source_node_id, edge.target_node_id, edge.provenance_type]).sort(),
      [["src-notes", "src-story-12", "SOURCE_EXPLICIT"], ["src-notes", "src-tc-1", "SOURCE_EXPLICIT"]]);
    assert.ok(mentions.every((edge) => edge.status === "ACTIVE" && edge.metadata.generator === "knowledge-mentions"));
    assert.ok(mentions.every((edge) => edge.spans.length === 1));
    assert.equal((await db.prepare("SELECT COUNT(*)::INT AS n FROM ai_knowledge_graph_nodes WHERE entity_key = 'UNKNOWN-99'").get()).n, 0, "an unmatched identifier creates nothing");
    assert.equal((await edgesOf("TESTS")).length, 1, "a mention never creates a verified TESTS link");
    const walked = await graph.expand({ projectId: project, user: full, seeds: ["src-notes"], hops: 1, maxBytes: 8000 });
    assert.equal(walked.budget.truncated, false);
    assert.deepEqual(walked.edges.map((edge) => edge.type).sort(), ["MENTIONS", "MENTIONS"]);
    assert.ok(walked.edges.every((edge) => edge.provenance_type === "SOURCE_EXPLICIT"));
  });

  await t.test("removing the mention in a new revision closes the edge, and a record indexed later is picked up", async () => {
    await db.query(`INSERT INTO requirements(id,project_id,title,display_id) VALUES ('g-story-20','gp','Late story','STORY-20')`);
    await ingest({ id: "src-notes", kind: "text", refId: null, content: "Release notes\n\nOnly STORY-12 is mentioned now, and STORY-20 is coming.", title: "Release notes",
      requiredPermission: null, serialized: { metadata: {}, title: "Release notes" } });
    const afterEdit = await edgesOf("MENTIONS");
    const active = afterEdit.filter((edge) => edge.status === "ACTIVE").map((edge) => edge.target_node_id);
    assert.deepEqual(active, ["src-story-12"]);
    assert.equal(afterEdit.find((edge) => edge.target_node_id === "src-tc-1").status, "TOMBSTONED", "the dropped mention is closed, not deleted");
    // STORY-20 is indexed afterwards: the document that mentions it is re-projected.
    const lateRow = await db.prepare("SELECT * FROM requirements WHERE id = 'g-story-20'").get();
    await ingest({ id: "src-story-20", kind: "requirement", refId: "g-story-20", serialized: rag._internals.serializeRequirement(lateRow, []), requiredPermission: "requirement.view" });
    assert.equal((await graph.processBackfill({ limit: 10 })).processed >= 1, true);
    const final = (await edgesOf("MENTIONS")).filter((edge) => edge.status === "ACTIVE").map((edge) => edge.target_node_id).sort();
    assert.deepEqual(final, ["src-story-12", "src-story-20"]);
  });

  await t.test("a question that names an entity starts the graph walk there and returns the neighbours' content, not only the link proof", async () => {
    // No search hits at all: the walk must not depend on whichever passages ranked.
    const response = await rag.expandRelationships({ projectId: project, user: full, hits: [], query: "What verifies STORY-12 and what has failed?", limit: 6, timeoutMs: 5000 });
    assert.equal(response.retrieval.anchored_seed_count, 1, "STORY-12 resolved from the question");
    const neighbour = response.results.find((item) => item.graph_neighbour && item.source_id === "src-tc-1");
    assert.ok(neighbour, JSON.stringify(response.results.map((item) => [item.source_id, item.graph_neighbour])));
    assert.match(neighbour.content, /Refund is issued/, "the neighbour's own text, not just the line that proves the edge");
    assert.equal(neighbour.relationship_context.relation_type, "TESTS");
    assert.ok(neighbour.citation.id.startsWith("K-") && neighbour.citation.version_hash && neighbour.citation.chunk_hash, "a complete, verifiable citation");
    assert.ok(response.relationships.some((edge) => edge.relationship_type === "TESTS"));
    assert.equal(response.retrieval.neighbour_passage_count >= 1, true);
    const witnesses = response.results.filter((item) => !item.graph_neighbour);
    assert.ok(witnesses.length >= 1, "the proof of each edge is still returned");
  });

  await t.test("neighbour content obeys source access: a caller who cannot see the story or the case gets nothing", async () => {
    const hidden = await rag.expandRelationships({ projectId: project, user: limited, hits: [], query: "What verifies STORY-12?", limit: 6, timeoutMs: 5000 });
    assert.deepEqual(hidden.results, [], "the limited user cannot resolve STORY-12, so there is nothing to anchor on");
    await db.query(`INSERT INTO ai_knowledge_security_bindings(id,project_id,source_id,principal_type,principal_id,effect,inherited)
      VALUES ('g-deny-neighbour','gp','src-tc-1','USER','g-user','DENY',FALSE)`);
    try {
      const denied = await rag.expandRelationships({ projectId: project, user: full, hits: [], query: "What verifies STORY-12?", limit: 6, timeoutMs: 5000 });
      assert.ok(!JSON.stringify(denied).includes("Refund is issued"), "a denied neighbour's text is never returned");
      assert.ok(!denied.results.some((item) => item.source_id === "src-tc-1"));
    } finally { await db.query("DELETE FROM ai_knowledge_security_bindings WHERE id = 'g-deny-neighbour'"); }
  });

  await t.test("identifiers that match nothing or several records anchor nothing instead of guessing", async () => {
    const none = await rag.expandRelationships({ projectId: project, user: full, hits: [], query: "What about STORY-9999?", limit: 6, timeoutMs: 5000 });
    assert.deepEqual(none.results, []);
    assert.equal(rag._internals.relationPreferenceForQuestion("Which test cases cover this story?")[0], "TESTS");
    assert.deepEqual(rag._internals.relationPreferenceForQuestion("What is the weather"), []);
    assert.ok(rag._internals.relationPreferenceForQuestion("failing runs").includes("EXECUTED_IN"));
  });

  await t.test("context evidence is partitioned, authorization is fresh, and de-identified health joins observed citations", async () => {
    const contextGraph=require('../../backend/services/knowledgeContextGraph.service');
    const expanded=await graph.expand({projectId:project,user:full,seeds:['src-story-12'],hops:1,maxBytes:8000});
    const relationship=expanded.edges[0],proof=expanded.evidence.find(item=>relationship.evidence_ids.includes(item.citation.id));
    assert.ok(relationship&&proof,'the trace fixture has a current, witnessed relationship and exact proof');
    const actorIds=[full.id,...Array.from({length:4},(_,index)=>`g-health-${index}`)];
    for(const actorId of actorIds.slice(1)){
      await db.prepare("INSERT INTO users(id,email,password_hash,name,default_role_id) VALUES (?,?,?,'Health reviewer','g-role')").run(actorId,`${actorId}@example.test`,'x');
      await db.prepare("INSERT INTO project_members(id,project_id,user_id,role_id) VALUES (?,?,?,'g-role')").run(`${actorId}-membership`,project,actorId);
    }
    const receipts=[];
    for(const [index,actorId] of actorIds.entries()){
      const packet={project_id:project,context_packet_id:`health-packet-${index}`,query:{original:`PRIVATE_HEALTH_QUESTION_${index}`},
        interpreted_request:{query_category:'project_analysis',input_type:'story_delivery'},
        authorization:{project_scope_enforced:true,source_acl_enforced:true},limitations:{retrieval_status:'COMPLETE'},
        evidence:[{evidence_id:proof.citation.id,source_id:proof.source_id,source_kind:proof.source_kind,source_ref_id:proof.source_ref_id,
          document_id:proof.document_id,chunk_id:proof.chunk_id,source_version:proof.source_version,
          integrity:{version_hash:proof.citation.version_hash,source_hash:proof.citation.source_hash,chunk_hash:proof.citation.chunk_hash},freshness:{status:'CURRENT'}}],
        relationships:[{knowledge_edge_id:relationship.id,source:relationship.source,target:relationship.target,type:relationship.type,evidence_ids:[proof.citation.id]}]};
      const receipt=await contextGraph.recordContext({projectId:project,user:{id:actorId},packet,featureId:'ai.knowledge.assistant',sessionId:'health-session'});
      assert.equal(receipt.status,'recorded');receipts.push({actorId,receipt,packet});
      await contextGraph.recordDecision({projectId:project,user:{id:actorId},contextTraceId:receipt.trace_id,event:{id:`submitted-${index}`,type:'CONTEXT_SENT',status:'submitted',metadata:{evidence_ids:[proof.citation.id]}}});
      await contextGraph.recordDecision({projectId:project,user:{id:actorId},contextTraceId:receipt.trace_id,event:{id:`cited-${index}`,type:'CITATIONS_RECORDED',status:'recorded',metadata:{evidence_ids:[proof.citation.id]}}});
    }
    const trace=await contextGraph.explore({projectId:project,user:full,traceId:receipts[0].receipt.trace_id});
    assert.equal(trace.stats.knowledge_relationship_count,1);assert.equal(trace.stats.submitted_evidence_count,1);assert.equal(trace.stats.cited_evidence_count,1);
    assert.ok(trace.nodes.some(node=>node.kind==='knowledge_graph_edge'&&node.metadata.knowledge_edge_id===relationship.id));
    const health=await contextGraph.health({projectId:project,user:full,days:30});
    assert.equal(health.observations.cohort_available,true);assert.ok(health.query_classes.some(item=>item.query_class==='project_analysis'&&item.trace_count===5));
    assert.ok(health.sources.some(item=>item.source_id===proof.source_id&&item.trace_count===5));
    assert.equal(health.observations.cited_evidence_count,5);assert.equal(health.observations.citation_observation_rate,1);
    assert.doesNotMatch(JSON.stringify(health),/g-health-|PRIVATE_HEALTH_QUESTION|health-packet|K-/);
    const directory=await db.prepare('SELECT evidence_refs,coverage,selection,query_hash FROM ai_context_graph_traces WHERE id=?').get(receipts[0].receipt.trace_id);
    assert.deepEqual(directory.evidence_refs,[]);assert.deepEqual(directory.coverage,{});assert.deepEqual(directory.selection,{});assert.equal(directory.query_hash,null);
    assert.equal((await db.prepare('SELECT COUNT(*)::INT AS n FROM ai_context_graph_trace_payloads WHERE trace_id=?').get(receipts[0].receipt.trace_id)).n,1);
    assert.ok((await contextGraph.maintainPartitions({monthsAhead:24})).months_ensured>=24);
    const second=await contextGraph.list({projectId:project,user:full,limit:20});assert.ok(second.items.some(item=>item.trace_id===receipts[0].receipt.trace_id));
  });

  await t.test("context trace retention enforces TTL and owner/project quotas with aggregate-only audit", async () => {
    const contextGraph=require('../../backend/services/knowledgeContextGraph.service');
    await db.prepare("INSERT INTO projects(id,name,visibility,created_by) VALUES ('gp-retention','Retention fixture','private','g-user')").run();
    for(const actorId of [full.id,limited.id])for(let index=0;index<4;index++){
      await db.prepare(`INSERT INTO ai_context_graph_traces(id,project_id,actor_id,feature_id,context_packet_id,selection_hash,recorded_at,expires_at)
        VALUES (?,?,?,'mcp.context',?,?,CURRENT_TIMESTAMP-(?::INT * INTERVAL '1 minute'),CURRENT_TIMESTAMP+INTERVAL '30 days')`)
        .run(`retention-${actorId}-${index}`,'gp-retention',actorId,`retention-packet-${actorId}-${index}`,'a'.repeat(64),index);
    }
    await db.prepare(`INSERT INTO ai_context_graph_traces(id,project_id,actor_id,feature_id,context_packet_id,selection_hash,recorded_at,expires_at)
      VALUES ('retention-expired','gp-retention','g-user','mcp.context','retention-expired-packet',?,CURRENT_TIMESTAMP-INTERVAL '1 year',CURRENT_TIMESTAMP-INTERVAL '1 day')`)
      .run('b'.repeat(64));
    const receipt=await contextGraph.purgeExpired({limit:20,ownerQuota:2,projectQuota:3});
    assert.ok(receipt.deleted>=6,'one bounded batch also services any older over-quota projects in the fixture database');
    assert.equal((await db.prepare("SELECT COUNT(*)::INT AS n FROM ai_context_graph_traces WHERE project_id='gp-retention'").get()).n,3);
    const audit=await db.prepare("SELECT reason,deleted_count FROM ai_context_graph_retention_audit WHERE project_id='gp-retention' ORDER BY reason").all();
    assert.deepEqual(audit,[{reason:'owner_quota',deleted_count:'4'},{reason:'project_quota',deleted_count:'1'},{reason:'ttl',deleted_count:'1'}]);
    assert.deepEqual((await db.prepare(`SELECT column_name FROM information_schema.columns WHERE table_name='ai_context_graph_retention_audit' ORDER BY ordinal_position`).all()).map(row=>row.column_name),
      ['project_id','purged_on','reason','deleted_count','updated_at']);
  });
});
