"use strict";

// Cross-encoder rerank of the top candidates.
//
// A cross-encoder reads the question and one passage together and scores how well
// the passage answers it, which first-stage retrieval cannot do. It is optional
// and off until an endpoint is configured. When it is not configured the result
// says so (`applied: false`); the code never presents a feature heuristic as a
// reranker.
//
//   KNOWLEDGE_RERANKER_URL        required to enable; the provider's rerank endpoint
//   KNOWLEDGE_RERANKER_API_KEY    bearer token, optional
//   KNOWLEDGE_RERANKER_MODEL      model name sent to the provider, optional
//   KNOWLEDGE_RERANKER_TOP_N      candidates to rerank (default 40)
//   KNOWLEDGE_RERANKER_TIMEOUT_MS per-call deadline (default 1500)
//
// The request and response follow the schema shared by Cohere, Jina, Voyage and
// Hugging Face Text Embeddings Inference:
//   POST { model, query, documents: [string], top_n }
//   ->   { results: [{ index, relevance_score }] }
//
// Only already-authorized evidence is ever sent: callers rerank after the access
// recheck, so nothing a user may not see leaves the process.

const { validateModelEndpoint } = require("@hellotest/platform/backend/src/utils/knowledgeModelRetry");

const clamp = (value, min, max, fallback) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const MAX_DOCUMENT_CHARS = 1_500;

const configuration = (env = process.env) => {
  const url = String(env.KNOWLEDGE_RERANKER_URL || "").trim();
  if (!url) return null;
  validateModelEndpoint(url);
  return {
    url,
    apiKey: String(env.KNOWLEDGE_RERANKER_API_KEY || ""),
    model: String(env.KNOWLEDGE_RERANKER_MODEL || ""),
    topN: clamp(Number.parseInt(env.KNOWLEDGE_RERANKER_TOP_N, 10), 5, 100, 40),
    timeoutMs: clamp(Number.parseInt(env.KNOWLEDGE_RERANKER_TIMEOUT_MS, 10), 200, 8_000, 1_500)
  };
};

// Providers return a 0..1 probability or an unbounded logit; map both to 0..1.
const toRelevance = (scores) => {
  const finite = scores.filter(Number.isFinite);
  const inUnitRange = finite.length > 0 && finite.every((score) => score >= 0 && score <= 1);
  return scores.map((score) => !Number.isFinite(score) ? 0 : inUnitRange ? score : 1 / (1 + Math.exp(-score)));
};

const documentText = (hit) => `${hit.title || ""}\n${String(hit.content || "").slice(0, MAX_DOCUMENT_CHARS)}`.trim();

/**
 * @returns {Promise<{applied: boolean, reason?: string, type?: string, hits: Array, scored?: number}>}
 *   Candidates beyond topN keep their order after the reranked head.
 */
const rerank = async ({ query, hits, signal, config, fetchImpl = globalThis.fetch }) => {
  let settings = config;
  try { settings = config === undefined ? configuration() : config; }
  catch { return { applied: false, reason: "misconfigured", hits }; }
  if (!settings) return { applied: false, reason: "not_configured", hits };
  const candidates = hits.slice(0, settings.topN);
  if (candidates.length < 2) return { applied: false, reason: "too_few_candidates", hits };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetchImpl(settings.url, {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) },
      body: JSON.stringify({ ...(settings.model ? { model: settings.model } : {}), query: String(query).slice(0, 2_000),
        documents: candidates.map(documentText), top_n: candidates.length })
    });
    if (!response.ok) return { applied: false, reason: `http_${response.status}`, hits };
    const body = await response.json();
    const results = Array.isArray(body?.results) ? body.results : Array.isArray(body?.data) ? body.data : null;
    if (!results) return { applied: false, reason: "invalid_response", hits };
    const raw = new Array(candidates.length).fill(NaN);
    for (const item of results) {
      const index = Number(item?.index);
      const score = Number(item?.relevance_score ?? item?.score);
      if (Number.isInteger(index) && index >= 0 && index < raw.length && Number.isFinite(score)) raw[index] = score;
    }
    if (raw.every((score) => !Number.isFinite(score))) return { applied: false, reason: "invalid_response", hits };
    const relevance = toRelevance(raw);
    const head = candidates.map((hit, index) => ({ ...hit, rerank_score: Number(relevance[index].toFixed(6)) }))
      .sort((left, right) => right.rerank_score - left.rerank_score);
    return { applied: true, type: "cross_encoder", scored: candidates.length, hits: [...head, ...hits.slice(settings.topN)] };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { applied: false, reason: error?.name === "AbortError" ? "timeout" : "unavailable", hits };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
};

module.exports = { configuration, rerank, toRelevance };
