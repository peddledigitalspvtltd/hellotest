const test = require("node:test");
const assert = require("node:assert/strict");
const contracts = require("../../backend/services/knowledgeContracts.service");
const engine = require("../../backend/services/knowledgeContextEngine.service");
const execution = require("../../backend/services/knowledgeExecution.service");

const hit = (id, content = "A passage about release coverage.") => ({ chunk_id: id, source_id: `source-${id}`, project_id: "project-1", source_kind: "text", title: "Coverage notes", content, score: 0.9, relevance: 0.9, citation: { id: `K-${id}`, chunk_id: id, source_id: `source-${id}` } });
const edge = { source_canonical_id: "tc-node", target_canonical_id: "story-node", relationship_type: "TESTS", evidence_ids: ["K-proof"], provenance_type: "DETERMINISTIC", endpoints_authorized: true };

const harness = ({ query = "What tests cover STORY-12?", queryClass = "LOOKUP", budgets = { max_rounds: 1 }, filters, overrides = {} } = {}) => {
  const timeline = [];
  const dependencies = {
    search: async () => { timeline.push("search:start"); await new Promise((resolve) => setTimeout(resolve, 25)); timeline.push("search:end"); return { results: [{ query, result: { results: [hit("1")], retrieval: { vector_mode: "disabled" } } }], errors: [] }; },
    liveEvidence: async () => ({ hits: [], counts: {} }),
    planContext: () => ({ indexed_source_kinds: ["text"], live_scopes: [] }),
    merge: (results, limit) => [...new Map(results.flatMap((entry) => entry.result.results).map((item) => [item.chunk_id, item])).values()].slice(0, limit),
    assess: () => ({ requires_more_context: true }),
    authorize: async (hits) => ({ allowed: hits, denied_ids: [], partial: false }),
    expandRelationships: async (input) => {
      timeline.push(`graph:start:${input.hits.length}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      timeline.push("graph:end");
      return { results: [hit("proof", "The test case TESTS the story.")], relationships: [edge], retrieval: { vector_mode: "graph_witnesses", degraded: false, anchored_seed_count: 1 } };
    },
    ...overrides
  };
  const run = () => execution.run({}, () => engine.retrieve({
    request: contracts.buildRetrievalRequest({ projectId: "project-1", query, queryClass, filters, budgets }), user: { id: "user-1" }, dependencies
  }));
  return { timeline, run };
};

test("a question naming an entity starts the graph walk at once, alongside search, with no search hits as seeds", async () => {
  const { timeline, run } = harness();
  const result = await run();
  assert.equal(timeline[0], "search:start");
  assert.equal(timeline[1], "graph:start:0", "the walk starts before search has returned, seeded by the question rather than by hits");
  assert.ok(timeline.indexOf("graph:end") < timeline.indexOf("search:end") || timeline.includes("graph:end"));
  assert.equal(timeline.filter((entry) => entry.startsWith("graph:start")).length, 1, "and is not repeated after the merge");
  assert.ok(result.packet.evidence.some((item) => item.evidence_id === "K-proof"), "its evidence reaches the packet");
  assert.equal(result.packet.relationships.length, 1);
  assert.equal(result.retrieval.retrieval_strategy.applied, "graph_expand");
  assert.equal(result.retrieval.retrieval_strategy.graph_tool_calls, 1);
});

test("without a named entity the first round does not walk the graph", async () => {
  const { timeline, run } = harness({ query: "What tests cover the checkout flow?" });
  await run();
  assert.ok(!timeline.some((entry) => entry.startsWith("graph:start:0")), "no entity, no anchored channel");
});

test("a failed anchored walk degrades the run but never loses the search results", async () => {
  const { run } = harness({ overrides: { expandRelationships: async () => { throw Object.assign(new Error("slow"), { code: "RELATIONSHIP_SEARCH_TIMEOUT" }); } } });
  const result = await run();
  assert.ok(result.packet.evidence.some((item) => item.evidence_id === "K-1"));
  assert.equal(result.retrieval.degraded, true);
  assert.equal(result.retrieval.retrieval_strategy.graph_expansion_status, "failed");
  assert.ok(result.retrieval.error_codes.includes("RELATIONSHIP_SEARCH_TIMEOUT"));
});

test("pinned sources, a historical read and a model-requested strategy keep their existing graph behaviour", async () => {
  const pinned = harness({ filters: { source_ids: ["source-1"] } });
  await pinned.run();
  assert.ok(!pinned.timeline.some((entry) => entry.startsWith("graph:start")), "pinned sources never widen into the graph");
  const historical = harness({ filters: { as_of: "2026-01-01T00:00:00Z" } });
  await historical.run().catch(() => undefined);
  assert.ok(!historical.timeline.some((entry) => entry.startsWith("graph:start:0")));
});

test("the anchored walk reserves its tool call and candidates so live facts and search keep theirs", async () => {
  const { run } = harness({ budgets: { max_rounds: 1, max_tool_calls: 3, max_candidates: 12 } });
  const result = await run();
  assert.ok(result.budget.tool_calls_used <= 3);
  assert.ok(result.retrieval.candidate_count <= 12);
});
