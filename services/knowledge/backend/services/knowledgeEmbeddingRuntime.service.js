"use strict";

const db = require("@hellotest/platform/backend/src/db");
const aiLlmSelectionService = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const { fetchLlmWithRetry } = require("@hellotest/platform/backend/src/utils/llmHttpClient");
const { retryKnowledgeModel, readRetryAfterMs, validateModelEndpoint } = require("@hellotest/platform/backend/src/utils/knowledgeModelRetry");
const { modelHttpError } = require("@hellotest/platform/backend/src/utils/knowledgeAssistantErrors");
const cacheService = require("@hellotest/platform/backend/src/utils/cache");
const { assertRetrievalActive, boundedRetrievalStage } = require("@hellotest/platform/backend/src/utils/knowledgeRetrievalTiming");
const { fingerprint, normalizeText } = require("@hellotest/platform/backend/src/security/aiTextPolicy");
const { localEmbedding } = require("./knowledgeProcessing.service");
const { assertLlmIntegrationProjectScope } = require("./knowledgeIntegrationScope.service");

const MAX_PROVIDER_EMBEDDING_DIMENSIONS = 8_192;
const MAX_PROVIDER_EMBEDDING_RESPONSE_BYTES = 32 * 1024 * 1024;
const EMBEDDING_BATCH_SIZE = 64;
const LOCAL_EMBEDDING_MODEL = "hellotest-hash-v1";
const RETRIEVAL_EMBEDDING_TIMEOUT_MS = 2_000;
// Optional semantic enrichment shares one document budget, including every
// provider batch and retry. Canonical lexical/local indexes do not wait on it.
const INGESTION_EMBEDDING_TIMEOUT_MS = 8_000;
const embeddingProviderCooldowns = new Map();
const asArray = (value) => Array.isArray(value) ? value : [];
const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const createError = (message, statusCode = 400, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
};

const validateEmbeddingVector = (value, expectedDimensions) => {
  if (!Array.isArray(value) || !value.length || value.length > MAX_PROVIDER_EMBEDDING_DIMENSIONS) {
    throw new Error("Embedding provider returned an empty or oversized vector.");
  }
  if (expectedDimensions && value.length !== expectedDimensions) {
    throw new Error("Embedding provider returned inconsistent vector dimensions.");
  }
  const vector = value.map(Number);
  if (vector.some((entry) => !Number.isFinite(entry) || Math.abs(entry) > 1_000_000)) {
    throw new Error("Embedding provider returned a non-finite or out-of-range vector value.");
  }
  return vector;
};

const vectorLiteral = (values) => `[${validateEmbeddingVector(values).join(",")}]`;

const readJsonResponseWithLimit = async (response, maxBytes = MAX_PROVIDER_EMBEDDING_RESPONSE_BYTES) => {
  const declaredLength = Number(response.headers?.get?.("content-length") || 0);
  if (declaredLength > maxBytes) throw new Error("Embedding provider response exceeded the configured size limit.");
  if (!response.body?.getReader) return response.json();
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Embedding provider response exceeded the configured size limit.");
    }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};
const normalizeProviderEmbeddingBatch = (payload, batchLength, expectedDimensions = null) => {
  const ordered = asArray(payload?.data).slice().sort((left, right) => Number(left.index) - Number(right.index));
  const indices = ordered.map((item) => Number(item.index));
  const indicesAreExact = indices.length === batchLength
    && indices.every((value, index) => Number.isInteger(value) && value === index);
  if (!indicesAreExact || ordered.some((item) => !Array.isArray(item.embedding))) {
    throw new Error("Embedding provider returned an invalid vector batch");
  }
  const vectors = [];
  let dimensions = expectedDimensions;
  for (const item of ordered) {
    const vector = validateEmbeddingVector(item.embedding, dimensions);
    dimensions ||= vector.length;
    vectors.push(vector);
  }
  return { vectors, dimensions };
};
let vectorCapabilityCache = null;
let vectorCapabilityCheckedAt = 0;

const getVectorCapability = async () => {
  if (vectorCapabilityCache !== null && Date.now() - vectorCapabilityCheckedAt < 60_000) return vectorCapabilityCache;
  try {
    const row = await db.prepare("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS available").get();
    vectorCapabilityCache = Boolean(row?.available);
  } catch {
    vectorCapabilityCache = false;
  }
  vectorCapabilityCheckedAt = Date.now();
  return vectorCapabilityCache;
};

const resolveEmbeddingRuntime = async ({ userId, projectId, integrationId, signal, timeoutMs = 2_000 } = {}) => {
  let integration = null;
  try {
    integration = await boundedRetrievalStage(() => aiLlmSelectionService.resolveLlmIntegrationForUsage({
      integrationId,
      userId,
      // Ingestion and retrieval share the governed Knowledge Assistant mapping so
      // document/query egress cannot silently select a different global provider.
      usageKey: "ai.knowledge.assistant",
      projectId,
      fallback: "project-then-global",
      allowMissing: true
    }), { timeoutMs, signal, code: "EMBEDDING_CONFIGURATION_TIMEOUT" });
  } catch (error) {
    assertRetrievalActive(signal);
    if (integrationId) throw error;
    return { configured: false, integration: null, model: LOCAL_EMBEDDING_MODEL,
      provider: "HelloTest local hash embedding", warning_code: "embedding_fallback",
      warning_reason_code: error?.code || "EMBEDDING_CONFIGURATION_UNAVAILABLE",
      warning: "Model configuration is temporarily unavailable. Searchable local indexes remain available." };
  }
  assertRetrievalActive(signal);
  assertLlmIntegrationProjectScope(integration, projectId);
  // A chat model does not imply embedding support. The normal integration form
  // configures answer generation; use local retrieval unless an existing
  // explicit embedding capability is present, instead of repeatedly probing a
  // chat-only model at /embeddings on every cold request.
  const model = normalizeText(asObject(integration?.config).embedding_model, 255);
  const baseUrl = normalizeText(integration?.base_url, 2_000);
  if (!integration || !model || !baseUrl || !integration.api_key) {
    return { configured: false, integration: null, model: LOCAL_EMBEDDING_MODEL, provider: "HelloTest local hash embedding" };
  }
  return { configured: true, integration, model, baseUrl, provider: integration.name || "Configured LLM provider" };
};

const requestProviderEmbeddings = async (runtime, texts, { signal, timeoutMs = INGESTION_EMBEDDING_TIMEOUT_MS } = {}) => {
  const endpoint = `${runtime.baseUrl.replace(/\/+$/, "")}/embeddings`;
  validateModelEndpoint(endpoint);
  const vectors = [];
  let expectedDimensions = null;
  const deadlineAt = Date.now() + timeoutMs;
  for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
    assertRetrievalActive(signal);
    const batch = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
    const payload = await retryKnowledgeModel(async ({ signal: attemptSignal, timeoutMs }) => {
      const response = await fetchLlmWithRetry(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${runtime.integration.api_key}` },
        body: JSON.stringify({ model: runtime.model, input: batch }),
        signal: attemptSignal
      }, {
        integration: runtime.integration,
        operation: "knowledge.embedding",
        timeoutMs,
        maxAttempts: 1,
        bufferResponse: true,
        maxResponseBytes: MAX_PROVIDER_EMBEDDING_RESPONSE_BYTES
      });
      if (!response.ok) throw Object.assign(modelHttpError(response.status, await response.text(), readRetryAfterMs(response)), { statusCode: response.status });
      return readJsonResponseWithLimit(response);
    }, { signal, timeoutMs: Math.max(0, deadlineAt - Date.now()),
      attemptTimeoutMs: Math.min(3_000, timeoutMs), stage: "HYBRID_SEARCH" });
    const normalized = normalizeProviderEmbeddingBatch(payload, batch.length, expectedDimensions);
    expectedDimensions = normalized.dimensions;
    vectors.push(...normalized.vectors);
  }
  return vectors;
};

const embeddingCacheKey = (runtime, value) => `knowledge:embedding:v2:${fingerprint(JSON.stringify({
  integration_id: runtime.integration?.id || null,
  endpoint: String(runtime.baseUrl || '').replace(/\/+$/, ''),
  model: runtime.model,
  input: value
}))}`;

const requestCachedProviderEmbeddings = async (runtime, texts, { signal, timeoutMs } = {}) => {
  const keys = texts.map((value) => embeddingCacheKey(runtime, value));
  const cached = await Promise.all(keys.map((key) => boundedRetrievalStage(() => cacheService.getCache(key), {
    timeoutMs: 250, signal, code: "EMBEDDING_CACHE_TIMEOUT"
  }).catch((error) => { assertRetrievalActive(signal); return null; })));
  const vectors = new Array(texts.length);
  const missingIndexes = [];
  for (let index = 0; index < texts.length; index += 1) {
    const vector = cached[index]?.vector;
    if (Array.isArray(vector) && vector.length >= 8 && vector.length <= MAX_PROVIDER_EMBEDDING_DIMENSIONS && vector.every(Number.isFinite)) vectors[index] = vector;
    else missingIndexes.push(index);
  }
  if (missingIndexes.length) {
    const generated = await requestProviderEmbeddings(runtime, missingIndexes.map((index) => texts[index]), { signal, timeoutMs });
    await Promise.all(missingIndexes.map(async (index, generatedIndex) => {
      vectors[index] = generated[generatedIndex];
      await boundedRetrievalStage(() => cacheService.setCache(keys[index], { vector: vectors[index] }, 15 * 60), {
        timeoutMs: 250, signal, code: "EMBEDDING_CACHE_TIMEOUT"
      }).catch(() => { assertRetrievalActive(signal); });
    }));
  }
  const dimensions = vectors[0]?.length;
  if (!dimensions || !vectors.every((vector) => vector.length === dimensions)) throw new Error("Cached embedding dimensions did not match the configured model");
  return vectors;
};

const embedTexts = async (runtime, texts, { signal, cacheResults = false, timeoutMs = INGESTION_EMBEDDING_TIMEOUT_MS } = {}) => {
  if (signal?.aborted) throw createError("Knowledge indexing lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");
  const fallback = texts.map(localEmbedding);
  if (!runtime.configured) return { vectors: fallback, fallback, model: LOCAL_EMBEDDING_MODEL, provider: runtime.provider,
    warning: runtime.warning || null, warning_code: runtime.warning_code, warning_reason_code: runtime.warning_reason_code };
  // A rejected model/embedding combination is stable across requests. Scope the
  // short circuit to its configuration (including credential changes), never to
  // project evidence or a user's query.
  const runtimeKey = fingerprint(`${runtime.integration?.id}:${runtime.baseUrl}:${runtime.model}:${runtime.integration?.api_key}`);
  const fallbackResult = (code, warning) => ({ vectors: fallback, fallback, model: LOCAL_EMBEDDING_MODEL,
    provider: "HelloTest local hash embedding", warning_code: "embedding_fallback", warning_reason_code: code, warning });
  if (Number(embeddingProviderCooldowns.get(runtimeKey) || 0) > Date.now()) {
    return fallbackResult("EMBEDDING_PROVIDER_COOLDOWN", "The embedding provider is temporarily unavailable; authorized local retrieval is being used.");
  }
  try {
    const requestVectors = (activeSignal) => cacheResults && texts.length <= 10
      ? requestCachedProviderEmbeddings(runtime, texts, { signal: activeSignal, timeoutMs })
      : requestProviderEmbeddings(runtime, texts, { signal: activeSignal, timeoutMs });
    const vectors = await boundedRetrievalStage(requestVectors, { timeoutMs, signal, code: "EMBEDDING_TIMEOUT" });
    embeddingProviderCooldowns.delete(runtimeKey);
    return { vectors, fallback, model: runtime.model, provider: runtime.provider, warning: null };
  } catch (error) {
    if (signal?.aborted) throw createError("Knowledge indexing lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");
    const cooldownMs = [400, 401, 403, 404, 405, 422].includes(error?.statusCode) ? 5 * 60_000 : 30_000;
    embeddingProviderCooldowns.set(runtimeKey, Date.now() + cooldownMs);
    if (embeddingProviderCooldowns.size > 128) embeddingProviderCooldowns.delete(embeddingProviderCooldowns.keys().next().value);
    const errorReference = fingerprint(error instanceof Error ? error.message : "Embedding request failed").slice(0, 12);
    return {
      vectors: fallback,
      fallback,
      model: LOCAL_EMBEDDING_MODEL,
      provider: "HelloTest local hash embedding",
      warning_code: "embedding_fallback",
      warning_reason_code: error?.code || "EMBEDDING_UNAVAILABLE",
      warning: `The configured LLM model did not return compatible embeddings. Deterministic local hybrid retrieval was indexed instead (ref ${errorReference}).`
    };
  }
};

module.exports = {
  EMBEDDING_BATCH_SIZE,
  INGESTION_EMBEDDING_TIMEOUT_MS,
  LOCAL_EMBEDDING_MODEL,
  MAX_PROVIDER_EMBEDDING_DIMENSIONS,
  MAX_PROVIDER_EMBEDDING_RESPONSE_BYTES,
  RETRIEVAL_EMBEDDING_TIMEOUT_MS,
  embedTexts,
  getVectorCapability,
  normalizeProviderEmbeddingBatch,
  readJsonResponseWithLimit,
  requestCachedProviderEmbeddings,
  requestProviderEmbeddings,
  resolveEmbeddingRuntime,
  validateEmbeddingVector,
  vectorLiteral
};
