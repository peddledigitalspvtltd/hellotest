const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const db = require("@hellotest/platform/backend/src/db");
const rag = require("../../backend/services/knowledgeRag.service");
const ontology = require("../../backend/services/knowledgeOntology");
const contracts = require("../../backend/services/knowledgeGraphContracts");
const projection = require("../../backend/services/knowledgeGraphProjection.service");
const { LINK_FIELDS, LINK_LABELS, SPECIAL_LINK_LABELS, linkLine } = require("../../backend/services/knowledgeLinkLabels");
const { fixture, node } = require("./graphFixture");

const request = { projectId: "project", user: { id: "actor" }, seeds: ["source-A"], maxTokens: 8000 };

// --- Link labels (the projection no longer re-parses private string literals) ---

test("every link the projection looks for is written by the real serializers under the shared labels", async (t) => {
  t.mock.method(db, "prepare", () => ({ all: async () => [] }));
  const story = rag._internals.serializeRequirement({ id: "req-1", title: "Story", display_id: "STORY-1" }, ["tc-1", "tc-2"]);
  const testCase = await rag._internals.serializeTestCase({ id: "tc-1", title: "Case", display_id: "TC-1", requirement_id: "req-1" });
  const bug = rag._internals.serializeBug({ id: "bug-1", title: "Defect", display_id: "BUG-1", linked_test_run_id: "run-1",
    linked_requirement_ids: ["req-1"], linked_test_case_ids: ["tc-1"] });
  for (const serialized of [story, testCase, bug]) {
    const references = projection.extractReferences({ source_kind: serialized.source_kind, metadata: serialized.metadata });
    assert.ok(references.length > 0, `${serialized.source_kind} declares links`);
    for (const reference of references) {
      const proof = projection.proofFor([{ id: "chunk", content: serialized.content }], reference);
      assert.ok(proof, `${serialized.source_kind}: "${reference.marker}: ${reference.ref_id}" must be witnessed in the serialized text`);
    }
  }
});

test("every label in the shared table is exercised, and serializers hold no private copies of them", () => {
  const declared = new Set(Object.values(LINK_FIELDS).flat().map((spec) => spec.label));
  assert.deepEqual([...declared, ...SPECIAL_LINK_LABELS].sort(), Object.values(LINK_LABELS).sort(), "the table and its special witnessed-link labels agree");
  const source = fs.readFileSync(path.resolve(__dirname, "../../backend/services/knowledgeRag.service.js"), "utf8");
  for (const label of Object.values(LINK_LABELS)) {
    assert.ok(!source.includes(`${label}:`), `knowledgeRag.service.js must use LINK_LABELS, not the literal "${label}:"`);
  }
  assert.equal(linkLine(LINK_LABELS.linkedTestCaseIds, "tc-9"), "Linked Test Case IDs: tc-9");
});

test("a renamed serializer label is reported as an explicit witness gap, not as a missing target", () => {
  const [reference] = projection.extractReferences({ source_kind: "requirement", metadata: { linked_test_case_ids: ["tc-1"] } });
  assert.ok(projection.proofFor([{ id: "c", content: "Linked Tests: tc-1" }], reference) === null,
    "the projection cannot find a witness under a drifted label");
});

// --- Ontology ---------------------------------------------------------------

test("the ontology is defined once and the graph contracts are derived from it", () => {
  assert.equal(contracts.KINDS, ontology.NODE_KINDS);
  assert.equal(contracts.RELATIONS, ontology.RELATION_TYPES);
  assert.equal(contracts.PERMISSIONS, ontology.PERMISSION_BY_KIND);
  assert.ok(ontology.RELATION_TYPES.includes("MENTIONS"));
  for (const type of ontology.RELATION_TYPES) assert.ok(ontology.RELATION_DEFINITIONS[type], `${type} has a definition`);
  assert.deepEqual(Object.keys(ontology.RELATION_DEFINITIONS).sort(), [...ontology.RELATION_TYPES].sort());
  assert.ok(!ontology.TRUSTED_PROVENANCE.includes("LLM_CANDIDATE"), "an LLM candidate never establishes a fact");
});

test("graph schema constraints are generated from the ontology and migrated once per ontology version", () => {
  const { statements } = require("../../backend/graphSchema");
  const nodes = statements.find((statement) => statement.includes("CREATE TABLE IF NOT EXISTS ai_knowledge_graph_nodes"));
  const edges = statements.find((statement) => statement.includes("CREATE TABLE IF NOT EXISTS ai_knowledge_graph_edges"));
  for (const kind of ontology.NODE_KINDS) assert.ok(nodes.includes(`'${kind}'`), `node kind ${kind} is allowed`);
  for (const type of ontology.RELATION_TYPES) assert.ok(edges.includes(`'${type}'`), `relation ${type} is allowed`);
  const migration = ontology.constraintMigrationStatements().join("\n");
  assert.match(migration, new RegExp(`ontology-constraints-${ontology.ontologyVersion()}`));
  assert.match(migration, /IF NOT EXISTS \(SELECT 1 FROM knowledge_schema_migrations/, "applied at most once, not on every start");
  assert.match(statements.at(-1), /knowledge_schema_migrations|DO \$migration\$/, "the migration runs after the tables exist");
});

test("relation types implied by endpoint kinds are preferred, never exclusive", () => {
  const implied = ontology.impliedRelations("requirement", "bug");
  assert.ok(implied.includes("HAS_DEFECT") && implied.includes("TESTS"));
  assert.ok(implied.includes("RELATED_TO"), "generic relations always apply");
  assert.ok(!implied.includes("EXECUTED_IN"), "relations that cannot touch either endpoint are not preferred");
});

// --- Resolution -------------------------------------------------------------

test("display IDs resolve typed seeds and exact queries without waiting for a re-projection", async () => {
  const { graph, calls } = fixture();
  await graph.resolve({ projectId: "project", user: { id: "actor" }, identifiers: [{ kind: "requirement", ref_id: "story-12" }] });
  await graph.resolve({ projectId: "project", user: { id: "actor" }, query: "STORY-12" });
  const reads = calls.filter((call) => call.sql.includes("SELECT nodes.id"));
  assert.equal(reads.length, 2);
  for (const { sql } of reads) assert.match(sql, /UPPER\(COALESCE\(sources\.metadata->>'display_id',''\)\)=UPPER\(\?\)/);
  assert.ok(reads[0].args.filter((arg) => arg === "story-12").length >= 3, "typed seed matches key, id and display ID");
});

// --- Batched expansion and tracing -----------------------------------------

test("a whole hop is expanded by one query, and each node is expanded once", async () => {
  const links = [["source-A", "source-B"], ["source-A", "source-C"], ["source-B", "source-D"], ["source-C", "source-E"]];
  const ids = ["source-A", "source-B", "source-C", "source-D", "source-E"];
  const { graph, calls } = fixture({ ids, links });
  const result = await graph.expand({ ...request, hops: 2, fanout: 5 });
  const hopQueries = calls.filter((call) => call.sql.includes("JOIN LATERAL"));
  assert.equal(hopQueries.length, 2, "two hops, two queries, however wide the frontier");
  assert.deepEqual(JSON.parse(hopQueries[0].args[0]), ["source-A"]);
  assert.deepEqual(JSON.parse(hopQueries[1].args[0]).sort(), ["source-B", "source-C"], "the second hop expands both neighbours at once");
  assert.equal(result.stats.frontier_queries, 2);
  assert.equal(result.edges.length, 4);
  assert.equal(result.nodes.length, 5);
  assert.equal(result.budget.truncated, false);
});

test("a graph larger than its byte budget is reported as truncated, never silently clipped", async () => {
  const links = [["source-A", "source-B"], ["source-A", "source-C"], ["source-A", "source-D"], ["source-B", "source-E"], ["source-C", "source-F"], ["source-D", "source-G"]];
  const ids = ["source-A", "source-B", "source-C", "source-D", "source-E", "source-F", "source-G"];
  const { graph, calls } = fixture({ ids, links });
  const result = await graph.expand({ ...request, hops: 2, fanout: 5 });
  assert.equal(calls.filter((call) => call.sql.includes("JOIN LATERAL")).length, 2, "the walk itself still takes one query per hop");
  assert.equal(result.budget.truncated, true);
  assert.equal(result.limitations.budget_reached, true);
  assert.equal(result.limitations.partial, true);
  assert.ok(result.budget.omitted.edges > 0 && result.budget.estimated_bytes <= result.budget.max_bytes);
});

test("trace meets in the middle: each side walks half the depth", async () => {
  const { graph, calls } = fixture();
  const result = await graph.trace({ ...request, source: { kind: "text", ref_id: "native-source-A" }, target: { kind: "text", ref_id: "native-source-D" }, hops: 3, maxPaths: 2 });
  assert.equal(result.stats.trace, "bidirectional");
  assert.equal(result.stats.forward_hops, 2);
  assert.equal(result.stats.backward_hops, 1);
  assert.deepEqual(result.paths[0].nodes, ["source-A", "source-B", "source-C", "source-D"]);
  const frontiers = calls.filter((call) => call.sql.includes("JOIN LATERAL")).map((call) => JSON.parse(call.args[0]));
  assert.deepEqual(frontiers[0], ["source-A"], "the forward walk starts at the source");
  assert.ok(frontiers.some((frontier) => frontier.includes("source-D")), "the backward walk starts at the target");
});

test("tracing against the grain of edge direction finds the path from the other end", async () => {
  const { graph } = fixture();
  const forward = await graph.trace({ ...request, source: { kind: "text", ref_id: "native-source-A" }, target: { kind: "text", ref_id: "native-source-D" }, hops: 3, direction: "outbound" });
  assert.equal(forward.paths.length, 1);
  const against = await graph.trace({ ...request, source: { kind: "text", ref_id: "native-source-A" }, target: { kind: "text", ref_id: "native-source-D" }, hops: 3, direction: "inbound" });
  assert.equal(against.paths.length, 0, "no edge leads from D back to A, so an inbound trace from A finds nothing");
});

// --- Budget -----------------------------------------------------------------

test("the graph budget says it is measured in UTF-8 bytes and converts it for planning", async () => {
  const { graph } = fixture();
  const result = await graph.expand({ ...request, hops: 1, maxBytes: 4000 });
  const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  const budget = result.budget;
  assert.equal(budget.unit, "utf8_bytes");
  assert.equal(budget.max_bytes, 4000);
  assert.equal(budget.estimated_bytes, bytes);
  assert.equal(budget.approx_model_tokens, Math.ceil(bytes / 4));
  assert.equal(budget.estimated_tokens, budget.estimated_bytes, "legacy field carries the same byte count");
  assert.equal(contracts.describe().budget_unit, "utf8_bytes");
  assert.ok(bytes <= 4000);
});

// --- Projection helpers -----------------------------------------------------

test("exact display IDs in free-form text become bounded, witnessed mentions", () => {
  const found = projection.findMentions([
    { id: "c1", content: "See STORY-12 and TC-0045. Also story-12 again." },
    { id: "c2", content: "😀 STORY-12 is blocked by BUG-7." }
  ]);
  assert.deepEqual([...found.keys()].sort(), ["BUG-7", "STORY-12", "TC-0045"]);
  const story = found.get("STORY-12");
  assert.equal(story.length, 2, "one witness per chunk, so a repeated ID in one chunk is not repeated");
  assert.deepEqual([story[0].chunk.id, story[0].span_start, story[0].span_end], ["c1", 4, 12]);
  assert.equal(story[1].span_start, 2, "offsets are Unicode code points, not UTF-16 units: the emoji counts once");
});

test("unresolved links retry with exponential backoff up to a ceiling", () => {
  const delays = [0, 1, 2, 3, 4].map(projection.retryDelaySeconds);
  assert.deepEqual(delays, [60, 120, 240, 480, 960]);
  assert.equal(projection.retryDelaySeconds(50), projection.BACKOFF_CEILING_SECONDS, "never beyond the ceiling");
  assert.equal(projection.BACKOFF_CEILING_SECONDS, 6 * 3600);
  assert.equal(projection.retryDelaySeconds(-3), projection.BACKOFF_BASE_SECONDS);
});

test("trace and expansion reject unsupported relation types and keep MENTIONS in the vocabulary", async () => {
  const { graph } = fixture();
  await assert.rejects(graph.expand({ ...request, relationTypes: ["NOT_A_RELATION"] }), /supported/);
  const result = await graph.expand({ ...request, hops: 1, relationTypes: ["MENTIONS"] });
  assert.ok(Array.isArray(result.edges));
  assert.ok(contracts.describe().relation_types.includes("MENTIONS"));
  assert.ok(node("x").id === "x");
});
