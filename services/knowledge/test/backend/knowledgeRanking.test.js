const test = require("node:test");
const assert = require("node:assert/strict");
const ranking = require("../../backend/services/knowledgeRanking");
const reranker = require("../../backend/services/knowledgeReranker");
const retrieval = require("../../backend/services/knowledgeRetrieval.service");
const contracts = require("../../backend/services/knowledgeContracts.service");
const engine = require("../../backend/services/knowledgeContextEngine.service");
const execution = require("../../backend/services/knowledgeExecution.service");

// --- fusion ---------------------------------------------------------------------

test("a chunk found by both channels outranks one found by a single channel, with no tuned weights", () => {
  const fused = ranking.fuse([
    { name: "lexical", ids: ["a", "b", "c"] },
    { name: "semantic", ids: ["c", "b", "d"] }
  ]);
  const order = [...fused.entries()].sort((left, right) => right[1].score - left[1].score).map(([id]) => id);
  assert.deepEqual(order.slice(0, 2).sort(), ["b", "c"], "b and c are in both channels");
  assert.ok(fused.get("b").normalized <= 1 && fused.get("a").normalized > 0);
  assert.equal(fused.get("c").ranks.lexical, 3);
  assert.equal(fused.get("c").ranks.semantic, 1);
});

test("a hit ranked first by every channel scores exactly 1 after normalisation", () => {
  const fused = ranking.fuse([{ name: "lexical", ids: ["a"] }, { name: "semantic", ids: ["a"] }, { name: "exact", ids: ["a"] }]);
  assert.equal(Number(fused.get("a").normalized.toFixed(9)), 1);
});

test("plain RRF ignores channel weights and duplicate IDs do not renumber positions", () => {
  const fused = ranking.fuse([{ name: "lexical", ids: ["a", "a", "b"], weight: 9 }, { name: "semantic", ids: ["z"], weight: 0 }]);
  assert.ok(fused.has("z"));
  assert.equal(fused.get("a").ranks.lexical, 1);
  assert.equal(fused.get("b").ranks.lexical, 3, "positions are positions in the list, a duplicate does not renumber");
});

test("disabled retrieval channels are omitted without weighting active channels", () => {
  const fused = ranking.fuse([{ name: "lexical", ids: ["a"] }, { name: "semantic", ids: ["z"], enabled: false }]);
  assert.ok(fused.has("a"));
  assert.ok(!fused.has("z"));
});

// --- relevance --------------------------------------------------------------------

test("lexical quality scales with how much of the question a chunk addresses", () => {
  const keyTerms = ["checkout", "flow", "expired", "credit", "cards", "returning", "customers", "retry"];
  const full = ranking.lexicalQuality({ sqlRank: 0.6, keyTerms, candidateText: "checkout flow rejects expired credit cards for returning customers with a retry" });
  const one = ranking.lexicalQuality({ sqlRank: 0.6, keyTerms, candidateText: "the checkout was scheduled" });
  const none = ranking.lexicalQuality({ sqlRank: 0.6, keyTerms, candidateText: "weather sports calendar" });
  assert.ok(full > 0.9, `full coverage is strong (${full})`);
  const two = ranking.lexicalQuality({ sqlRank: 0.6, keyTerms, candidateText: "the checkout flow was scheduled" });
  assert.ok(one < two, `two matching terms are more relevant than one (${one} < ${two})`);
  assert.equal(none, 0);
  assert.equal(ranking.lexicalQuality({ exact: true, keyTerms, candidateText: "" }), 1);
  assert.ok(ranking.lexicalQuality({ sqlRank: 0.1, keyTerms: ["idempotency"], candidateText: "idempotency keys" }) >= 0.5, "a single-term question fully covered passes");
});

test("a hashed local vector never counts as semantic evidence; a cross-encoder score replaces the estimate", () => {
  assert.equal(ranking.relevanceOf({ lexical: 0.2, semantic: 0.9, semanticIsReal: false }), 0.2);
  assert.equal(ranking.relevanceOf({ lexical: 0.2, semantic: 0.9, semanticIsReal: true }), 0.9);
  assert.equal(ranking.relevanceOf({ lexical: 0.9, semantic: 0.1, semanticIsReal: true, rerank: 0.05 }), 0.05);
  assert.equal(ranking.relevanceOf({ lexical: 0.9, rerank: 7 }), 1, "clamped");
});

test("semantic mode falls back to lexical RRF when only local hash vectors are available", () => {
  const local = ranking.channelAvailability({ mode: "semantic", embeddingModel: "hellotest-hash-v1", localEmbeddingModel: "hellotest-hash-v1" });
  assert.equal(local.semanticUsable, false);
  assert.equal(local.lexicalFallback, true);
  assert.equal(local.semanticSignal, "hashed_lexical");
  const provider = ranking.channelAvailability({ mode: "semantic", embeddingModel: "text-embedding-current", localEmbeddingModel: "hellotest-hash-v1",
    candidates: [{ embedding_model: "text-embedding-current", embedding: [0, 1] }] });
  assert.equal(provider.semanticUsable, true);
  assert.equal(provider.lexicalFallback, false);
});

test("per-source diversity keeps the best hits and a pinned source keeps more", () => {
  const hits = Array.from({ length: 10 }, (_, index) => ({ id: index, source_id: index < 8 ? "long-spec" : "other" }));
  assert.equal(ranking.diversify(hits, { limit: 10 }).filter((hit) => hit.source_id === "long-spec").length, ranking.PER_SOURCE_CAP);
  assert.equal(ranking.diversify(hits, { limit: 10, cap: ranking.PINNED_PER_SOURCE_CAP }).filter((hit) => hit.source_id === "long-spec").length, 8);
  assert.deepEqual(ranking.diversify(hits, { limit: 2, cap: 12 }).map((hit) => hit.id), [0, 1], "best first, limit respected");
});

// --- merging queries and sufficiency ---------------------------------------------

const hit = (id, relevance, extra = {}) => ({ chunk_id: id, source_id: extra.source_id || `source-${id}`, title: extra.title || "Doc", content: extra.content || "text", relevance, score: relevance, citation: { id: `K-${id}`, source_id: extra.source_id || `source-${id}` } });
const entry = (hits, mode) => ({ query: "q", result: { results: hits, retrieval: { vector_mode: "disabled", ...(mode ? { mode } : {}) } } });

test("merging queries orders by fused rank and reports the best relevance any query gave", () => {
  const merged = retrieval.mergeRetrievalResults([
    entry([hit("a", 0.4), hit("b", 0.9)]),
    entry([hit("b", 0.7), hit("c", 0.5)])
  ]);
  assert.equal(merged[0].chunk_id, "b", "found by both queries");
  assert.equal(merged[0].relevance, 0.9);
  assert.equal(merged[0].retrieval_query_match_count, 2);
  assert.ok(merged.every((item) => item.retrieval_fusion_score <= 1 && item.retrieval_fusion_score > 0));
});

test("plain RRF gives equal rank votes to live and indexed evidence", () => {
  const live = entry([hit("live-1", 1, { source_id: "live-project-p-runs" })], "live_project");
  const oneEach = retrieval.mergeRetrievalResults([entry([hit("x", 0.8)]), live]);
  assert.equal(oneEach[0].retrieval_fusion_score, oneEach[1].retrieval_fusion_score);
  const tied = retrieval.mergeRetrievalResults([entry([hit("x", 1)]), entry([hit("x", 1)]), live]);
  assert.equal(tied[0].chunk_id, "x");
  assert.ok(tied[0].retrieval_fusion_score > tied[1].retrieval_fusion_score);
});

test("candidate relevance is reported without a hand-set grounding floor", () => {
  const graph = { query: "relationship_search", result: { results: [{ ...hit("proof", 0), score: 0 }],
    relationships: [{ endpoints_authorized: true, provenance_type: "HUMAN_VERIFIED", source_canonical_id: "a", target_canonical_id: "b", evidence_ids: ["K-proof"] }],
    retrieval: { vector_mode: "graph_witnesses" } } };
  const merged = retrieval.mergeRetrievalResults([entry([hit("weak", 0.01), hit("fine", 0.5)]), graph]);
  assert.deepEqual(merged.map((item) => item.chunk_id).sort(), ["fine", "proof", "weak"]);
});

test("pinned sources keep more passages per source in the merged list", () => {
  const many = Array.from({ length: 8 }, (_, index) => hit(`p${index}`, 0.9 - index * 0.01, { source_id: "pinned" }));
  assert.equal(retrieval.mergeRetrievalResults([entry(many)], 14).length, ranking.PER_SOURCE_CAP);
  assert.equal(retrieval.mergeRetrievalResults([entry(many)], 14, { perSourceCap: ranking.PINNED_PER_SOURCE_CAP }).length, 8);
});

test("sufficiency uses absolute relevance: a strong-looking rank of poor hits is not strong", () => {
  const poor = Array.from({ length: 6 }, (_, index) => ({ ...hit(`p${index}`, 0.11), retrieval_fusion_score: 1, source_id: `s${index % 3}`, source_kind: "text" }));
  const good = poor.map((item) => ({ ...item, relevance: 0.95 }));
  assert.ok(retrieval.assessEvidenceSufficiency(good).score > retrieval.assessEvidenceSufficiency(poor).score);
});

test("sufficiency checks each information need the planner named, and an unanswered need asks for more", () => {
  const hits = [{ ...hit("a", 0.9, { title: "Checkout", content: "The checkout flow rejects expired credit cards." }), source_kind: "text" },
    { ...hit("b", 0.9, { source_id: "s2", title: "Release", content: "Release approval needs a passing regression suite." }), source_kind: "text" },
    { ...hit("c", 0.9, { source_id: "s3", title: "Notes", content: "General notes." }), source_kind: "text" }];
  const covered = retrieval.assessEvidenceSufficiency(hits, { informationNeeds: ["expired credit cards at checkout", "regression suite approval"] });
  assert.deepEqual(covered.uncovered_needs, []);
  assert.equal(covered.needs_coverage_ratio, 1);
  const open = retrieval.assessEvidenceSufficiency(hits, { informationNeeds: ["expired credit cards at checkout", "rollback procedure for failed deployments"] });
  assert.deepEqual(open.uncovered_needs, ["rollback procedure for failed deployments"]);
  assert.equal(open.requires_more_context, true, "even a high count score does not hide an unanswered need");
  assert.notEqual(open.status, "strong");
  assert.equal(retrieval.assessEvidenceSufficiency(hits).uncovered_needs.length, 0, "no named needs, nothing to check");
});

test("plain RRF rewards agreement across derived queries, with the raw question breaking ties", () => {
  const original = "stable regression suite";
  const primary = { query: original, result: { results: [hit("best", 0.9), hit("other", 0.6)], retrieval: {} } };
  // Two derived queries both put a weaker document first.
  const variantA = { query: "regression severity defect", result: { results: [hit("noise", 0.5)], retrieval: {} } };
  const variantB = { query: "specialist focus: stable regression suite", result: { results: [hit("noise", 0.5)], retrieval: {} } };
  const merged = retrieval.mergeRetrievalResults([primary, variantA, variantB], 14, { primaryQuery: original });
  assert.equal(merged[0].chunk_id, "noise", "two independent query lists contribute two ordinary RRF votes");
  assert.equal(merged.find((item) => item.chunk_id === "noise").retrieval_query_match_count, 2);
  assert.equal(merged.find((item) => item.chunk_id === "best").matched_primary_query, true);
  assert.equal(retrieval.mergeRetrievalResults([primary, variantA, variantB])[0].chunk_id, "noise");
});

test("RRF order is independent of the old hand-set relevance multiplier", () => {
  const original = "recipe for a stable regression suite";
  // The strong match is first in the user's list; the weak one is rank 4 there and first in two derived lists.
  const primary = { query: original, result: { results: [hit("strong", 0.65), hit("p2", 0.35), hit("p3", 0.125), hit("weak", 0.12)], retrieval: {} } };
  const derivedA = { query: "defect regression severity", result: { results: [hit("weak", 0.19)], retrieval: {} } };
  const derivedB = { query: "regression status impacted", result: { results: [hit("weak", 0.19)], retrieval: {} } };
  const merged = retrieval.mergeRetrievalResults([primary, derivedA, derivedB], 14, { primaryQuery: original });
  assert.equal(merged[0].chunk_id, "weak", "plain RRF follows rank agreement; relevance remains separately available for sufficiency and reranking");
});

test("a vague information need made of meta-words is not checked, so it cannot force another round", () => {
  const hits = [{ ...hit("a", 0.9, { title: "Checkout", content: "The checkout flow rejects expired cards." }), source_kind: "text" }];
  for (const vague of ["the behaviour the question asks about", "relevant information about the project", "specific details", "answer"]) {
    const result = retrieval.assessEvidenceSufficiency(hits, { informationNeeds: [vague] });
    assert.deepEqual(result.uncovered_needs, [], vague);
    assert.deepEqual(result.information_needs, [], `${vague}: not evaluated`);
  }
  assert.equal(retrieval.assessEvidenceSufficiency(hits, { informationNeeds: ["rollback procedure for failed deployments"] }).uncovered_needs.length, 1, "a specific unanswered need still counts");
});

// --- reranker ---------------------------------------------------------------------

const rerankHits = ["a", "b", "c", "d"].map((id) => hit(id, 0.5));
const config = { url: "https://rerank.example/v1/rerank", apiKey: "key", model: "m", topN: 3, timeoutMs: 500 };
const provider = (results, status = 200) => async (url, init) => ({ ok: status < 400, status, json: async () => ({ results }), _init: init, _url: url });

test("no reranker is claimed unless one is configured", async () => {
  const result = await reranker.rerank({ query: "q", hits: rerankHits, config: null });
  assert.deepEqual([result.applied, result.reason], [false, "not_configured"]);
  assert.equal(result.hits, rerankHits);
  assert.equal(reranker.configuration({}), null);
  assert.equal(reranker.configuration({ KNOWLEDGE_RERANKER_URL: "https://x.example/rerank", KNOWLEDGE_RERANKER_TOP_N: "999" }).topN, 100);
  assert.throws(() => reranker.configuration({ KNOWLEDGE_RERANKER_URL: "ftp://bad" }), /not configured correctly/);
});

test("a cross-encoder reorders the head, scores it 0..1, and leaves the tail in place", async () => {
  let sent;
  const result = await reranker.rerank({ query: "expired cards", hits: rerankHits, config, fetchImpl: async (url, init) => { sent = { url, init }; return provider([{ index: 0, relevance_score: 0.2 }, { index: 1, relevance_score: 0.95 }, { index: 2, relevance_score: 0.6 }])(url, init); } });
  assert.equal(result.applied, true);
  assert.equal(result.type, "cross_encoder");
  assert.deepEqual(result.hits.map((item) => item.chunk_id), ["b", "c", "a", "d"]);
  assert.equal(result.hits[0].rerank_score, 0.95);
  assert.equal(result.hits[3].rerank_score, undefined, "beyond topN is not scored");
  const body = JSON.parse(sent.init.body);
  assert.equal(body.documents.length, 3);
  assert.equal(body.query, "expired cards");
  assert.equal(sent.init.headers.Authorization, "Bearer key");
  assert.equal(sent.init.redirect, "error", "never follows a redirect to another host");
});

test("raw logits are mapped to 0..1 and failures degrade to the fused order without throwing", async () => {
  const logits = await reranker.rerank({ query: "q", hits: rerankHits, config, fetchImpl: provider([{ index: 0, relevance_score: -3 }, { index: 1, relevance_score: 4 }, { index: 2, relevance_score: 0 }]) });
  assert.ok(logits.hits.every((item, index) => index > 2 || (item.rerank_score > 0 && item.rerank_score < 1)));
  assert.equal(logits.hits[0].chunk_id, "b");
  for (const [label, fetchImpl, reason] of [
    ["http error", provider([], 503), "http_503"],
    ["malformed", async () => ({ ok: true, json: async () => ({ nope: 1 }) }), "invalid_response"],
    ["no usable scores", provider([{ index: 99, relevance_score: 1 }]), "invalid_response"],
    ["network", async () => { throw new Error("boom"); }, "unavailable"]
  ]) {
    const result = await reranker.rerank({ query: "q", hits: rerankHits, config, fetchImpl });
    assert.deepEqual([label, result.applied, result.reason], [label, false, reason]);
    assert.equal(result.hits, rerankHits);
  }
});

test("a slow reranker is abandoned at its deadline", async () => {
  const result = await reranker.rerank({ query: "q", hits: rerankHits, config: { ...config, timeoutMs: 200 },
    fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))) });
  assert.deepEqual([result.applied, result.reason], [false, "timeout"]);
});

test("a single candidate is not worth a call", async () => {
  let calls = 0;
  const result = await reranker.rerank({ query: "q", hits: [rerankHits[0]], config, fetchImpl: async () => { calls++; return provider([])(); } });
  assert.equal(result.reason, "too_few_candidates");
  assert.equal(calls, 0);
});

// --- engine -----------------------------------------------------------------------

const engineHit = (id, content = "The release requires a passing checkout test.") => ({ chunk_id: id, source_id: `source-${id}`, project_id: "project-1", source_kind: "text", title: "Release checklist", content, score: 0.9, relevance: 0.9, citation: { id: `K-${id}`, chunk_id: id, source_id: `source-${id}` } });
const engineDeps = (overrides = {}) => ({
  search: async () => ({ results: [{ query: "release", result: { results: [engineHit("1"), engineHit("2", "A second passage about checkout.")], retrieval: { vector_mode: "disabled" } } }], errors: [] }),
  liveEvidence: async () => ({ hits: [], counts: {} }),
  planContext: () => ({ indexed_source_kinds: ["text"], live_scopes: [] }),
  merge: (results, limit) => [...new Map(results.flatMap((item) => item.result.results).map((item) => [item.chunk_id, item])).values()].slice(0, limit),
  assess: () => ({ requires_more_context: false }),
  authorize: async (hits) => ({ allowed: hits, denied_ids: [], partial: false }),
  ...overrides
});
const run = (dependencies) => execution.run({}, () => engine.retrieve({
  request: contracts.buildRetrievalRequest({ projectId: "project-1", query: "release checklist" }), user: { id: "user-1" }, dependencies
}));

test("the engine reranks only evidence that passed the final access check, and reports it", async () => {
  const sent = [];
  const result = await run(engineDeps({
    search: async () => ({ results: [{ query: "release", result: { results: [engineHit("1"), engineHit("2", "A second passage."), engineHit("3", "A third passage.")], retrieval: { vector_mode: "disabled" } } }], errors: [] }),
    authorize: async (hits) => ({ allowed: hits.filter((item) => item.chunk_id !== "2"), denied_ids: ["K-2"], partial: true }),
    rerank: async ({ hits }) => { sent.push(...hits.map((item) => item.chunk_id)); return { applied: false, reason: "not_configured", hits }; }
  }));
  assert.deepEqual(sent.sort(), ["1", "3"], "a revoked passage is never sent to the reranker");
  assert.equal(result.retrieval.reranking.applied, false);
  assert.equal(result.retrieval.reranking.reason, "not_configured");
});

test("a configured reranker reorders the packet and becomes the absolute relevance", async () => {
  const result = await run(engineDeps({
    rerank: async ({ hits }) => ({ applied: true, type: "cross_encoder", scored: hits.length, hits: [...hits].reverse().map((item, index) => ({ ...item, rerank_score: 0.9 - index * 0.5 })) })
  }));
  assert.deepEqual(result.hits.map((item) => item.chunk_id), ["2", "1"]);
  assert.deepEqual(result.retrieval.reranking, { applied: true, type: "cross_encoder", scored: 2 });
  assert.equal(result.hits[0].relevance, 0.9);
});

test("a reranker that fails leaves the fused order, marks the run degraded and does not fail retrieval", async () => {
  const result = await run(engineDeps({ rerank: async () => { throw Object.assign(new Error("down"), { code: "RERANKING_UNAVAILABLE" }); } }));
  assert.deepEqual(result.hits.map((item) => item.chunk_id), ["1", "2"]);
  assert.equal(result.retrieval.degraded, true);
  assert.ok(result.retrieval.error_codes.includes("RERANKING_UNAVAILABLE"));
  assert.equal(result.retrieval.reranking.applied, false);
});

test("a zero reranker budget disables reranking entirely", async () => {
  let called = false;
  const result = await execution.run({}, () => engine.retrieve({
    request: contracts.buildRetrievalRequest({ projectId: "project-1", query: "release checklist", budgets: { max_reranker_candidates: 0 } }), user: { id: "u" },
    dependencies: engineDeps({ rerank: async ({ hits }) => { called = true; return { applied: false, hits }; } })
  }));
  assert.equal(called, false);
  assert.equal(result.retrieval.reranking.applied, false);
});

test("open information needs become the follow-up queries", async () => {
  const seen = [];
  await execution.run({}, () => engine.retrieve({
    request: contracts.buildRetrievalRequest({ projectId: "project-1", query: "release checklist", budgets: { max_rounds: 2, max_tool_calls: 8 } }), user: { id: "u" },
    followUpRounds: true, intentPlan: { queries: [], source_kinds: ["text"], information_needs: ["rollback procedure for the release checklist"] },
    dependencies: engineDeps({
      assess: (hits, options) => ({ requires_more_context: true, uncovered_needs: options.informationNeeds }),
      planQueries: async (input) => { seen.push(input.openNeeds); return { search_queries: input.openNeeds }; }
    })
  }));
  assert.deepEqual(seen[0], ["rollback procedure for the release checklist"]);
});
