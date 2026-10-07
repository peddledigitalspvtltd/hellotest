const { randomUUID: uuid, createHash } = require("crypto");
const { Readable } = require("stream");
const db = require("@hellotest/platform/backend/src/db");
const { config } = require("@hellotest/platform/backend/src/config");
const attachmentService = require("@hellotest/platform/backend/services/attachment.service");
const aiLlmSelectionService = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const permissionService = require("@hellotest/platform/backend/services/permission.service");
const featureFlagService = require("@hellotest/platform/backend/services/featureFlag.service");
const knowledgeVectorStore = require("./knowledgeVectorStore.service");
const knowledgeContracts = require("./knowledgeContracts.service");
const knowledgeAuthorization = require("./knowledgeAuthorization.service");
const {
  PRODUCT_HELP_VERSION,
  rankProductHelpSections
} = require("./knowledgeProductCatalog.service");
const { fetchLlmWithRetry } = require("@hellotest/platform/backend/src/utils/llmHttpClient");
const { retryKnowledgeModel, readRetryAfterMs, validateModelEndpoint } = require("@hellotest/platform/backend/src/utils/knowledgeModelRetry");
const { modelHttpError } = require("@hellotest/platform/backend/src/utils/knowledgeAssistantErrors");
const cacheService = require("@hellotest/platform/backend/src/utils/cache");
const { assertRetrievalActive, boundedRetrievalStage, retrievalTimeout } = require("@hellotest/platform/backend/src/utils/knowledgeRetrievalTiming");
const { MAX_EXTRACTED_TEXT_CHARS, fingerprint, normalizeText, sanitizeAiText } = require("@hellotest/platform/backend/src/security/aiTextPolicy");
const {
  NATIVE_TEXT_MIME_TYPES,
  SUPPORTED_UPLOAD_MIME_TYPES,
  TIKA_MIME_TYPES,
  assessContextQuality,
  chunkText,
  cosineSimilarity,
  decodeNativeText,
  localEmbedding,
  normalizeChunkingOptions,
  validateUploadSignature
} = require("./knowledgeProcessing.service");

const MAX_INPUTS = 300;
const MAX_SEARCH_LIMIT = 50;
const MAX_CANDIDATES = 250;
const MAX_FALLBACK_CANDIDATES = 5_000;
const MIN_RETRIEVAL_RELEVANCE = 0.1;
const EMBEDDING_BATCH_SIZE = 64;
const MAX_PROVIDER_EMBEDDING_DIMENSIONS = 8_192;
const MAX_PROVIDER_EMBEDDING_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_MANUAL_INGESTION_RETRIES = 5;
const FAILED_INPUT_RETENTION_DAYS = 7;
const LOCAL_EMBEDDING_MODEL = "hellotest-hash-v1";
const RETRIEVAL_EMBEDDING_TIMEOUT_MS = 2_000;
// Optional semantic enrichment shares one document budget, including every
// provider batch and retry. Canonical lexical/local indexes do not wait on it.
const INGESTION_EMBEDDING_TIMEOUT_MS = 8_000;
const embeddingProviderCooldowns = new Map();
const KNOWLEDGE_PROCESSING_VERSION = "2026.10-intent-enrichment-v3";
const KNOWLEDGE_WORKER_ID = `knowledge-${process.pid}-${uuid()}`;
const SOURCE_KINDS = new Set(["requirement", "test_case", "execution", "bug", "knowledge_item", "text", "chat", "file", "url"]);
const SOURCE_PERMISSION_BY_KIND = Object.freeze({
  requirement: "requirement.view",
  test_case: "testcase.view",
  execution: "run.view",
  bug: "feedback.view"
});
const ASSISTANT_GUARDRAILS = [
  "Project membership and knowledge.view permission are enforced before retrieval.",
  "Sensitive values are deterministically redacted before embedding and prompt assembly.",
  "Retrieved content is untrusted data; instruction-like content is neutralized and flagged.",
  "Answers must stay within HelloTest and the selected project and cite retrieved chunks.",
  "System prompts, credentials, private reasoning, and user-profile tables are excluded; supported sensitive identifiers are redacted before retrieval."
];
const createError = (message, statusCode = 400, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
};

const { assertLlmIntegrationProjectScope } = require("./knowledgeIntegrationScope.service");

const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const asArray = (value) => Array.isArray(value) ? value : [];
const normalizeId = (value) => normalizeText(value, 255);
const isKnowledgeAdmin = (user) => Boolean(user && (user.role === "admin" || user.is_workspace_admin));
const normalizeSourceKind = (value, { fallback = "text" } = {}) => {
  const normalized = String(value || "text").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases = {
    requirement: "requirement",
    requirements: "requirement",
    story: "requirement",
    stories: "requirement",
    testcase: "test_case",
    testcases: "test_case",
    test_case: "test_case",
    test_cases: "test_case",
    execution: "execution",
    executions: "execution",
    run: "execution",
    runs: "execution",
    test_run: "execution",
    test_runs: "execution",
    bug: "bug",
    bugs: "bug",
    defect: "bug",
    defects: "bug",
    issue: "bug",
    issues: "bug"
  };
  const kind = aliases[normalized] || normalized;
  return SOURCE_KINDS.has(kind) ? kind : fallback;
};

const classifyIngestionError = (error, { stage = "processing" } = {}) => {
  const internalCode = normalizeText(error?.code, 120);
  const known = {
    KNOWLEDGE_LEASE_LOST: {
      code: "processing_interrupted",
      message: "Knowledge processing was interrupted before completion. Retry the job to resume from the retained source.",
      retryable: true
    },
    KNOWLEDGE_VERSION_SUPERSEDED: {
      code: "source_revision_superseded",
      message: "A newer source revision replaced this processing attempt. The newest revision should be used instead.",
      retryable: false
    },
    KNOWLEDGE_FILE_CHECKSUM_MISMATCH: {
      code: "source_integrity_mismatch",
      message: "The stored file no longer matches the accepted upload. Upload the source again.",
      retryable: false
    },
    KNOWLEDGE_INPUT_FINGERPRINT_MISMATCH: {
      code: "source_integrity_mismatch",
      message: "The retained extracted text did not match the accepted input. Upload the source again.",
      retryable: false
    },
    KNOWLEDGE_ATTACHMENT_SCOPE_MISMATCH: {
      code: "source_attachment_mismatch",
      message: "The staged file is no longer attached to this Knowledge source. Upload the source again.",
      retryable: false
    }
  };
  const statusCode = Number(error?.statusCode || error?.status || 0);
  const presentation = known[internalCode]
    || (statusCode === 403 ? {
      code: "source_permission_denied",
      message: "Knowledge processing no longer has access to this source. Review project permissions, then retry.",
      retryable: true
    } : statusCode === 404 ? {
      code: "source_unavailable",
      message: "The source or staged file is no longer available. Upload or select the source again.",
      retryable: false
    } : statusCode === 413 ? {
      code: "source_too_large",
      message: "The source exceeds the configured processing limit. Reduce or split it before uploading again.",
      retryable: false
    } : {
      code: "knowledge_processing_failed",
      message: "Knowledge processing stopped unexpectedly. Retry the retained source; if it repeats, share the reference code with an administrator.",
      retryable: true
    });
  const safeOriginalMessage = sanitizeAiText(error instanceof Error ? error.message : "Knowledge processing failed").text;
  return {
    ...presentation,
    stage,
    error_fingerprint: fingerprint(safeOriginalMessage || "Knowledge processing failed")
  };
};
const requiredPermissionForSourceKind = (sourceKind) => SOURCE_PERMISSION_BY_KIND[sourceKind] || null;
const usesEmbeddingsForMode = (mode) => mode !== "keyword";
const processingProfile = (chunking = {}) => {
  const normalizedChunking = normalizeChunkingOptions(chunking);
  return {
    version: KNOWLEDGE_PROCESSING_VERSION,
    chunking: normalizedChunking,
    fingerprint: fingerprint(JSON.stringify({ version: KNOWLEDGE_PROCESSING_VERSION, chunking: normalizedChunking }))
  };
};
const canReuseSourceVersion = ({ existing, readyDocument, contentHash, documentHash, processingFingerprint }) => Boolean(
  readyDocument
  && existing?.extraction_status === "ready"
  && existing?.checksum_sha256 === contentHash
  && (!documentHash || readyDocument.checksum_sha256 === documentHash)
  && (!processingFingerprint || asObject(readyDocument.metadata).processing_pipeline?.fingerprint === processingFingerprint)
);
const resolveAllowedSourcePermissions = async (user, projectId) => {
  if (!user) return [];
  const permissions = [...new Set(Object.values(SOURCE_PERMISSION_BY_KIND))];
  const checks = await Promise.all(permissions.map(async (permissionCode) => ({
    permissionCode,
    allowed: await permissionService.hasPermission(user, permissionCode, projectId)
      && await featureFlagService.areEnabled(featureFlagService.getFeatureKeysForPermission(permissionCode), { user })
  })));
  return checks.filter((check) => check.allowed).map((check) => check.permissionCode);
};
const sanitizeSourceUri = (value) => {
  const normalized = normalizeText(value, 4_000);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
};
const sanitizeExternalReferences = (value) => asArray(value).slice(0, 50).map((reference) => {
  if (typeof reference === "string") {
    return sanitizeSourceUri(reference) || sanitizeAiText(normalizeText(reference, 500)).text;
  }
  const raw = asObject(reference);
  const safe = {};
  for (const key of ["id", "key", "type", "label"]) {
    const sanitized = sanitizeAiText(normalizeText(raw[key], 240)).text;
    if (sanitized) safe[key] = sanitized;
  }
  const url = sanitizeSourceUri(raw.url || raw.uri || raw.href);
  if (url) safe.url = url;
  return Object.keys(safe).length ? safe : null;
}).filter(Boolean);
const toPublicSource = (source) => {
  const { _reused, _pending_checksum, _new, _had_ready_version, metadata, created_by, required_permission, ...safe } = source || {};
  return { ...safe, deduplicated: Boolean(_reused) };
};
const toPublicDocument = (document) => document ? ({
  id: document.id,
  project_id: document.project_id,
  source_id: document.source_id,
  canonical_id: document.source_id,
  knowledge_id: document.id,
  title: document.title,
  version: document.version,
  token_count: document.token_count,
  char_count: document.char_count,
  checksum_sha256: document.checksum_sha256,
  is_active: document.is_active,
  is_current: document.is_active,
  effective_from: document.effective_from,
  effective_to: document.effective_to,
  created_at: document.created_at,
  updated_at: document.updated_at
}) : null;

const getTikaUrl = () => {
  const raw = String(config.knowledge?.tikaUrl || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return new URL("/tika", `${parsed.toString().replace(/\/+$/, "")}/`).toString();
  } catch {
    return null;
  }
};

const extractWithTika = async (buffer, mimeType) => {
  const tikaUrl = getTikaUrl();
  if (!tikaUrl || !Buffer.isBuffer(buffer) || !TIKA_MIME_TYPES.has(mimeType)) return null;
  if (buffer.length > Number(config.knowledge?.extractionMaxBytes || 20 * 1024 * 1024)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(config.knowledge?.tikaTimeoutMs || 30_000));
  try {
    const response = await fetch(tikaUrl, {
      method: "PUT",
      headers: {
        Accept: "text/plain",
        "Content-Type": mimeType,
        "X-Tika-Skip-Embedded": "true",
        "X-Tika-PDFOcrStrategy": "no_ocr",
        "X-Tika-PDFextractInlineImages": "false"
      },
      body: buffer,
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Apache Tika returned ${response.status}`);
    if (!response.body) throw new Error("Apache Tika returned an empty response body");
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    const maxOutputBytes = MAX_EXTRACTED_TEXT_CHARS * 4;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxOutputBytes) {
        controller.abort();
        throw new Error("Apache Tika output exceeded the configured extraction limit");
      }
      chunks.push(Buffer.from(value));
    }
    const extracted = Buffer.concat(chunks).toString("utf8");
    if (extracted.length > MAX_EXTRACTED_TEXT_CHARS) throw new Error("Apache Tika output exceeded the configured character limit");
    return normalizeText(extracted);
  } finally {
    clearTimeout(timer);
  }
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

const embeddingCacheKey = (runtime, value) => `knowledge:embedding:v1:${fingerprint(`${runtime.integration?.id || runtime.baseUrl}:${runtime.model}:${value}`)}`;

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

const assertCollectionScope = async (projectId, collectionId) => {
  if (!collectionId) return null;
  const collection = await db.prepare("SELECT * FROM ai_knowledge_collections WHERE id = ? AND project_id = ?").get(collectionId, projectId);
  if (!collection) throw createError("Knowledge collection was not found in this project.", 404);
  return collection;
};

const compactJson = (value, maxLength = 2_000) => {
  try {
    return JSON.stringify(value ?? null).slice(0, maxLength);
  } catch {
    return "";
  }
};

const serializeRequirement = (row, linkedTestCaseIds = []) => ({
  source_kind: "requirement",
  source_ref_id: row.id,
  app_type_id: null,
  title: row.title || row.display_id || row.id,
  content: [
    `Story ${row.display_id || row.id}: ${row.title}`,
    `Status: ${row.status || "not recorded"}`,
    `Priority: ${row.priority ?? "not recorded"}`,
    row.release ? `Release: ${row.release}` : "",
    row.sprint ? `Sprint: ${row.sprint}` : "",
    row.description || "",
    row.specification_content || "",
    asArray(row.gherkin_scenarios).length ? compactJson(row.gherkin_scenarios, 8_000) : "",
    asArray(row.labels).length ? `Labels: ${compactJson(row.labels, 1_000)}` : "",
    sanitizeExternalReferences(row.external_references).length ? `External references: ${compactJson(sanitizeExternalReferences(row.external_references), 2_000)}` : "",
    linkedTestCaseIds.length ? `Linked Test Case IDs (${linkedTestCaseIds.length}): ${linkedTestCaseIds.join(", ")}` : "Linked Test Case IDs: none"
  ].filter(Boolean).join("\n\n"),
  metadata: {
    display_id: row.display_id,
    status: row.status,
    priority: row.priority,
    linked_test_case_ids: linkedTestCaseIds,
    linked_test_case_count: linkedTestCaseIds.length,
    source_updated_at: row.updated_at || row.created_at
  }
});

const serializeTestCase = async (row) => {
  const steps = await db.prepare(`
    SELECT step_order, action, expected_result, step_type
    FROM test_steps WHERE test_case_id = ? ORDER BY step_order ASC LIMIT 100
  `).all(row.id);
  const [requirementLinks, dataSets, modules, suite] = await Promise.all([
    db.prepare(`
      SELECT requirement_id FROM requirement_test_cases
      WHERE test_case_id = ? ORDER BY requirement_id LIMIT 50
    `).all(row.id),
    db.prepare(`
      SELECT data_sets.id, data_sets.name, data_sets.columns, data_sets.rows
      FROM test_case_data_sets links
      JOIN test_data_sets data_sets ON data_sets.id = links.test_data_set_id
      WHERE links.test_case_id = ? ORDER BY links.sort_order, data_sets.id LIMIT 3
    `).all(row.id),
    db.prepare(`
      SELECT modules.id, modules.name
      FROM test_case_module_cases links
      JOIN test_case_modules modules ON modules.id = links.module_id
      WHERE links.test_case_id = ? ORDER BY links.sort_order, modules.id LIMIT 20
    `).all(row.id),
    row.suite_id ? db.prepare("SELECT id, name FROM test_suites WHERE id = ?").get(row.suite_id) : null
  ]);
  const requirementIds = [...new Set([
    normalizeId(row.requirement_id),
    ...requirementLinks.map((link) => normalizeId(link.requirement_id))
  ].filter(Boolean))].slice(0, 50);
  const dataSetEvidence = dataSets.map((dataSet) => ({
    id: dataSet.id,
    name: dataSet.name,
    columns: asArray(dataSet.columns).slice(0, 50),
    first_row: asArray(dataSet.rows)[0] || null,
    row_count: asArray(dataSet.rows).length
  }));
  return {
    source_kind: "test_case",
    source_ref_id: row.id,
    app_type_id: row.app_type_id || null,
    title: row.title || row.display_id || row.id,
    content: [
      `Test Case ${row.display_id || row.id}: ${row.title}`,
      `Status: ${row.status || "not recorded"}`,
      `Priority: ${row.priority ?? "not recorded"}`,
      `Authoring mode: ${row.authoring_mode || "structured"}`,
      `Review status: ${row.review_status || "not_requested"}`,
      requirementIds.length ? `Requirement IDs: ${requirementIds.join(", ")}` : "",
      suite ? `Suite: ${suite.name} (${suite.id})` : "",
      modules.length ? `Modules: ${modules.map((module) => `${module.name} (${module.id})`).join(", ")}` : "",
      Object.keys(asObject(row.parameter_values)).length ? `Test parameters: ${compactJson(row.parameter_values, 4_000)}` : "",
      dataSetEvidence.length ? `Linked dataset evidence: ${compactJson(dataSetEvidence, 6_000)}` : "",
      asArray(row.labels).length ? `Labels: ${compactJson(row.labels, 1_000)}` : "",
      sanitizeExternalReferences(row.external_references).length ? `External references: ${compactJson(sanitizeExternalReferences(row.external_references), 2_000)}` : "",
      row.description || "",
      row.gherkin_document || "",
      ...steps.map((step) => `Step ${step.step_order}: ${step.action || ""}\nExpected: ${step.expected_result || ""}\nType: ${step.step_type || "manual"}`)
    ].filter(Boolean).join("\n\n"),
    metadata: {
      display_id: row.display_id,
      status: row.status,
      priority: row.priority,
      review_status: row.review_status,
      step_count: steps.length,
      requirement_ids: requirementIds,
      module_ids: modules.map((module) => module.id),
      suite_id: suite?.id || null,
      data_set_ids: dataSetEvidence.map((dataSet) => dataSet.id),
      source_updated_at: row.updated_at || row.created_at
    }
  };
};

const serializeExecution = async (row) => {
  const [results, countRows] = await Promise.all([
    db.prepare(`
      SELECT id, test_case_id, test_case_title, status, duration_ms, error, logs,
        test_data_set_id, test_data_set_name, data_set_iteration_index,
        data_set_row_snapshot, created_at
      FROM execution_results WHERE execution_id = ?
      ORDER BY CASE status WHEN 'failed' THEN 1 WHEN 'blocked' THEN 2 WHEN 'running' THEN 3 ELSE 4 END,
        created_at DESC, id DESC LIMIT 50
    `).all(row.id),
    db.prepare(`
      SELECT COALESCE(status, 'unknown') AS status, COUNT(*)::INTEGER AS count
      FROM execution_results WHERE execution_id = ?
      GROUP BY COALESCE(status, 'unknown')
      ORDER BY COALESCE(status, 'unknown')
    `).all(row.id)
  ]);
  const resultCounts = Object.fromEntries(countRows.map((entry) => [entry.status, Number(entry.count || 0)]));
  const sanitizeSnapshot = (value, maxLength) => sanitizeAiText(compactJson(value, maxLength)).text || null;
  const failureEvidence = results.filter((result) => ["failed", "blocked"].includes(result.status)).slice(0, 12).map((result) => ({
    result_id: result.id,
    test_case_id: result.test_case_id,
    test_case_title: result.test_case_title,
    status: result.status,
    error: normalizeText(result.error, 1_500) || null,
    log_excerpt: normalizeText(result.logs, 1_500) || null,
    data_set: result.test_data_set_name || result.test_data_set_id || null,
    iteration: result.data_set_iteration_index ?? null,
    data_set_row_snapshot: sanitizeSnapshot(result.data_set_row_snapshot, 2_000)
  }));
  const environmentSnapshot = sanitizeSnapshot(row.test_environment_snapshot, 3_000);
  const configurationSnapshot = sanitizeSnapshot(row.test_configuration_snapshot, 3_000);
  const dataSetSnapshot = sanitizeSnapshot(row.test_data_set_snapshot, 3_000);
  const failedOrBlockedTotal = Number(resultCounts.failed || 0) + Number(resultCounts.blocked || 0);
  return {
    source_kind: "execution",
    source_ref_id: row.id,
    app_type_id: row.app_type_id || null,
    title: row.name || `Test Run ${row.id}`,
    content: [
      `Test Run ${row.name || row.id}`,
      `Status: ${row.status || "not recorded"}`,
      `Trigger: ${row.trigger || "not recorded"}`,
      `Mode: ${row.execution_mode || "not recorded"}`,
      `Result summary: ${compactJson(resultCounts, 1_000)}`,
      row.test_environment_name ? `Environment: ${row.test_environment_name}` : "",
      environmentSnapshot ? `Environment snapshot: ${environmentSnapshot}` : "",
      row.test_configuration_name ? `Configuration: ${row.test_configuration_name}` : "",
      configurationSnapshot ? `Configuration snapshot: ${configurationSnapshot}` : "",
      row.test_data_set_name ? `Run dataset: ${row.test_data_set_name}` : "",
      dataSetSnapshot ? `Run dataset snapshot: ${dataSetSnapshot}` : "",
      row.release ? `Release: ${row.release}` : "",
      row.sprint ? `Sprint: ${row.sprint}` : "",
      row.build ? `Build: ${row.build}` : "",
      row.error_message ? `Recorded run error: ${normalizeText(row.error_message, 2_000)}` : "",
      failureEvidence.length ? `Failed or blocked case evidence: ${compactJson(failureEvidence, 12_000)}` : "No failed or blocked case results were recorded in the bounded result window."
    ].filter(Boolean).join("\n"),
    metadata: {
      status: row.status,
      release: row.release,
      sprint: row.sprint,
      build: row.build,
      result_counts: resultCounts,
      failed_or_blocked_count: failedOrBlockedTotal,
      failure_evidence_count: failureEvidence.length,
      failure_evidence_truncated: failedOrBlockedTotal > failureEvidence.length,
      result_evidence_window_count: results.length,
      result_evidence_truncated: Object.values(resultCounts).reduce((sum, count) => sum + Number(count || 0), 0) > results.length,
      environment_name: row.test_environment_name || null,
      configuration_name: row.test_configuration_name || null,
      data_set_name: row.test_data_set_name || null,
      source_updated_at: row.ended_at || row.started_at || row.created_at
    }
  };
};

const serializeBug = (row) => ({
  source_kind: "bug",
  source_ref_id: row.id,
  app_type_id: null,
  title: row.title || row.display_id || row.id,
  content: [
    `Defect ${row.display_id || row.id}: ${row.title}`,
    `Status: ${row.status || "not recorded"}`,
    `Severity: ${row.severity || "not recorded"}`,
    `Priority: ${row.priority || "not recorded"}`,
    row.environment ? `Environment: ${row.environment}` : "",
    row.build ? `Build: ${row.build}` : "",
    row.release ? `Release: ${row.release}` : "",
    row.sprint ? `Sprint: ${row.sprint}` : "",
    row.fix_version ? `Fix version: ${row.fix_version}` : "",
    row.linked_test_run_id ? `Linked Test Run ID: ${row.linked_test_run_id}` : "",
    asArray(row.linked_requirement_ids).length ? `Linked Story IDs: ${asArray(row.linked_requirement_ids).slice(0, 50).join(", ")}` : "",
    asArray(row.linked_test_case_ids).length ? `Linked Test Case IDs: ${asArray(row.linked_test_case_ids).slice(0, 50).join(", ")}` : "",
    asArray(row.linked_test_suite_ids).length ? `Linked Suite IDs: ${asArray(row.linked_test_suite_ids).slice(0, 50).join(", ")}` : "",
    asArray(row.linked_module_ids).length ? `Linked Module IDs: ${asArray(row.linked_module_ids).slice(0, 50).join(", ")}` : "",
    row.message || "",
    row.steps_to_reproduce ? `Steps to reproduce:\n${row.steps_to_reproduce}` : "",
    row.expected_result ? `Expected:\n${row.expected_result}` : "",
    row.actual_result ? `Actual:\n${row.actual_result}` : "",
    row.root_cause ? `Recorded root cause:\n${row.root_cause}` : ""
  ].filter(Boolean).join("\n\n"),
  metadata: {
    display_id: row.display_id,
    status: row.status,
    severity: row.severity,
    priority: row.priority,
    linked_test_run_id: row.linked_test_run_id || null,
    linked_requirement_ids: asArray(row.linked_requirement_ids).slice(0, 50),
    linked_test_case_ids: asArray(row.linked_test_case_ids).slice(0, 50),
    source_updated_at: row.updated_at || row.created_at
  }
});

const loadApplicationRecord = async (projectId, kind, id) => {
  if (kind === "requirement") {
    const row = await db.prepare(`
      SELECT id, display_id, title, description, gherkin_scenarios, specification_content,
        external_references, labels, priority, status, sprint, release, created_at, updated_at
      FROM requirements WHERE id = ? AND project_id = ?
    `).get(id, projectId);
    if (!row) throw createError(`Story ${id} was not found in this project.`, 404);
    const linkedTestCases = await db.prepare(`
      SELECT test_case_id FROM requirement_test_cases
      WHERE requirement_id = ? ORDER BY test_case_id LIMIT 100
    `).all(id);
    return serializeRequirement(row, linkedTestCases.map((link) => link.test_case_id));
  }
  if (kind === "test_case") {
    const row = await db.prepare(`
      SELECT test_cases.id, test_cases.display_id, test_cases.app_type_id, test_cases.title,
        test_cases.description, test_cases.gherkin_document, test_cases.authoring_mode,
        test_cases.priority, test_cases.status, test_cases.suite_id, test_cases.requirement_id,
        test_cases.parameter_values, test_cases.review_status, test_cases.external_references,
        test_cases.labels, test_cases.created_at, test_cases.updated_at
      FROM test_cases JOIN app_types ON app_types.id = test_cases.app_type_id
      WHERE test_cases.id = ? AND app_types.project_id = ?
    `).get(id, projectId);
    if (!row) throw createError(`Test Case ${id} was not found in this project.`, 404);
    return serializeTestCase(row);
  }
  if (kind === "execution") {
    const row = await db.prepare(`
      SELECT id, app_type_id, name, status, trigger, execution_mode, release, sprint, build,
        error_message, duration_ms, test_environment_name, test_configuration_name,
        test_data_set_name, test_environment_snapshot, test_configuration_snapshot,
        test_data_set_snapshot, created_at, started_at, ended_at
      FROM executions WHERE id = ? AND project_id = ?
    `).get(id, projectId);
    if (!row) throw createError(`Test Run ${id} was not found in this project.`, 404);
    return serializeExecution(row);
  }
  if (kind === "bug") {
    const row = await db.prepare(`
      SELECT id, display_id, title, message, steps_to_reproduce, expected_result, actual_result,
        root_cause, status, severity, priority, environment, build, sprint, fix_version, release,
        linked_test_run_id, linked_test_case_ids, linked_test_suite_ids, linked_module_ids,
        linked_requirement_ids, labels, created_at, updated_at
      FROM feedback WHERE id = ? AND project_id = ?
    `).get(id, projectId);
    if (!row) throw createError(`Defect ${id} was not found in this project.`, 404);
    return serializeBug(row);
  }
  throw createError(`Unsupported application record type: ${kind}`);
};

const normalizeSelectedRecordInputs = (selectedRecords) => {
  const selected = asObject(selectedRecords);
  const mappings = [
    ["requirements", "requirement"],
    ["test_cases", "test_case"],
    ["testCases", "test_case"],
    ["executions", "execution"],
    ["test_runs", "execution"],
    ["bugs", "bug"]
  ];
  const inputs = [];
  for (const [field, kind] of mappings) {
    for (const item of asArray(selected[field])) {
      const id = normalizeId(typeof item === "string" ? item : item?.id);
      if (id && !inputs.some((input) => input.kind === kind && input.entity_id === id)) inputs.push({ kind, entity_id: id });
    }
  }
  return inputs;
};

const getRecordSourcePermissionCodes = (rawInputs) => {
  const required = new Set();
  for (const rawInput of rawInputs) {
    const source = asObject(rawInput);
    const kind = normalizeSourceKind(source.kind || source.type || source.entity_type || source.source_kind);
    if (SOURCE_PERMISSION_BY_KIND[kind]) required.add(SOURCE_PERMISSION_BY_KIND[kind]);
  }
  return [...required];
};

const assertRecordSourcePermissions = async (projectId, rawInputs, user) => {
  const required = getRecordSourcePermissionCodes(rawInputs);
  for (const permissionCode of required) {
    if (!user || !await permissionService.hasPermission(user, permissionCode, projectId)) {
      throw createError(`Permission required to ingest selected records: ${permissionCode}`, 403, "KNOWLEDGE_SOURCE_PERMISSION_REQUIRED");
    }
  }
};

const sanitizeClientMetadata = (value, sourceKind) => {
  const raw = asObject(value);
  const safe = {};
  for (const key of ["submitted_from", "language"]) {
    if (typeof raw[key] !== "string") continue;
    const sanitized = sanitizeAiText(normalizeText(raw[key], 240));
    if (sanitized.text) safe[key] = sanitized.text;
  }
  if (sourceKind === "chat") safe.chat_role = raw.chat_role === "assistant" ? "assistant" : "user";
  return safe;
};

const stableSourceKey = ({ source_kind, source_ref_id, app_scope_key, app_type_id, checksum_sha256 } = {}) => {
  const kind = normalizeSourceKind(source_kind);
  const reference = normalizeId(source_ref_id);
  if (reference) return `ref:${kind}:${reference}`;
  const checksum = normalizeText(checksum_sha256, 128);
  if (!checksum) return null;
  return `hash:${kind}:${normalizeId(app_scope_key ?? app_type_id) || ""}:${checksum}`;
};

const applicationSnapshotFingerprint = (record = {}) => {
  const { snapshot_fingerprint, ...metadata } = asObject(record.metadata);
  return fingerprint(JSON.stringify({
    source_kind: normalizeSourceKind(record.source_kind),
    source_ref_id: normalizeId(record.source_ref_id),
    app_type_id: normalizeId(record.app_type_id) || null,
    title: sanitizeAiText(record.title).text,
    content: sanitizeAiText(record.content).text,
    metadata
  }));
};

const normalizeInput = async (projectId, input) => {
  const source = asObject(input);
  const kind = normalizeSourceKind(source.kind || source.type || source.entity_type || source.source_kind);
  const entityId = normalizeId(source.entity_id || source.source_ref_id || source.record_id);
  if (["requirement", "test_case", "execution", "bug"].includes(kind)) {
    if (!entityId) throw createError(`${kind} entity_id is required.`);
    const record = await loadApplicationRecord(projectId, kind, entityId);
    // Parent timestamps do not necessarily move when linked steps, datasets,
    // modules, or execution results change. Fingerprint the complete bounded
    // evidence snapshot so activation can reject a mixed/stale child view.
    record.metadata = {
      ...asObject(record.metadata),
      snapshot_fingerprint: applicationSnapshotFingerprint(record)
    };
    return record;
  }

  const supplied = normalizeText(source.content || source.text || source.extracted_text || source.transcript || source.caption);
  const title = normalizeText(source.title || source.file_name || (kind === "chat" ? "Chat context" : "Text context"), 500);
  if (!title) throw createError("Every context input requires a title.");
  return {
    source_kind: kind,
    source_ref_id: entityId || null,
    // Only the route-validated top-level app_type_id may scope client-authored
    // text/chat/URL inputs; nested IDs are discarded to prevent cross-project scope injection.
    app_type_id: null,
    title,
    content: supplied,
    source_uri: normalizeText(source.source_uri || source.url, 4_000) || null,
    file_name: normalizeText(source.file_name, 500) || null,
    mime_type: normalizeText(source.mime_type, 255) || null,
    size_bytes: Number.isFinite(Number(source.size_bytes)) ? Math.max(0, Number(source.size_bytes)) : null,
    extraction_strategy: supplied ? (source.extraction_strategy || "client_supplied") : "metadata_only",
    metadata: sanitizeClientMetadata({
      ...asObject(source.metadata),
      chat_role: kind === "chat" ? (source.role === "assistant" ? "assistant" : "user") : undefined
    }, kind)
  };
};

const isApplicationRecordSnapshotCurrent = async (projectId, input) => {
  const kind = input?.source_kind;
  const id = normalizeId(input?.source_ref_id);
  if (!SOURCE_PERMISSION_BY_KIND[kind] || !id) return true;
  // Re-serialize the same bounded, identity-free evidence immediately before
  // activation. This covers child tables whose writes do not touch the parent
  // updated_at (steps, links, datasets, modules, and run results).
  const expectedFingerprint = normalizeText(input?.metadata?.snapshot_fingerprint, 128);
  if (expectedFingerprint) {
    try {
      const fresh = await loadApplicationRecord(projectId, kind, id);
      return applicationSnapshotFingerprint(fresh) === expectedFingerprint;
    } catch {
      return false;
    }
  }
  let row;
  if (kind === "requirement") {
    row = await db.prepare("SELECT updated_at FROM requirements WHERE id = ? AND project_id = ?").get(id, projectId);
  } else if (kind === "test_case") {
    row = await db.prepare(`
      SELECT test_cases.updated_at FROM test_cases
      JOIN app_types ON app_types.id = test_cases.app_type_id
      WHERE test_cases.id = ? AND app_types.project_id = ?
    `).get(id, projectId);
  } else if (kind === "bug") {
    row = await db.prepare("SELECT updated_at FROM feedback WHERE id = ? AND project_id = ?").get(id, projectId);
  } else if (kind === "execution") {
    row = await db.prepare(`
      SELECT status, ended_at, started_at, created_at
      FROM executions WHERE id = ? AND project_id = ?
    `).get(id, projectId);
    if (row?.status !== input.metadata?.status) return false;
    row = row ? { updated_at: row.ended_at || row.started_at || row.created_at } : null;
  }
  return Boolean(row)
    && String(row.updated_at || "") === String(input.metadata?.source_updated_at || "");
};

const createJob = async ({ projectId, collectionId, inputCount, config: jobConfig, userId, status = "running", idempotencyKey }) => {
  const id = uuid();
  const normalizedStatus = status === "queued" ? "queued" : "running";
  const result = await db.prepare(`
    INSERT INTO ai_knowledge_ingestion_jobs (
      id, project_id, collection_id, status, input_count, config, idempotency_key,
      created_by, started_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    id,
    projectId,
    collectionId || null,
    normalizedStatus,
    inputCount,
    jobConfig,
    normalizeText(idempotencyKey, 255) || null,
    userId || null,
    normalizedStatus === "running" ? new Date().toISOString() : null
  );
  return getIngestionJob(id);
};

const getIngestionJob = async (id, { user } = {}) => {
  const job = await db.prepare("SELECT * FROM ai_knowledge_ingestion_jobs WHERE id = ?").get(id);
  if (!job) throw createError("Knowledge ingestion job not found.", 404);
  // Job titles, result source IDs and errors can reveal domain activity. Non-admin
  // users may inspect only jobs they initiated; null-owner jobs fail closed.
  if (user && !isKnowledgeAdmin(user) && (!job.created_by || job.created_by !== user.id)) {
    throw createError("This knowledge ingestion belongs to another workspace member.", 403, "KNOWLEDGE_JOB_ACCESS_DENIED");
  }
  const results = await db.prepare(`
    SELECT input_index, source_id, document_id, outcome, reused, warning_codes,
      error_fingerprint, created_at, updated_at
    FROM ai_knowledge_ingestion_results
    WHERE job_id = ? ORDER BY input_index ASC
  `).all(id);
  return toPublicIngestionJob(job, results);
};

const toPublicIngestionJob = (job, results = []) => {
  const rawConfig = asObject(job?.config);
  const safeConfig = {
    title: normalizeText(rawConfig.title, 500) || null,
    app_type_id: normalizeId(rawConfig.app_type_id) || null,
    chunking: asObject(rawConfig.chunking),
    upload: Boolean(rawConfig.upload),
    queue_version: Number(rawConfig.queue_version || 0) || null,
    retry_count: Math.max(0, Number(rawConfig.retry_count || 0) || 0),
    max_retries: MAX_MANUAL_INGESTION_RETRIES
  };
  const publicErrors = asArray(job.errors).map((entry) => ({
    input_index: Number.isInteger(entry?.input_index) ? entry.input_index : undefined,
    code: normalizeText(entry?.code, 120) || "ingestion_failed",
    message: normalizeText(entry?.message, 1_000) || "Knowledge processing needs attention.",
    retryable: entry?.retryable !== false,
    stage: normalizeText(entry?.stage, 120) || "processing",
    error_fingerprint: normalizeText(entry?.error_fingerprint, 128) || null
  }));
  return {
    id: job.id,
    project_id: job.project_id,
    collection_id: job.collection_id || null,
    status: job.status,
    input_count: Number(job.input_count || 0),
    processed_count: Number(job.processed_count || 0),
    failed_count: Number(job.failed_count || 0),
    chunk_count: Number(job.chunk_count || 0),
    warnings: asArray(job.warnings),
    errors: publicErrors,
    can_retry: job.status === "failed"
      && safeConfig.retry_count < MAX_MANUAL_INGESTION_RETRIES
      && (!publicErrors.length || publicErrors.some((entry) => entry.retryable)),
    config: safeConfig,
    created_at: job.created_at,
    started_at: job.started_at || null,
    completed_at: job.completed_at || null,
    updated_at: job.updated_at,
    results
  };
};

const recordIngestionResult = async (jobId, inputIndex, {
  sourceId,
  documentId,
  outcome,
  reused = false,
  warningCodes = [],
  errorFingerprint = null
}, { leaseOwner } = {}) => {
  const result = leaseOwner ? await db.prepare(`
    WITH owned_job AS (
      SELECT id FROM ai_knowledge_ingestion_jobs
      WHERE id = ? AND status = 'running' AND lease_owner = ?
        AND lease_expires_at > CURRENT_TIMESTAMP
      FOR UPDATE
    )
    INSERT INTO ai_knowledge_ingestion_results (
      job_id, input_index, source_id, document_id, outcome, reused, warning_codes, error_fingerprint
    )
    SELECT owned_job.id, ?, ?, ?, ?, ?, ?, ? FROM owned_job
    ON CONFLICT (job_id, input_index) DO UPDATE SET
      source_id = EXCLUDED.source_id, document_id = EXCLUDED.document_id,
      outcome = EXCLUDED.outcome, reused = EXCLUDED.reused,
      warning_codes = EXCLUDED.warning_codes, error_fingerprint = EXCLUDED.error_fingerprint,
      updated_at = CURRENT_TIMESTAMP
    RETURNING job_id
  `).get(jobId, leaseOwner, inputIndex, sourceId || null, documentId || null, outcome, Boolean(reused), warningCodes, errorFingerprint)
    : await db.prepare(`
      INSERT INTO ai_knowledge_ingestion_results (
        job_id, input_index, source_id, document_id, outcome, reused, warning_codes, error_fingerprint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (job_id, input_index) DO UPDATE SET
        source_id = EXCLUDED.source_id, document_id = EXCLUDED.document_id,
        outcome = EXCLUDED.outcome, reused = EXCLUDED.reused,
        warning_codes = EXCLUDED.warning_codes, error_fingerprint = EXCLUDED.error_fingerprint,
        updated_at = CURRENT_TIMESTAMP
      RETURNING job_id
    `).get(jobId, inputIndex, sourceId || null, documentId || null, outcome, Boolean(reused), warningCodes, errorFingerprint);
  if (leaseOwner && !result) throw createError("Knowledge ingestion lease was lost before recording provenance.", 409, "KNOWLEDGE_LEASE_LOST");
  return result;
};

const createSource = async ({ projectId, collectionId, input, userId, jobId, leaseOwner, _leaseLocked = false }) => {
  if (jobId && !_leaseLocked) {
    return db.transaction(async () => {
      const ownedJob = leaseOwner ? await db.prepare(`
        SELECT id FROM ai_knowledge_ingestion_jobs
        WHERE id = ? AND project_id = ? AND status = 'running' AND lease_owner = ?
          AND lease_expires_at > CURRENT_TIMESTAMP
        FOR UPDATE
      `).get(jobId, projectId, leaseOwner) : await db.prepare(`
        SELECT id FROM ai_knowledge_ingestion_jobs
        WHERE id = ? AND project_id = ? AND status IN ('queued', 'running')
        FOR UPDATE
      `).get(jobId, projectId);
      if (!ownedJob) throw createError("Knowledge ingestion lease was lost before source persistence.", 409, "KNOWLEDGE_LEASE_LOST");
      return createSource({ projectId, collectionId, input, userId, jobId, leaseOwner, _leaseLocked: true });
    })();
  }
  const sanitizedContent = sanitizeAiText(input.content || "").text;
  const safeTitle = sanitizeAiText(input.title).text || "Untitled knowledge source";
  const safeFileName = input.file_name ? sanitizeAiText(input.file_name).text : null;
  const safeSourceUri = sanitizeSourceUri(input.source_uri);
  const contentHash = normalizeText(input.checksum_sha256, 128) || (sanitizedContent ? fingerprint(sanitizedContent) : null);
  const documentHash = sanitizedContent ? fingerprint(sanitizedContent) : null;
  const requiredPermission = requiredPermissionForSourceKind(input.source_kind);
  const appScopeKey = normalizeId(input.app_type_id) || "";
  const revisionToken = uuid();
  let existing = null;
  if (input.source_ref_id) {
    existing = await db.prepare(`
      SELECT * FROM ai_knowledge_sources
      WHERE project_id = ? AND source_kind = ? AND source_ref_id = ?
      ORDER BY updated_at DESC LIMIT 1
    `).get(projectId, input.source_kind, input.source_ref_id);
  } else if (contentHash) {
    existing = await db.prepare(`
      SELECT * FROM ai_knowledge_sources
      WHERE project_id = ? AND app_scope_key = ?
        AND source_kind = ? AND checksum_sha256 = ?
      ORDER BY updated_at DESC LIMIT 1
    `).get(projectId, appScopeKey, input.source_kind, contentHash);
  }
  if (existing) {
    await db.prepare(`INSERT INTO ai_knowledge_security_bindings
      (id, project_id, source_id, principal_type, principal_id, effect, inherited)
      VALUES (?, ?, ?, 'PROJECT', ?, 'ALLOW', TRUE) ON CONFLICT (id) DO NOTHING`
    ).run(`${existing.id}:project-read`, projectId, existing.id, projectId);
    if (collectionId) {
      await db.prepare(`
        INSERT INTO ai_knowledge_collection_sources (collection_id, source_id)
        VALUES (?, ?) ON CONFLICT (collection_id, source_id) DO NOTHING
      `).run(collectionId, existing.id);
    }
    const readyDocument = await db.prepare(`
      SELECT id, checksum_sha256, metadata FROM ai_knowledge_documents
      WHERE source_id = ? AND is_active = TRUE LIMIT 1
    `).get(existing.id);
    if (canReuseSourceVersion({ existing, readyDocument, contentHash, documentHash, processingFingerprint: input.processing_fingerprint })) {
      return { ...existing, _reused: true, _new: false, _had_ready_version: true };
    }
    // Reserve only an index attempt. Visible source metadata changes atomically
    // with promotion after every required index is ready.
    await db.prepare(`UPDATE ai_knowledge_sources SET revision_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(revisionToken, existing.id);
    return {
      ...existing,
      app_type_id: input.app_type_id || null,
      title: safeTitle,
      source_uri: safeSourceUri,
      file_name: safeFileName || existing.file_name || null,
      mime_type: input.mime_type || existing.mime_type || null,
      size_bytes: input.size_bytes ?? existing.size_bytes ?? null,
      extraction_strategy: input.extraction_strategy || (input.content ? "structured_record" : "metadata_only"),
      metadata: asObject(input.metadata),
      required_permission: requiredPermission,
      revision_token: revisionToken,
      _pending_checksum: contentHash,
      _pending_source_update: true,
      _new: false,
      _had_ready_version: Boolean(readyDocument)
    };
  }

  const id = uuid();
  const status = input.content ? "processing" : "needs_extraction";
  try {
    await db.prepare(`
      INSERT INTO ai_knowledge_sources (
        id, project_id, app_type_id, app_scope_key, source_kind, source_ref_id, title, source_uri,
        file_name, mime_type, size_bytes, checksum_sha256, required_permission, extraction_status,
        extraction_strategy, metadata, risk_flags, created_by, revision_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, projectId, input.app_type_id || null, appScopeKey, input.source_kind, input.source_ref_id || null,
      safeTitle, safeSourceUri, safeFileName, input.mime_type || null,
      input.size_bytes ?? null, contentHash, requiredPermission, status,
      input.extraction_strategy || (input.content ? "structured_record" : "metadata_only"),
      asObject(input.metadata), [], userId || null, revisionToken
    );
  } catch (error) {
    if (error?.code !== "23505") throw error;
    // A concurrent request won the stable-reference/content-hash insert. Re-read
    // that winner and apply the normal version/dedup logic instead of failing or
    // creating duplicate chunks.
    return createSource({ projectId, collectionId, input, userId, jobId, leaseOwner, _leaseLocked: true });
  }
  if (collectionId) {
    await db.prepare(`
      INSERT INTO ai_knowledge_collection_sources (collection_id, source_id)
      VALUES (?, ?) ON CONFLICT (collection_id, source_id) DO NOTHING
    `).run(collectionId, id);
  }
  await db.prepare(`INSERT INTO ai_knowledge_security_bindings
    (id, project_id, source_id, principal_type, principal_id, effect, inherited)
    VALUES (?, ?, ?, 'PROJECT', ?, 'ALLOW', TRUE) ON CONFLICT (id) DO NOTHING`
  ).run(`${id}:project-read`, projectId, id, projectId);
  return {
    ...await db.prepare("SELECT * FROM ai_knowledge_sources WHERE id = ?").get(id),
    _new: true,
    _had_ready_version: false
  };
};

const markSourcePersistenceFailed = async (source, { jobId, leaseOwner } = {}) => {
  if (!source?.id || source._reused || source._had_ready_version) return;
  if (leaseOwner) {
    const result = await db.transaction(async () => {
      const owned = await db.prepare(`
        SELECT id FROM ai_knowledge_ingestion_jobs
        WHERE id = ? AND status = 'running' AND lease_owner = ?
          AND lease_expires_at > CURRENT_TIMESTAMP
        FOR UPDATE
      `).get(jobId, leaseOwner);
      if (!owned) return { owned: false };
      const updated = await db.prepare(`
        UPDATE ai_knowledge_sources
        SET extraction_status = 'failed', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND (?::TEXT IS NULL OR revision_token = ?)
          AND NOT EXISTS (
            SELECT 1 FROM ai_knowledge_documents
            WHERE source_id = ai_knowledge_sources.id AND is_active = TRUE
          )
        RETURNING id
      `).get(source.id, source.revision_token || null, source.revision_token || null);
      return { owned: true, updated: Boolean(updated) };
    })();
    if (!result?.owned) throw createError("Knowledge ingestion lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");
    return;
  }
  await db.prepare(`
    UPDATE ai_knowledge_sources
    SET extraction_status = 'failed', updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND (?::TEXT IS NULL OR revision_token = ?)
      AND NOT EXISTS (
        SELECT 1 FROM ai_knowledge_documents
        WHERE source_id = ai_knowledge_sources.id AND is_active = TRUE
      )
  `).run(source.id, source.revision_token || null, source.revision_token || null);
};

const markSourceNeedsExtraction = async (source, { jobId, leaseOwner } = {}) => {
  if (!source?.id) return;
  if (leaseOwner) {
    const result = await db.transaction(async () => {
      const owned = await db.prepare(`
        SELECT id FROM ai_knowledge_ingestion_jobs
        WHERE id = ? AND status = 'running' AND lease_owner = ?
          AND lease_expires_at > CURRENT_TIMESTAMP
        FOR UPDATE
      `).get(jobId, leaseOwner);
      if (!owned) return false;
      await db.prepare(`
        UPDATE ai_knowledge_sources
        SET extraction_status = 'needs_extraction', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND revision_token = ? AND extraction_status <> 'ready'
      `).run(source.id, source.revision_token);
      return true;
    })();
    if (!result) throw createError("Knowledge ingestion lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");
    return;
  }
  await db.prepare(`
    UPDATE ai_knowledge_sources
    SET extraction_status = 'needs_extraction', updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND revision_token = ? AND extraction_status <> 'ready'
  `).run(source.id, source.revision_token);
};

const removeUnactivatedNewSourceAfterLeaseLoss = async (source) => {
  if (!source?._new || !source.id || !source.revision_token) return;
  await db.prepare(`
    UPDATE ai_knowledge_sources sources
    SET extraction_status = 'archived',
      revision_token = id || ':lease-lost:' || EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::TEXT || ':' || RANDOM()::TEXT,
      updated_at = CURRENT_TIMESTAMP
    WHERE sources.id = ? AND sources.revision_token = ? AND sources.attachment_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ai_knowledge_documents documents
        WHERE documents.source_id = sources.id AND documents.is_active = TRUE
      )
  `).run(source.id, source.revision_token);
};

const persistEmbeddingVector = async (chunkId, vector) => {
  if (!await getVectorCapability()) return false;
  try {
    await db.prepare("UPDATE ai_knowledge_chunks SET embedding_vector = ?::vector WHERE id = ?").run(vectorLiteral(vector), chunkId);
    return true;
  } catch {
    // A malformed row or provider-dimension mismatch must degrade this row only;
    // extension capability is independently probed and remains available.
    return false;
  }
};

const buildChunkRetrievalText = ({ title, chunk } = {}) => [
  normalizeText(title, 500) ? `Document: ${normalizeText(title, 500)}` : null,
  asArray(chunk?.heading_path).length
    ? `Section path: ${chunk.heading_path.map((item) => normalizeText(item, 240)).filter(Boolean).join(" > ")}`
    : normalizeText(chunk?.heading, 500) ? `Section: ${normalizeText(chunk.heading, 500)}` : null,
  normalizeText(chunk?.section_type, 80) && chunk.section_type !== "body"
    ? `Content type: ${normalizeText(chunk.section_type, 80).replace(/_/g, " ")}`
    : null,
  normalizeText(chunk?.content, 100_000)
].filter(Boolean).join("\n");

const buildDocumentContextProfile = ({ title, chunks } = {}) => ({
  title: normalizeText(title, 500) || "Untitled knowledge source",
  headings: [...new Set(asArray(chunks).map((chunk) => normalizeText(chunk?.heading, 500)).filter(Boolean))].slice(0, 80),
  section_paths: [...new Set(asArray(chunks).map((chunk) => asArray(chunk?.heading_path).map((item) => normalizeText(item, 240)).filter(Boolean).join(" > ")).filter(Boolean))].slice(0, 120),
  section_types: [...new Set(asArray(chunks).map((chunk) => normalizeText(chunk?.section_type, 80)).filter(Boolean))].slice(0, 20),
  chunk_count: asArray(chunks).length,
  hierarchy_strategy: "document-title+section-lineage+content-type+content"
});

const persistDocument = async ({ projectId, source, content, chunking, embeddingRuntime, metadata = {}, activationGuard, signal }) => {
  const sanitized = sanitizeAiText(content);
  if (!sanitized.text) return { document: null, chunks: [], warning: "No extractable text was available; the source was retained for a caption, transcript, or extraction step." };
  const documentId = uuid();
  const checksum = fingerprint(sanitized.text);
  let version = null;
  const chunks = chunkText(sanitized.text, chunking);
  if (!chunks.length) return { document: null, chunks: [], warning: "No searchable chunks could be produced from this source." };
  const contextQuality = assessContextQuality({ text: sanitized.text, chunks, redactionCount: sanitized.redaction_count });
  const documentContext = buildDocumentContextProfile({ title: source.title, chunks });
  const pipeline = processingProfile(chunking);
  const retrievalTexts = chunks.map((chunk) => buildChunkRetrievalText({ title: source.title, chunk }));
  let embeddingResult = await embedTexts({ configured: false }, retrievalTexts, { signal });
  if (signal?.aborted) throw createError("Knowledge indexing lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");

  const persistedChunks = [];
  const commitDocumentVersion = db.transaction(async () => {
    const lockedSource = await db.prepare(`
      SELECT id, revision_token FROM ai_knowledge_sources
      WHERE id = ? AND project_id = ? AND extraction_status <> 'archived'
      FOR UPDATE
    `).get(source.id, projectId);
    if (!lockedSource) throw createError("Knowledge source no longer exists in this project.", 404);
    if (!source.revision_token || lockedSource.revision_token !== source.revision_token) {
      throw createError("Knowledge source changed while indexing; this stale version was not activated.", 409, "KNOWLEDGE_VERSION_SUPERSEDED");
    }
    if (activationGuard && !await activationGuard()) {
      throw createError("Knowledge source changed or was archived while indexing; this version was not activated.", 409, "KNOWLEDGE_VERSION_SUPERSEDED");
    }
    const versionRow = await db.prepare(`
      SELECT COALESCE(MAX(version), 0)::INTEGER + 1 AS version
      FROM ai_knowledge_documents WHERE source_id = ?
    `).get(source.id);
    version = Number(versionRow?.version || 1);
    await db.prepare(`
      INSERT INTO ai_knowledge_documents (
        id, project_id, source_id, title, content, version, token_count, char_count,
        checksum_sha256, metadata, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)
    `).run(
      documentId, projectId, source.id, source.title, sanitized.text, version,
      Math.ceil(sanitized.text.length / 4), sanitized.text.length, checksum,
      { ...metadata, source_snapshot: { source_kind: source.source_kind, source_ref_id: source.source_ref_id || null,
        title: source.title, source_uri: sanitizeSourceUri(source.source_uri), attachment_id: source.attachment_id || null,
        checksum_sha256: source._pending_checksum || source.checksum_sha256 || null },
        processing_pipeline: pipeline, context_quality: contextQuality, document_context: documentContext, redactions: sanitized.redactions, redaction_count: sanitized.redaction_count, control_character_count: sanitized.control_character_count, risk_flags: sanitized.risk_flags }
    );

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const id = uuid();
      await db.prepare(`
        INSERT INTO ai_knowledge_chunks (
          id, project_id, document_id, source_id, chunk_index, heading, content, token_count,
          char_start, char_end, search_vector, embedding, fallback_embedding, embedding_model, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, to_tsvector('simple', ?), ?, ?, ?, ?)
      `).run(
        id, projectId, documentId, source.id, chunk.index, chunk.heading, chunk.content,
        chunk.token_count, chunk.char_start, chunk.char_end, retrievalTexts[index],
        embeddingResult.vectors[index], embeddingResult.fallback[index], embeddingResult.model,
        { fragment_key: `${(chunk.heading_path || []).join("/") || "body"}:${chunk.index}`,
          document_title: documentContext.title, section_heading: chunk.heading || null, section_path: chunk.heading_path || [], section_type: chunk.section_type || "body", section_level: chunk.section_level || null, hierarchy_strategy: documentContext.hierarchy_strategy, context_quality_grade: contextQuality.grade, context_quality_score: contextQuality.score, risk_flags: sanitized.risk_flags, redaction_count: sanitized.redaction_count }
      );
      persistedChunks.push({ id, ...chunk, document_id: documentId, source_id: source.id });
    }

    // Re-check after all potentially long chunk writes and immediately before
    // the active-version flip. Child evidence writers do not share this source
    // row lock, so the first pre-insert check alone is not a sufficient guard.
    if (activationGuard && !await activationGuard()) {
      throw createError("Knowledge evidence changed while indexing; the stale document was not activated.", 409, "KNOWLEDGE_VERSION_SUPERSEDED");
    }
    await db.prepare(`
      INSERT INTO ai_knowledge_index_states (
        document_id, project_id, source_id, document_version, is_current,
        lexical_state, dense_state, vector_provider, embedding_model,
        embedding_dimensions, indexed_chunk_count, indexed_at
      ) VALUES (?, ?, ?, ?, FALSE, 'ready', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (document_id) DO UPDATE SET
        is_current = FALSE,
        lexical_state = 'ready',
        dense_state = EXCLUDED.dense_state,
        vector_provider = EXCLUDED.vector_provider,
        embedding_model = EXCLUDED.embedding_model,
        embedding_dimensions = EXCLUDED.embedding_dimensions,
        indexed_chunk_count = EXCLUDED.indexed_chunk_count,
        error_fingerprint = NULL,
        indexed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      documentId, projectId, source.id, version,
      "ready", "postgresql",
      embeddingResult.model, embeddingResult.vectors[0]?.length || null, persistedChunks.length
    );
  });
  await commitDocumentVersion();

  const activateDocumentVersion = db.transaction(async () => {
    const current = await db.prepare(`SELECT id, revision_token FROM ai_knowledge_sources
      WHERE id = ? AND project_id = ? AND extraction_status <> 'archived' FOR UPDATE`).get(source.id, projectId);
    if (!current || current.revision_token !== source.revision_token || (activationGuard && !await activationGuard())) {
      throw createError("Knowledge source changed before index promotion.", 409, "KNOWLEDGE_VERSION_SUPERSEDED");
    }
    const ready = await db.prepare(`SELECT document_id FROM ai_knowledge_index_states
      WHERE document_id = ? AND lexical_state = 'ready' AND dense_state = 'ready'`).get(documentId);
    if (!ready) throw createError("Required knowledge indexes are not ready.", 409, "ERR_INDEX_NOT_READY");
    await db.prepare(`
      UPDATE ai_knowledge_documents SET is_active = FALSE, effective_to = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE source_id = ? AND id <> ? AND is_active = TRUE
    `).run(source.id, documentId);
    await db.prepare(`UPDATE ai_knowledge_index_states SET is_current = FALSE, updated_at = CURRENT_TIMESTAMP
      WHERE source_id = ? AND document_id <> ? AND is_current = TRUE`).run(source.id, documentId);
    await db.prepare(`UPDATE ai_knowledge_documents SET is_active = TRUE, effective_from = CURRENT_TIMESTAMP,
      effective_to = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(documentId);
    await db.prepare(`UPDATE ai_knowledge_index_states SET is_current = TRUE, required_indexes_ready = TRUE,
      updated_at = CURRENT_TIMESTAMP WHERE document_id = ?`).run(documentId);
    await db.prepare(`
      UPDATE ai_knowledge_sources
      SET app_type_id = ?, title = ?, source_uri = ?, file_name = ?, mime_type = ?, size_bytes = ?,
        extraction_strategy = ?, metadata = ?, required_permission = ?,
        extraction_status = 'ready', checksum_sha256 = COALESCE(?, checksum_sha256),
        risk_flags = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      source.app_type_id || null, source.title, sanitizeSourceUri(source.source_uri), source.file_name || null,
      source.mime_type || null, source.size_bytes ?? null, source.extraction_strategy || null,
      asObject(source.metadata), source.required_permission || null,
      source._pending_checksum || null, sanitized.risk_flags, source.id
    );
  });
  // Publish a complete canonical revision before contacting optional providers.
  // PostgreSQL already contains FTS and deterministic local vectors, so readers
  // can use the current source during enrichment or a provider outage.
  await activateDocumentVersion();
  const semanticProfile = await require("./knowledgeEnrichment.service").enrichDocument({ projectId, source, chunks, signal });
  const runtime = typeof embeddingRuntime === "function" ? await embeddingRuntime() : embeddingRuntime;
  embeddingResult = await embedTexts(runtime || { configured: false }, retrievalTexts, { signal });
  if (signal?.aborted) throw createError("Knowledge indexing lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");

  const assertCurrentEnrichment = async () => {
    const current = await db.prepare(`SELECT sources.id, sources.revision_token
      FROM ai_knowledge_sources sources JOIN ai_knowledge_documents documents ON documents.source_id = sources.id
      WHERE sources.id = ? AND sources.project_id = ? AND sources.extraction_status = 'ready'
        AND documents.id = ? AND documents.is_active = TRUE FOR UPDATE OF sources
    `).get(source.id, projectId, documentId);
    if (!current || current.revision_token !== source.revision_token || signal?.aborted || (activationGuard && !await activationGuard())) {
      throw createError("Knowledge source changed during optional enrichment.", 409, "KNOWLEDGE_VERSION_SUPERSEDED");
    }
  };
  await db.transaction(async () => {
    await assertCurrentEnrichment();
    await db.prepare(`UPDATE ai_knowledge_documents SET metadata = metadata || ?::jsonb
      WHERE id = ? AND project_id = ? AND is_active = TRUE`).run({ llm_context_profile: semanticProfile }, documentId, projectId);
    for (const section of semanticProfile.sections) {
      const index = chunks.findIndex(chunk => chunk.index === section.chunk_index);
      if (index < 0) continue;
      await db.prepare(`UPDATE ai_knowledge_chunks SET metadata = metadata || ?::jsonb,
        search_vector = to_tsvector('simple', ?) WHERE id = ? AND document_id = ?`).run(
          { llm_context_hint: { ...section, generated: true, authoritative: false } },
          `${retrievalTexts[index]}\n${section.excerpt}`, persistedChunks[index].id, documentId);
    }
    if (embeddingResult.model !== LOCAL_EMBEDDING_MODEL) {
      for (let index = 0; index < persistedChunks.length; index += 1) {
        await db.prepare(`UPDATE ai_knowledge_chunks SET embedding = ?, embedding_model = ?
          WHERE id = ? AND document_id = ?`).run(embeddingResult.vectors[index], embeddingResult.model, persistedChunks[index].id, documentId);
      }
      await db.prepare(`UPDATE ai_knowledge_index_states SET embedding_model = ?, embedding_dimensions = ?,
        updated_at = CURRENT_TIMESTAMP WHERE document_id = ? AND is_current = TRUE
      `).run(embeddingResult.model, embeddingResult.vectors[0]?.length || null, documentId);
    }
  })();
  // Optional pgvector casts stay outside the document transaction; a provider
  // dimension/extension error cannot roll back the canonical JSONB/FTS indexes.
  for (let index = 0; index < persistedChunks.length; index += 1) {
    if (signal?.aborted) throw createError("Knowledge indexing lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");
    await persistEmbeddingVector(persistedChunks[index].id, embeddingResult.vectors[index]);
  }
  let projectionWarning = null;
  if (knowledgeVectorStore.isConfigured()) {
    try {
      // PostgreSQL remains canonical. Qdrant stores only stable canonical IDs
      // and ACL-filterable projection metadata; content is hydrated from the
      // active PostgreSQL revision after vector retrieval.
      const active = await db.prepare(`SELECT id, revision_token FROM ai_knowledge_sources
        WHERE id = ? AND project_id = ? AND extraction_status <> 'archived'`).get(source.id, projectId);
      if (active?.revision_token !== source.revision_token) throw createError("A newer Knowledge document superseded the vector projection.", 409, "KNOWLEDGE_VERSION_SUPERSEDED");
      const projection = await boundedRetrievalStage((projectionSignal) => knowledgeVectorStore.replaceDocument({
        projectId,
        source,
        documentId,
        chunks: persistedChunks,
        vectors: embeddingResult.vectors,
        embeddingModel: embeddingResult.model,
        signal: projectionSignal
      }), { timeoutMs: 8_000, signal, code: "VECTOR_PROJECTION_TIMEOUT" });
      await db.transaction(async () => {
        await assertCurrentEnrichment();
        await db.prepare(`
          UPDATE ai_knowledge_index_states
          SET dense_state = 'ready', vector_provider = 'qdrant',
            embedding_dimensions = ?, indexed_chunk_count = ?, error_fingerprint = NULL,
            indexed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE document_id = ? AND is_current = TRUE
        `).run(projection.dimensions, projection.indexed, documentId);
      })();
    } catch (error) {
      if (signal?.aborted || error?.code === "KNOWLEDGE_VERSION_SUPERSEDED") throw error;
      const errorReference = fingerprint(error instanceof Error ? error.message : "Qdrant projection failed");
      await db.prepare(`
        UPDATE ai_knowledge_index_states
        SET vector_provider = 'postgresql', error_fingerprint = ?, updated_at = CURRENT_TIMESTAMP
        WHERE document_id = ? AND is_current = TRUE
      `).run(errorReference, documentId).catch(() => undefined);
      projectionWarning = `The current revision is searchable using PostgreSQL lexical and local indexes. The optional vector projection is unavailable (ref ${errorReference.slice(0, 12)}).`;
    }
  }

  const document = await db.prepare("SELECT * FROM ai_knowledge_documents WHERE id = ?").get(documentId);
  const warning = [embeddingResult.warning, projectionWarning, contextQuality.requires_review ? `Context quality ${contextQuality.score}/100 requires review before relying on this source.` : null].filter(Boolean).join(" ") || null;
  return {
    document,
    chunks: persistedChunks,
    context_quality: contextQuality,
    warning_code: embeddingResult.warning_code || (projectionWarning ? "vector_projection_degraded" : contextQuality.requires_review ? "context_quality_review" : null),
    warning
  };
};

const completeJob = async (jobId, { processed, failed, chunkCount, warnings, errors }, { leaseOwner } = {}) => {
  const status = failed && !processed ? "failed" : warnings.length || failed ? "completed_with_warnings" : "completed";
  const result = await db.prepare(`
    UPDATE ai_knowledge_ingestion_jobs
    SET status = ?, processed_count = ?, failed_count = ?, chunk_count = ?, warnings = ?, errors = ?,
      completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
      lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL
    WHERE id = ? ${leaseOwner ? "AND status = 'running' AND lease_owner = ?" : ""}
  `).run(status, processed, failed, chunkCount, warnings, errors, jobId, ...(leaseOwner ? [leaseOwner] : []));
  if (leaseOwner && !result.changes) throw createError("Knowledge ingestion lease was lost before completion.", 409, "KNOWLEDGE_LEASE_LOST");
  return getIngestionJob(jobId);
};

const ingest = async ({ projectId, collectionId, appTypeId, title, inputs, selectedRecords, chunking, integrationId, user, existingJobId, leaseOwner, signal }) => {
  const normalizedProjectId = normalizeId(projectId);
  if (!normalizedProjectId) throw createError("project_id is required.");
  await assertCollectionScope(normalizedProjectId, collectionId);
  const rawInputs = [...asArray(inputs), ...normalizeSelectedRecordInputs(selectedRecords)];
  if (!rawInputs.length) throw createError("Choose at least one Story, Test Case, Test Run, Defect, text, chat, URL, or file input.");
  if (rawInputs.length > MAX_INPUTS) throw createError(`A single ingestion can contain at most ${MAX_INPUTS} inputs.`);
  await assertRecordSourcePermissions(normalizedProjectId, rawInputs, user);
  const chunkingOptions = normalizeChunkingOptions(asObject(chunking));
  // Validate explicit selections before writes; discover the optional default
  // only after the canonical document has become searchable.
  let embeddingRuntimePromise;
  const embeddingRuntime = integrationId
    ? await resolveEmbeddingRuntime({ userId: user?.id, projectId: normalizedProjectId, integrationId, signal })
    : () => (embeddingRuntimePromise ||= resolveEmbeddingRuntime({ userId: user?.id, projectId: normalizedProjectId, signal }));
  const job = existingJobId
    ? await getIngestionJob(existingJobId)
    : await createJob({
        projectId: normalizedProjectId,
        collectionId,
        inputCount: rawInputs.length,
        config: { title: normalizeText(title, 500) || null, app_type_id: normalizeId(appTypeId) || null, chunking: chunkingOptions },
        userId: user?.id
      });
  if (job.project_id !== normalizedProjectId || (existingJobId && job.status !== "running")) {
    throw createError("Queued knowledge ingestion job is not in a processable project state.", 409);
  }
  const sources = [];
  const documents = [];
  const warnings = [];
  const errors = [];
  let chunkCount = 0;
  let processed = 0;
  let failed = 0;
  let deduplicatedCount = 0;

  for (let index = 0; index < rawInputs.length; index += 1) {
    let source = null;
    try {
      const input = await normalizeInput(normalizedProjectId, rawInputs[index]);
      input.app_type_id = input.app_type_id || normalizeId(appTypeId) || null;
      input.processing_fingerprint = processingProfile(chunkingOptions).fingerprint;
      source = await createSource({
        projectId: normalizedProjectId,
        collectionId,
        input,
        userId: user?.id,
        jobId: job.id,
        leaseOwner
      });
      sources.push(source);
      if (source._reused) {
        deduplicatedCount += 1;
        warnings.push({ input_index: index, source_id: source.id, code: "deduplicated", message: "An identical current source was already indexed and was reused." });
        await recordIngestionResult(job.id, index, { sourceId: source.id, outcome: "reused", reused: true, warningCodes: ["deduplicated"] }, { leaseOwner });
        processed += 1;
        continue;
      }
      const persisted = await persistDocument({
        projectId: normalizedProjectId,
        source,
        content: input.content,
        chunking: chunkingOptions,
        embeddingRuntime,
        metadata: { source_kind: input.source_kind, source_ref_id: input.source_ref_id },
        signal,
        activationGuard: async () => {
          if (!await isApplicationRecordSnapshotCurrent(normalizedProjectId, input)) return false;
          if (!leaseOwner) return true;
          const lease = await db.prepare(`
            SELECT 1 AS owned FROM ai_knowledge_ingestion_jobs
            WHERE id = ? AND status = 'running' AND lease_owner = ?
              AND lease_expires_at > CURRENT_TIMESTAMP
          `).get(job.id, leaseOwner);
          return Boolean(lease?.owned) && !signal?.aborted;
        }
      });
      if (persisted.document) documents.push(toPublicDocument(persisted.document));
      if (!persisted.document) {
        await markSourceNeedsExtraction(source, { jobId: job.id, leaseOwner });
      }
      chunkCount += persisted.chunks.length;
      if (persisted.warning) warnings.push({ input_index: index, source_id: source.id, code: persisted.warning_code || "indexing_warning", message: persisted.warning });
      await recordIngestionResult(job.id, index, {
        sourceId: source.id,
        documentId: persisted.document?.id,
        outcome: persisted.document ? "indexed" : "needs_extraction",
        warningCodes: persisted.warning ? [persisted.warning_code || "indexing_warning"] : []
      }, { leaseOwner });
      processed += 1;
    } catch (error) {
      try {
        await markSourcePersistenceFailed(source, { jobId: job.id, leaseOwner });
      } catch (persistenceError) {
        if (persistenceError?.code === "KNOWLEDGE_LEASE_LOST") {
          await removeUnactivatedNewSourceAfterLeaseLoss(source);
        }
        throw persistenceError;
      }
      failed += 1;
      const classifiedError = classifyIngestionError(error, { stage: "indexing" });
      errors.push({ input_index: index, ...classifiedError });
      await recordIngestionResult(job.id, index, {
        sourceId: source?.id,
        outcome: "failed",
        errorFingerprint: classifiedError.error_fingerprint
      }, { leaseOwner });
    }
    if (existingJobId) {
      const progress = await db.prepare(`
        UPDATE ai_knowledge_ingestion_jobs SET updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'running' AND lease_owner = ?
      `).run(job.id, leaseOwner);
      if (!progress.changes) throw createError("Knowledge ingestion lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");
    }
  }
  const completedJob = await completeJob(job.id, { processed, failed, chunkCount, warnings, errors }, { leaseOwner });
  return { job: completedJob, sources: sources.map(toPublicSource), documents, chunk_count: chunkCount, deduplicated_count: deduplicatedCount, warnings };
};

const prepareQueuedInput = async (projectId, rawInput, appTypeId) => {
  const source = asObject(rawInput);
  const kind = normalizeSourceKind(source.kind || source.type || source.entity_type || source.source_kind);
  const entityId = normalizeId(source.entity_id || source.source_ref_id || source.record_id);
  if (SOURCE_PERMISSION_BY_KIND[kind]) {
    if (!entityId) throw createError(`${kind} entity_id is required.`);
    return {
      kind,
      entity_id: entityId,
      stable_source_key: stableSourceKey({ source_kind: kind, source_ref_id: entityId })
    };
  }
  const normalized = await normalizeInput(projectId, source);
  const scopedAppTypeId = normalizeId(appTypeId) || null;
  const sanitizedContent = sanitizeAiText(normalized.content || "").text;
  const contentChecksum = sanitizedContent ? fingerprint(sanitizedContent) : null;
  return {
    kind: normalized.source_kind,
    entity_id: normalized.source_ref_id || undefined,
    app_type_id: scopedAppTypeId || undefined,
    title: sanitizeAiText(normalized.title).text,
    content: sanitizedContent,
    source_uri: sanitizeSourceUri(normalized.source_uri),
    file_name: normalized.file_name ? sanitizeAiText(normalized.file_name).text : undefined,
    mime_type: normalized.mime_type || undefined,
    size_bytes: normalized.size_bytes ?? undefined,
    extraction_strategy: normalized.extraction_strategy,
    metadata: normalized.metadata,
    stable_source_key: stableSourceKey({
      source_kind: normalized.source_kind,
      app_type_id: scopedAppTypeId,
      checksum_sha256: contentChecksum
    }) || undefined
  };
};

const enqueueIngestion = async ({
  projectId,
  collectionId,
  appTypeId,
  title,
  inputs,
  selectedRecords,
  chunking,
  idempotencyKey,
  user
}) => {
  const normalizedProjectId = normalizeId(projectId);
  if (!normalizedProjectId) throw createError("project_id is required.");
  await assertCollectionScope(normalizedProjectId, collectionId);
  const rawInputs = [...asArray(inputs), ...normalizeSelectedRecordInputs(selectedRecords)];
  if (!rawInputs.length) throw createError("Choose at least one Story, Test Case, Test Run, Defect, text, chat, URL, or file input.");
  if (rawInputs.length > MAX_INPUTS) throw createError(`A single ingestion can contain at most ${MAX_INPUTS} inputs.`);
  await assertRecordSourcePermissions(normalizedProjectId, rawInputs, user);
  const preparedInputs = [];
  for (const rawInput of rawInputs) preparedInputs.push(await prepareQueuedInput(normalizedProjectId, rawInput, appTypeId));
  const chunkingOptions = normalizeChunkingOptions(asObject(chunking));
  const normalizedIdempotencyKey = normalizeText(idempotencyKey, 255) || null;
  const requestFingerprint = fingerprint(JSON.stringify({
    project_id: normalizedProjectId,
    collection_id: normalizeId(collectionId),
    app_type_id: normalizeId(appTypeId),
    title: normalizeText(title, 500),
    chunking: chunkingOptions,
    inputs: preparedInputs
  }));

  if (normalizedIdempotencyKey) {
    const existing = await db.prepare(`
      SELECT * FROM ai_knowledge_ingestion_jobs
      WHERE project_id = ? AND created_by = ? AND idempotency_key = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(normalizedProjectId, user?.id, normalizedIdempotencyKey);
    if (existing) {
      if (asObject(existing.config).request_fingerprint !== requestFingerprint) {
        throw createError("Idempotency-Key was already used for a different knowledge ingestion request.", 409, "IDEMPOTENCY_KEY_REUSED");
      }
      return {
        accepted: ["queued", "running"].includes(existing.status),
        idempotent_replay: true,
        job: toPublicIngestionJob(existing),
        sources: [],
        documents: [],
        chunk_count: Number(existing.chunk_count || 0),
        deduplicated_count: 0,
        warnings: asArray(existing.warnings),
        status_url: `/knowledge/ingestions/${existing.id}`
      };
    }
  }

  let job;
  try {
    job = await db.transaction(async () => {
      const created = await createJob({
      projectId: normalizedProjectId,
      collectionId,
      inputCount: preparedInputs.length,
      config: {
        title: normalizeText(title, 500) || null,
        app_type_id: normalizeId(appTypeId) || null,
        chunking: chunkingOptions,
        request_fingerprint: requestFingerprint,
        queue_version: 1
      },
      userId: user?.id,
      status: "queued",
      idempotencyKey: normalizedIdempotencyKey
    });
      for (let index = 0; index < preparedInputs.length; index += 1) {
        await db.prepare(`
          INSERT INTO ai_knowledge_ingestion_inputs (job_id, input_index, payload)
          VALUES (?, ?, ?)
        `).run(created.id, index, preparedInputs[index]);
      }
      return created;
    })();
  } catch (error) {
    if (error?.code !== "23505" || !normalizedIdempotencyKey) throw error;
    const existing = await db.prepare(`
      SELECT * FROM ai_knowledge_ingestion_jobs
      WHERE project_id = ? AND created_by = ? AND idempotency_key = ?
    `).get(normalizedProjectId, user?.id, normalizedIdempotencyKey);
    if (!existing || asObject(existing.config).request_fingerprint !== requestFingerprint) {
      throw createError("Idempotency-Key was already used for a different knowledge ingestion request.", 409, "IDEMPOTENCY_KEY_REUSED");
    }
    return {
      accepted: ["queued", "running"].includes(existing.status),
      idempotent_replay: true,
      job: toPublicIngestionJob(existing),
      sources: [],
      documents: [],
      chunk_count: Number(existing.chunk_count || 0),
      deduplicated_count: 0,
      warnings: asArray(existing.warnings),
      status_url: `/knowledge/ingestions/${existing.id}`
    };
  }
  return {
    accepted: true,
    idempotent_replay: false,
    job,
    sources: [],
    documents: [],
    chunk_count: 0,
    deduplicated_count: 0,
    warnings: [],
    status_url: `/knowledge/ingestions/${job.id}`
  };
};

const claimQueuedIngestion = (workerId, leaseMinutes) => db.transaction(async () => {
  const queued = await db.prepare(`
    SELECT id FROM ai_knowledge_ingestion_jobs
    WHERE status = 'queued'
    ORDER BY created_at ASC, id ASC
    LIMIT 1 FOR UPDATE SKIP LOCKED
  `).get();
  if (!queued) return null;
  return db.prepare(`
    UPDATE ai_knowledge_ingestion_jobs
    SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
      lease_owner = ?, lease_expires_at = CURRENT_TIMESTAMP + (?::INTEGER * INTERVAL '1 minute'),
      heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'queued'
    RETURNING *
  `).get(workerId, leaseMinutes, queued.id);
})();

const renewIngestionLease = async (jobId, workerId, leaseMinutes) => db.prepare(`
  UPDATE ai_knowledge_ingestion_jobs
  SET lease_expires_at = CURRENT_TIMESTAMP + (?::INTEGER * INTERVAL '1 minute'),
    heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND status = 'running' AND lease_owner = ?
`).run(leaseMinutes, jobId, workerId);

const processQueuedIngestions = async ({ limit = 2, staleAfterMinutes = 60 } = {}) => {
  const normalizedLimit = Math.max(1, Math.min(10, Number.parseInt(limit, 10) || 2));
  const normalizedStaleMinutes = Math.max(15, Math.min(24 * 60, Number.parseInt(staleAfterMinutes, 10) || 60));
  const leaseMinutes = Math.max(5, Math.min(30, Math.ceil(normalizedStaleMinutes / 4)));
  await db.prepare(`
    UPDATE ai_knowledge_ingestion_jobs
    SET status = 'queued', started_at = NULL, updated_at = CURRENT_TIMESTAMP,
      lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
      warnings = warnings || ?::jsonb
    WHERE status = 'running' AND completed_at IS NULL
      AND (
        (lease_expires_at IS NOT NULL AND lease_expires_at < CURRENT_TIMESTAMP)
        OR (lease_expires_at IS NULL AND updated_at < CURRENT_TIMESTAMP - (?::INTEGER * INTERVAL '1 minute'))
      )
  `).run([{ code: "stale_lease_recovered", message: "A stale ingestion lease was recovered after a worker restart." }], normalizedStaleMinutes);
  // Retain sanitized failed inputs long enough for a manual retry, then purge
  // stale payload copies. Staged file retries remain reconstructable from their
  // scoped attachment even after this retention window.
  await db.prepare(`
    DELETE FROM ai_knowledge_ingestion_inputs inputs
    WHERE EXISTS (
      SELECT 1 FROM ai_knowledge_ingestion_jobs jobs
      WHERE jobs.id = inputs.job_id AND jobs.status = 'failed'
        AND jobs.updated_at < CURRENT_TIMESTAMP - (?::INTEGER * INTERVAL '1 day')
    )
  `).run(FAILED_INPUT_RETENTION_DAYS);

  const outcomes = [];
  for (let index = 0; index < normalizedLimit; index += 1) {
    const job = await claimQueuedIngestion(KNOWLEDGE_WORKER_ID, leaseMinutes);
    if (!job) break;
    let terminalStatePersisted = false;
    let queuedInputs = [];
    let jobConfig = {};
    const leaseController = new AbortController();
    const heartbeat = setInterval(async () => {
      try {
        const renewed = await renewIngestionLease(job.id, KNOWLEDGE_WORKER_ID, leaseMinutes);
        if (!renewed.changes) leaseController.abort();
      } catch (error) {
        leaseController.abort();
        console.warn(JSON.stringify({
          event: "knowledge_ingestion_lease_heartbeat_failed",
          job_id: job.id,
          error_fingerprint: fingerprint(error instanceof Error ? error.message : String(error))
        }));
      }
    }, 30_000);
    heartbeat.unref?.();
    try {
      queuedInputs = await db.prepare(`
        SELECT payload FROM ai_knowledge_ingestion_inputs
        WHERE job_id = ? ORDER BY input_index ASC
      `).all(job.id);
      if (!queuedInputs.length) throw createError("Queued knowledge inputs are unavailable.", 409);
      jobConfig = asObject(job.config);
      const workerUser = job.created_by ? await db.prepare(`
        SELECT id, is_workspace_admin FROM users WHERE id = ?
      `).get(job.created_by) : null;
      if (workerUser?.is_workspace_admin) workerUser.role = "admin";
      const result = jobConfig.upload
        ? await processQueuedUpload({ job, payload: asObject(queuedInputs[0].payload), user: workerUser, leaseOwner: KNOWLEDGE_WORKER_ID, signal: leaseController.signal })
        : await ingest({
            projectId: job.project_id,
            collectionId: job.collection_id,
            appTypeId: jobConfig.app_type_id,
            title: jobConfig.title,
            inputs: queuedInputs.map((row) => row.payload),
            chunking: jobConfig.chunking,
            user: workerUser,
            existingJobId: job.id,
            leaseOwner: KNOWLEDGE_WORKER_ID,
            signal: leaseController.signal
          });
      terminalStatePersisted = true;
      outcomes.push({ id: job.id, status: result.job.status });
    } catch (error) {
      const classifiedError = classifyIngestionError(error, {
        stage: jobConfig.upload ? "file_processing" : "indexing"
      });
      if (jobConfig.upload) {
        const stagedSourceId = normalizeId(asObject(queuedInputs[0]?.payload).source_id);
        if (stagedSourceId) {
          await markSourcePersistenceFailed({
            id: stagedSourceId,
            revision_token: asObject(queuedInputs[0]?.payload).revision_token,
            _new: true,
            _had_ready_version: false
          }, { jobId: job.id, leaseOwner: KNOWLEDGE_WORKER_ID });
          await recordIngestionResult(job.id, 0, {
            sourceId: stagedSourceId,
            outcome: "failed",
            errorFingerprint: classifiedError.error_fingerprint
          }, { leaseOwner: KNOWLEDGE_WORKER_ID });
        }
      }
      await completeJob(job.id, {
        processed: 0,
        failed: Number(job.input_count || 1),
        chunkCount: 0,
        warnings: [],
        errors: [classifiedError]
      }, { leaseOwner: KNOWLEDGE_WORKER_ID });
      terminalStatePersisted = true;
      console.warn(JSON.stringify({
        event: "knowledge_ingestion_job_failed",
        job_id: job.id,
        project_id: job.project_id,
        stage: classifiedError.stage,
        error_code: classifiedError.code,
        retryable: classifiedError.retryable,
        error_fingerprint: classifiedError.error_fingerprint
      }));
      outcomes.push({ id: job.id, status: "failed" });
    } finally {
      clearInterval(heartbeat);
      if (terminalStatePersisted) await db.prepare(`
        DELETE FROM ai_knowledge_ingestion_inputs inputs
        WHERE inputs.job_id = ? AND EXISTS (
          SELECT 1 FROM ai_knowledge_ingestion_jobs jobs
          WHERE jobs.id = inputs.job_id AND jobs.status IN ('completed', 'completed_with_warnings')
        )
      `).run(job.id);
    }
  }
  return outcomes;
};

const retryIngestion = async ({ id, user }) => {
  const visibleJob = await getIngestionJob(id, { user });
  const retry = await db.transaction(async () => {
    const job = await db.prepare(`
      SELECT * FROM ai_knowledge_ingestion_jobs WHERE id = ? FOR UPDATE
    `).get(id);
    if (!job) throw createError("Knowledge ingestion job not found.", 404);
    if (["queued", "running"].includes(job.status)) return { job, alreadyAccepted: true };
    if (job.status !== "failed") {
      throw createError("Only a failed Knowledge ingestion can be retried.", 409, "KNOWLEDGE_RETRY_NOT_ALLOWED");
    }

    const jobConfig = asObject(job.config);
    const retryCount = Math.max(0, Number(jobConfig.retry_count || 0) || 0);
    if (retryCount >= MAX_MANUAL_INGESTION_RETRIES) {
      throw createError(`This ingestion reached the ${MAX_MANUAL_INGESTION_RETRIES}-retry safety limit. Upload or select the source again to start a clean job.`, 409, "KNOWLEDGE_RETRY_LIMIT_REACHED");
    }

    let queuedInputs = await db.prepare(`
      SELECT input_index FROM ai_knowledge_ingestion_inputs
      WHERE job_id = ? ORDER BY input_index ASC
    `).all(id);
    if (!queuedInputs.length && jobConfig.upload) {
      const source = await db.prepare(`
        SELECT sources.id, sources.project_id, sources.attachment_id, sources.checksum_sha256,
          sources.revision_token, sources.mime_type
        FROM ai_knowledge_ingestion_results results
        JOIN ai_knowledge_sources sources ON sources.id = results.source_id
        WHERE results.job_id = ? AND sources.project_id = ?
        ORDER BY results.input_index ASC LIMIT 1
      `).get(id, job.project_id);
      const canReextract = source && (
        NATIVE_TEXT_MIME_TYPES.has(source.mime_type)
        || (TIKA_MIME_TYPES.has(source.mime_type) && Boolean(getTikaUrl()))
      );
      if (!source?.attachment_id || !source.checksum_sha256 || !source.revision_token || !canReextract) {
        throw createError("The retained retry input is unavailable. Upload this source again so its text can be extracted safely.", 409, "KNOWLEDGE_RETRY_INPUT_UNAVAILABLE");
      }
      await db.prepare(`
        INSERT INTO ai_knowledge_ingestion_inputs (job_id, input_index, payload)
        VALUES (?, 0, ?)
      `).run(id, {
        kind: "staged_file",
        source_id: source.id,
        attachment_id: source.attachment_id,
        checksum_sha256: source.checksum_sha256,
        supplied_text: null,
        supplied_text_hash: null,
        revision_token: source.revision_token
      });
      queuedInputs = [{ input_index: 0 }];
    }
    if (!queuedInputs.length) {
      throw createError("The retained retry input has expired. Start a new context build from the source records.", 409, "KNOWLEDGE_RETRY_INPUT_UNAVAILABLE");
    }

    await db.prepare(`
      UPDATE ai_knowledge_sources sources
      SET extraction_status = CASE
          WHEN EXISTS (
            SELECT 1 FROM ai_knowledge_documents documents
            WHERE documents.source_id = sources.id AND documents.is_active = TRUE
          ) THEN 'ready' ELSE 'processing' END,
        updated_at = CURRENT_TIMESTAMP
      WHERE sources.id IN (
        SELECT results.source_id FROM ai_knowledge_ingestion_results results
        WHERE results.job_id = ? AND results.source_id IS NOT NULL
      ) AND sources.extraction_status = 'failed'
    `).run(id);
    await db.prepare("DELETE FROM ai_knowledge_ingestion_results WHERE job_id = ?").run(id);
    const updated = await db.prepare(`
      UPDATE ai_knowledge_ingestion_jobs
      SET status = 'queued', processed_count = 0, failed_count = 0, chunk_count = 0,
        warnings = ?, errors = ?, config = ?, started_at = NULL, completed_at = NULL,
        lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'failed'
      RETURNING *
    `).get(
      [{ code: "manual_retry_queued", message: `Retry ${retryCount + 1} was queued from the retained source.` }],
      [],
      { ...jobConfig, retry_count: retryCount + 1 },
      id
    );
    if (!updated) throw createError("The ingestion changed while the retry was being queued.", 409, "KNOWLEDGE_RETRY_RACE");
    return { job: updated, alreadyAccepted: false };
  })();
  return {
    accepted: true,
    idempotent_replay: retry.alreadyAccepted,
    job: toPublicIngestionJob(retry.job),
    status_url: `/knowledge/ingestions/${visibleJob.id}`
  };
};

const archiveLegacyKnowledgeSource = async (projectId, sourceRefId) => {
  const vectorTargets = knowledgeVectorStore.isConfigured() ? await db.prepare(`
    SELECT sources.id AS source_id, states.embedding_dimensions
    FROM ai_knowledge_sources sources
    LEFT JOIN ai_knowledge_index_states states ON states.source_id = sources.id
    WHERE sources.project_id = ? AND sources.source_kind = 'knowledge_item'
      AND sources.source_ref_id = ? AND states.embedding_dimensions IS NOT NULL
  `).all(projectId, sourceRefId).catch(() => []) : [];
  await db.prepare(`
    UPDATE ai_knowledge_sources
    SET extraction_status = 'archived',
      revision_token = id || ':archived:' || EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::TEXT || ':' || RANDOM()::TEXT,
      updated_at = CURRENT_TIMESTAMP
    WHERE project_id = ? AND source_kind = 'knowledge_item' AND source_ref_id = ?
  `).run(projectId, sourceRefId);
  await db.prepare(`
    UPDATE ai_knowledge_documents SET is_active = FALSE, effective_to = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE source_id IN (
      SELECT id FROM ai_knowledge_sources
      WHERE project_id = ? AND source_kind = 'knowledge_item' AND source_ref_id = ?
    ) AND is_active = TRUE
  `).run(projectId, sourceRefId);
  await db.prepare(`
    UPDATE ai_knowledge_index_states SET is_current = FALSE, updated_at = CURRENT_TIMESTAMP
    WHERE source_id IN (
      SELECT id FROM ai_knowledge_sources
      WHERE project_id = ? AND source_kind = 'knowledge_item' AND source_ref_id = ?
    ) AND is_current = TRUE
  `).run(projectId, sourceRefId);
  await Promise.allSettled(vectorTargets.map((target) => knowledgeVectorStore.deleteSource({
    projectId,
    sourceId: target.source_id,
    dimensions: Number(target.embedding_dimensions)
  })));
};

const queueLegacyKnowledgeSync = async ({ projectId, sourceRefId, userId, action = "upsert" }) => {
  const normalizedProjectId = normalizeId(projectId);
  const normalizedSourceRefId = normalizeId(sourceRefId);
  if (!normalizedProjectId || !normalizedSourceRefId) throw createError("Legacy knowledge sync requires projectId and sourceRefId.");
  const id = uuid();
  return db.prepare(`
    INSERT INTO ai_knowledge_sync_outbox (
      id, project_id, source_ref_id, action, status, requested_by
    ) VALUES (?, ?, ?, ?, 'queued', ?)
    ON CONFLICT (project_id, source_ref_id) DO UPDATE SET
      action = EXCLUDED.action,
      status = 'queued',
      attempts = 0,
      requested_by = EXCLUDED.requested_by,
      lease_owner = NULL,
      lease_expires_at = NULL,
      error_fingerprint = NULL,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, project_id, source_ref_id, action, status
  `).get(id, normalizedProjectId, normalizedSourceRefId, action === "archive" ? "archive" : "upsert", userId || null);
};

const claimLegacyKnowledgeSync = (workerId, leaseMinutes) => db.transaction(async () => {
  const queued = await db.prepare(`
    SELECT id FROM ai_knowledge_sync_outbox
    WHERE status = 'queued'
    ORDER BY created_at ASC, id ASC
    LIMIT 1 FOR UPDATE SKIP LOCKED
  `).get();
  if (!queued) return null;
  return db.prepare(`
    UPDATE ai_knowledge_sync_outbox
    SET status = 'running', attempts = attempts + 1, lease_owner = ?,
      lease_expires_at = CURRENT_TIMESTAMP + (?::INTEGER * INTERVAL '1 minute'),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'queued'
    RETURNING *
  `).get(workerId, leaseMinutes, queued.id);
})();

const processLegacyKnowledgeSyncOutbox = async ({ limit = 4, leaseMinutes = 10 } = {}) => {
  const normalizedLimit = Math.max(1, Math.min(20, Number.parseInt(limit, 10) || 4));
  const normalizedLeaseMinutes = Math.max(2, Math.min(30, Number.parseInt(leaseMinutes, 10) || 10));
  await db.prepare(`
    UPDATE ai_knowledge_sync_outbox
    SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE status = 'running' AND lease_expires_at < CURRENT_TIMESTAMP
  `).run();
  const outcomes = [];
  for (let index = 0; index < normalizedLimit; index += 1) {
    const event = await claimLegacyKnowledgeSync(KNOWLEDGE_WORKER_ID, normalizedLeaseMinutes);
    if (!event) break;
    const leaseController = new AbortController();
    const heartbeat = setInterval(async () => {
      try {
        const renewed = await db.prepare(`
          UPDATE ai_knowledge_sync_outbox
          SET lease_expires_at = CURRENT_TIMESTAMP + (?::INTEGER * INTERVAL '1 minute'),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'running' AND lease_owner = ?
        `).run(normalizedLeaseMinutes, event.id, KNOWLEDGE_WORKER_ID);
        if (!renewed.changes) leaseController.abort();
      } catch {
        leaseController.abort();
      }
    }, 30_000);
    heartbeat.unref?.();
    try {
      const record = event.action === "upsert" ? await db.prepare(`
        SELECT id, project_id, app_type_id, title, description, content_type,
          content, source_uri, is_active
        FROM ai_knowledge_repo WHERE id = ? AND project_id = ?
      `).get(event.source_ref_id, event.project_id) : null;
      if (!record || !record.is_active || !normalizeText(record.content)) {
        await db.transaction(async () => {
          const owned = await db.prepare(`
            SELECT 1 AS owned FROM ai_knowledge_sync_outbox
            WHERE id = ? AND status = 'running' AND lease_owner = ?
            FOR UPDATE
          `).get(event.id, KNOWLEDGE_WORKER_ID);
          if (!owned || leaseController.signal.aborted) throw createError("Legacy sync lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");
          await archiveLegacyKnowledgeSource(event.project_id, event.source_ref_id);
        })();
      } else {
        await syncLegacyKnowledgeItem(event.project_id, record, event.requested_by, {
          signal: leaseController.signal,
          activationGuard: async () => {
            const owned = await db.prepare(`
              SELECT 1 AS owned FROM ai_knowledge_sync_outbox
              WHERE id = ? AND status = 'running' AND lease_owner = ?
                AND lease_expires_at > CURRENT_TIMESTAMP
              FOR SHARE
            `).get(event.id, KNOWLEDGE_WORKER_ID);
            return Boolean(owned?.owned) && !leaseController.signal.aborted;
          }
        });
      }
      const deleted = await db.prepare(`
        DELETE FROM ai_knowledge_sync_outbox
        WHERE id = ? AND status = 'running' AND lease_owner = ?
      `).run(event.id, KNOWLEDGE_WORKER_ID);
      outcomes.push({ id: event.id, status: deleted.changes ? "completed" : "superseded" });
    } catch (error) {
      const errorFingerprint = fingerprint(error instanceof Error ? error.message : "legacy sync failed");
      await db.prepare(`
        UPDATE ai_knowledge_sync_outbox
        SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END,
          lease_owner = NULL, lease_expires_at = NULL, error_fingerprint = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND lease_owner = ?
      `).run(errorFingerprint, event.id, KNOWLEDGE_WORKER_ID);
      outcomes.push({ id: event.id, status: "retry_scheduled", error_fingerprint: errorFingerprint });
    } finally {
      clearInterval(heartbeat);
    }
  }
  return outcomes;
};

const streamToBoundedBuffer = async (stream, maxBytes) => {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) {
      stream.destroy?.();
      throw createError(`Stored knowledge file exceeds the ${maxBytes}-byte processing limit.`, 413);
    }
    chunks.push(buffer);
  }
  if (!bytes) throw createError("Stored knowledge file is empty.", 409);
  return Buffer.concat(chunks);
};

const processQueuedUpload = async ({ job, payload, user, leaseOwner, signal }) => {
  if (signal?.aborted) throw createError("Knowledge ingestion lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");
  const source = await db.prepare(`
    SELECT id, project_id, app_type_id, source_kind, source_ref_id, title, file_name,
      mime_type, size_bytes, attachment_id, checksum_sha256, extraction_status,
      extraction_strategy, metadata, revision_token
    FROM ai_knowledge_sources WHERE id = ? AND project_id = ?
  `).get(payload.source_id, job.project_id);
  if (!source?.attachment_id || source.attachment_id !== payload.attachment_id) {
    throw createError("Queued knowledge upload is no longer attached to its project source.", 409);
  }
  if (!payload.revision_token || source.revision_token !== payload.revision_token) {
    throw createError("A newer upload revision superseded this queued file.", 409, "KNOWLEDGE_VERSION_SUPERSEDED");
  }
  const suppliedText = normalizeText(payload.supplied_text);
  if ((suppliedText ? fingerprint(suppliedText) : null) !== (payload.supplied_text_hash || null)) {
    throw createError("Queued extracted text fingerprint is invalid.", 409, "KNOWLEDGE_INPUT_FINGERPRINT_MISMATCH");
  }
  const maxFileBytes = Math.min(Number(config.knowledge?.maxFileBytes || 50 * 1024 * 1024), Number(config.objectStorage.maxAttachmentBytes));
  const { stream } = await attachmentService.downloadManagedKnowledgeObject({
    id: source.attachment_id,
    projectId: job.project_id,
    sourceId: source.id
  });
  const buffer = await streamToBoundedBuffer(stream, maxFileBytes);
  if (signal?.aborted) throw createError("Knowledge ingestion lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");
  validateUploadSignature(buffer, source.file_name, source.mime_type);
  const actualChecksum = createHash("sha256").update(buffer).digest("hex");
  if (actualChecksum !== source.checksum_sha256 || actualChecksum !== payload.checksum_sha256) {
    throw createError("Stored knowledge file checksum no longer matches the queued upload.", 409, "KNOWLEDGE_FILE_CHECKSUM_MISMATCH");
  }

  let extractedText = suppliedText;
  let extractionStrategy = extractedText ? "client_supplied" : "metadata_only";
  let extractionWarning = null;
  if (!extractedText && NATIVE_TEXT_MIME_TYPES.has(source.mime_type)) {
    extractedText = decodeNativeText(buffer, source.mime_type);
    extractionStrategy = "native_text";
  } else if (!extractedText && TIKA_MIME_TYPES.has(source.mime_type) && getTikaUrl()) {
    if (buffer.length > Number(config.knowledge?.extractionMaxBytes || 20 * 1024 * 1024)) {
      extractionWarning = "The file is stored, but exceeds the configured server extraction limit; provide bounded extracted_text to index it.";
    } else {
      try {
        extractedText = await extractWithTika(buffer, source.mime_type);
        extractionStrategy = extractedText ? "apache_tika" : "metadata_only";
      } catch (error) {
        extractionWarning = `Apache Tika could not extract this file (error ${fingerprint(error instanceof Error ? error.message : "request failed")}).`;
      }
    }
  }
  if (!extractedText && !extractionWarning) {
    extractionWarning = "The file is stored, but searchable context needs extracted_text, a caption, a transcript, or a configured supported document processor.";
  }
  source.extraction_strategy = extractionStrategy;
  await db.prepare(`
    UPDATE ai_knowledge_sources
    SET extraction_status = CASE
          WHEN EXISTS (SELECT 1 FROM ai_knowledge_documents WHERE source_id = ? AND is_active = TRUE) THEN 'ready'
          ELSE 'processing'
        END,
      extraction_strategy = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(source.id, extractionStrategy, source.id);
  const embeddingRuntime = () => resolveEmbeddingRuntime({ userId: user?.id, projectId: job.project_id, signal });
  const persisted = await persistDocument({
    projectId: job.project_id,
    source,
    content: extractedText,
    chunking: asObject(job.config).chunking,
    embeddingRuntime,
    metadata: { attachment_id: source.attachment_id, mime_type: source.mime_type },
    signal,
    activationGuard: async () => {
      const lease = await db.prepare(`
        SELECT 1 AS owned FROM ai_knowledge_ingestion_jobs
        WHERE id = ? AND status = 'running' AND lease_owner = ?
          AND lease_expires_at > CURRENT_TIMESTAMP
      `).get(job.id, leaseOwner);
      return Boolean(lease?.owned) && !signal?.aborted;
    }
  });
  const warnings = [
    extractionWarning ? { source_id: source.id, code: "extraction_warning", message: extractionWarning } : null,
    persisted.warning ? { source_id: source.id, code: persisted.warning_code || "indexing_warning", message: persisted.warning } : null
  ].filter(Boolean);
  if (!persisted.document) {
    await markSourceNeedsExtraction(source, { jobId: job.id, leaseOwner });
  }
  await recordIngestionResult(job.id, 0, {
    sourceId: source.id,
    documentId: persisted.document?.id,
    outcome: persisted.document ? "indexed" : "needs_extraction",
    warningCodes: warnings.map((warning) => warning.code)
  }, { leaseOwner });
  const completedJob = await completeJob(job.id, {
    processed: 1,
    failed: 0,
    chunkCount: persisted.chunks.length,
    warnings,
    errors: []
  }, { leaseOwner });
  return { job: completedJob, source_id: source.id, status: completedJob.status };
};

const ingestUpload = async ({ user, fields, file, idempotencyKey }) => {
  const projectId = normalizeId(fields.project_id);
  if (!projectId) throw createError("project_id is required before the file field.");
  const collectionId = normalizeId(fields.collection_id) || null;
  await assertCollectionScope(projectId, collectionId);
  const mimeType = String(file.mimetype || "application/octet-stream").toLowerCase().split(";")[0].trim();
  const safeFileName = attachmentService.safeFileName(file.filename);
  if (!SUPPORTED_UPLOAD_MIME_TYPES.has(mimeType)) throw createError(`Unsupported knowledge file type: ${mimeType}.`, 415);
  const buffer = await file.toBuffer();
  const maxFileBytes = Math.min(Number(config.knowledge?.maxFileBytes || 50 * 1024 * 1024), Number(config.objectStorage.maxAttachmentBytes));
  if (!buffer.length || buffer.length > maxFileBytes || file.file?.truncated) {
    throw createError(`Knowledge files must be non-empty and no larger than ${maxFileBytes} bytes.`);
  }
  try {
    validateUploadSignature(buffer, safeFileName, mimeType);
  } catch (error) {
    throw createError(error instanceof Error ? error.message : "Knowledge file validation failed.", 415, "KNOWLEDGE_FILE_SIGNATURE_MISMATCH");
  }
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const suppliedText = sanitizeAiText(normalizeText(fields.extracted_text || fields.transcript || fields.caption)).text;
  const chunkingOptions = normalizeChunkingOptions(asObject(fields.chunking));
  const normalizedIdempotencyKey = normalizeText(idempotencyKey, 255) || null;
  const uploadStableSourceKey = stableSourceKey({
    source_kind: "file",
    app_type_id: normalizeId(fields.app_type_id),
    checksum_sha256: checksum
  });
  const requestFingerprint = fingerprint(JSON.stringify({
    project_id: projectId,
    collection_id: collectionId,
    app_type_id: normalizeId(fields.app_type_id),
    title: normalizeText(fields.title, 500) || safeFileName,
    file_name: safeFileName,
    mime_type: mimeType,
    checksum_sha256: checksum,
    supplied_text_hash: suppliedText ? fingerprint(suppliedText) : null,
    chunking: chunkingOptions
  }));
  if (normalizedIdempotencyKey) {
    const existing = await db.prepare(`
      SELECT * FROM ai_knowledge_ingestion_jobs
      WHERE project_id = ? AND created_by = ? AND idempotency_key = ?
    `).get(projectId, user?.id, normalizedIdempotencyKey);
    if (existing) {
      if (asObject(existing.config).request_fingerprint !== requestFingerprint) {
        throw createError("Idempotency-Key was already used for a different knowledge upload.", 409, "IDEMPOTENCY_KEY_REUSED");
      }
      return {
        accepted: ["queued", "running"].includes(existing.status),
        idempotent_replay: true,
        job: await getIngestionJob(existing.id, { user }),
        sources: [], documents: [], chunk_count: Number(existing.chunk_count || 0),
        deduplicated_count: 0, warnings: asArray(existing.warnings),
        status_url: `/knowledge/ingestions/${existing.id}`
      };
    }
  }
  let job;
  try {
    job = await createJob({
      projectId,
      collectionId,
      inputCount: 1,
      config: {
        title: normalizeText(fields.title, 500) || safeFileName,
        app_type_id: normalizeId(fields.app_type_id) || null,
        chunking: chunkingOptions,
        upload: true,
        stable_source_key: uploadStableSourceKey,
        queue_version: 1,
        request_fingerprint: requestFingerprint
      },
      userId: user?.id,
      status: "running",
      idempotencyKey: normalizedIdempotencyKey
    });
  } catch (error) {
    if (error?.code !== "23505" || !normalizedIdempotencyKey) throw error;
    const winner = await db.prepare(`
      SELECT * FROM ai_knowledge_ingestion_jobs
      WHERE project_id = ? AND created_by = ? AND idempotency_key = ?
    `).get(projectId, user?.id, normalizedIdempotencyKey);
    if (!winner || asObject(winner.config).request_fingerprint !== requestFingerprint) {
      throw createError("Idempotency-Key was already used for a different knowledge upload.", 409, "IDEMPOTENCY_KEY_REUSED");
    }
    return {
      accepted: ["queued", "running"].includes(winner.status),
      idempotent_replay: true,
      job: await getIngestionJob(winner.id, { user }),
      sources: [], documents: [], chunk_count: Number(winner.chunk_count || 0),
      deduplicated_count: 0, warnings: asArray(winner.warnings),
      status_url: `/knowledge/ingestions/${winner.id}`
    };
  }
  const input = {
    source_kind: "file",
    source_ref_id: null,
    app_type_id: normalizeId(fields.app_type_id) || null,
    title: normalizeText(fields.title, 500) || safeFileName,
    content: suppliedText,
    source_uri: null,
    file_name: safeFileName,
    mime_type: mimeType,
    size_bytes: buffer.length,
    extraction_strategy: suppliedText ? "client_supplied" : "queued_extraction",
    metadata: { original_file_name: safeFileName },
    processing_fingerprint: processingProfile(chunkingOptions).fingerprint
  };
  input.checksum_sha256 = checksum;
  let source;
  try {
    source = await createSource({ projectId, collectionId, input, userId: user?.id, jobId: job.id });
    if (source._reused) {
      const warnings = [{ source_id: source.id, code: "deduplicated", message: "This exact file and extracted content are already indexed; the current version was reused." }];
      await recordIngestionResult(job.id, 0, { sourceId: source.id, outcome: "reused", reused: true, warningCodes: ["deduplicated"] });
      const completedJob = await completeJob(job.id, { processed: 1, failed: 0, chunkCount: 0, warnings, errors: [] });
      return { accepted: false, idempotent_replay: false, job: completedJob, sources: [toPublicSource(source)], documents: [], chunk_count: 0, deduplicated_count: 1, warnings, status_url: `/knowledge/ingestions/${job.id}` };
    }
    let uploadedAttachment = null;
    const attachment = source.attachment_id
      ? { id: source.attachment_id }
      : (uploadedAttachment = await attachmentService.upload({
          user,
          entityType: "knowledge_source",
          entityId: source.id,
          projectId,
          fileName: safeFileName,
          mimeType,
          stream: Readable.from(buffer),
          permissionCode: "knowledge.manage"
        }));
    const attached = await db.prepare(`
      UPDATE ai_knowledge_sources
      SET attachment_id = ?, checksum_sha256 = ?,
        extraction_status = CASE
          WHEN EXISTS (SELECT 1 FROM ai_knowledge_documents WHERE source_id = ? AND is_active = TRUE) THEN 'ready'
          ELSE 'processing'
        END,
        extraction_strategy = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND revision_token = ?
      RETURNING id
    `).get(attachment.id, checksum, source.id, "queued_extraction", source.id, source.revision_token);
    if (!attached) {
      if (uploadedAttachment) {
        await attachmentService.remove({ user, id: uploadedAttachment.id, permissionCode: "knowledge.manage" }).catch(() => undefined);
      }
      throw createError("A newer upload revision superseded this staged file.", 409, "KNOWLEDGE_VERSION_SUPERSEDED");
    }
    await db.transaction(async () => {
      await db.prepare(`
        INSERT INTO ai_knowledge_ingestion_inputs (job_id, input_index, payload)
        VALUES (?, 0, ?)
      `).run(job.id, {
        kind: "staged_file",
        source_id: source.id,
        attachment_id: attachment.id,
        checksum_sha256: checksum,
        supplied_text: suppliedText || null,
        supplied_text_hash: suppliedText ? fingerprint(suppliedText) : null,
        revision_token: source.revision_token,
        stable_source_key: stableSourceKey({
          source_kind: source.source_kind,
          app_scope_key: source.app_scope_key,
          checksum_sha256: checksum
        })
      });
      await db.prepare(`
        UPDATE ai_knowledge_ingestion_jobs
        SET status = 'queued', started_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'running'
      `).run(job.id);
    })();
    return {
      accepted: true,
      idempotent_replay: false,
      job: await getIngestionJob(job.id, { user }),
      sources: [toPublicSource({ ...source, attachment_id: attachment.id, extraction_status: source._had_ready_version ? "ready" : "processing" })],
      documents: [], chunk_count: 0, deduplicated_count: 0, warnings: [],
      status_url: `/knowledge/ingestions/${job.id}`
    };
  } catch (error) {
    await markSourcePersistenceFailed(source);
    const errorFingerprint = fingerprint(error instanceof Error ? error.message : "Upload staging failed");
    await recordIngestionResult(job.id, 0, { sourceId: source?.id, outcome: "failed", errorFingerprint });
    await completeJob(job.id, { processed: 0, failed: 1, chunkCount: 0, warnings: [], errors: [{ code: "upload_staging_failed", error_fingerprint: errorFingerprint }] });
    throw error;
  }
};

const normalizeFilterIds = (value, max = 100) => [...new Set(asArray(value).map(normalizeId).filter(Boolean))].slice(0, max);

const getProductHelpCandidates = (query, { includeEmbeddings = true } = {}) => {
  return rankProductHelpSections(query).map((section) => {
    const sourceHash = fingerprint(`hellotest-product-help:${PRODUCT_HELP_VERSION}`);
    const versionHash = fingerprint(`${section.id}:${PRODUCT_HELP_VERSION}:${section.content}`);
    return {
      chunk_id: `product-help-${section.id}-${PRODUCT_HELP_VERSION.replace(/\W/g, "-")}`,
      document_id: `product-help-${section.id}`,
      source_id: "hellotest-product-help",
      content: section.content,
      chunk_index: 0,
      heading: section.title,
      char_start: 0,
      char_end: section.content.length,
      embedding: includeEmbeddings ? localEmbedding(section.content) : null,
      fallback_embedding: includeEmbeddings ? localEmbedding(section.content) : null,
      embedding_model: includeEmbeddings ? LOCAL_EMBEDDING_MODEL : null,
      lexical_rank: section.relevance,
      title: section.title,
      version_hash: versionHash,
      source_kind: "product_help",
      source_ref_id: `${section.id}@${PRODUCT_HELP_VERSION}`,
      app_type_id: null,
      source_uri: null,
      risk_flags: [],
      source_hash: sourceHash,
      collection_ids: []
    };
  });
};

const search = async ({
  projectId,
  query,
  mode = "hybrid",
  limit = 12,
  filters = {},
  user,
  userId,
  integrationId,
  allowedSourcePermissions,
  preparedEmbedding,
  signal,
  maxCandidates,
  timeoutMs
} = {}) => {
  if (signal?.aborted) throw signal.reason || createError("Knowledge retrieval was cancelled.", 408);
  const deadlineAt = Date.now() + retrievalTimeout(timeoutMs);
  const visibilityReserveMs = Math.min(750, Math.max(1, Math.floor(retrievalTimeout(timeoutMs) / 8)));
  const remainingMs = (reserve = 0) => Math.max(0, deadlineAt - Date.now() - reserve);
  const normalizedProjectId = normalizeId(projectId);
  const sanitizedQuery = sanitizeAiText(normalizeText(query, 4_000));
  if (!normalizedProjectId || !sanitizedQuery.text) throw createError("project_id and query are required.");
  const normalizedLimit = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Number.parseInt(limit, 10) || 12));
  const candidateLimit = Math.max(1, Math.min(1_000, Number(maxCandidates) || MAX_CANDIDATES));
  const normalizedMode = ["hybrid", "semantic", "keyword"].includes(mode) ? mode : "hybrid";
  const normalizedFilters = asObject(filters);
  let asOf = null;
  if (normalizedFilters.as_of) {
    const timestamp = Date.parse(normalizedFilters.as_of);
    if (!Number.isFinite(timestamp)) throw createError("as_of must be a valid timestamp.");
    await boundedRetrievalStage(() => knowledgeAuthorization.assertHistoricalAccess(user, normalizedProjectId), {
      signal, timeoutMs: remainingMs(visibilityReserveMs), code: "AUTHORIZATION_TIMEOUT"
    });
    asOf = new Date(timestamp).toISOString();
  }
  const collectionIds = normalizeFilterIds(normalizedFilters.collection_ids || normalizedFilters.collections);
  const requestedSourceIds = normalizeFilterIds(normalizedFilters.source_ids, 100);
  const includeProductHelpBySource = !requestedSourceIds.length || requestedSourceIds.includes("hellotest-product-help");
  const sourceIds = requestedSourceIds.filter((sourceId) => sourceId !== "hellotest-product-help");
  const requestedSourceKinds = [...new Set(asArray(normalizedFilters.source_kinds || normalizedFilters.source_types)
    .map((value) => String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_"))
    .filter(Boolean))].slice(0, 20);
  const normalizedRequestedSourceKinds = requestedSourceKinds
    .map((kind) => kind === "product_help" ? kind : normalizeSourceKind(kind, { fallback: null }))
    .filter(Boolean);
  const includeProductHelp = includeProductHelpBySource
    && (!requestedSourceKinds.length || normalizedRequestedSourceKinds.includes("product_help"));
  const sourceKinds = [...new Set(normalizedRequestedSourceKinds.filter((kind) => kind !== "product_help"))];
  const includePersistedSources = (!requestedSourceKinds.length || sourceKinds.length > 0)
    && (!requestedSourceIds.length || sourceIds.length > 0);
  const appTypeId = normalizeId(normalizedFilters.app_type_id) || null;
  const effectiveAllowedSourcePermissions = Array.isArray(allowedSourcePermissions)
    ? [...new Set(allowedSourcePermissions.filter((permissionCode) => Object.values(SOURCE_PERMISSION_BY_KIND).includes(permissionCode)))]
    : await boundedRetrievalStage(() => resolveAllowedSourcePermissions(user, normalizedProjectId), {
      signal, timeoutMs: Math.min(1_500, remainingMs(visibilityReserveMs)), code: "AUTHORIZATION_TIMEOUT"
    });
  const filterParams = [normalizedProjectId, normalizedProjectId, normalizedProjectId];
  const clauses = [
    "chunks.project_id = ?",
    "documents.project_id = ?",
    "sources.project_id = ?",
    ...(asOf ? ["documents.effective_from <= ?::timestamptz AND (documents.effective_to IS NULL OR documents.effective_to > ?::timestamptz)"] : ["documents.is_active = TRUE"]),
    "index_states.required_indexes_ready = TRUE",
    "sources.extraction_status = 'ready'"
  ];
  if (asOf) filterParams.push(asOf, asOf);
  const fragmentAcl = knowledgeAuthorization.predicate({ user, projectId: normalizedProjectId, document: "documents", chunk: "chunks" });
  clauses.push(fragmentAcl.sql);
  filterParams.push(...fragmentAcl.params);
  if (effectiveAllowedSourcePermissions.length) {
    clauses.push(`(sources.required_permission IS NULL OR sources.required_permission IN (${effectiveAllowedSourcePermissions.map(() => "?").join(", ")}))`);
    filterParams.push(...effectiveAllowedSourcePermissions);
  } else {
    clauses.push("sources.required_permission IS NULL");
  }
  if (appTypeId) {
    clauses.push("(sources.app_type_id = ? OR sources.app_type_id IS NULL)");
    filterParams.push(appTypeId);
  }
  if (sourceKinds.length) {
    clauses.push(`sources.source_kind IN (${sourceKinds.map(() => "?").join(", ")})`);
    filterParams.push(...sourceKinds);
  }
  if (sourceIds.length) {
    clauses.push(`sources.id IN (${sourceIds.map(() => "?").join(", ")})`);
    filterParams.push(...sourceIds);
  }
  if (collectionIds.length) {
    clauses.push(`EXISTS (
      SELECT 1 FROM ai_knowledge_collection_sources scoped_collections
      WHERE scoped_collections.source_id = chunks.source_id
        AND scoped_collections.collection_id IN (${collectionIds.map(() => "?").join(", ")})
    )`);
    filterParams.push(...collectionIds);
  }
  const embeddingProjection = !usesEmbeddingsForMode(normalizedMode)
    ? "NULL::jsonb AS embedding, NULL::jsonb AS fallback_embedding, NULL::text AS embedding_model,"
    : "chunks.embedding, chunks.fallback_embedding, chunks.embedding_model,";
  const candidateProjection = `
    SELECT chunks.id AS chunk_id, chunks.document_id, chunks.source_id, chunks.content,
      chunks.chunk_index, chunks.heading, chunks.char_start, chunks.char_end, chunks.metadata,
      ${embeddingProjection}
      documents.title, documents.checksum_sha256 AS version_hash, documents.version,
      documents.is_active AS is_current, documents.effective_from, documents.effective_to,
      sources.source_kind, sources.source_ref_id, sources.app_type_id,
      sources.source_uri, sources.risk_flags, sources.checksum_sha256 AS source_hash,
      ARRAY(SELECT collection_id FROM ai_knowledge_collection_sources links WHERE links.source_id = chunks.source_id) AS collection_ids
    FROM ai_knowledge_chunks chunks
    JOIN ai_knowledge_documents documents ON documents.id = chunks.document_id
    JOIN ai_knowledge_sources sources ON sources.id = chunks.source_id
    JOIN ai_knowledge_index_states index_states ON index_states.document_id = documents.id
  `;
  const exactIdentifiers = [...new Set((sanitizedQuery.text.match(/\b(?:[A-Z][A-Z0-9]{1,11}-\d+|(?:BUG|TC|TS|STORY|RUN|REQ)-?[A-Z0-9_-]+|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\b/gi) || []).map((value) => value.toUpperCase()))].slice(0, 10);

  const retrievalErrors = [];
  const readStage = (task, code, cap = 3_500) => boundedRetrievalStage(task, {
    signal, timeoutMs: Math.min(cap, remainingMs(visibilityReserveMs)), code
  });
  const localVector = usesEmbeddingsForMode(normalizedMode) ? localEmbedding(sanitizedQuery.text) : null;
  let queryEmbeddingResult = localVector ? { model: LOCAL_EMBEDDING_MODEL, vectors: [localVector], fallback: [localVector] } : null;
  let queryVector = localVector;
  let fallbackQueryVector = localVector;
  let denseCandidates = [];
  let vectorMode = normalizedMode === "keyword" ? "postgresql-fts-only" : "degraded-local-jsonb-cosine+fts";
  let qdrantResult = { configured: false, hits: [] };
  // Start exact and lexical reads before resolving/awaiting embeddings. Every
  // channel has its own bound, so an optional provider cannot discard fast SQL.
  const lexicalPromise = includePersistedSources ? readStage(() => db.prepare(`
    ${candidateProjection.replace("SELECT ", "SELECT ts_rank_cd(chunks.search_vector, plainto_tsquery('simple', ?)) AS lexical_rank, ")}
    WHERE ${clauses.join(" AND ")}
    ORDER BY lexical_rank DESC, chunks.created_at DESC
    LIMIT ?
  `).all(
    sanitizedQuery.text,
    ...filterParams,
    normalizedMode === "keyword" || knowledgeVectorStore.isConfigured() || maxCandidates ? candidateLimit : MAX_FALLBACK_CANDIDATES
  ), "LEXICAL_SEARCH_TIMEOUT") : Promise.resolve([]);
  const directLookupPromise = includePersistedSources && exactIdentifiers.length ? readStage(() => db.prepare(`
    ${candidateProjection.replace("SELECT ", "SELECT 1::real AS lexical_rank, TRUE AS exact_match, ")}
    WHERE ${clauses.join(" AND ")}
      AND (
        UPPER(COALESCE(sources.source_ref_id, '')) IN (${exactIdentifiers.map(() => "?").join(", ")})
        OR UPPER(COALESCE(sources.metadata->>'display_id', '')) IN (${exactIdentifiers.map(() => "?").join(", ")})
        OR UPPER(COALESCE(sources.metadata->>'key', '')) IN (${exactIdentifiers.map(() => "?").join(", ")})
        OR UPPER(sources.id) IN (${exactIdentifiers.map(() => "?").join(", ")})
      )
    ORDER BY chunks.chunk_index ASC
    LIMIT ?
  `).all(...filterParams, ...exactIdentifiers, ...exactIdentifiers, ...exactIdentifiers, ...exactIdentifiers, Math.min(candidateLimit, exactIdentifiers.length * 12)), "DIRECT_LOOKUP_TIMEOUT") : Promise.resolve([]);
  const densePromise = usesEmbeddingsForMode(normalizedMode) && includePersistedSources
    ? readStage(async (denseSignal) => {
      const prepared = await (typeof preparedEmbedding === "function" ? preparedEmbedding() : preparedEmbedding);
      assertRetrievalActive(denseSignal);
      let embedding;
      if (prepared?.model && Array.isArray(prepared.vector) && Array.isArray(prepared.fallback)) {
        embedding = { model: prepared.model, vectors: [prepared.vector], fallback: [prepared.fallback],
          warning: prepared.warning || null, warning_code: prepared.warning_code || null,
          warning_reason_code: prepared.warning_reason_code || null };
      } else {
        const runtime = await resolveEmbeddingRuntime({ userId: user?.id || userId, projectId: normalizedProjectId, integrationId });
        assertRetrievalActive(denseSignal);
        embedding = await embedTexts(runtime, [sanitizedQuery.text], {
          cacheResults: true, signal: denseSignal,
          timeoutMs: Math.min(RETRIEVAL_EMBEDDING_TIMEOUT_MS, remainingMs(visibilityReserveMs))
        });
      }
      assertRetrievalActive(denseSignal);
      const vector = embedding.vectors[0];
      const pgvectorAvailable = await getVectorCapability();
      assertRetrievalActive(denseSignal);
      let projection = { configured: false, hits: [] };
      let candidates = [];
      let mode = pgvectorAvailable ? "pgvector-exact+fts" : "degraded-local-jsonb-cosine+fts";
      if (knowledgeVectorStore.isConfigured()) {
        try {
          const authorized = await db.prepare(`SELECT chunks.id
            FROM ai_knowledge_chunks chunks
            JOIN ai_knowledge_documents documents ON documents.id = chunks.document_id
            JOIN ai_knowledge_sources sources ON sources.id = chunks.source_id
            JOIN ai_knowledge_index_states index_states ON index_states.document_id = documents.id
            WHERE ${clauses.join(" AND ")} ORDER BY chunks.id LIMIT 10001
          `).all(...filterParams);
          assertRetrievalActive(denseSignal);
          projection = authorized.length > 10_000
            ? { configured: true, hits: [], degraded: true, authorization_scope_exceeded: true }
            : await knowledgeVectorStore.search({
              projectId: normalizedProjectId, queryVector: vector, embeddingModel: embedding.model,
              allowedPermissions: effectiveAllowedSourcePermissions,
              authorizedChunkIds: authorized.map((row) => row.id), historical: Boolean(asOf),
              sourceKinds, sourceIds, appTypeId, limit: candidateLimit, signal: denseSignal
            });
          assertRetrievalActive(denseSignal);
          if (projection.hits.length) {
            const scores = new Map(projection.hits.map((hit) => [hit.chunk_id, Number(hit.score || 0)]));
            const ids = [...scores.keys()];
            const rows = await db.prepare(`
              ${candidateProjection.replace("SELECT ", "SELECT 0::real AS lexical_rank, ")}
              WHERE ${clauses.join(" AND ")}
                AND chunks.id IN (${ids.map(() => "?").join(", ")})
                AND chunks.embedding_model = ?
            `).all(...filterParams, ...ids, embedding.model);
            assertRetrievalActive(denseSignal);
            candidates = rows.map((candidate) => ({ ...candidate, dense_similarity: scores.get(candidate.chunk_id) || 0 }))
              .sort((left, right) => right.dense_similarity - left.dense_similarity);
            mode = "qdrant-acl-prefilter+postgresql-fts";
          }
        } catch (error) {
          assertRetrievalActive(denseSignal);
          projection = { configured: true, hits: [], degraded: true,
            error_fingerprint: fingerprint(error instanceof Error ? error.message : "Qdrant retrieval failed") };
        }
      }
      // PostgreSQL is canonical. Search its vectors even when Qdrant has hits:
      // older uploaded documents may not yet have an external projection.
      if (pgvectorAvailable) {
        try {
          const rows = await db.prepare(`
            ${candidateProjection.replace("SELECT ", "SELECT (1 - (chunks.embedding_vector <=> ?::vector)) AS dense_similarity, 0::real AS lexical_rank, ")}
            WHERE ${clauses.join(" AND ")}
              AND chunks.embedding_vector IS NOT NULL
              AND chunks.embedding_model = ?
              AND vector_dims(chunks.embedding_vector) = ?
            ORDER BY dense_similarity DESC
            LIMIT ?
          `).all(vectorLiteral(vector), ...filterParams, embedding.model, vector.length, candidateLimit);
          assertRetrievalActive(denseSignal);
          const union = new Map([...candidates, ...rows].map((candidate) => [candidate.chunk_id, candidate]));
          candidates = [...union.values()].sort((left, right) => Number(right.dense_similarity || 0) - Number(left.dense_similarity || 0)).slice(0, candidateLimit);
        } catch (error) {
          assertRetrievalActive(denseSignal);
          if (!candidates.length) mode = "degraded-local-jsonb-cosine+fts";
        }
      }
      return { candidates, embedding, projection, mode };
    }, "SEMANTIC_SEARCH_TIMEOUT") : Promise.resolve(null);
  const settled = await Promise.allSettled([lexicalPromise, directLookupPromise, densePromise]);
  assertRetrievalActive(signal);
  const channel = (index, fallback) => {
    if (settled[index].status === "fulfilled") return settled[index].value;
    retrievalErrors.push(settled[index].reason?.code || "RETRIEVAL_CHANNEL_UNAVAILABLE");
    return fallback;
  };
  const lexicalCandidates = channel(0, []);
  const directLookupCandidates = channel(1, []);
  const dense = channel(2, null);
  if (dense) {
    denseCandidates = dense.candidates;
    queryEmbeddingResult = dense.embedding;
    queryVector = dense.embedding.vectors[0];
    fallbackQueryVector = dense.embedding.fallback[0];
    vectorMode = dense.mode;
    qdrantResult = dense.projection;
    if (dense.embedding.warning_code) retrievalErrors.push(dense.embedding.warning_reason_code || dense.embedding.warning_code);
  }
  const lexicalIds = new Set(lexicalCandidates.map((candidate) => candidate.chunk_id));
  for (const candidate of directLookupCandidates.slice().reverse()) {
    if (!lexicalIds.has(candidate.chunk_id)) lexicalCandidates.unshift(candidate);
    else Object.assign(lexicalCandidates.find((item) => item.chunk_id === candidate.chunk_id), { exact_match: true, lexical_rank: Math.max(1, Number(candidate.lexical_rank || 0)) });
  }
  if (includeProductHelp && !collectionIds.length) {
    lexicalCandidates.push(...getProductHelpCandidates(sanitizedQuery.text, { includeEmbeddings: usesEmbeddingsForMode(normalizedMode) }));
    lexicalCandidates.sort((left, right) => Number(right.lexical_rank || 0) - Number(left.lexical_rank || 0));
  }

  const candidateById = new Map();
  for (const candidate of lexicalCandidates) candidateById.set(candidate.chunk_id, candidate);
  for (const candidate of denseCandidates) {
    const previous = candidateById.get(candidate.chunk_id);
    candidateById.set(candidate.chunk_id, { ...previous, ...candidate,
      lexical_rank: Math.max(Number(previous?.lexical_rank || 0), Number(candidate.lexical_rank || 0)) });
  }
  // Give exact lookup and both retrieval channels room within the caller's
  // candidate budget before reranking the authorized union.
  const candidateIds = new Set(directLookupCandidates.map((candidate) => candidate.chunk_id));
  for (let index = 0; index < Math.max(lexicalCandidates.length, denseCandidates.length); index += 1) {
    if (lexicalCandidates[index]) candidateIds.add(lexicalCandidates[index].chunk_id);
    if (denseCandidates[index]) candidateIds.add(denseCandidates[index].chunk_id);
  }
  const candidates = [...candidateIds].slice(0, maxCandidates ? candidateLimit : MAX_FALLBACK_CANDIDATES).map((id) => candidateById.get(id)).filter(Boolean);
  const queryTokens = new Set(sanitizedQuery.text.toLowerCase().match(/[a-z0-9][a-z0-9_.-]{1,48}/g) || []);
  const lexicalRankById = new Map(
    lexicalCandidates.filter((candidate) => Number(candidate.lexical_rank) > 0).map((candidate, index) => [candidate.chunk_id, index + 1])
  );
  const semanticRanked = normalizedMode === "keyword" ? [] : (denseCandidates.length ? denseCandidates : candidates.slice().sort((left, right) => {
    const leftVector = left.embedding_model === queryEmbeddingResult.model && Array.isArray(left.embedding) ? left.embedding : left.fallback_embedding;
    const rightVector = right.embedding_model === queryEmbeddingResult.model && Array.isArray(right.embedding) ? right.embedding : right.fallback_embedding;
    return cosineSimilarity(rightVector, right.embedding_model === queryEmbeddingResult.model ? queryVector : fallbackQueryVector)
      - cosineSimilarity(leftVector, left.embedding_model === queryEmbeddingResult.model ? queryVector : fallbackQueryVector);
  }));
  const semanticRankById = new Map(semanticRanked.map((candidate, index) => [candidate.chunk_id, index + 1]));
  const scoredAll = candidates.map((candidate) => {
    const primaryCompatible = normalizedMode !== "keyword"
      && candidate.embedding_model === queryEmbeddingResult.model
      && Array.isArray(candidate.embedding);
    const semantic = normalizedMode === "keyword" ? 0 : Math.max(0, cosineSimilarity(
      primaryCompatible ? candidate.embedding : candidate.fallback_embedding,
      primaryCompatible ? queryVector : fallbackQueryVector
    ));
    const lexicalRank = Math.max(0, Number(candidate.lexical_rank || 0));
    const contentTokens = new Set(String(candidate.content || "").toLowerCase().match(/[a-z0-9][a-z0-9_.-]{1,48}/g) || []);
    const overlap = queryTokens.size ? [...queryTokens].filter((token) => contentTokens.has(token)).length / queryTokens.size : 0;
    const lexical = candidate.exact_match ? 1 : Math.min(1, lexicalRank * 5 + overlap * 0.6 + (String(candidate.content).toLowerCase().includes(sanitizedQuery.text.toLowerCase()) ? 0.4 : 0));
    const lexicalPosition = lexicalRankById.get(candidate.chunk_id);
    const semanticPosition = semanticRankById.get(candidate.chunk_id);
    const reciprocalRank = normalizedMode === "keyword"
      ? (lexicalPosition ? (1 / (60 + lexicalPosition)) / (1 / 61) : 0)
      : ((lexicalPosition ? 1 / (60 + lexicalPosition) : 0) + (semanticPosition ? 1 / (60 + semanticPosition) : 0)) / (2 / 61);
    const score = normalizedMode === "semantic"
      ? semantic
      : normalizedMode === "keyword"
        ? lexical
        : Math.min(1, reciprocalRank * 0.45 + semantic * 0.31 + lexical * 0.24);
    const citationId = `K-${candidate.chunk_id}`;
    return {
      id: candidate.chunk_id,
      chunk_id: candidate.chunk_id,
      document_id: candidate.document_id,
      source_id: candidate.source_id,
      canonical_id: candidate.source_id,
      knowledge_id: candidate.document_id,
      fragment_id: candidate.chunk_id,
      version: candidate.version || null,
      is_current: candidate.is_current !== false,
      effective_from: candidate.effective_from || null,
      effective_to: candidate.effective_to || null,
      index_ready: true,
      collection_ids: asArray(candidate.collection_ids),
      title: candidate.title,
      source_kind: candidate.source_kind,
      source_ref_id: candidate.source_ref_id,
      content: candidate.content,
      excerpt: String(candidate.content || "").slice(0, 700),
      score: Number(score.toFixed(6)),
      lexical_score: Number(lexical.toFixed(6)),
      semantic_score: Number(semantic.toFixed(6)),
      reciprocal_rank_score: Number(reciprocalRank.toFixed(6)),
      citation: {
        id: citationId,
        label: candidate.title,
        source_id: candidate.source_id,
        source_kind: candidate.source_kind,
        source_ref_id: candidate.source_ref_id,
        source_uri: candidate.source_kind === "url"
          ? sanitizeSourceUri(candidate.source_uri)
          : candidate.source_kind === "file" ? `/knowledge/sources/${candidate.source_id}/file` : null,
        document_id: candidate.document_id,
        chunk_id: candidate.chunk_id,
        canonical_id: candidate.source_id,
        knowledge_id: candidate.document_id,
        fragment_id: candidate.chunk_id,
        version: candidate.version || null,
        is_current: candidate.is_current !== false,
        effective_from: candidate.effective_from || null,
        effective_to: candidate.effective_to || null,
        excerpt: String(candidate.content || "").slice(0, 700),
        source_hash: candidate.source_hash || null,
        version_hash: candidate.version_hash || null,
        chunk_hash: fingerprint(candidate.content),
        location: {
          chunk_index: Number(candidate.chunk_index || 0),
          heading: candidate.heading || null,
          heading_path: asArray(candidate.metadata?.section_path),
          section_type: candidate.metadata?.section_type || null,
          char_start: Number(candidate.char_start || 0),
          char_end: Number(candidate.char_end || 0),
          page: Number(candidate.metadata?.page || 0) || null
        }
      }
    };
  }).sort((left, right) => right.score - left.score);
  const relevanceThreshold = normalizedMode === "keyword" ? 0.08 : normalizedMode === "semantic" ? 0.13 : MIN_RETRIEVAL_RELEVANCE;
  const sourceCounts = new Map();
  const scored = [];
  for (const result of scoredAll) {
    if (result.score < relevanceThreshold || Math.max(result.semantic_score, result.lexical_score) < relevanceThreshold) continue;
    const currentCount = sourceCounts.get(result.source_id) || 0;
    if (currentCount >= 3) continue;
    sourceCounts.set(result.source_id, currentCount + 1);
    scored.push(result);
    if (scored.length >= normalizedLimit) break;
  }

  const selectedSourceIds = normalizeFilterIds(scored.map((hit) => hit.source_id).filter((id) => id !== "hellotest-product-help"));
  const partialSources = selectedSourceIds.length ? await boundedRetrievalStage(() => db.prepare(`SELECT DISTINCT sources.id
    FROM ai_knowledge_sources sources
    JOIN ai_knowledge_documents documents ON documents.source_id = sources.id
    JOIN ai_knowledge_chunks chunks ON chunks.document_id = documents.id
    JOIN ai_knowledge_index_states index_states ON index_states.document_id = documents.id
    WHERE sources.project_id = ? AND sources.extraction_status = 'ready' AND index_states.required_indexes_ready = TRUE
      ${asOf ? "AND documents.effective_from <= ?::timestamptz AND (documents.effective_to IS NULL OR documents.effective_to > ?::timestamptz)" : "AND documents.is_active = TRUE"}
      AND sources.id IN (${selectedSourceIds.map(() => "?").join(",")}) AND NOT (${fragmentAcl.sql})`
  ).all(normalizedProjectId, ...(asOf ? [asOf, asOf] : []), ...selectedSourceIds, ...fragmentAcl.params), { signal, timeoutMs: Math.min(750, remainingMs()), code: "VISIBILITY_CHECK_TIMEOUT" }).catch((error) => {
    assertRetrievalActive(signal);
    retrievalErrors.push(error.code || "VISIBILITY_CHECK_UNAVAILABLE");
    return selectedSourceIds.map((id) => ({ id }));
  }) : [];
  const partialSourceIds = new Set(partialSources.map((source) => source.id));
  for (const hit of scored) hit.visibility = { state: partialSourceIds.has(hit.source_id) ? "PARTIAL" : "FULL" };
  if (signal?.aborted) throw signal.reason || createError("Knowledge retrieval was cancelled.", 408);

  return {
    project_id: normalizedProjectId,
    query: sanitizedQuery.text,
    mode: normalizedMode,
    results: scored,
    retrieval: {
      candidate_count: candidates.length,
      result_count: scored.length,
      embedding_model: queryEmbeddingResult?.model || null,
      query_class: knowledgeContracts.classifyQuery(sanitizedQuery.text),
      direct_lookup_count: directLookupCandidates.length,
      vector_mode: vectorMode,
      degraded: retrievalErrors.length > 0 || (normalizedMode !== "keyword" && (vectorMode.startsWith("degraded") || Boolean(qdrantResult.degraded) || queryEmbeddingResult.model === LOCAL_EMBEDDING_MODEL)),
      error_codes: [...new Set(retrievalErrors)],
      retrieval_error_count: retrievalErrors.length,
      ranking: normalizedMode === "keyword"
        ? "PostgreSQL full-text lexical ranking (no embedding provider call)"
        : "reciprocal-rank fusion of PostgreSQL full-text and dense retrieval",
      relevance_threshold: relevanceThreshold,
      filters: { collection_ids: collectionIds, source_kinds: requestedSourceKinds, source_ids: requestedSourceIds, app_type_id: appTypeId },
      source_acl: {
        enforced: true,
        partial: partialSourceIds.size > 0,
        partially_visible_sources: partialSourceIds.size,
        allowed_record_permissions: effectiveAllowedSourcePermissions,
        vector_prefilter_enforced: vectorMode.startsWith("qdrant")
      },
      vector_projection_error_fingerprint: qdrantResult.error_fingerprint || null,
      authorization_scope_bounded: Boolean(qdrantResult.authorization_scope_exceeded),
      historical: Boolean(asOf),
      as_of: asOf,
      query_redaction_count: sanitizedQuery.redaction_count,
      query_risk_flags: sanitizedQuery.risk_flags
    },
    guardrails: ASSISTANT_GUARDRAILS
  };
};

const expandEvidence = async ({ projectId, user, hits = [], window = 1, limit = 12, asOf, signal, timeoutMs, maxCandidates } = {}) => {
  if (signal?.aborted) throw signal.reason || createError("Knowledge expansion cancelled.", 408);
  const deadlineAt = Date.now() + retrievalTimeout(timeoutMs, 1_500);
  const remainingMs = () => Math.max(0, deadlineAt - Date.now());
  const access = await knowledgeAuthorization.getEvidenceAccess({ projectId, user, evidence: hits, asOf, signal, timeoutMs: remainingMs() });
  const seeds = access.allowed.filter((hit) => hit.source_id !== "hellotest-product-help").slice(0, 6);
  const radius = Math.max(0, Math.min(2, Number(window) || 1));
  const maximum = Math.max(0, Math.min(24, Number(limit) || 12, maxCandidates ?? 24));
  if (!maximum) return { results: [] };
  const acl = knowledgeAuthorization.predicate({ user, projectId, document: "documents", chunk: "chunks" });
  const settled = await Promise.allSettled(seeds.map(async (seed) => {
    const ordinal = Number(seed.citation?.location?.chunk_index || 0);
    const rows = await boundedRetrievalStage(() => db.prepare(`SELECT chunks.* FROM ai_knowledge_chunks chunks
      JOIN ai_knowledge_documents documents ON documents.id = chunks.document_id
      JOIN ai_knowledge_sources sources ON sources.id = chunks.source_id
      JOIN ai_knowledge_index_states indexes ON indexes.document_id = documents.id
      WHERE chunks.project_id = ? AND documents.project_id = ? AND sources.project_id = ?
        AND sources.extraction_status = 'ready' AND indexes.required_indexes_ready = TRUE
        ${asOf ? "AND documents.effective_from <= ?::timestamptz AND (documents.effective_to IS NULL OR documents.effective_to > ?::timestamptz)" : "AND documents.is_active = TRUE"}
        AND chunks.document_id = ? AND chunks.chunk_index BETWEEN ? AND ? AND ${acl.sql}
      ORDER BY chunks.chunk_index LIMIT 5`).all(projectId, projectId, projectId, ...(asOf ? [asOf, asOf] : []),
      seed.document_id || seed.knowledge_id, Math.max(0, ordinal - radius), ordinal + radius, ...acl.params), { signal, timeoutMs: Math.max(0, remainingMs() - 10), code: "PARENT_EXPANSION_TIMEOUT" });
    assertRetrievalActive(signal);
    return rows.map((row) => ({
      ...seed, id: row.id, chunk_id: row.id, fragment_id: row.id,
      content: row.content, excerpt: row.content.slice(0, 700), score: Number((Number(seed.score || 0.5) * 0.85).toFixed(6)),
      expansion_of: seed.chunk_id || seed.fragment_id,
      citation: {
        ...seed.citation, id: `K-${row.id}`, chunk_id: row.id, fragment_id: row.id,
        excerpt: row.content.slice(0, 700), chunk_hash: fingerprint(row.content),
        location: { chunk_index: row.chunk_index, heading: row.heading, heading_path: asArray(row.metadata?.section_path),
          char_start: row.char_start, char_end: row.char_end, page: row.metadata?.page || null }
      }
    }));
  }));
  assertRetrievalActive(signal);
  const windows = settled.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value);
  const errors = settled.filter((entry) => entry.status === "rejected").map((entry) => entry.reason?.code || "PARENT_EXPANSION_UNAVAILABLE");
  const seen = new Set(hits.map((hit) => hit.chunk_id || hit.fragment_id));
  const results = windows.flat().filter((hit) => {
    if (seen.has(hit.chunk_id)) return false;
    seen.add(hit.chunk_id);
    return true;
  }).slice(0, maximum);
  return { results, retrieval: { degraded: errors.length > 0, error_codes: errors }, expansion: { kind: "adjacent_fragments", window: radius, bounded: true, seed_count: seeds.length, result_count: results.length } };
};

const expandRelationships = async ({ projectId, user, hits = [], query, mode = "hybrid", limit = 6, signal, maxCandidates, timeoutMs } = {}) => {
  if (signal?.aborted) throw signal.reason || createError("Knowledge expansion cancelled.", 408);
  const deadlineAt = Date.now() + retrievalTimeout(timeoutMs, 1_500);
  const remainingMs = () => Math.max(0, deadlineAt - Date.now());
  const access = await knowledgeAuthorization.getEvidenceAccess({ projectId, user, evidence: hits, signal, timeoutMs: remainingMs() });
  const seeds = normalizeFilterIds(access.allowed.map((hit) => hit.source_id), 6).filter((id) => id !== "hellotest-product-help");
  if (!seeds.length) return { results: [], relationships: [] };
  const acl = knowledgeAuthorization.predicate({ user, projectId, source: "targets" });
  const rows = await boundedRetrievalStage(() => db.prepare(`SELECT relations.id, origin.id AS source_canonical_id,
    targets.id AS target_canonical_id, relations.relation_type,
    COALESCE(relations.metadata->>'provenance_type', 'SOURCE_EXPLICIT') AS provenance_type
    FROM ai_knowledge_relations relations
    JOIN ai_knowledge_sources origin ON origin.source_ref_id = relations.source_id AND origin.source_kind = relations.source_type
    JOIN ai_knowledge_sources targets ON targets.source_ref_id = relations.target_id AND targets.source_kind = relations.target_type
    WHERE relations.project_id = ? AND origin.project_id = ? AND targets.project_id = ?
      AND origin.id IN (${seeds.map(() => "?").join(",")}) AND targets.extraction_status = 'ready'
      AND COALESCE(relations.metadata->>'provenance_type', 'SOURCE_EXPLICIT') IN ('SOURCE_EXPLICIT', 'DETERMINISTIC', 'HUMAN_VERIFIED')
      AND COALESCE(relations.metadata->>'status', 'ACTIVE') IN ('ACTIVE', 'APPROVED') AND ${acl.sql}
    ORDER BY relations.created_at DESC LIMIT 24`).all(projectId, projectId, projectId, ...seeds, ...acl.params), { signal, timeoutMs: remainingMs(), code: "RELATIONSHIP_SEARCH_TIMEOUT" });
  assertRetrievalActive(signal);
  const targets = normalizeFilterIds(rows.map((row) => row.target_canonical_id), 12);
  if (!targets.length) return { results: [], relationships: [] };
  const response = await search({ projectId, user, query, mode, signal, maxCandidates, timeoutMs: remainingMs(), limit: Math.min(12, Math.max(1, Number(limit) || 6)), filters: { source_ids: targets } });
  const visible = new Set(response.results.map((hit) => hit.source_id));
  return { results: response.results, relationships: rows.filter((row) => visible.has(row.target_canonical_id)).map((row) => ({
    ...row, relationship_type: row.relation_type,
    evidence_ids: [...access.allowed.filter((hit) => hit.source_id === row.source_canonical_id), ...response.results.filter((hit) => hit.source_id === row.target_canonical_id)]
      .map((hit) => hit.citation?.id || `K-${hit.chunk_id}`)
  })), retrieval: response.retrieval };
};

// Resolve ACL and the configured LLM embedding runtime once, then embed all
// retrieval queries in one provider batch. The individual searches retain the
// exact same filters and ranking contract while avoiding repeated setup/network
// calls during multi-query and multi-round assistant retrieval.
const allocateCandidateBudgets = (queryCount, maxCandidates) => {
  if (maxCandidates === undefined || maxCandidates === null) return Array(queryCount).fill(undefined);
  const total = Math.max(0, Math.min(10_000, Math.floor(Number(maxCandidates) || 0)));
  const count = Math.min(queryCount, total);
  return Array.from({ length: count }, (_, index) => Math.min(1_000,
    Math.floor(total / count) + (index < total % count ? 1 : 0)));
};

const searchMany = async ({ queries, projectId, mode = "hybrid", user, userId, integrationId, ...options } = {}) => {
  const deadlineAt = Date.now() + retrievalTimeout(options.timeoutMs);
  const remainingMs = () => Math.max(0, deadlineAt - Date.now());
  const normalizedProjectId = normalizeId(projectId);
  const normalizedMode = ["hybrid", "semantic", "keyword"].includes(mode) ? mode : "hybrid";
  const normalizedQueries = [...new Map(asArray(queries)
    .map((query) => sanitizeAiText(normalizeText(query, 4_000)).text)
    .filter(Boolean)
    .map((query) => [query.toLowerCase(), query])).values()].slice(0, 10);
  if (!normalizedProjectId || !normalizedQueries.length) throw createError("project_id and at least one query are required.");
  const candidateBudgets = allocateCandidateBudgets(normalizedQueries.length, options.maxCandidates);
  const activeQueries = normalizedQueries.slice(0, candidateBudgets.length);
  if (!activeQueries.length) return {
    results: [], errors: [], query_count: 0, embedding_batch_count: 0,
    candidate_count: 0, skipped_query_count: normalizedQueries.length, candidate_budget_exhausted: true
  };
  const allowedSourcePermissions = await boundedRetrievalStage(() => resolveAllowedSourcePermissions(user, normalizedProjectId), {
    signal: options.signal, timeoutMs: Math.min(1_500, remainingMs()), code: "AUTHORIZATION_TIMEOUT"
  });
  const embeddingTimeoutMs = Math.min(RETRIEVAL_EMBEDDING_TIMEOUT_MS, Math.max(1, Math.floor(remainingMs() / 2)));
  // Share the provider batch without making lexical/exact searches wait for it.
  let embeddingBatchPromise = null;
  const getEmbeddingBatch = () => {
    embeddingBatchPromise ||= boundedRetrievalStage(async (signal) => {
      const runtime = await resolveEmbeddingRuntime({ userId: user?.id || userId, projectId: normalizedProjectId, integrationId });
      assertRetrievalActive(signal);
      return embedTexts(runtime, activeQueries, { cacheResults: true, signal, timeoutMs: embeddingTimeoutMs });
    }, { signal: options.signal, timeoutMs: Math.min(remainingMs(), embeddingTimeoutMs + 300), code: "EMBEDDING_SETUP_TIMEOUT" })
      .catch((error) => {
        assertRetrievalActive(options.signal);
        const fallback = activeQueries.map(localEmbedding);
        return { model: LOCAL_EMBEDDING_MODEL, vectors: fallback, fallback,
          warning_code: error.code || "EMBEDDING_UNAVAILABLE" };
      });
    return embeddingBatchPromise;
  };
  const settled = await Promise.allSettled(activeQueries.map(async (query, index) => ({
    query,
    result: await search({
      ...options,
      timeoutMs: remainingMs(),
      maxCandidates: candidateBudgets[index],
      projectId: normalizedProjectId,
      query,
      mode: normalizedMode,
      integrationId,
      user,
      userId,
      allowedSourcePermissions,
      preparedEmbedding: () => getEmbeddingBatch().then((embeddingBatch) => embeddingBatch ? {
        model: embeddingBatch.model,
        vector: embeddingBatch.vectors[index],
        fallback: embeddingBatch.fallback[index],
        warning: embeddingBatch.warning,
        warning_code: embeddingBatch.warning_code,
        warning_reason_code: embeddingBatch.warning_reason_code
      } : null)
    })
  })));
  assertRetrievalActive(options.signal);
  const results = settled.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value);
  return {
    results,
    errors: settled.filter((entry) => entry.status === "rejected").map((entry) => entry.reason),
    query_count: activeQueries.length,
    skipped_query_count: normalizedQueries.length - activeQueries.length,
    candidate_count: results.reduce((count, entry) => count + Number(entry.result.retrieval?.candidate_count || 0), 0),
    embedding_batch_count: embeddingBatchPromise ? 1 : 0
  };
};

const buildCollectionCountsSql = (allowedSourcePermissions) => {
  const aclScoped = Array.isArray(allowedSourcePermissions);
  const sourceAcl = !aclScoped
    ? ""
    : allowedSourcePermissions.length
      ? `AND (sources.required_permission IS NULL OR sources.required_permission IN (${allowedSourcePermissions.map(() => "?").join(", ")}))`
      : "AND sources.required_permission IS NULL";
  return `
  SELECT collections.*,
    COUNT(DISTINCT sources.id)::INTEGER AS source_count,
    COUNT(DISTINCT documents.id)::INTEGER AS document_count,
    COUNT(DISTINCT chunks.id)::INTEGER AS chunk_count
  FROM ai_knowledge_collections collections
  LEFT JOIN ai_knowledge_collection_sources links ON links.collection_id = collections.id
  LEFT JOIN ai_knowledge_sources sources ON sources.id = links.source_id ${sourceAcl}
  LEFT JOIN ai_knowledge_documents documents ON documents.source_id = sources.id AND documents.is_active = TRUE
  LEFT JOIN ai_knowledge_chunks chunks ON chunks.document_id = documents.id
`;
};

const listCollections = async (projectId, { allowedSourcePermissions } = {}) => db.prepare(`${buildCollectionCountsSql(allowedSourcePermissions)}
  WHERE collections.project_id = ?
  GROUP BY collections.id
  ORDER BY collections.updated_at DESC
`).all(...(Array.isArray(allowedSourcePermissions) ? allowedSourcePermissions : []), projectId);

const getCollection = async (id, { allowedSourcePermissions } = {}) => {
  const collection = await db.prepare(`${buildCollectionCountsSql(allowedSourcePermissions)}
    WHERE collections.id = ?
    GROUP BY collections.id
  `).get(...(Array.isArray(allowedSourcePermissions) ? allowedSourcePermissions : []), id);
  if (!collection) throw createError("Knowledge collection not found.", 404);
  return collection;
};

const createCollection = async ({ projectId, appTypeId, name, description, color, retrievalConfig, userId }) => {
  const id = uuid();
  const normalizedName = normalizeText(name, 240);
  if (!projectId || !normalizedName) throw createError("project_id and name are required.");
  await db.prepare(`
    INSERT INTO ai_knowledge_collections (
      id, project_id, app_type_id, name, description, color, retrieval_config, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, projectId, appTypeId || null, normalizedName, normalizeText(description, 4_000) || null, normalizeText(color, 40) || null, asObject(retrievalConfig), userId || null);
  return getCollection(id);
};

const updateCollection = async (id, data) => {
  const current = await getCollection(id);
  const status = data.status === "archived" ? "archived" : data.status === "active" ? "active" : current.status;
  await db.prepare(`
    UPDATE ai_knowledge_collections SET app_type_id = ?, name = ?, description = ?, color = ?, status = ?,
      retrieval_config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(
    Object.prototype.hasOwnProperty.call(data, "app_type_id") ? normalizeId(data.app_type_id) || null : current.app_type_id,
    normalizeText(data.name, 240) || current.name,
    Object.prototype.hasOwnProperty.call(data, "description") ? normalizeText(data.description, 4_000) || null : current.description,
    Object.prototype.hasOwnProperty.call(data, "color") ? normalizeText(data.color, 40) || null : current.color,
    status,
    Object.prototype.hasOwnProperty.call(data, "retrieval_config") ? asObject(data.retrieval_config) : asObject(current.retrieval_config),
    id
  );
  return getCollection(id);
};

const deleteCollection = async (id) => {
  const collection = await getCollection(id);
  await db.prepare("DELETE FROM ai_knowledge_collections WHERE id = ?").run(id);
  return { deleted: true, id, project_id: collection.project_id, sources_retained: true };
};

const assertSourceRowsVisible = async (projectId, rows, user) => {
  const requiredPermissions = [...new Set(rows.map((row) => row.required_permission).filter(Boolean))];
  for (const permissionCode of requiredPermissions) {
    if (!user || !await permissionService.hasPermission(user, permissionCode, projectId)) {
      throw createError(`Permission required for selected knowledge source: ${permissionCode}`, 403, "KNOWLEDGE_SOURCE_PERMISSION_REQUIRED");
    }
  }
};

const linkCollectionSources = async (collectionId, sourceIds, user) => {
  const collection = await getCollection(collectionId);
  const ids = normalizeFilterIds(sourceIds, 500);
  if (!ids.length) throw createError("source_ids must include at least one source.");
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await db.prepare(`SELECT id, required_permission FROM ai_knowledge_sources WHERE project_id = ? AND id IN (${placeholders})`).all(collection.project_id, ...ids);
  if (rows.length !== ids.length) throw createError("One or more knowledge sources do not belong to this project.", 403);
  await assertSourceRowsVisible(collection.project_id, rows, user);
  await db.transaction(async () => {
    for (const id of ids) {
      await db.prepare("INSERT INTO ai_knowledge_collection_sources (collection_id, source_id) VALUES (?, ?) ON CONFLICT DO NOTHING").run(collectionId, id);
    }
  })();
  const allowedSourcePermissions = await resolveAllowedSourcePermissions(user, collection.project_id);
  return getCollection(collectionId, { allowedSourcePermissions });
};

const unlinkCollectionSources = async (collectionId, sourceIds, user) => {
  const collection = await getCollection(collectionId);
  const ids = normalizeFilterIds(sourceIds, 500);
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(", ");
    const rows = await db.prepare(`
      SELECT sources.id, sources.required_permission
      FROM ai_knowledge_collection_sources links
      JOIN ai_knowledge_sources sources ON sources.id = links.source_id
      WHERE links.collection_id = ? AND sources.project_id = ? AND sources.id IN (${placeholders})
    `).all(collectionId, collection.project_id, ...ids);
    if (rows.length !== ids.length) throw createError("One or more knowledge sources are not linked to this project collection.", 404);
    await assertSourceRowsVisible(collection.project_id, rows, user);
    await db.transaction(async () => {
      await db.prepare(`DELETE FROM ai_knowledge_collection_sources WHERE collection_id = ? AND source_id IN (${placeholders})`).run(collectionId, ...ids);
    })();
  }
  const allowedSourcePermissions = await resolveAllowedSourcePermissions(user, collection.project_id);
  return getCollection(collectionId, { allowedSourcePermissions });
};

const getOverview = async ({ projectId, userId, user }) => {
  const allowedSourcePermissions = await resolveAllowedSourcePermissions(user, projectId);
  const sourceAcl = allowedSourcePermissions.length
    ? `(required_permission IS NULL OR required_permission IN (${allowedSourcePermissions.map(() => "?").join(", ")}))`
    : "required_permission IS NULL";
  const counts = await db.prepare(`
    WITH visible_sources AS (
      SELECT id, extraction_status FROM ai_knowledge_sources
      WHERE project_id = ? AND ${sourceAcl}
    )
    SELECT
      (SELECT COUNT(*)::INTEGER FROM ai_knowledge_collections WHERE project_id = ?) AS collections,
      (SELECT COUNT(*)::INTEGER FROM visible_sources) AS sources,
      (SELECT COUNT(*)::INTEGER FROM ai_knowledge_documents documents JOIN visible_sources sources ON sources.id = documents.source_id WHERE documents.is_active = TRUE) AS documents,
      (SELECT COUNT(*)::INTEGER FROM ai_knowledge_chunks chunks
        JOIN ai_knowledge_documents documents ON documents.id = chunks.document_id AND documents.is_active = TRUE
        JOIN visible_sources sources ON sources.id = chunks.source_id) AS chunks,
      (SELECT COUNT(*)::INTEGER FROM visible_sources WHERE extraction_status = 'ready') AS ready_sources,
      (SELECT COUNT(*)::INTEGER FROM visible_sources WHERE extraction_status IN ('pending', 'processing', 'needs_extraction')) AS processing_sources,
      (SELECT COUNT(*)::INTEGER FROM visible_sources WHERE extraction_status = 'failed') AS failed_sources
  `).get(projectId, ...allowedSourcePermissions, projectId);
  const recentJobs = isKnowledgeAdmin(user)
    ? await db.prepare("SELECT * FROM ai_knowledge_ingestion_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 10").all(projectId)
    : await db.prepare("SELECT * FROM ai_knowledge_ingestion_jobs WHERE project_id = ? AND created_by = ? ORDER BY created_at DESC LIMIT 10").all(projectId, user?.id || "__no_user__");
  const embedding = await resolveEmbeddingRuntime({ userId, projectId });
  const pgvectorAvailable = await getVectorCapability();
  let contextQuality = { active_documents: 0, current_pipeline_documents: 0, review_required_documents: 0, average_score: null };
  try {
    const qualityRow = await db.prepare(`
      SELECT COUNT(*)::INTEGER AS active_documents,
        COUNT(*) FILTER (WHERE metadata->'processing_pipeline'->>'version' = ?)::INTEGER AS current_pipeline_documents,
        COUNT(*) FILTER (WHERE COALESCE((metadata->'context_quality'->>'requires_review')::BOOLEAN, FALSE))::INTEGER AS review_required_documents,
        ROUND(AVG(NULLIF(metadata->'context_quality'->>'score', '')::NUMERIC), 1) AS average_score
      FROM ai_knowledge_documents
      WHERE project_id = ? AND is_active = TRUE
    `).get(KNOWLEDGE_PROCESSING_VERSION, projectId);
    contextQuality = {
      active_documents: Number(qualityRow?.active_documents || 0),
      current_pipeline_documents: Number(qualityRow?.current_pipeline_documents || 0),
      review_required_documents: Number(qualityRow?.review_required_documents || 0),
      average_score: qualityRow?.average_score === null || qualityRow?.average_score === undefined ? null : Number(qualityRow.average_score)
    };
  } catch {
    // Overview remains available during rolling upgrades or partial schemas.
  }
  return {
    project_id: projectId,
    counts,
    recent_jobs: recentJobs.map((job) => toPublicIngestionJob(job)),
    capabilities: {
      hybrid_search: true,
      vector_store: {
        engine: knowledgeVectorStore.isConfigured() ? "Qdrant projection + PostgreSQL canonical hydration" : "PostgreSQL",
        pgvector_available: pgvectorAvailable,
        mode: knowledgeVectorStore.isConfigured()
          ? "ACL-prefiltered Qdrant dense retrieval fused with PostgreSQL full-text search"
          : pgvectorAvailable ? "pgvector with JSONB fallback" : "JSONB cosine with PostgreSQL full-text search",
        fallback: "PostgreSQL tsvector + pgvector/JSONB cosine + deterministic local hash embeddings",
        ...knowledgeVectorStore.getStatus()
      },
      embedding: {
        provider: embedding.provider,
        model: embedding.model,
        configured: embedding.configured,
        mode: embedding.configured ? "configured_semantic_embedding" : "degraded_local_lexical_hash",
        accuracy_note: embedding.configured
          ? "Semantic quality depends on the configured embedding model and indexed model compatibility."
          : "The local hash vector is a deterministic degraded retrieval fallback, not a semantic-accuracy substitute."
      },
      context_processing: {
        version: KNOWLEDGE_PROCESSING_VERSION,
        hierarchy_strategy: "document-title+section-lineage+content-type+content",
        ...contextQuality,
        refresh_recommended: contextQuality.active_documents > contextQuality.current_pipeline_documents
      },
      product_help: { version: PRODUCT_HELP_VERSION, source_id: "hellotest-product-help", citation_backed: true },
      extraction: {
        max_file_bytes: Math.min(Number(config.knowledge?.maxFileBytes || 50 * 1024 * 1024), Number(config.objectStorage.maxAttachmentBytes)),
        max_extractable_bytes: Number(config.knowledge?.extractionMaxBytes || 20 * 1024 * 1024),
        max_extracted_text_chars: MAX_EXTRACTED_TEXT_CHARS,
        native_text_mime_types: [...NATIVE_TEXT_MIME_TYPES].sort(),
        supported_mime_types: [...SUPPORTED_UPLOAD_MIME_TYPES].sort(),
        tika_configured: Boolean(getTikaUrl()),
        binary_requires_extracted_text: true,
        tika_documents_can_be_extracted_server_side: Boolean(getTikaUrl()),
        media_requires_caption_or_transcript: true
      },
      guardrails: ASSISTANT_GUARDRAILS
    }
  };
};

const syncLegacyKnowledgeItem = async (projectId, item, userId, { signal, activationGuard } = {}) => {
  if (item.is_active === false || !normalizeText(item.content)) {
    await archiveLegacyKnowledgeSource(projectId, item.id);
    return null;
  }
  const input = {
    source_kind: "knowledge_item",
    source_ref_id: item.id,
    app_type_id: item.app_type_id || null,
    title: item.title,
    content: [item.description, item.content].filter(Boolean).join("\n\n"),
    source_uri: item.source_uri || null,
    extraction_strategy: "legacy_knowledge_item",
    metadata: { content_type: item.content_type, legacy: true },
    processing_fingerprint: processingProfile({}).fingerprint
  };
  const source = await createSource({ projectId, input, userId });
  if (source._reused) return { document: null, chunks: [], reused: true };
  const runtime = () => resolveEmbeddingRuntime({ userId, projectId, signal });
  const expectedHash = fingerprint(sanitizeAiText(input.content).text);
  return persistDocument({
    projectId,
    source,
    content: input.content,
    chunking: {},
    embeddingRuntime: runtime,
    metadata: input.metadata,
    signal,
    activationGuard: async () => {
      const current = await db.prepare(`
        SELECT description, content, is_active
        FROM ai_knowledge_repo WHERE id = ? AND project_id = ?
        FOR SHARE
      `).get(item.id, projectId);
      const currentMatches = Boolean(current?.is_active)
        && fingerprint(sanitizeAiText([current.description, current.content].filter(Boolean).join("\n\n")).text) === expectedHash;
      return currentMatches && (!activationGuard || await activationGuard());
    }
  });
};

// Fingerprint complete evidence, including linked child records, before deciding
// whether incremental refresh needs extraction/embedding. Respect archived sources.
const isApplicationRecordIndexed = async (projectId, kind, id) => {
  const source = await db.prepare(`SELECT s.extraction_status, d.metadata FROM ai_knowledge_sources s
    LEFT JOIN ai_knowledge_documents d ON d.source_id = s.id AND d.is_active = TRUE
    WHERE s.project_id = ? AND s.source_kind = ? AND s.source_ref_id = ? LIMIT 1`).get(projectId, kind, id);
  if (source?.extraction_status === "archived") return true;
  if (!source?.metadata?.snapshot_fingerprint) return false;
  const record = await loadApplicationRecord(projectId, kind, id);
  return source.metadata.snapshot_fingerprint === applicationSnapshotFingerprint(record);
};
module.exports = {
  isApplicationRecordIndexed,
  ASSISTANT_GUARDRAILS,
  assertLlmIntegrationProjectScope,
  createCollection,
  deleteCollection,
  getCollection,
  getIngestionJob,
  getOverview,
  getTikaUrl,
  getVectorCapability,
  ingest,
  enqueueIngestion,
  ingestUpload,
  linkCollectionSources,
  listCollections,
  processQueuedIngestions,
  processLegacyKnowledgeSyncOutbox,
  queueLegacyKnowledgeSync,
  retryIngestion,
  archiveLegacyKnowledgeSource,
  resolveAllowedSourcePermissions,
  search,
  searchMany,
  expandEvidence,
  expandRelationships,
  syncLegacyKnowledgeItem,
  unlinkCollectionSources,
  updateCollection,
  _internals: {
    allocateCandidateBudgets,
    createSource,
    persistDocument,
    KNOWLEDGE_PROCESSING_VERSION,
    buildChunkRetrievalText,
    buildDocumentContextProfile,
    classifyIngestionError,
    embedTexts,
    extractWithTika,
    loadApplicationRecord,
    normalizeInput,
    isApplicationRecordSnapshotCurrent,
    stableSourceKey,
    applicationSnapshotFingerprint,
    normalizeProviderEmbeddingBatch,
    processingProfile,
    validateEmbeddingVector,
    sanitizeClientMetadata,
    sanitizeExternalReferences,
    normalizeSourceKind,
    normalizeSelectedRecordInputs,
    getRecordSourcePermissionCodes,
    canReuseSourceVersion,
    requiredPermissionForSourceKind,
    usesEmbeddingsForMode,
    resolveEmbeddingRuntime,
    serializeBug,
    serializeExecution,
    serializeRequirement,
    serializeTestCase
  }
};
