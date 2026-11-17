const { randomUUID: uuid, createHash } = require("crypto");
const { Readable } = require("stream");
const db = require("@hellotest/platform/backend/src/db");
const { config } = require("@hellotest/platform/backend/src/config");
const attachmentService = require("@hellotest/platform/backend/services/attachment.service");
const permissionService = require("@hellotest/platform/backend/services/permission.service");
const featureFlagService = require("@hellotest/platform/backend/services/featureFlag.service");
const knowledgeVectorStore = require("./knowledgeVectorStore.service");
const knowledgeVectorProjection = require("./knowledgeVectorProjection.service");
const knowledgeContracts = require("./knowledgeContracts.service");
const knowledgeAuthorization = require("./knowledgeAuthorization.service");
const {
  PRODUCT_HELP_VERSION,
  rankProductHelpSections
} = require("./knowledgeProductCatalog.service");
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
const MAX_MANUAL_INGESTION_RETRIES = 5;
const FAILED_INPUT_RETENTION_DAYS = 7;
const KNOWLEDGE_PROCESSING_VERSION = "2026.10-permission-scoped-context-v4";
const KNOWLEDGE_WORKER_ID = `knowledge-${process.pid}-${uuid()}`;
const NATIVE_OUTBOX_PRINCIPAL = Symbol("knowledge-native-outbox-principal");
const knowledgeOntology = require("./knowledgeOntology");
const SOURCE_KINDS = new Set(knowledgeOntology.NODE_KINDS);
const SOURCE_PERMISSION_BY_KIND = knowledgeOntology.PERMISSION_BY_KIND;
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
const lexicalQuery = require("./knowledgeLexicalQuery");
const ranking = require("./knowledgeRanking");
const { claimFairQueueRow } = require("./knowledgeQueueFairness.service");
const { LINK_FIELDS, LINK_LABELS, linkLine } = require("./knowledgeLinkLabels");
const embeddingRuntime = require("./knowledgeEmbeddingRuntime.service");
const {
  INGESTION_EMBEDDING_TIMEOUT_MS,
  LOCAL_EMBEDDING_MODEL,
  RETRIEVAL_EMBEDDING_TIMEOUT_MS,
  embedTexts,
  getVectorCapability,
  normalizeProviderEmbeddingBatch,
  resolveEmbeddingRuntime,
  validateEmbeddingVector,
  vectorLiteral
} = embeddingRuntime;

// The lexical channel drops words that appear in most chunks (they carry no
// signal for an OR query). PostgreSQL already tracks the most common lexemes of
// the search vector for its own planner, so reuse that instead of scanning.
//
// The read is synchronous: retrieval must dispatch its lexical SQL before it
// awaits anything (an unresponsive embedding provider can never delay it), so a
// stale cache is refreshed in the background and the previous value is used now.
// Statistics only sharpen the query. Any failure leaves the filter as it was and
// is not retried for a minute.
const LEXEME_STATISTICS_TTL_MS = 10 * 60_000;
const LEXEME_STATISTICS_RETRY_MS = 60_000;
const lexemeStatistics = { expiresAt: 0, lexemes: new Map(), refreshing: null };
const refreshCommonLexemes = async () => {
  try {
    const row = await db.prepare(`SELECT most_common_elems, most_common_elem_freqs FROM pg_stats
      WHERE schemaname = current_schema() AND tablename = 'ai_knowledge_chunks' AND attname = 'search_vector' LIMIT 1`).get();
    lexemeStatistics.lexemes = lexicalQuery.parseLexemeStatistics(row);
    lexemeStatistics.expiresAt = Date.now() + LEXEME_STATISTICS_TTL_MS;
  } catch {
    lexemeStatistics.expiresAt = Date.now() + LEXEME_STATISTICS_RETRY_MS;
  } finally {
    lexemeStatistics.refreshing = null;
  }
};
const commonLexemes = () => {
  if (Date.now() >= lexemeStatistics.expiresAt && !lexemeStatistics.refreshing) {
    lexemeStatistics.refreshing = refreshCommonLexemes();
  }
  return lexemeStatistics.lexemes;
};
// Prose vectors use one configured language. Validated against an allow-list so
// it can be interpolated into SQL safely.
const lexicalProseConfig = () => lexicalQuery.configuredProseConfig();

const asObject =(value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
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
    execution_result: "execution_result",
    execution_results: "execution_result",
    suite: "test_suite",
    suites: "test_suite",
    test_suite: "test_suite",
    test_suites: "test_suite",
    module: "test_module",
    modules: "test_module",
    test_module: "test_module",
    test_modules: "test_module",
    release: "release",
    releases: "release",
    sprint: "sprint",
    sprints: "sprint",
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
const canReuseSourceVersion = ({ existing, readyDocument, contentHash, documentHash, processingFingerprint, metadataFingerprint, snapshotFingerprint }) => Boolean(
  readyDocument
  && existing?.extraction_status === "ready"
  && existing?.checksum_sha256 === contentHash
  && (!documentHash || readyDocument.checksum_sha256 === documentHash)
  && (!processingFingerprint || asObject(readyDocument.metadata).processing_pipeline?.fingerprint === processingFingerprint)
  && (!metadataFingerprint || asObject(readyDocument.metadata).repository_provenance_fingerprint === metadataFingerprint)
  && (!snapshotFingerprint || asObject(readyDocument.metadata).snapshot_fingerprint === snapshotFingerprint)
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

const assertCollectionScope = async (projectId, collectionId) => {
  if (!collectionId) return null;
  const collection = await db.prepare("SELECT * FROM ai_knowledge_collections WHERE id = ? AND project_id = ?").get(collectionId, projectId);
  if (!collection) throw createError("Knowledge collection was not found in this project.", 404);
  return collection;
};

const { compactJson, relationshipRecords, buildRelationshipChunks, stripRelationshipLines, serializeRequirement, serializeTestCase, serializeExecution, serializeBug, serializeTestSuite, serializeTestModule, serializeRelease, serializeSprint, serializeExecutionResult } = require("./knowledgeApplicationSerializers.service")({
  db, asArray, asObject, normalizeId, normalizeText, sanitizeExternalReferences, knowledgeAuthorization, LINK_FIELDS, LINK_LABELS, linkLine
});

const loadApplicationRecord = async (projectId, kind, id) => {
  if (kind === "requirement") {
    const row = await db.prepare(`
      SELECT id, display_id, title, description, gherkin_scenarios, specification_content,
        additional_fields->'acceptance_criteria' AS acceptance_criteria,
        external_references, labels, priority, status, sprint, release, iteration_id, created_at, updated_at
      FROM requirements WHERE id = ? AND project_id = ?
    `).get(id, projectId);
    if (!row) throw createError(`Story ${id} was not found in this project.`, 404);
    const linkedTestCases = await db.prepare(`
      SELECT test_case_id, COUNT(*) OVER() AS total_link_count FROM requirement_test_cases
      WHERE requirement_id = ? ORDER BY test_case_id
    `).all(id);
    const releaseLinks = await db.prepare(`SELECT release_id FROM requirement_release_items WHERE requirement_id = ? ORDER BY release_id`).all(id);
    return serializeRequirement({ ...row, release_ids: releaseLinks.map(link => link.release_id), sprint_ids: row.iteration_id ? [row.iteration_id] : [] },
      linkedTestCases.map((link) => link.test_case_id), Number(linkedTestCases[0]?.total_link_count) || linkedTestCases.length);
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
  if (kind === "test_suite") {
    const row = await db.prepare(`SELECT suites.id,suites.display_id,suites.app_type_id,suites.name,suites.description,suites.parent_id,suites.updated_at,suites.created_at
      FROM test_suites suites JOIN app_types apps ON apps.id=suites.app_type_id WHERE suites.id=? AND apps.project_id=?`).get(id, projectId);
    if (!row) throw createError(`Test Suite ${id} was not found in this project.`, 404);
    const links = await db.prepare(`SELECT test_case_id,COUNT(*) OVER() AS test_case_count FROM suite_test_cases
      WHERE suite_id=? ORDER BY sort_order,test_case_id`).all(id);
    return serializeTestSuite({ ...row, test_case_count: links[0]?.test_case_count }, links.map(link => link.test_case_id));
  }
  if (kind === "test_module") {
    const row = await db.prepare(`SELECT modules.id,modules.display_id,modules.app_type_id,modules.name,modules.description,modules.updated_at,modules.created_at
      FROM test_case_modules modules JOIN app_types apps ON apps.id=modules.app_type_id WHERE modules.id=? AND apps.project_id=?`).get(id, projectId);
    if (!row) throw createError(`Test Module ${id} was not found in this project.`, 404);
    const [caseLinks, requirementLinks] = await Promise.all([
      db.prepare(`SELECT test_case_id,COUNT(*) OVER() AS test_case_count FROM test_case_module_cases WHERE module_id=? ORDER BY sort_order,test_case_id`).all(id),
      db.prepare(`SELECT requirement_id,COUNT(*) OVER() AS requirement_count FROM test_case_module_requirements WHERE module_id=? ORDER BY sort_order,requirement_id`).all(id)
    ]);
    return serializeTestModule({ ...row, test_case_count: caseLinks[0]?.test_case_count, requirement_count: requirementLinks[0]?.requirement_count },
      caseLinks.map(link => link.test_case_id), requirementLinks.map(link => link.requirement_id));
  }
  if (kind === "release") {
    const row = await db.prepare(`SELECT id,display_id,project_id,name,description,fix_version,state,sprint_ids,updated_at,created_at
      FROM requirement_releases WHERE id=? AND project_id=?`).get(id, projectId);
    if (!row) throw createError(`Release ${id} was not found in this project.`, 404);
    const links = await db.prepare(`SELECT requirement_id,COUNT(*) OVER() AS requirement_count FROM requirement_release_items
      WHERE release_id=? ORDER BY requirement_id`).all(id);
    return serializeRelease({ ...row, requirement_count: links[0]?.requirement_count }, links.map(link => link.requirement_id));
  }
  if (kind === "sprint") {
    const row = await db.prepare(`SELECT id,display_id,project_id,name,description,goal,state,updated_at,created_at
      FROM requirement_iterations WHERE id=? AND project_id=?`).get(id, projectId);
    if (!row) throw createError(`Sprint ${id} was not found in this project.`, 404);
    const links = await db.prepare(`SELECT id AS requirement_id,COUNT(*) OVER() AS requirement_count FROM requirements
      WHERE iteration_id=? AND project_id=? ORDER BY id`).all(id, projectId);
    return serializeSprint({ ...row, requirement_count: links[0]?.requirement_count }, links.map(link => link.requirement_id));
  }
  if (kind === "execution_result") {
    const row = await db.prepare(`SELECT results.id,results.execution_id,results.test_case_id,results.app_type_id,results.status,
      results.created_at AS updated_at,results.created_at,runs.project_id
      FROM execution_results results JOIN executions runs ON runs.id=results.execution_id
      WHERE results.id=? AND runs.project_id=?`).get(id, projectId);
    if (!row) throw createError(`Test Run result ${id} was not found in this project.`, 404);
    return serializeExecutionResult(row);
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

const { createKnowledgeIngestionService } = require("./knowledgeIngestion.service");
const knowledgeIngestion = createKnowledgeIngestionService({
  FAILED_INPUT_RETENTION_DAYS,
  KNOWLEDGE_WORKER_ID,
  LOCAL_EMBEDDING_MODEL,
  MAX_INPUTS,
  MAX_MANUAL_INGESTION_RETRIES,
  NATIVE_OUTBOX_PRINCIPAL,
  NATIVE_TEXT_MIME_TYPES,
  Readable,
  SOURCE_PERMISSION_BY_KIND,
  SUPPORTED_UPLOAD_MIME_TYPES,
  TIKA_MIME_TYPES,
  applicationSnapshotFingerprint,
  asArray,
  asObject,
  assertCollectionScope,
  assertRecordSourcePermissions,
  assessContextQuality,
  attachmentService,
  buildRelationshipChunks,
  canReuseSourceVersion,
  chunkText,
  claimFairQueueRow,
  classifyIngestionError,
  config,
  createError,
  createHash,
  db,
  decodeNativeText,
  embedTexts,
  extractWithTika,
  featureFlagService,
  fingerprint,
  getTikaUrl,
  getVectorCapability,
  isKnowledgeAdmin,
  knowledgeVectorProjection,
  lexicalProseConfig,
  lexicalQuery,
  loadApplicationRecord,
  localEmbedding,
  normalizeChunkingOptions,
  normalizeId,
  normalizeSelectedRecordInputs,
  normalizeSourceKind,
  normalizeText,
  permissionService,
  processingProfile,
  requiredPermissionForSourceKind,
  resolveEmbeddingRuntime,
  sanitizeAiText,
  sanitizeClientMetadata,
  sanitizeSourceUri,
  stableSourceKey,
  stripRelationshipLines,
  toPublicDocument,
  toPublicSource,
  uuid,
  validateEmbeddingVector,
  validateUploadSignature,
  vectorLiteral,
  syncLegacyKnowledgeItem: (...args) => syncLegacyKnowledgeItem(...args)
});
const { normalizeInput, isApplicationRecordSnapshotCurrent, createJob, getIngestionJob, toPublicIngestionJob, recordIngestionResult, createSource, markSourcePersistenceFailed, markSourceNeedsExtraction, removeUnactivatedNewSourceAfterLeaseLoss, persistEmbeddingVector, buildChunkRetrievalText, buildDocumentContextProfile, embeddingConfigurationHash, enqueueSemanticWork, claimSemanticWork, enqueueStaleEmbeddingBackfill, finishSemanticWork, processSemanticWork, embedDocumentTexts, persistDocument, completeJob, ingest, claimNativeOutboxEvent, processNativeChangeOutbox, reconcileNativeIndexGaps, prepareQueuedInput, enqueueIngestion, claimQueuedIngestion, renewIngestionLease, processQueuedIngestions, retryIngestion, archiveLegacyKnowledgeSource, queueLegacyKnowledgeSync, claimLegacyKnowledgeSync, processLegacyKnowledgeSyncOutbox, streamToBoundedBuffer, processQueuedUpload, ingestUpload } = knowledgeIngestion;
const normalizeFilterIds = (value, max = 100) => [...new Set(asArray(value).map(normalizeId).filter(Boolean))].slice(0, max);
const { createKnowledgeCollections } = require("./knowledgeCollections.service");
const {
  buildCollectionCountsSql,
  listCollections,
  getCollection,
  createCollection,
  updateCollection,
  deleteCollection,
  linkCollectionSources,
  unlinkCollectionSources
} = createKnowledgeCollections({
  db, uuid, normalizeText, normalizeId, normalizeFilterIds, resolveAllowedSourcePermissions, permissionService
});
const { createKnowledgeOverview } = require("./knowledgeOverview.service");
const { getOverview } = createKnowledgeOverview({
  db, config, maxExtractedTextChars: MAX_EXTRACTED_TEXT_CHARS,
  nativeTextMimeTypes: NATIVE_TEXT_MIME_TYPES, supportedUploadMimeTypes: SUPPORTED_UPLOAD_MIME_TYPES,
  assistantGuardrails: ASSISTANT_GUARDRAILS, processingVersion: KNOWLEDGE_PROCESSING_VERSION,
  productHelpVersion: PRODUCT_HELP_VERSION, authorization: knowledgeAuthorization, vectorStore: knowledgeVectorStore,
  isKnowledgeAdmin, resolveAllowedSourcePermissions, toPublicIngestionJob,
  resolveEmbeddingRuntime, getVectorCapability, getTikaUrl
});

const { createKnowledgeSearchService } = require("./knowledgeSearch.service");
const {
  getProductHelpCandidates, search, searchMany, expandEvidence, expandRelationships,
  allocateCandidateBudgets, relationPreferenceForQuestion, resolveQuestionEntities, loadNeighbourPassages
} = createKnowledgeSearchService({
  ASSISTANT_GUARDRAILS,
  LOCAL_EMBEDDING_MODEL,
  MAX_CANDIDATES,
  MAX_FALLBACK_CANDIDATES,
  MAX_SEARCH_LIMIT,
  PRODUCT_HELP_VERSION,
  RETRIEVAL_EMBEDDING_TIMEOUT_MS,
  SOURCE_KINDS,
  SOURCE_PERMISSION_BY_KIND,
  asArray,
  asObject,
  assertRetrievalActive,
  boundedRetrievalStage,
  commonLexemes,
  cosineSimilarity,
  createError,
  db,
  embedTexts,
  fingerprint,
  getVectorCapability,
  knowledgeAuthorization,
  knowledgeContracts,
  knowledgeVectorStore,
  lexicalProseConfig,
  lexicalQuery,
  localEmbedding,
  normalizeFilterIds,
  normalizeId,
  normalizeSourceKind,
  normalizeText,
  rankProductHelpSections,
  ranking,
  resolveAllowedSourcePermissions,
  resolveEmbeddingRuntime,
  retrievalTimeout,
  sanitizeAiText,
  sanitizeSourceUri,
  usesEmbeddingsForMode,
  vectorLiteral,
});


const syncLegacyKnowledgeItem = async (projectId, item, userId, { signal, activationGuard } = {}) => {
  if (item.is_active === false || !normalizeText(item.content)) {
    await archiveLegacyKnowledgeSource(projectId, item.id);
    return null;
  }
  const provenance = require('./knowledgeRepositoryProvenance').repositoryProvenanceMetadata(item.metadata);
  const input = {
    source_kind: "knowledge_item",
    source_ref_id: item.id,
    app_type_id: item.app_type_id || null,
    title: item.title,
    content: [item.description, item.content].filter(Boolean).join("\n\n"),
    source_uri: item.source_uri || null,
    extraction_strategy: "legacy_knowledge_item",
    metadata: { content_type: ['text','url','video_url','file','pdf','image','markdown'].includes(item.content_type) ? item.content_type : 'text', legacy: true, ...provenance },
    metadata_fingerprint: provenance.repository_provenance_fingerprint,
    graph_projection_required: Boolean(provenance.repository_agent_key),
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
        SELECT description, content, is_active, metadata
        FROM ai_knowledge_repo WHERE id = ? AND project_id = ?
        FOR SHARE
      `).get(item.id, projectId);
      const currentMatches = Boolean(current?.is_active)
        && fingerprint(sanitizeAiText([current.description, current.content].filter(Boolean).join("\n\n")).text) === expectedHash
        && (!input.metadata_fingerprint || require('./knowledgeRepositoryProvenance').repositoryProvenanceMetadata(current.metadata).repository_provenance_fingerprint === input.metadata_fingerprint);
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
  processNativeChangeOutbox,
  reconcileNativeIndexGaps,
  processSemanticWork,
  enqueueStaleEmbeddingBackfill,
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
    relationPreferenceForQuestion,
    resolveQuestionEntities,
    loadNeighbourPassages,
    createSource,
    persistDocument,
    KNOWLEDGE_PROCESSING_VERSION,
    buildChunkRetrievalText,
    buildDocumentContextProfile,
    buildRelationshipChunks,
    relationshipRecords,
    embedDocumentTexts,
    embeddingConfigurationHash,
    relationshipRecords,
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
    claimQueuedIngestion,
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
