const test = require("node:test");
const assert = require("node:assert/strict");
const followUp = require("../../backend/services/knowledgeFollowUp");
const contracts = require("../../backend/services/knowledgeContracts.service");
const engine = require("../../backend/services/knowledgeContextEngine.service");
const execution = require("../../backend/services/knowledgeExecution.service");

const history = [
  { role: "user", content: "Summarize the release readiness of STORY-12" },
  { role: "assistant", content: "STORY-12 is covered by TC-0045; one defect, BUG-77, is open." }
];

test("a short question that leans on an earlier one is also searched joined to it", () => {
  const queries = followUp.buildSeedQueries("What about its failed cases?", history);
  assert.equal(queries.length, 2);
  assert.match(queries[1], /Previous project question: Summarize the release readiness of STORY-12/);
  assert.match(queries[1], /Current follow-up: What about its failed cases\?/);
  assert.equal(followUp.isFollowUp("What about its failed cases?", history), true);
});

test("a self-contained or first question is not treated as a follow-up", () => {
  assert.deepEqual(followUp.buildSeedQueries("List every failing checkout regression run in the last release", history), ["List every failing checkout regression run in the last release"]);
  assert.deepEqual(followUp.buildSeedQueries("What about its failed cases?", []), ["What about its failed cases?"]);
  assert.equal(followUp.isFollowUp("Explain the checkout refund policy in detail for returning customers please", history), false);
});

test("entities named in recent turns are found newest first, and bounded", () => {
  // The newest turn is read first and the limit (3) is already met by it, in the order they appear.
  assert.deepEqual(followUp.recentIdentifiers(history), ["STORY-12", "TC-0045", "BUG-77"]);
  assert.deepEqual(followUp.recentIdentifiers(history.slice(0, 1)), ["STORY-12"], "and an older turn is used when it is all there is");
  assert.deepEqual(followUp.recentIdentifiers(history, { limit: 1 }).length, 1);
  assert.deepEqual(followUp.recentIdentifiers([], {}), []);
  assert.deepEqual(followUp.recentIdentifiers(null), []);
});

// --- engine ---------------------------------------------------------------------

const hit = (id) => ({ chunk_id: id, source_id: `source-${id}`, project_id: "project-1", source_kind: "text", title: "Notes", content: "Coverage of the story.", score: 0.9, relevance: 0.9, citation: { id: `K-${id}`, chunk_id: id, source_id: `source-${id}` } });
const harness = ({ query, past = history, focusSourceIds, queryClass = "LOOKUP" }) => {
  const calls = { searches: [], expansions: [] };
  const dependencies = {
    search: async ({ queries }) => { calls.searches.push(queries); return { results: [{ query: queries[0], result: { results: [hit("1")], retrieval: { vector_mode: "disabled" } } }], errors: [] }; },
    liveEvidence: async () => ({ hits: [], counts: {} }),
    planContext: () => ({ indexed_source_kinds: ["text"], live_scopes: [] }),
    merge: (results, limit) => results.flatMap((entry) => entry.result.results).slice(0, limit),
    assess: () => ({ requires_more_context: false }),
    authorize: async (hits) => ({ allowed: hits, denied_ids: [], partial: false }),
    expandRelationships: async (input) => { calls.expansions.push(input); return { results: [], relationships: [], retrieval: {} }; }
  };
  const run = () => execution.run({}, () => engine.retrieve({
    request: contracts.buildRetrievalRequest({ projectId: "project-1", query, queryClass, budgets: { max_rounds: 1 } }),
    user: { id: "user-1" }, history: past, focusSourceIds, dependencies
  }));
  return { calls, run };
};

test("a follow-up is searched with the question joined to the earlier one", async () => {
  const { calls, run } = harness({ query: "What about its failed cases?" });
  await run();
  assert.ok(calls.searches[0].some((query) => /Previous project question: Summarize the release readiness of STORY-12/.test(query)), JSON.stringify(calls.searches[0]));
});

test("a follow-up that names nothing inherits the entity of the turns before it as its graph anchor", async () => {
  const { calls, run } = harness({ query: "What about its failed cases?" });
  await run();
  assert.equal(calls.expansions.length, 1, "the anchored walk started");
  assert.deepEqual(calls.expansions[0].identifiers.slice(0, 1), ["STORY-12"]);
  assert.deepEqual(calls.expansions[0].hits, [], "seeded by the conversation, not by search hits");
});

test("an entity the question names itself wins over the conversation's", async () => {
  const { calls, run } = harness({ query: "And what about BUG-9?" });
  await run();
  assert.deepEqual(calls.expansions[0].identifiers, ["BUG-9"]);
});

test("sources cited in recent turns seed a follow-up even when no entity is named", async () => {
  const { calls, run } = harness({ query: "What about its failed cases?", past: [{ role: "user", content: "Summarize release readiness" }, { role: "assistant", content: "Readiness is amber." }], focusSourceIds: ["source-7", "source-8"] });
  await run();
  assert.deepEqual(calls.expansions[0].focusSourceIds, ["source-7", "source-8"]);
});

test("focus never applies to a question that is not a follow-up", async () => {
  const { calls, run } = harness({ query: "Explain the checkout refund policy in detail for returning customers please", focusSourceIds: ["source-7"] });
  await run();
  assert.equal(calls.expansions.length, 0);
  assert.ok(!calls.searches[0].some((query) => /Previous project question/.test(query)));
});
