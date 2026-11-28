const { isDeepStrictEqual } = require('node:util');
const { normalizeParameterKey } = require('./stepParameterResolution');

const TEST_STEP_TYPES = new Set(["web", "api", "android", "ios"]);
const API_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const API_BODY_MODES = new Set(["none", "json", "text", "xml", "form"]);
const API_VALIDATION_KINDS = new Set(["status", "header", "header_present", "body_contains", "body_not_contains", "json_path", "json_schema", "response_time"]);
const API_VALIDATION_OPERATORS = new Set(["eq", "ne", "contains", "matches", "exists", "lt", "lte", "gt", "gte"]);
const API_REQUEST_ROW_FIELDS = ['headers', 'query_params', 'cookies'];

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

const API_ACTION_METHOD = /^(?:(?:send|call|execute|perform|issue|make|invoke)\s+(?:(?:an?|the)\s+)?(?:(?:HTTP|API)\s+)?(?:request\s+)?(?:to\s+)?)?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(?:(?:HTTP|API)\s+)?(?:request\s+)?(?:to\s+)?(?:https?:\/\/|\/|@[a-z][\w.\[\]-]*|\{\{)/i;

const normalizeStepAction = value => String(value || '').replace(/<[^>]+>/g, ' ').trim()
  .replace(/^(?:Given|When|Then|And|But)\s+/i, '').replace(/^(?:I|we|the client)\s+/i, '');

// Only unimplemented Web defaults are eligible for inference. Saved code and
// explicitly native/API sections retain their runtime, including mixed cases.
const inferAutomationStepType = (step = {}, { appTypeKind } = {}) => {
  const saved = normalizeTestStepType(step.step_type, "web");
  if (saved !== "web" || normalizeRichText(step.automation_code)) return saved;
  if (normalizeApiRequest(step.api_request)?.url || appTypeKind === "api") return "api";
  const action = normalizeStepAction(step.action);
  if (/^(?:click|tap|type|fill|enter|select|navigate|browse|open|visit|hover|scroll)\b/i.test(action)) return saved;
  if (API_ACTION_METHOD.test(action)
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
  const keyedRows = (rows) => Array.isArray(rows) ? rows.map(row => ({ key: normalizeText(row?.key) || "", value: normalizeRichText(row?.value) || "" })).filter(row => row.key) : [];
  const queryParams = keyedRows(parsed.query_params);
  const cookies = keyedRows(parsed.cookies);
  const auth = parsed.auth && typeof parsed.auth === "object" && !Array.isArray(parsed.auth) ? {
    type: normalizeText(parsed.auth.type) || "none",
    ...(parsed.auth.credential_reference != null ? { credential_reference: normalizeText(parsed.auth.credential_reference) } : {}),
    ...(parsed.auth.key_name != null ? { key_name: normalizeText(parsed.auth.key_name) } : {}),
    ...(parsed.auth.location != null ? { location: normalizeText(parsed.auth.location) } : {})
  } : null;
  const validations = Array.isArray(parsed.validations)
    ? parsed.validations
        .map((validation) => ({
          kind: normalizeText(validation?.kind || validation?.type)?.toLowerCase() || "status",
          ...(validation?.operator != null ? { operator: normalizeText(validation.operator) } : {}),
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
        .filter((capture) => capture.path || capture.parameter)
    : [];

  const normalizedMethod = API_METHODS.has(method) ? method : "GET";
  const normalizedBodyMode = API_BODY_MODES.has(bodyMode) ? bodyMode : "none";
  const timeout = Number(parsed.timeout_ms);
  const timeoutMs = Number.isFinite(timeout) && timeout > 0 ? Math.round(Math.max(1000, Math.min(120000, timeout))) : 30000;
  const hasRequestOptions = normalizedMethod !== "GET" || normalizedBodyMode !== "none" || parsed.follow_redirects === false || timeoutMs !== 30000;

  if (!hasRequestOptions && !url && !headers.length && !body && !validations.length && !captures.length && !queryParams.length && !cookies.length && (!auth || auth.type === "none")) {
    return null;
  }

  return {
    ...(parsed.query_params !== undefined ? { query_params: queryParams } : {}),
    ...(parsed.cookies !== undefined ? { cookies } : {}),
    ...(auth ? { auth } : {}),
    ...(typeof parsed.follow_redirects === "boolean" ? { follow_redirects: parsed.follow_redirects } : {}),
    ...(parsed.timeout_ms !== undefined ? { timeout_ms: timeoutMs } : {}),
    method: normalizedMethod,
    url,
    headers,
    body_mode: normalizedBodyMode,
    body,
    validations,
    captures
  };
};

function validateApiRequest(value, { stepOrder = 1, existingRequest, expectedResult, action, draft = false } = {}) {
  const request = parseJsonValue(value, null);
  const fail = message => { throw new Error(`Step ${stepOrder} contains an invalid API request. ${message}`); };
  if (!request || typeof request !== 'object' || Array.isArray(request)) fail('Supply an API request object.');
  if (request.url != null && typeof request.url !== 'string' || !draft && !normalizeText(request.url)) fail('Supply a request URL.');
  const method = String(request.method || 'GET').trim().toUpperCase();
  const mode = String(request.body_mode || request.bodyMode || request.bodyType || 'none').trim().toLowerCase();
  if (!API_METHODS.has(method) || !API_BODY_MODES.has(mode) || request.body != null && typeof request.body !== 'string') fail('Use a supported method and string body.');
  const allowed = new Set(['method','url','headers','query_params','cookies','auth','body_mode','bodyMode','bodyType','body','validations','captures','timeout_ms','follow_redirects']);
  if (Object.keys(request).some(key => !allowed.has(key))) fail('Use the native request fields; unsupported fields would be discarded.');
  for (const field of API_REQUEST_ROW_FIELDS) {
    if (request[field] !== undefined && (!Array.isArray(request[field]) || request[field].some(row => !row || !normalizeText(row.key) || typeof row.value !== 'string'))) fail(`${field} must contain complete key/value strings.`);
  }
  if (request.auth != null) {
    const auth = request.auth;
    if (!auth || Array.isArray(auth) || !['none','bearer','api_key','basic','oauth2_ref'].includes(auth.type) || Object.keys(auth).some(key => !['type','credential_reference','key_name','location'].includes(key))) fail('Use a supported authentication type and credential reference.');
    if (auth.credential_reference != null && typeof auth.credential_reference !== 'string') fail('Use a string credential_reference.');
    if (!draft && auth.type !== 'none' && !normalizeText(auth.credential_reference)) fail('Authentication requires a configured credential_reference.');
    if (auth.location !== undefined && !['header','query'].includes(auth.location)) fail('API key location must be header or query.');
  }
  if (request.follow_redirects !== undefined && typeof request.follow_redirects !== 'boolean') fail('follow_redirects must be boolean.');
  if (request.validations !== undefined && !Array.isArray(request.validations)) fail('validations must be an array.');
  if (expectedResult && !request.validations?.length) fail('Translate the supplied expected result into explicit response assertions.');
  for (const validation of request.validations || []) {
    const kind = validation?.kind || validation?.type;
    const operator = validation?.operator ?? undefined;
    if (!API_VALIDATION_KINDS.has(kind) || operator !== undefined && (!API_VALIDATION_OPERATORS.has(operator) || operator === 'matches')) fail('Use a supported API assertion kind and operator.');
    if (operator !== undefined && kind !== 'json_path' && !(kind === 'header' && ['eq','ne','contains','exists'].includes(operator)) && !(kind === 'response_time' && operator === 'lte')) fail('Use operators on JSON-path assertions, supported header comparisons, or lte response-time checks.');
    const expected = validation.expected ?? validation.value;
    const target = validation.target ?? validation.path;
    if (expected != null && typeof expected !== 'string' || target != null && typeof target !== 'string') fail('Use string assertion values and targets.');
    if (!draft && !['header_present'].includes(kind) && operator !== 'exists' && !normalizeText(expected)) fail('Provide a nonempty string expected value for each API assertion.');
    if (!draft && ['header','header_present','json_path'].includes(kind) && !normalizeText(target)) fail('Provide an assertion target.');
    if (draft && !normalizeText(expected)) continue;
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
  if (request.captures !== undefined && (!Array.isArray(request.captures) || request.captures.some(capture =>
    !capture || typeof capture !== 'object' || Array.isArray(capture) ||
    capture.path != null && typeof capture.path !== 'string' || capture.parameter != null && typeof capture.parameter !== 'string' ||
    !draft && (!normalizeText(capture.path) || !normalizeText(capture.parameter))))) fail('Each API capture needs a path and output parameter.');
  const normalized = normalizeApiRequest(request);
  if (request.body && (mode === 'none' || ['GET','HEAD'].includes(method))) fail('The method or body mode would discard the supplied body.');
  if (request.timeout_ms !== undefined && Number(request.timeout_ms) !== (normalized?.timeout_ms ?? 30000)) fail('The timeout must fit the runtime range of 1000 to 120000 milliseconds.');
  const existing = normalizeApiRequest(existingRequest);
  const authoredMethod = existing?.url ? existing.method : API_ACTION_METHOD.exec(normalizeStepAction(action))?.[1]?.toUpperCase();
  if (!draft && authoredMethod && method !== authoredMethod) fail(`Preserve the authored HTTP method ${authoredMethod}.`);
  if (existing) {
    for (const field of ['url', 'body', 'follow_redirects', 'timeout_ms']) {
      if (existing[field] != null && existing[field] !== normalized[field]) fail(`Preserve the authored request field ${field}.`);
    }
    if (existing.body_mode !== 'none' && existing.body_mode !== normalized.body_mode) fail('Preserve the authored request body mode.');
    for (const [field, value] of Object.entries(existing.auth || {})) {
      if (value != null && normalized.auth?.[field] !== value) fail(`Preserve the authored authentication field ${field}.`);
    }
    for (const field of API_REQUEST_ROW_FIELDS) {
      // Repeated rows are valid, especially query parameters. Match each
      // authored group by key so generation cannot shadow or collapse it.
      const keyOf = row => field === 'headers' ? row.key.toLowerCase() : row.key;
      const keys = new Set((existing[field] || []).map(keyOf));
      for (const key of keys) {
        const values = rows => (rows || []).filter(row => keyOf(row) === key).map(row => row.value);
        if (!isDeepStrictEqual(values(existing[field]), values(normalized[field]))) fail(`Preserve authored values and order in ${field}.`);
      }
    }
  }
  for (const key of ['validations','captures']) if (existing?.[key]?.some(item => !normalized[key].some(next => JSON.stringify(next) === JSON.stringify(item)))) throw new Error(`Step ${stepOrder} removed or changed an existing API ${key === 'validations' ? 'assertion' : 'capture'}. Preserve saved behavior and expected values.`);
  return normalized;
}

const validateGeneratedApiRequest = (value, { stepOrder, existingRequest, expectedResult, action } = {}) =>
  validateApiRequest(value, { stepOrder, existingRequest, expectedResult, action });

// A request can be saved before credentials, assertions or output captures
// are complete. Generation and run admission still require executable input.
function validateAuthoredApiRequest(value, { stepOrder = 1 } = {}) {
  if (value != null && value !== '') {
    try { validateApiRequest(value, { stepOrder, draft: true }); }
    catch (error) { throw Object.assign(error, { statusCode: 422, code: 'INVALID_API_REQUEST' }); }
  }
  return value;
}

const authoredApiRequestUnchanged = (submitted, previous) =>
  isDeepStrictEqual(parseJsonValue(submitted, submitted ?? null), parseJsonValue(previous, previous ?? null));

// Only a structured request may replace the historical Web default on save.
// Prose inference remains an automation-planning decision.
const authoredStepType = (step = {}) => inferAutomationStepType({
  step_type: step.step_type ?? step.stepType,
  automation_code: step.automation_code ?? step.automationCode,
  api_request: step.api_request ?? step.apiRequest
});

function hasExecutableApiRequest(request) {
  try { return Boolean(validateGeneratedApiRequest(request)); }
  catch { return false; }
}

function apiCaptureNames(request) {
  return (Array.isArray(request?.captures) ? request.captures : [])
    .filter(capture => typeof capture?.path === 'string' && capture.path.trim())
    .map(capture => normalizeParameterKey(capture.parameter, 'r')).filter(Boolean);
}

module.exports = {
  API_VALIDATION_KINDS,
  API_VALIDATION_OPERATORS,
  TEST_STEP_TYPES,
  normalizeApiRequest,
  normalizeRichText,
  normalizeTestStepType,
  inferAutomationStepType,
  authoredStepType,
  authoredApiRequestUnchanged,
  hasExecutableApiRequest,
  apiCaptureNames,
  validateGeneratedApiRequest,
  validateAuthoredApiRequest,
  parseJsonValue
};
