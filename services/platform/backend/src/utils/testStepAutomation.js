const TEST_STEP_TYPES = new Set(["web", "api", "android", "ios"]);
const API_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const API_BODY_MODES = new Set(["none", "json", "text", "xml", "form"]);
const API_VALIDATION_KINDS = new Set(["status", "header", "header_present", "body_contains", "body_not_contains", "json_path", "json_schema", "response_time"]);
const API_VALIDATION_OPERATORS = new Set(["eq", "ne", "contains", "matches", "exists", "lt", "lte", "gt", "gte"]);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
};

const normalizeRichText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\r\n/g, "\n");
  return normalized.trim() ? normalized : null;
};

const parseJsonValue = (value, fallback) => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return value;
};

const normalizeTestStepType = (value, fallback = null) => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = normalizeText(value)?.toLowerCase() || null;

  if (!normalized) {
    return fallback;
  }

  return TEST_STEP_TYPES.has(normalized) ? normalized : fallback;
};

// Only unimplemented Web defaults are eligible for inference. Saved code and
// explicitly native/API sections retain their runtime, including mixed cases.
const inferAutomationStepType = (step = {}, { appTypeKind } = {}) => {
  const saved = normalizeTestStepType(step.step_type, "web");
  if (saved !== "web" || normalizeRichText(step.automation_code)) return saved;
  if (normalizeApiRequest(step.api_request)?.url || appTypeKind === "api") return "api";
  const action = String(step.action || "").replace(/<[^>]+>/g, " ").trim().replace(/^(?:I|we|the client)\s+/i, "");
  if (/^(?:Given|When|Then|And|But)\s+/i.test(action)) return inferAutomationStepType({ ...step, action: action.replace(/^(?:Given|When|Then|And|But)\s+/i, "") }, { appTypeKind });
  if (/^(?:click|tap|type|fill|enter|select|navigate|browse|open|visit|hover|scroll)\b/i.test(action)) return saved;
  if (/^(?:(?:send|call|execute|perform|issue|make|invoke)\s+(?:(?:an?|the)\s+)?(?:(?:HTTP|API)\s+)?(?:request\s+)?(?:to\s+)?)?(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(?:(?:HTTP|API)\s+)?(?:request\s+)?(?:to\s+)?(?:https?:\/\/|\/|@[a-z][\w.\[\]-]*|\{\{)/i.test(action)
    || /^(?:send|call|execute|perform|issue|make|invoke)\b.*\b(?:API|HTTP)\s+(?:request|endpoint|call)\b/i.test(action)) return "api";
  return saved;
};

const normalizeApiRequest = (value) => {
  const parsed = parseJsonValue(value, null);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const method = String(parsed.method || "GET").trim().toUpperCase();
  const url = normalizeRichText(parsed.url);
  const bodyMode = normalizeText(parsed.body_mode || parsed.bodyMode || parsed.bodyType)?.toLowerCase() || "none";
  const body = normalizeRichText(parsed.body);
  const headers = Array.isArray(parsed.headers)
    ? parsed.headers
        .map((header) => ({
          key: normalizeText(header?.key) || "",
          value: normalizeRichText(header?.value) || ""
        }))
        .filter((header) => header.key || header.value)
    : [];
  const validations = Array.isArray(parsed.validations)
    ? parsed.validations
        .map((validation) => ({
          kind: normalizeText(validation?.kind || validation?.type)?.toLowerCase() || "status",
          ...(validation?.operator !== undefined ? { operator: normalizeText(validation.operator) } : {}),
          target: normalizeRichText(validation?.target || validation?.path),
          expected: normalizeRichText(validation?.expected || validation?.value)
        }))
        .filter((validation) =>
          API_VALIDATION_KINDS.has(validation.kind) && (validation.kind === "status" || validation.target || validation.expected)
        )
    : [];
  const captures = Array.isArray(parsed.captures)
    ? parsed.captures
        .map((capture) => ({
          path: normalizeRichText(capture?.path),
          parameter: normalizeRichText(capture?.parameter)
        }))
        .filter((capture) => capture.path && capture.parameter)
    : [];

  const normalizedMethod = API_METHODS.has(method) ? method : "GET";
  const normalizedBodyMode = API_BODY_MODES.has(bodyMode) ? bodyMode : "none";

  if (!url && !headers.length && !body && !validations.length && !captures.length) {
    return null;
  }

  return {
    ...(parsed.query_params !== undefined ? { query_params: Array.isArray(parsed.query_params) ? parsed.query_params.map(row => ({ key: normalizeText(row?.key) || "", value: normalizeRichText(row?.value) || "" })).filter(row => row.key) : [] } : {}),
    ...(parsed.cookies !== undefined ? { cookies: Array.isArray(parsed.cookies) ? parsed.cookies.map(row => ({ key: normalizeText(row?.key) || "", value: normalizeRichText(row?.value) || "" })).filter(row => row.key) : [] } : {}),
    ...(parsed.auth && typeof parsed.auth === "object" && !Array.isArray(parsed.auth) ? { auth: { type: normalizeText(parsed.auth.type) || "none", ...(parsed.auth.credential_reference != null ? { credential_reference: normalizeText(parsed.auth.credential_reference) } : {}), ...(parsed.auth.key_name != null ? { key_name: normalizeText(parsed.auth.key_name) } : {}), ...(parsed.auth.location != null ? { location: normalizeText(parsed.auth.location) } : {}) } } : {}),
    ...(typeof parsed.follow_redirects === "boolean" ? { follow_redirects: parsed.follow_redirects } : {}),
    ...(parsed.timeout_ms !== undefined ? {
      timeout_ms: Number.isFinite(Number(parsed.timeout_ms)) && Number(parsed.timeout_ms) > 0
        ? Math.round(Math.max(1000, Math.min(120000, Number(parsed.timeout_ms))))
        : 30000
    } : {}),
    method: normalizedMethod,
    url,
    headers,
    body_mode: normalizedBodyMode,
    body,
    validations,
    captures
  };
};

function validateGeneratedApiRequest(value, { stepOrder = 1, existingRequest, expectedResult } = {}) {
  const request = parseJsonValue(value, null);
  const fail = message => { throw new Error(`Step ${stepOrder} contains an invalid API request. ${message}`); };
  if (!request || typeof request !== 'object' || Array.isArray(request) || !normalizeText(request.url)) fail('Supply a request URL.');
  const method = String(request.method || 'GET').trim().toUpperCase();
  const mode = String(request.body_mode || request.bodyMode || request.bodyType || 'none').trim().toLowerCase();
  if (!API_METHODS.has(method) || !API_BODY_MODES.has(mode) || request.body != null && typeof request.body !== 'string') fail('Use a supported method and string body.');
  const allowed = new Set(['method','url','headers','query_params','cookies','auth','body_mode','bodyMode','bodyType','body','validations','captures','timeout_ms','follow_redirects']);
  if (Object.keys(request).some(key => !allowed.has(key))) fail('Use the native request fields; unsupported fields would be discarded.');
  for (const field of ['headers','query_params','cookies']) {
    if (request[field] !== undefined && (!Array.isArray(request[field]) || request[field].some(row => !row || !normalizeText(row.key) || typeof row.value !== 'string'))) fail(`${field} must contain complete key/value strings.`);
  }
  if (request.auth !== undefined) {
    const auth = request.auth;
    if (!auth || Array.isArray(auth) || !['none','bearer','api_key','basic','oauth2_ref'].includes(auth.type) || Object.keys(auth).some(key => !['type','credential_reference','key_name','location'].includes(key))) fail('Use a supported authentication type and credential reference.');
    if (auth.type !== 'none' && !normalizeText(auth.credential_reference)) fail('Authentication requires a configured credential_reference.');
    if (auth.location !== undefined && !['header','query'].includes(auth.location)) fail('API key location must be header or query.');
  }
  if (request.follow_redirects !== undefined && typeof request.follow_redirects !== 'boolean') fail('follow_redirects must be boolean.');
  if (request.validations !== undefined && !Array.isArray(request.validations)) fail('validations must be an array.');
  if (expectedResult && !request.validations?.length) fail('Translate the supplied expected result into explicit response assertions.');
  for (const validation of request.validations || []) {
    const kind = validation?.kind || validation?.type;
    if (!API_VALIDATION_KINDS.has(kind) || validation.operator !== undefined && (!API_VALIDATION_OPERATORS.has(validation.operator) || validation.operator === 'matches')) fail('Use a supported API assertion kind and operator.');
    if (validation.operator !== undefined && kind !== 'json_path' && !(kind === 'header' && ['eq','ne','contains','exists'].includes(validation.operator)) && !(kind === 'response_time' && validation.operator === 'lte')) fail('Use operators on JSON-path assertions, supported header comparisons, or lte response-time checks.');
    if (!['header_present'].includes(kind) && validation.operator !== 'exists' && (typeof (validation.expected ?? validation.value) !== 'string' || !String(validation.expected ?? validation.value).trim())) fail('Provide a nonempty string expected value for each API assertion.');
    if (['header','header_present','json_path'].includes(kind) && !normalizeText(validation.target || validation.path)) fail('Provide an assertion target.');
    const expected = validation.expected ?? validation.value;
    // Keep exact scoped inputs symbolic in drafts. Their concrete values are
    // resolved and checked by the execution assertion, never by substituting
    // a current value into saved source or choosing a numeric default.
    const parameterExpected = typeof expected === 'string' && /^@[tsr]\.(?:[A-Za-z][A-Za-z0-9_-]*|\[(?:\\.|[^\]\\\r\n])+\])$/i.test(expected.trim());
    if (kind === 'status' && !parameterExpected && (!/^\d{3}$/.test(expected) || Number(expected) < 100 || Number(expected) > 599)) fail('Provide an explicit HTTP status from 100 to 599 or an exact scoped parameter reference.');
    if (kind === 'response_time' && !parameterExpected && !(Number(expected) > 0 && Number.isFinite(Number(expected)))) fail('Provide a positive response duration in milliseconds or an exact scoped parameter reference.');
    if (kind === 'json_schema' && !parameterExpected) {
      let schema;
      try { schema = JSON.parse(expected); } catch { fail('Encode the JSON Schema as a JSON string.'); }
      if (!schema || typeof schema !== 'object' || Array.isArray(schema) || !Object.keys(schema).length) fail('Provide a nonempty JSON Schema object.');
    }
  }
  if (request.captures !== undefined && (!Array.isArray(request.captures) || request.captures.some(capture => !normalizeText(capture?.path) || !normalizeText(capture?.parameter)))) fail('Each API capture needs a path and output parameter.');
  const normalized = normalizeApiRequest(request);
  if (request.body && (mode === 'none' || ['GET','HEAD'].includes(method))) fail('The method or body mode would discard the supplied body.');
  if (request.timeout_ms !== undefined && Number(request.timeout_ms) !== normalized.timeout_ms) fail('The timeout must fit the runtime range of 1000 to 120000 milliseconds.');
  const existing = normalizeApiRequest(existingRequest);
  for (const key of ['validations','captures']) if (existing?.[key]?.some(item => !normalized[key].some(next => JSON.stringify(next) === JSON.stringify(item)))) throw new Error(`Step ${stepOrder} removed or changed an existing API ${key === 'validations' ? 'assertion' : 'capture'}. Preserve saved behavior and expected values.`);
  return normalized;
}

// Blank API drafts can be saved. Once a target is authored, reject fields
// that the legacy normalizer would otherwise discard or silently replace.
function validateAuthoredApiRequest(value, { stepOrder = 1 } = {}) {
  const request = parseJsonValue(value, null);
  if (request && normalizeText(request.url)) validateGeneratedApiRequest(request, { stepOrder });
  return value;
}

module.exports = {
  API_VALIDATION_KINDS,
  API_VALIDATION_OPERATORS,
  TEST_STEP_TYPES,
  normalizeApiRequest,
  normalizeRichText,
  normalizeTestStepType,
  inferAutomationStepType,
  validateGeneratedApiRequest,
  validateAuthoredApiRequest,
  parseJsonValue
};
