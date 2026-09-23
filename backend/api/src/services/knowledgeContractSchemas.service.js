const VERSION = "1.0";
const PRESENTATIONS = Object.freeze(["TEXT", "TABLE", "TIMELINE", "COMPARISON", "RELATIONSHIP_GRAPH", "METRIC", "DOCUMENT_RESULTS", "IMAGE_RESULTS"]);
const STAGES = Object.freeze([
  "QUERY_RECEIVED", "QUERY_UNDERSTANDING", "INTENT_ANALYSIS", "AUTHORIZATION", "RETRIEVAL_PLANNING",
  "READING_PROJECT", "READING_STORIES", "READING_TEST_CASES", "READING_RUNS", "READING_BUGS",
  "READING_AUTOMATION", "READING_EXECUTION_CONTEXT", "KNOWLEDGE_REPO_SEARCH", "CONTEXT_SUFFICIENCY",
  "STRUCTURED_LOOKUP", "LEXICAL_SEARCH", "SEMANTIC_SEARCH", "HYBRID_SEARCH", "RELATIONSHIP_SEARCH",
  "MULTIMODAL_SEARCH", "RERANKING", "PARENT_EXPANSION", "CONTEXT_ASSEMBLY", "GENERATION",
  "VALIDATION", "COMPLETED", "FAILED"
]);
const string = (maxLength = 4000) => ({
  type: "string",
  maxLength
});
const id = {
  ...string(500),
  minLength: 1
};
const nullable = schema => ({
  anyOf: [schema, {
      type: "null"
    }]
});
const number = (maximum = Number.MAX_SAFE_INTEGER) => ({
  type: "number",
  minimum: 0,
  maximum
});
const integer = (maximum = Number.MAX_SAFE_INTEGER) => ({
  ...number(maximum),
  type: "integer"
});
const boolean = {
  type: "boolean"
};
const array = (items, maxItems = 100) => ({
  type: "array",
  items,
  maxItems
});
const object = (properties, required = [], additionalProperties = false) => ({
  type: "object",
  properties,
  required,
  additionalProperties
});
const openObject = {
  type: "object",
  additionalProperties: true
};
const enumeration = values => ({
  type: "string",
  enum: values
});
const timestamp = {
  type: "string",
  format: "date-time"
};
const envelope = (type, fields, required = []) => object({
  contract_type: {
    const: type
  },
  contract_version: {
    const: VERSION
  },
  schema_id: {
    const: `${type}.v1`
  },
  ...fields
}, ["contract_type", "contract_version", ...required]);
const budgets = object({
  deadline_ms: integer(60000),
  max_rounds: integer(4),
  max_retrieval_rounds: integer(4),
  max_tool_calls: integer(20),
  max_queries: integer(10),
  max_candidates: integer(1000),
  max_candidate_documents: integer(1000),
  max_reranker_candidates: integer(1000),
  max_evidence_items: integer(30),
  max_context_tokens: integer(32000),
  max_cost_usd: number(10),
  max_query_cost_usd: number(10)
});
const filters = object({
  collection_ids: array(id),
  collections: array(id),
  source_ids: array(id),
  source_kinds: array(string(80), 20),
  source_types: array(string(80), 20),
  app_type_id: nullable(id),
  project: array(id),
  as_of: nullable(timestamp)
});
const location = object({
  page: nullable(integer()),
  section: nullable(string(500)),
  timestamp_start_ms: nullable(integer()),
  timestamp_end_ms: nullable(integer()),
  start_ms: nullable(integer()),
  end_ms: nullable(integer()),
  line: nullable(integer()),
  field: nullable(string(500)),
  uri: nullable(string(2000)),
  url: nullable(string(2000)),
  title: nullable(string(500)),
  heading: nullable(string(500)),
  chunk_index: nullable(integer()),
  offset: nullable(integer())
});
const limitations = object({
  retrieval_status: enumeration(["COMPLETE", "PARTIAL", "FAILED"]),
  authorization_partial: boolean,
  budget_partial: boolean,
  stale_sources: array(id),
  unavailable_sources: integer(),
  freshness_unknown: boolean
}, ["retrieval_status", "authorization_partial", "budget_partial", "stale_sources", "unavailable_sources"]);
const evidence = object({
  evidence_id: id,
  canonical_id: nullable(id),
  knowledge_id: nullable(id),
  fragment_id: nullable(id),
  source_id: string(500),
  source_kind: string(80),
  source_type: string(80),
  source_ref_id: nullable(string(500)),
  document_id: nullable(id),
  chunk_id: nullable(id),
  title: string(500),
  content: string(128000),
  location,
  locator: location,
  scores: object({
    fused: number(),
    lexical: number(),
    semantic: number()
  }),
  relevance: object({
    rerank_score: nullable(number())
  }),
  integrity: object({
    source_hash: nullable(string(255)),
    version_hash: nullable(string(255)),
    chunk_hash: string(255),
    evidence_hash: string(255)
  }),
  authoritative_live: boolean,
  freshness: object({
    current: nullable(boolean),
    status: enumeration(["CURRENT", "STALE", "HISTORICAL", "UNKNOWN"]),
    effective_from: nullable(timestamp),
    effective_to: nullable(timestamp),
    source_version: nullable(string(500))
  }),
  visibility: object({
    state: enumeration(["FULL", "PARTIAL"])
  }),
  representation_type: string(80),
  uri: nullable(string(2000)),
  media_type: nullable(string(100))
}, ["evidence_id", "content", "source_id", "freshness", "visibility"]);
const relationship = object({
  source: id,
  target: id,
  type: string(80),
  evidence_ids: array(id),
  provenance_type: string(80)
}, ["source", "target", "type", "evidence_ids"]);
const claim = object({
  claim_id: id,
  statement: string(4000),
  text: string(4000),
  classification: enumeration(["SUPPORTED", "INTERPRETATION"]),
  evidence_ids: array(id, 30),
  support_method: enumeration(["EXTRACTIVE", "VERIFIED_ENTAILMENT", "DETERMINISTIC", "CITATION_BOUND"])
}, ["claim_id", "statement", "evidence_ids", "classification", "support_method"]);
const evidenceIds = array(id, 30);
const tablePayload = object({
  columns: array(object({ key: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,40}$" }, label: string(120) }, ["key", "label"]), 12),
  rows: array(object({ cells: { type: "object", additionalProperties: string(2000) }, evidence_ids: evidenceIds }, ["cells", "evidence_ids"]), 40)
}, ["columns", "rows"]);
const presentationPayloads = {
  TEXT: object({}),
  TABLE: tablePayload,
  COMPARISON: tablePayload,
  TIMELINE: object({ items: array(object({ date: string(2000), title: string(2000), description: string(2000), evidence_ids: evidenceIds }, ["date", "title", "description", "evidence_ids"]), 40) }, ["items"]),
  METRIC: object({ items: array(object({ label: string(2000), value: string(2000), unit: string(2000), evidence_ids: evidenceIds }, ["label", "value", "unit", "evidence_ids"]), 40) }, ["items"]),
  RELATIONSHIP_GRAPH: object({
    nodes: array(object({ id, label: string(2000), type: string(120), evidence_ids: evidenceIds }, ["id", "label", "type", "evidence_ids"]), 40),
    edges: array(object({ source: id, target: id, type: string(120), evidence_ids: evidenceIds }, ["source", "target", "type", "evidence_ids"]), 80)
  }, ["nodes", "edges"]),
  DOCUMENT_RESULTS: object({ items: array(object({ evidence_id: id, title: string(500), url: { type: "string", maxLength: 2000, pattern: "^(https?://|/[^/])" } }, ["evidence_id", "title"]), 30) }, ["items"]),
  IMAGE_RESULTS: object({ items: array(object({ evidence_id: id, title: string(500), url: { type: "string", maxLength: 2000, pattern: "^(https?://|/[^/])" } }, ["evidence_id", "title"]), 30) }, ["items"])
};
const presentation = { anyOf: PRESENTATIONS.map(type => object({ recommended_type: { const: type }, structured_payload: presentationPayloads[type] }, ["recommended_type", "structured_payload"])) };

const MODEL_ANSWER_SCHEMA = object({
  status: enumeration(["answered", "insufficient_context", "refused"]),
  executive_summary: string(3000),
  findings: array(string(2000), 40),
  recommendations: array(string(1200), 20),
  evidence_gaps: array(string(1200), 20),
  citation_ids: array(id, 100),
  supported_claims: array(object({
    statement: string(2000),
    citation_ids: array(id, 30)
  }, ["statement", "citation_ids"]), 40),
  presentation
}, ["status", "supported_claims"]);
const JSON_SCHEMAS = Object.freeze({
  KnowledgeObject: envelope("KnowledgeObject", {
    canonical_id: id,
    knowledge_id: id,
    tenant_id: id,
    source: object({
      type: id,
      system_id: id,
      native_id: id,
      source_version: nullable(string(500)),
      uri: nullable(string(2000))
    }, ["type", "system_id", "native_id"]),
    content: object({
      content_type: enumeration(["TEXT", "JSON", "IMAGE", "VIDEO", "AUDIO", "DOCUMENT", "TABLE"]),
      text: string(2000000),
      original_object_ref: nullable(string(2000))
    }, ["content_type"]),
    structure: object({
      parent_canonical_id: nullable(id),
      parent_knowledge_id: nullable(id),
      fragment_type: string(80),
      fragment_key: nullable(string(500)),
      section: nullable(string(500)),
      page: nullable(integer()),
      timestamp_start_ms: nullable(integer()),
      timestamp_end_ms: nullable(integer())
    }),
    security: object({
      sensitivity: enumeration(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]),
      policy_id: id,
      policy_version: id,
      visibility: enumeration(["FULL", "PARTIAL", "DENIED"])
    }, ["sensitivity", "policy_id", "policy_version", "visibility"]),
    lifecycle: object({
      behavior: enumeration(["VERSIONED", "IMMUTABLE", "MUTABLE"]),
      state: enumeration(["ACTIVE", "DELETED", "TOMBSTONED", "UNAVAILABLE", "ARCHIVED"]),
      is_current: boolean,
      effective_from: timestamp,
      effective_to: nullable(timestamp),
      content_hash_algorithm: {
        const: "SHA256"
      },
      content_hash: {
        type: "string",
        pattern: "^[a-f0-9]{64}$"
      }
    }, ["behavior", "state", "is_current", "effective_from", "content_hash_algorithm", "content_hash"]),
    metadata: openObject,
    provenance: object({
      representation_type: enumeration(["SOURCE_DIRECT", "DETERMINISTIC", "MODEL_DERIVED", "HUMAN_VERIFIED"]),
      derived_from: array(id)
    }, ["representation_type", "derived_from"])
  }, ["canonical_id", "knowledge_id", "tenant_id", "source", "content", "security", "lifecycle", "provenance"]),
  RetrievalRequest: envelope("RetrievalRequest", {
    request_id: id,
    query_id: id,
    trace_id: id,
    project_id: string(500),
    tenant_id: string(500),
    query: {
      ...string(8000),
      minLength: 1
    },
    query_fingerprint: string(64),
    query_class: enumeration(["LOOKUP", "SEARCH", "ANALYTICAL", "INVESTIGATIVE", "MULTIMODAL"]),
    filters,
    budgets,
    smart_context: object({
      source_ids: array(id),
      source_kinds: array(string(80), 20),
      reviewed_context_present: boolean
    }),
    conversation: object({
      session_id: nullable(id),
      history_message_count: integer(100),
      follow_up: boolean
    }),
    conversation_context: object({
      conversation_id: nullable(id),
      recent_turn_limit: integer(20)
    }),
    created_at: timestamp
  }, ["query"]),
  RetrievalEvent: envelope("RetrievalEvent", {
    event_type: enumeration(["progress", "result", "error"]),
    request_id: id,
    query_id: id,
    trace_id: id,
    sequence: integer(),
    stage: enumeration(STAGES),
    status: enumeration(["IN_PROGRESS", "COMPLETE", "PARTIAL", "FAILED"]),
    message: string(300),
    metrics: object({
      candidates_found: integer(),
      candidates_selected: integer(),
      elapsed_ms: number(),
      context_tokens: integer(),
      input_tokens: integer(),
      output_tokens: integer(),
      cost_usd: number(),
      retrieval_rounds: integer(),
      model_attempt: integer(),
      model_max_attempts: integer(),
      retry_delay_ms: number()
    }),
    context_packet_id: nullable(id),
    answer_id: nullable(id),
    termination_reason: nullable(string(100)),
    error_code: nullable(string(100)),
    created_at: timestamp
  }, ["request_id", "query_id", "trace_id", "sequence", "stage", "status", "message"]),
  ContextPacket: envelope("ContextPacket", {
    packet_id: id,
    context_packet_id: id,
    request_id: nullable(id),
    query_id: nullable(id),
    trace_id: nullable(id),
    project_id: nullable(string(500)),
    tenant_id: nullable(string(500)),
    query: object({
      text: string(8000),
      original: string(8000),
      interpreted: string(8000),
      class: string(80)
    }),
    interpreted_request: openObject,
    applied_filters: filters,
    evidence: array(evidence, 30),
    relationship_evidence: array(relationship),
    relationships: array(relationship),
    coverage: object({
      evidence_count: integer(30),
      source_count: integer(30),
      source_kinds: array(string(80), 30),
      context_tokens_estimated: integer(32000),
      context_budget_exhausted: boolean
    }),
    authorization: object({
      project_scope_enforced: boolean,
      source_acl_enforced: boolean,
      allowed_record_permissions: array(string(100), 100)
    }),
    authorization_coverage: object({
      fully_visible_objects: integer(),
      partially_visible_objects: integer(),
      unavailable_objects: integer()
    }),
    retrieval: openObject,
    limitations,
    evidence_quality: openObject,
    budget: nullable(openObject),
    created_at: timestamp
  }, ["context_packet_id", "evidence", "limitations", "authorization"]),
  AnswerContract: envelope("AnswerContract", {
    answer_id: id,
    request_id: nullable(id),
    query_id: nullable(id),
    trace_id: nullable(id),
    context_packet_id: nullable(id),
    status: enumeration(["answered", "insufficient_context", "refused", "provider_unavailable", "error"]),
    answer: object({
      summary: string(12000)
    }, ["summary"]),
    presentation,
    summary: string(12000),
    findings: array(string(12000), 40),
    recommendations: array(string(4000), 20),
    evidence_gaps: array(string(1200), 20),
    claims: array(claim, 40),
    citation_ids: array(id, 100),
    grounding: object({
      context_evidence_count: integer(),
      supported_claim_count: integer(),
      citation_bound_claim_count: integer(),
      unsupported_claim_count: integer(),
      unsupported_section_count: integer(),
      claim_citation_coverage: number(1),
      model_confidence_accepted: {
        const: false
      },
      validation_method: string(100),
      presentation_rejected: boolean
    }),
    limitations,
    evidence_quality: openObject,
    termination_reason: nullable(string(100)),
    created_at: timestamp
  }, ["answer_id", "status", "summary", "claims", "citation_ids", "grounding", "limitations", "presentation"])
});
function contractError(code, message, path = "$") {
  const error = new Error(`${message} (${path})`);
  error.statusCode = 422;
  error.code = code;
  error.validation_path = path;
  return error;
}
function validateNode(value, schema, path = "$", depth = 0) {
  const fail = message => {
    throw contractError("ERR_CONTRACT_VALIDATION", message, path);
  };
  if (depth > 30)
    fail("Contract nesting limit exceeded");
  if (schema.anyOf) {
    for (const option of schema.anyOf) {
      try {
        validateNode(value, option, path, depth + 1);
        return;
      }
      catch {
      }
    }
    fail("Value has an invalid type");
  }
  if (Object.prototype.hasOwnProperty.call(schema, "const") && value !== schema.const)
    fail("Unexpected contract field value");
  if (schema.enum && !schema.enum.includes(value))
    fail("Unsupported enum value");
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (schema.type && (schema.type === "integer" ? !Number.isSafeInteger(value) : type !== schema.type))
    fail(`Expected ${schema.type}`);
  if (typeof value === "number" && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)))
    fail("Number is outside contract limits");
  if (typeof value === "string") {
    if (value.length > (schema.maxLength ?? Infinity) || value.length < (schema.minLength ?? 0))
      fail("Text length is outside contract limits");
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      fail("Text does not match contract format");
    if (schema.format === "date-time" && (!/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))))
      fail("Expected an ISO timestamp");
  }
  if (Array.isArray(value)) {
    if (value.length > (schema.maxItems ?? 10000))
      fail("Array exceeds contract limit");
    value.forEach((item, index) => validateNode(item, schema.items || {}, `${path}[${index}]`, depth + 1));
  }
  else if (value && typeof value === "object") {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      fail("Expected a plain JSON object");
    for (const key of schema.required || [])
      if (!Object.prototype.hasOwnProperty.call(value, key))
        fail(`Missing required field ${key}`);
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        fail("Unsafe object key");
      if (schema.additionalProperties === false && !Object.prototype.hasOwnProperty.call(schema.properties || {}, key))
        fail(`Unknown field ${key}`);
      validateNode(item, schema.properties?.[key] || (typeof schema.additionalProperties === "object" ? schema.additionalProperties : {}), `${path}.${key}`, depth + 1);
    }
  }
  else if (["undefined", "function", "symbol", "bigint"].includes(type))
    fail("Expected JSON data");
  return value;
}
function validateContract(value, expectedType, { allowLegacyVersion = true } = {}) {
  const type = String(expectedType || value?.contract_type || "").replace(/\.v1$/, "");
  const schema = JSON_SCHEMAS[type];
  if (!schema)
    throw contractError("ERR_CONTRACT_VALIDATION", "Unknown knowledge contract type");
  const legacy = value?.contract_version === `${type}.v1` && allowLegacyVersion;
  if (value?.contract_version !== VERSION && !legacy)
    throw contractError("ERR_UNSUPPORTED_CONTRACT_VERSION", "Unsupported knowledge contract version");
  const candidate = legacy ? {
    ...value,
    contract_type: value.contract_type || type,
    contract_version: VERSION
  } : value;
  validateNode(candidate, schema);
  if (type === "KnowledgeObject") {
    const lifecycle = candidate.lifecycle;
    if (lifecycle.effective_to && Date.parse(lifecycle.effective_to) <= Date.parse(lifecycle.effective_from)) throw contractError("ERR_CONTRACT_VALIDATION", "Revision effective interval must be increasing");
    if (lifecycle.is_current && lifecycle.effective_to) throw contractError("ERR_CONTRACT_VALIDATION", "A current revision cannot have an effective end");
    if (!candidate.content.text && !candidate.content.original_object_ref) throw contractError("ERR_CONTRACT_VALIDATION", "A knowledge object needs source text or an original object reference");
  }
  if (type === "ContextPacket") {
    const evidenceIds = candidate.evidence.map(item => item.evidence_id);
    if (new Set(evidenceIds).size !== evidenceIds.length) throw contractError("ERR_CONTRACT_VALIDATION", "Duplicate evidence identity");
    if (candidate.coverage && candidate.coverage.evidence_count !== evidenceIds.length) throw contractError("ERR_CONTRACT_VALIDATION", "Evidence coverage does not match the packet");
    for (const edge of candidate.relationship_evidence || candidate.relationships || []) {
      if (!edge.evidence_ids.length || edge.evidence_ids.some(id => !evidenceIds.includes(id))) throw contractError("ERR_CONTRACT_VALIDATION", "Relationship references evidence outside the packet");
    }
  }
  if (type === "AnswerContract") {
    const cited = new Set(candidate.citation_ids);
    for (const claim of candidate.claims) {
      if (!claim.evidence_ids.length || claim.evidence_ids.some(id => !cited.has(id))) throw contractError("ERR_CONTRACT_VALIDATION", "Claim citations do not match answer references");
      if (claim.support_method === "CITATION_BOUND" && claim.classification !== "INTERPRETATION") throw contractError("ERR_CONTRACT_VALIDATION", "Citation binding is not verified claim support");
    }
    if (candidate.citation_ids.some(id => !candidate.claims.some(claim => claim.evidence_ids.includes(id)))) throw contractError("ERR_CONTRACT_VALIDATION", "Answer has an unreferenced citation");
  }
  return value;
}
module.exports = {
  MODEL_ANSWER_SCHEMA,
  VERSION,
  PRESENTATIONS,
  STAGES,
  JSON_SCHEMAS,
  validateContract,
  validateNode,
  contractError
};
