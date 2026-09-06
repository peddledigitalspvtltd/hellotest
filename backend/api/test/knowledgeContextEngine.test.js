const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const contracts = require("../src/services/knowledgeContracts.service");
const engine = require("../src/services/knowledgeContextEngine.service");
const execution = require("../src/services/knowledgeExecution.service");
const { streamKnowledge } = require("../src/utils/knowledgeStream");

const hit = (id, content = "The release requires a passing checkout test.") => ({ chunk_id: id, source_id: `source-${id}`, project_id: "project-1", source_kind: "text", title: "Release checklist", content, score: 0.9, citation: { id: `K-${id}`, chunk_id: id, source_id: `source-${id}` } });
const fixtures = (overrides = {}) => ({
  search: async () => ({ results: [{ query: "release", result: { results: [hit("1")], retrieval: { vector_mode: "disabled" } } }], errors: [] }),
  liveEvidence: async () => ({ hits: [], counts: {} }),
  planContext: () => ({ indexed_source_kinds: ["text"], live_scopes: [] }),
  merge: (results, limit) => [...new Map(results.flatMap((entry) => entry.result.results).map((item) => [item.chunk_id, item])).values()].slice(0, limit),
  assess: (hits) => ({ requires_more_context: !hits.length }),
  authorize: async (hits) => ({ allowed: hits, denied_ids: [], partial: false }),
  ...overrides
});
const retrieve = (dependencies, budgets = {}, options = {}) => execution.run(options, () => engine.retrieve({
  request: contracts.buildRetrievalRequest({ projectId: "project-1", query: "release checklist", budgets }),
  user: { id: "user-1" }, dependencies, ...options
}));

test("context engine returns the same bounded evidence used by consumers and actual safe events", async () => {
  const events = [];
  const result = await retrieve(fixtures(), { max_context_tokens: 1500 }, { onProgress: (event) => events.push(event) });
  assert.equal(result.packet.contract_type, "ContextPacket");
  assert.equal(result.packet.authorization.source_acl_enforced, true);
  assert.deepEqual(result.hits.map((item) => item.citation.id), result.packet.evidence.map((item) => item.evidence_id));
  assert.ok(events.some((event) => event.stage === "HYBRID_SEARCH" && event.status === "COMPLETE"));
  assert.ok(!events.some((event) => event.stage === "GENERATION" || event.stage === "RERANKING"));
  assert.equal(new Set(events.map((event) => event.sequence)).size, events.length);
  assert.ok(!JSON.stringify(events).includes("checkout"));
});

test("zero-hit search expands before concluding insufficient evidence", async () => {
  let searches = 0;
  let plans = 0;
  const result = await retrieve(fixtures({
    search: async () => ({ results: [{ query: "release", result: { results: ++searches === 1 ? [] : [hit("2")] } }], errors: [] }),
    planQueries: async () => { plans++; return { search_queries: ["release approval"] }; }
  }), {}, { integration: { id: "model" } });
  assert.equal(searches, 2);
  assert.equal(plans, 1);
  assert.equal(result.hits.length, 1);
});

test("sufficient evidence skips model planning and revoked fragments never enter packets", async () => {
  let planned = false;
  const result = await retrieve(fixtures({
    search: async () => ({ results: [{ query: "release", result: { results: [hit("allowed"), hit("denied", "restricted material")] } }], errors: [] }),
    authorize: async (hits) => ({ allowed: hits.filter((item) => item.chunk_id === "allowed"), denied_ids: ["K-denied"], partial: true }),
    planQueries: async () => { planned = true; return {}; }
  }), {}, { integration: { id: "model" } });
  assert.equal(planned, false);
  assert.equal(result.packet.limitations.authorization_partial, true);
  assert.ok(!JSON.stringify(result.packet).includes("restricted material"));
});

test("deadline returns partial context without waiting for an unresponsive search", async () => {
  let aborted = false;
  const started = Date.now();
  const result = await retrieve(fixtures({ search: ({ signal }) => new Promise(() => signal.addEventListener("abort", () => { aborted = true; })) }), { deadline_ms: 25 });
  assert.ok(Date.now() - started < 1000);
  assert.equal(aborted, true);
  assert.equal(result.packet.limitations.budget_partial, true);
  assert.equal(result.retrieval.termination_reason, "deadline_exceeded");
});

test("cancellation interrupts retrieval instead of producing a fallback answer", async () => {
  const controller = new AbortController();
  const job = retrieve(fixtures({ search: async () => { controller.abort(); return { results: [], errors: [] }; } }), {}, { signal: controller.signal });
  await assert.rejects(job, { name: "AbortError" });
});

test("candidate and tool budgets bound retrieval work before execution", async () => {
  let planned = 0;
  const result = await retrieve(fixtures({
    search: async () => ({ results: [{ query: "release", result: { results: Array.from({ length: 50 }, (_, i) => hit(String(i))) } }], errors: [] }),
    planQueries: async () => { planned++; return { search_queries: ["release signoff"] }; }
  }), { max_candidates: 2, max_tool_calls: 1 }, { integration: { id: "model" } });
  assert.ok(result.hits.length <= 2);
  assert.equal(result.retrieval.candidate_count, 2);
  assert.equal(planned, 0);
});

test("query expansion rejects unrelated invented concepts and repeated queries", () => {
  assert.deepEqual(engine.anchoredQueries(["release approval", "external cryptocurrency forecast", "RELEASE CHECKLIST"], {
    question: "release checklist", hits: [], seen: new Set(["release checklist"])
  }), ["release approval"]);
});

test("context-only retrieval rechecks access after model planning", async () => {
  let revoked = false;
  const result = await retrieve(fixtures({
    assess: () => ({ requires_more_context: true }),
    authorize: async (hits) => ({ allowed: revoked ? [] : hits, denied_ids: revoked ? ["K-1"] : [], partial: revoked }),
    planQueries: async () => { revoked = true; return { search_queries: [] }; }
  }), {}, { integration: { id: "model" } });
  assert.equal(result.packet.evidence.length, 0);
  assert.equal(result.packet.relationships.length, 0);
  assert.equal(result.packet.limitations.authorization_partial, true);
});

test("SSE returns structured events and aborts work when the reader disconnects", async () => {
  const raw = new EventEmitter();
  const chunks = [];
  Object.assign(raw, { writableLength: 0, writeHead() {}, write(value) { chunks.push(value); }, end() { this.writableEnded = true; }, destroy() { this.destroyed = true; } });
  const reply = { raw, hijack() {}, getHeaders: () => ({}) };
  await streamKnowledge({}, reply, async ({ signal, onProgress }) => {
    onProgress({ stage: "QUERY_RECEIVED" });
    raw.emit("close");
    assert.equal(signal.aborted, true);
    return { must_not_send: true };
  });
  assert.match(chunks.join(""), /event: progress/);
  assert.doesNotMatch(chunks.join(""), /must_not_send/);
});
