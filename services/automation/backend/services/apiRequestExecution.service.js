const { normalizeApiRequest } = require("@hellotest/platform/backend/src/utils/testStepAutomation");
const { materializeTemplateValue } = require("@hellotest/platform/backend/src/utils/testDataGenerators");
const { normalizeParameterLayer } = require("@hellotest/platform/backend/src/utils/stepParameterResolution");

const STEP_PARAMETER_PATTERN = /(?<![A-Za-z0-9_])@(?:(t|s|r)\.)?(\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi;
const API_PREVIEW_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RETRYABLE_RESPONSE_STATUSES = new Set([429, 502, 503, 504]);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim();
  return normalized;
};

const stringifyValue = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const normalizeContextKey = (value) => {
  const key = normalizeText(String(value || "").replace(/^@+/, ""));
  const scoped = key.match(/^([tsr])\.(.+)$/i);
  const rawName = scoped?.[2] || key;
  const quoted = rawName.match(/^\[((?:\\.|[^\]\\\r\n])+)\]$/);
  const name = (quoted ? quoted[1].replace(/\\([\\\]])/g, "$1") : rawName).trim().toLowerCase();
  return scoped ? `${scoped[1].toLowerCase()}.${name}` : name;
};
const GENERATED_CONTEXT_ALIASES = {
  "t.random": "{{randomString:3}}",
  random: "{{randomString:3}}",
  "t.randomstring": "{{randomString:8}}",
  randomstring: "{{randomString:8}}",
  "t.randomnumber": "{{randomNumber:6}}",
  randomnumber: "{{randomNumber:6}}",
  "t.yopmail": "{{yopmail}}",
  yopmail: "{{yopmail}}",
  "t.today": "{{date:YYYY-MM-DD}}",
  today: "{{date:YYYY-MM-DD}}",
  "t.timestamp": "{{date:ISO}}",
  timestamp: "{{date:ISO}}",
  "r.random": "{{randomString:3}}",
  "r.randomstring": "{{randomString:8}}",
  "r.randomnumber": "{{randomNumber:6}}",
  "r.yopmail": "{{yopmail}}",
  "r.today": "{{date:YYYY-MM-DD}}",
  "r.timestamp": "{{date:ISO}}",

};

const ensureHttpUrl = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new Error("A request URL is required");
  }

  let parsed;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Request URL must be an absolute http or https URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported");
  }

  return parsed.toString();
};

const mapResponseHeaders = (response) =>
  Array.from(response.headers.entries()).reduce((accumulator, [key, value]) => {
    accumulator[key.toLowerCase()] = value;
    return accumulator;
  }, {});

const parseResponseJson = (bodyText, contentType) => {
  const normalizedBody = typeof bodyText === "string" ? bodyText.trim() : "";
  const normalizedType = String(contentType || "").toLowerCase();

  if (!normalizedBody) {
    return null;
  }

  if (!normalizedType.includes("json") && !/^[\[{]/.test(normalizedBody)) {
    return null;
  }

  try {
    return JSON.parse(normalizedBody);
  } catch {
    return null;
  }
};

const escapeXml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const buildApiEvidenceDataUrl = ({
  status,
  title,
  url,
  method,
  responseStatus,
  captureLines
}) => {
  const bg = status === "passed" ? "#dff7ec" : status === "failed" ? "#ffe6ea" : "#eef2ff";
  const accent = status === "passed" ? "#0f9d6c" : status === "failed" ? "#cd3658" : "#5b6fd8";
  const lines = [
    `${method} ${url}`,
    title,
    responseStatus ? `Response ${responseStatus}` : null,
    ...captureLines.slice(0, 2)
  ].filter(Boolean);

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220" viewBox="0 0 900 220">`,
    `<rect width="900" height="220" rx="22" fill="${bg}"/>`,
    `<rect x="28" y="28" width="844" height="164" rx="18" fill="#ffffff" stroke="${accent}" stroke-width="4"/>`,
    `<text x="52" y="72" font-size="28" font-family="Arial, sans-serif" fill="${accent}" font-weight="700">${escapeXml(status.toUpperCase())}</text>`,
    ...lines.map((line, index) =>
      `<text x="52" y="${112 + index * 28}" font-size="${index === 0 ? 22 : 18}" font-family="Arial, sans-serif" fill="#16324f">${escapeXml(line)}</text>`
    ),
    `</svg>`
  ].join("");

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
};

const serializeApiBody = (request, headers) => {
  const body = request.body || "";
  const mode = request.body_mode || "none";

  if (!body || mode === "none") {
    return undefined;
  }

  if (mode === "json") {
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return body;
  }

  if (mode === "form") {
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
    }
    return body;
  }

  if (mode === "xml" && !headers.has("content-type")) {
    headers.set("content-type", "application/xml");
  }

  if (mode === "text" && !headers.has("content-type")) {
    headers.set("content-type", "text/plain;charset=UTF-8");
  }

  return body;
};

const waitForRetry = (attempt) => new Promise((resolve) => {
  const exponentialDelay = Math.min(1500, 200 * (2 ** Math.max(0, attempt - 1)));
  const jitter = Math.floor(Math.random() * 120);
  setTimeout(resolve, exponentialDelay + jitter);
});

const readLimitedResponseBody = async (response, maxBytes = API_PREVIEW_MAX_RESPONSE_BYTES) => {
  if (!response.body?.getReader) {
    const bodyText = await response.text();
    const encoded = Buffer.byteLength(bodyText, "utf8");
    return {
      bodyText: encoded > maxBytes ? Buffer.from(bodyText).subarray(0, maxBytes).toString("utf8") : bodyText,
      bytesReceived: Math.min(encoded, maxBytes),
      truncated: encoded > maxBytes
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let bytesReceived = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      const remaining = maxBytes - bytesReceived;

      if (remaining <= 0) {
        truncated = true;
        await reader.cancel("HelloTest API preview response limit reached");
        break;
      }

      const accepted = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      chunks.push(decoder.decode(accepted, { stream: true }));
      bytesReceived += accepted.byteLength;

      if (accepted.byteLength < value.byteLength) {
        truncated = true;
        await reader.cancel("HelloTest API preview response limit reached");
        break;
      }
    }
  } finally {
    chunks.push(decoder.decode());
  }

  return { bodyText: chunks.join(""), bytesReceived, truncated };
};

const resolveContextValue = (values, rawKey, fallbackScope = "r") => {
  const normalizedKey = normalizeContextKey(rawKey);

  if (!normalizedKey) {
    return "";
  }

  if (
    Object.prototype.hasOwnProperty.call(values, normalizedKey)
  ) {
    return stringifyValue(values[normalizedKey]);
  }

  if (!/^[tsr]\./.test(normalizedKey)) {
    const scoped = `${fallbackScope}.${normalizedKey}`;

    if (
      Object.prototype.hasOwnProperty.call(values, scoped)
    ) {
      return stringifyValue(values[scoped]);
    }

    if (Object.prototype.hasOwnProperty.call(values, `s.${normalizedKey}`)) {
      return stringifyValue(values[`s.${normalizedKey}`]);
    }

    if (Object.prototype.hasOwnProperty.call(values, `r.${normalizedKey}`)) {
      return stringifyValue(values[`r.${normalizedKey}`]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(GENERATED_CONTEXT_ALIASES, normalizedKey)) {
    return materializeTemplateValue(GENERATED_CONTEXT_ALIASES[normalizedKey]);
  }

  return "";
};

const interpolateText = (value, parameterValues = {}) =>
  String(value || "").replace(STEP_PARAMETER_PATTERN, (token, scope, rawName, offset, source) => {
    if (!scope && /^[tsr]$/i.test(rawName) && source[offset + token.length] === ".") return token;
    const normalizedKey = `${scope || "r"}.${rawName}`;
    return resolveContextValue(parameterValues, normalizedKey, scope ? String(scope).toLowerCase() : "r");
  });

const resolveApiRequestParameters = (request, parameterValues = {}) => {
  if (!request) {
    return null;
  }

  const contextValues = normalizeParameterLayer(parameterValues);

  return {
    ...request,
    url: interpolateText(request.url, contextValues),
    body: interpolateText(request.body, contextValues),
    headers: (request.headers || []).map((header) => ({
      key: interpolateText(header.key, contextValues),
      value: interpolateText(header.value, contextValues)
    })),
    validations: (request.validations || []).map((validation) => ({
      ...validation,
      target: interpolateText(validation.target, contextValues),
      expected: interpolateText(validation.expected, contextValues)
    })),
    captures: (request.captures || []).map((capture) => ({
      ...capture,
      // The output parameter keeps its name; only the input path is resolved.
      path: interpolateText(capture.path, contextValues)
    }))
  };
};

const parseJsonPath = (path) => {
  const normalized = normalizeText(path);

  if (!normalized || normalized === "$") {
    return [];
  }

  if (!normalized.startsWith("$")) {
    throw new Error("JPath must start with $");
  }

  const tokens = [];
  let index = 1;

  while (index < normalized.length) {
    const current = normalized[index];

    if (current === ".") {
      index += 1;
      const nextIndex = index;

      while (index < normalized.length && normalized[index] !== "." && normalized[index] !== "[") {
        index += 1;
      }

      const token = normalized.slice(nextIndex, index).trim();

      if (!token) {
        throw new Error("JPath contains an empty property segment");
      }

      tokens.push(token);
      continue;
    }

    if (current === "[") {
      index += 1;

      if (index >= normalized.length) {
        throw new Error("JPath is missing a closing bracket");
      }

      const quote = normalized[index];

      if (quote === "\"" || quote === "'") {
        index += 1;
        const nextIndex = index;

        while (index < normalized.length && normalized[index] !== quote) {
          index += 1;
        }

        if (index >= normalized.length) {
          throw new Error("JPath has an unterminated quoted property");
        }

        const token = normalized.slice(nextIndex, index);
        index += 1;

        if (normalized[index] !== "]") {
          throw new Error("JPath has an invalid quoted property segment");
        }

        index += 1;
        tokens.push(token);
        continue;
      }

      const nextIndex = index;

      while (index < normalized.length && normalized[index] !== "]") {
        index += 1;
      }

      if (index >= normalized.length) {
        throw new Error("JPath is missing a closing bracket");
      }

      const rawToken = normalized.slice(nextIndex, index).trim();
      index += 1;

      if (!/^\d+$/.test(rawToken)) {
        throw new Error("Only numeric array indexes are supported in bracket notation");
      }

      tokens.push(Number(rawToken));
      continue;
    }

    throw new Error(`Unexpected token "${current}" in JPath`);
  }

  return tokens;
};

const readJsonPathValue = (source, path) => {
  try {
    const tokens = parseJsonPath(path);
    let current = source;

    for (const token of tokens) {
      if (typeof token === "number") {
        if (!Array.isArray(current)) {
          return { found: false, error: `Path ${path} does not point to an array before [${token}]` };
        }

        if (token < 0 || token >= current.length) {
          return { found: false, error: `Path ${path} is missing array index [${token}]` };
        }

        current = current[token];
        continue;
      }

      if (!current || typeof current !== "object" || !(token in current)) {
        return { found: false, error: `Path ${path} is missing property "${token}"` };
      }

      current = current[token];
    }

    return { found: true, value: current };
  } catch (error) {
    return {
      found: false,
      error: error instanceof Error ? error.message : "Invalid JPath"
    };
  }
};

const parseAssertionExpectedValue = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return "";
  }

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  if (normalized === "null") {
    return null;
  }

  if (/^-?\d+(\.\d+)?$/.test(normalized)) {
    return Number(normalized);
  }

  if (/^[\[{"]/.test(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return normalized;
    }
  }

  return normalized;
};

const areAssertionValuesEqual = (left, right) => {
  if (left === right) {
    return true;
  }

  if (typeof left === "object" && left !== null && typeof right === "object" && right !== null) {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  return false;
};

const evaluateApiAssertions = (preview, validations = []) => {
  const effectiveValidations = validations.length ? validations : [{ kind: "status", expected: "200" }];

  return effectiveValidations.map((validation) => {
    const kind = normalizeText(validation.kind || "status") || "status";
    const target = normalizeText(validation.target);
    const expected = normalizeText(validation.expected);

    if (kind === "status") {
      const expectedStatus = Number(expected || "200") || 200;
      const passed = preview.response.status === expectedStatus;

      return {
        kind,
        passed,
        target: null,
        expected: String(expectedStatus),
        actual: String(preview.response.status),
        summary: passed
          ? `Matched expected status ${expectedStatus}.`
          : `Expected status ${expectedStatus}, received ${preview.response.status}.`
      };
    }

    if (kind === "header") {
      const headerName = String(target || "content-type").toLowerCase();
      const actual = preview.response.headers[headerName] || "";
      const passed = actual === (expected || "");

      return {
        kind,
        passed,
        target: headerName,
        expected: expected || "",
        actual,
        summary: passed
          ? `Header matched ${headerName}.`
          : `Expected "${expected || ""}", received "${actual || "(empty)"}".`
      };
    }

    if (kind === "body_contains") {
      const bodyText = String(preview.response.body_text || "");
      const passed = bodyText.includes(expected || "");

      return {
        kind,
        passed,
        target: target || null,
        expected: expected || "",
        actual: bodyText,
        summary: passed
          ? "Expected text was found in the response body."
          : `Could not find "${expected || ""}" in the response body.`
      };
    }

    if (preview.response.body_json === null || preview.response.body_json === undefined) {
      return {
        kind,
        passed: false,
        target: target || "$",
        expected: expected || "",
        actual: null,
        summary: "Response body is not JSON, so this JPath assertion could not be evaluated."
      };
    }

    const resolved = readJsonPathValue(preview.response.body_json, target || "$");

    if (!resolved.found) {
      return {
        kind,
        passed: false,
        target: target || "$",
        expected: expected || "",
        actual: null,
        summary: resolved.error
      };
    }

    const expectedValue = parseAssertionExpectedValue(expected);
    const passed = areAssertionValuesEqual(resolved.value, expectedValue);

    return {
      kind,
      passed,
      target: target || "$",
      expected: stringifyValue(expectedValue),
      actual: stringifyValue(resolved.value),
      summary: passed
        ? `Matched ${target || "$"} = ${stringifyValue(resolved.value)}.`
        : `Expected ${stringifyValue(expectedValue)}, received ${stringifyValue(resolved.value)}.`
    };
  });
};

const appendJsonPathSegment = (basePath, key) => {
  if (typeof key === "number") {
    return `${basePath}[${key}]`;
  }

  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
    return `${basePath}.${key}`;
  }

  return `${basePath}[${JSON.stringify(key)}]`;
};

const collectJsonScalars = (value, path = "$", key = "") => {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [{ path, key, value }];
  }

  if (Array.isArray(value)) {
    return value.slice(0, 5).flatMap((entry, index) => collectJsonScalars(entry, appendJsonPathSegment(path, index), key));
  }

  if (value && typeof value === "object") {
    return Object.entries(value).slice(0, 80).flatMap(([entryKey, entryValue]) =>
      collectJsonScalars(entryValue, appendJsonPathSegment(path, entryKey), entryKey)
    );
  }

  return [];
};

const toParameterToken = (path, key) => {
  const rawName = normalizeText(key)
    || normalizeText(String(path || "").split(/[.[\]]/).filter(Boolean).pop())
    || "responseValue";
  const words = rawName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const camel = words
    .map((word, index) => {
      const lower = word.toLowerCase();
      return index === 0 ? lower : `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
    })
    .join("");

  return `@t.${camel || "responseValue"}`;
};

const isLikelyCapture = ({ key, path, value }) => {
  const label = `${key || ""} ${path || ""}`.toLowerCase();
  const compactLabel = label.replace(/[^a-z0-9]/g, "");

  if (value === null || value === undefined || typeof value === "object") {
    return false;
  }

  return /\b(id|uuid|token|access[_-]?token|refresh[_-]?token|session|reference|number|email|url)\b/.test(label)
    || /(^|[._-])(id|uuid|token|email|url)$/.test(label)
    || /(id|uuid|token|email|url|reference|number)$/.test(compactLabel);
};

const isLikelyAssertion = ({ key, path, value }) => {
  const label = `${key || ""} ${path || ""}`.toLowerCase();

  if (value === null || value === undefined || typeof value === "object") {
    return false;
  }

  return /\b(status|state|success|enabled|active|type|code|message|result)\b/.test(label);
};

const buildAiResponseSuggestions = (preview) => {
  const assertions = [
    {
      kind: "status",
      target: null,
      expected: String(preview.response.status)
    }
  ];
  const captures = [];
  const notes = [];

  if (preview.response.body_json !== null && preview.response.body_json !== undefined) {
    const scalars = collectJsonScalars(preview.response.body_json);
    const assertionCandidates = scalars
      .filter(isLikelyAssertion)
      .filter((candidate) => candidate.path !== "$")
      .slice(0, 4);
    const captureCandidates = scalars
      .filter(isLikelyCapture)
      .filter((candidate) => candidate.path !== "$")
      .filter((candidate, index, all) => all.findIndex((entry) => entry.path === candidate.path) === index)
      .slice(0, 6);

    assertionCandidates.forEach((candidate) => {
      assertions.push({
        kind: "json_path",
        target: candidate.path,
        expected: stringifyValue(candidate.value)
      });
    });

    captureCandidates.forEach((candidate) => {
      captures.push({
        path: candidate.path,
        parameter: toParameterToken(candidate.path, candidate.key)
      });
    });

    notes.push(
      captureCandidates.length
        ? `Suggested ${captureCandidates.length} likely reusable response value${captureCandidates.length === 1 ? "" : "s"}.`
        : "No obvious dynamic IDs, tokens, or references were promoted as output parameters."
    );
  } else {
    const snippet = normalizeText(String(preview.response.body_text || "").replace(/\s+/g, " ").slice(0, 120));

    if (snippet) {
      assertions.push({
        kind: "body_contains",
        target: null,
        expected: snippet
      });
      notes.push("Suggested a focused body text assertion because the response is not JSON.");
    }
  }

  return {
    summary: `AI response review suggested ${assertions.length} assertion${assertions.length === 1 ? "" : "s"} and ${captures.length} output parameter${captures.length === 1 ? "" : "s"}.`,
    assertions,
    captures,
    notes
  };
};

const extractCaptures = (request, preview) => {
  const captures = {};

  for (const capture of request.captures || []) {
    const parameter = normalizeText(capture.parameter);

    if (!parameter) {
      continue;
    }

    const source = preview.response.body_json !== null && preview.response.body_json !== undefined
      ? preview.response.body_json
      : preview.response.body_text;
    const resolved = readJsonPathValue(source, capture.path || "$");
    captures[parameter] = resolved.found ? stringifyValue(resolved.value) : "";
  }

  return captures;
};

const runResolvedApiRequest = async (request) => {
  const normalizedRequest = normalizeApiRequest(request);

  if (!normalizedRequest) {
    throw new Error("A valid API request is required");
  }

  const url = ensureHttpUrl(normalizedRequest.url);
  const method = normalizedRequest.method || "GET";
  const headers = new Headers();

  for (const header of normalizedRequest.headers || []) {
    const key = normalizeText(header.key);

    if (!key) {
      continue;
    }

    headers.set(key, header.value || "");
  }

  const requestBody = method === "GET" || method === "HEAD" ? undefined : serializeApiBody(normalizedRequest, headers);
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const maxAttempts = IDEMPOTENT_METHODS.has(method) ? 2 : 1;
  const attempts = [];
  let response;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptStartedAt = Date.now();

    try {
      response = await fetch(url, {
        method,
        headers,
        body: requestBody,
        signal: AbortSignal.timeout(20000)
      });
      attempts.push({
        attempt,
        status: response.status,
        duration_ms: Date.now() - attemptStartedAt,
        outcome: RETRYABLE_RESPONSE_STATUSES.has(response.status) && attempt < maxAttempts ? "retrying" : "completed"
      });

      if (RETRYABLE_RESPONSE_STATUSES.has(response.status) && attempt < maxAttempts) {
        await response.body?.cancel();
        await waitForRetry(attempt);
        continue;
      }

      break;
    } catch (error) {
      const timedOut = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
      attempts.push({
        attempt,
        status: null,
        duration_ms: Date.now() - attemptStartedAt,
        outcome: attempt < maxAttempts ? "retrying" : "failed",
        error: timedOut ? "Request timed out after 20 seconds" : (error instanceof Error ? error.message : "Network request failed")
      });

      if (attempt < maxAttempts) {
        await waitForRetry(attempt);
        continue;
      }

      throw new Error(timedOut ? "API request timed out after 20 seconds" : (error instanceof Error ? error.message : "Unable to run API request"));
    }
  }

  if (!response) {
    throw new Error("Unable to run API request");
  }

  const { bodyText, bytesReceived, truncated } = await readLimitedResponseBody(response);
  const contentType = response.headers.get("content-type");
  const completedAt = Date.now();

  return {
    request: {
      method,
      url,
      headers: Object.fromEntries(headers.entries()),
      body: normalizedRequest.body || null
    },
    response: {
      status: response.status,
      ok: response.ok,
      status_text: response.statusText,
      headers: mapResponseHeaders(response),
      content_type: contentType,
      body_text: bodyText,
      body_json: parseResponseJson(bodyText, contentType),
      duration_ms: completedAt - startedAt,
      size_bytes: bytesReceived,
      truncated
    },
    trace: {
      started_at: startedAtIso,
      completed_at: new Date(completedAt).toISOString(),
      total_duration_ms: completedAt - startedAt,
      request_size_bytes: requestBody ? Buffer.byteLength(requestBody, "utf8") : 0,
      response_size_bytes: bytesReceived,
      response_truncated: truncated,
      attempts
    }
  };
};

exports.runApiRequestPreview = async (input, options = {}) => {
  const request = normalizeApiRequest(resolveApiRequestParameters(input, options.parameterValues || {}));

  if (!request) {
    throw new Error("A valid API request is required");
  }

  const preview = await runResolvedApiRequest(request);

  return {
    request: {
      method: preview.request.method,
      url: preview.request.url
    },
    response: {
      status: preview.response.status,
      ok: preview.response.ok,
      headers: preview.response.headers,
      content_type: preview.response.content_type,
      body_text: preview.response.body_text,
      body_json: preview.response.body_json,
      duration_ms: preview.response.duration_ms,
      size_bytes: preview.response.size_bytes,
      truncated: preview.response.truncated
    },
    trace: preview.trace,
    ai_suggestions: buildAiResponseSuggestions(preview)
  };
};

exports.executeApiRequestStep = async ({ api_request, parameter_values = {} } = {}) => {
  const request = normalizeApiRequest(resolveApiRequestParameters(api_request, parameter_values));

  if (!request) {
    throw new Error("A valid API request is required");
  }

  const preview = await runResolvedApiRequest(request);
  const assertions = evaluateApiAssertions(preview, request.validations || []);
  const captures = extractCaptures(request, preview);
  const firstFailure = assertions.find((assertion) => !assertion.passed);
  const passed = assertions.every((assertion) => assertion.passed);
  const captureLines = Object.entries(captures).map(([key, value]) => `Captured ${key} = ${stringifyValue(value)}`);

  return {
    status: passed ? "passed" : "failed",
    duration_ms: preview.response.duration_ms,
    note: passed
      ? `${preview.request.method} ${preview.request.url} passed with ${preview.response.status}.`
      : firstFailure?.summary || `${preview.request.method} ${preview.request.url} failed with ${preview.response.status}.`,
    detail: {
      request: {
        method: preview.request.method,
        url: preview.request.url,
        headers: preview.request.headers,
        body: preview.request.body
      },
      response: {
        status: preview.response.status,
        status_text: preview.response.status_text,
        headers: preview.response.headers,
        body: preview.response.body_text,
        json: preview.response.body_json
      },
      captures,
      assertions: assertions.map((assertion) => ({
        kind: assertion.kind,
        passed: assertion.passed,
        target: assertion.target,
        expected: assertion.expected,
        actual: assertion.actual
      }))
    },
    captures,
    evidence: {
      dataUrl: buildApiEvidenceDataUrl({
        status: passed ? "passed" : "failed",
        title: request.url || "API step",
        url: preview.request.url,
        method: preview.request.method,
        responseStatus: `${preview.response.status} ${preview.response.status_text}`.trim(),
        captureLines
      }),
      fileName: `api-step-${passed ? "passed" : "failed"}.svg`,
      mimeType: "image/svg+xml"
    }
  };
};
