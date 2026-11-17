"use strict";

// Ranking for hybrid retrieval, in two deliberately separate parts.
//
//   ORDER      plain reciprocal-rank fusion (RRF) over retrieval channels.
//   RELEVANCE  an absolute 0..1 estimate of whether a hit answers the question at
//              all. RRF cannot supply this (the best of a bad candidate set still
//              ranks first), so a hit is kept only when its relevance clears a
//              threshold. A cross-encoder score replaces the estimate when a
//              reranker is configured.
//
// The previous code blended 0.45 * rank-fusion + 0.31 * cosine + 0.24 * lexical
// and then blended that again with a second set of weights when merging queries,
// with two thresholds and nothing to tune them against. The retrieval evaluation
// harness (test/support/knowledgeRetrievalEvaluation.js) measures what these defaults do.

const RRF_K = 60;
const CHANNELS = Object.freeze(["exact", "lexical", "semantic", "graph"]);
const PER_SOURCE_CAP = 3;
// Pinned sources are the user's explicit choice of material; a long specification
// should not be cut to three passages.
const PINNED_PER_SOURCE_CAP = 12;

const channelAvailability = ({ mode, embeddingModel, localEmbeddingModel, denseCandidates = [], candidates = [] } = {}) => {
  const semanticIsReal = mode !== "keyword" && Boolean(embeddingModel) && embeddingModel !== localEmbeddingModel;
  const semanticUsable = semanticIsReal && (denseCandidates.length > 0
    || candidates.some(candidate => candidate.embedding_model === embeddingModel && Array.isArray(candidate.embedding)));
  return { semanticIsReal, semanticUsable, lexicalFallback: mode === "semantic" && !semanticUsable,
    semanticSignal: mode === "keyword" ? "none" : semanticIsReal ? "provider_embedding" : "hashed_lexical" };
};

/**
 * @param {Array<{name: string, ids: string[], weight?: number}>} channels each `ids` is best-first
 * @returns {Map<string, {score: number, normalized: number, ranks: Record<string, number>}>}
 *   `normalized` divides by the best possible score, so it lies in [0, 1].
 */
const fuse = (channels, { k = RRF_K } = {}) => {
  const active = channels.filter((channel) => channel.enabled !== false && channel.ids?.length);
  const best = active.length / (k + 1) || 1;
  const fused = new Map();
  for (const channel of active) {
    const seen = new Set();
    channel.ids.forEach((id, index) => {
      if (seen.has(id)) return;
      seen.add(id);
      const entry = fused.get(id) || { score: 0, normalized: 0, ranks: {} };
      entry.score += 1 / (k + index + 1);
      entry.ranks[channel.name] = index + 1;
      fused.set(id, entry);
    });
  }
  for (const entry of fused.values()) entry.normalized = Math.min(1, entry.score / best);
  return fused;
};

// The words of a text that the question's key terms can match.
const tokenSet = (text) => new Set(String(text || "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_.\-/@]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu) || []);

/**
 * How well a chunk matches the question lexically, 0..1.
 *
 * The SQL rank (cover density, already bounded) measures proximity and weight;
 * key-term coverage measures how much of the question the chunk addresses. A
 * chunk that names one of eight key terms is a weak match however dense it is,
 * so coverage scales the rank rather than adding to it.
 */
const lexicalQuality = ({ sqlRank = 0, keyTerms = [], candidateText = "", phrase = false, exact = false }) => {
  if (exact) return 1;
  const tokens = tokenSet(candidateText);
  const covered = keyTerms.length ? keyTerms.filter((term) => tokens.has(term) || candidateText.toLowerCase().includes(term)).length / keyTerms.length : 0;
  const proximity = Math.min(1, Math.max(0, Number(sqlRank) || 0) * 3);
  // Coverage is raised to 1.5 so that naming a single weak term of a long question is not
  // enough on its own (1 of 8 terms scores 0.04) while 2 of 8 clears the gate. The exponent
  // shapes the gate; the retrieval evaluation set is what it is tuned against.
  const base = Math.pow(covered, 1.5) * (0.5 + 0.5 * proximity);
  return Math.min(1, base + (phrase ? 0.2 : 0));
};

/**
 * Absolute relevance in 0..1. A hashed local vector is word hashing, not a
 * semantic embedding, so it never counts as semantic evidence; its similarity is
 * reported for diagnostics only.
 */
const relevanceOf = ({ lexical = 0, semantic = 0, semanticIsReal = false, rerank = null }) =>
  rerank != null && Number.isFinite(Number(rerank)) ? Math.min(1, Math.max(0, Number(rerank))) : Math.max(lexical, semanticIsReal ? semantic : 0);

/** Keep the best hits, at most `cap` per source. Input must already be best-first. */
const diversify = (hits, { limit, cap = PER_SOURCE_CAP, sourceOf = (hit) => hit.source_id }) => {
  const counts = new Map();
  const kept = [];
  for (const hit of hits) {
    const key = sourceOf(hit);
    const count = counts.get(key) || 0;
    if (count >= cap) continue;
    counts.set(key, count + 1);
    kept.push(hit);
    if (kept.length >= limit) break;
  }
  return kept;
};

/** Combine per-query hit lists: one fused order across queries, relevance = the best any query gave. */
const mergeQueries = (queryLists, { k = RRF_K } = {}) => {
  const channels = queryLists.map((hits, index) => ({ name: `q${index}`, ids: hits.map((hit) => hit.key) }));
  const fused = fuse(channels, { k });
  const byKey = new Map();
  queryLists.forEach((hits, index) => hits.forEach((hit) => {
    const current = byKey.get(hit.key);
    if (!current) byKey.set(hit.key, { hit: hit.hit, relevance: hit.relevance, queries: new Set([index]) });
    else {
      current.queries.add(index);
      if (hit.relevance > current.relevance) { current.hit = hit.hit; current.relevance = hit.relevance; }
    }
  }));
  return [...byKey.entries()].map(([key, entry]) => ({ key, hit: entry.hit, relevance: entry.relevance, queryCount: entry.queries.size, fusion: fused.get(key)?.normalized || 0 }))
    .sort((left, right) => right.fusion - left.fusion || right.queryCount - left.queryCount || right.relevance - left.relevance);
};

module.exports = {
  CHANNELS, PER_SOURCE_CAP, PINNED_PER_SOURCE_CAP, RRF_K,
  channelAvailability, diversify, fuse, lexicalQuality, mergeQueries, relevanceOf, tokenSet
};
