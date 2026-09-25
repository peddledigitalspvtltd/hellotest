const TEST_STEP_TYPES = new Set(["web", "api", "android", "ios"]);
const API_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const API_BODY_MODES = new Set(["none", "json", "text", "xml", "form"]);
const API_VALIDATION_KINDS = new Set(["status", "header", "body_contains", "json_path"]);

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

module.exports = {
  TEST_STEP_TYPES,
  normalizeApiRequest,
  normalizeRichText,
  normalizeTestStepType,
  parseJsonValue
};
