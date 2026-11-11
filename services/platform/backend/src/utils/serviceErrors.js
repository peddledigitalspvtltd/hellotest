const SERVICE_ERROR_CODES = Object.freeze({
  CANCELLED: "DEPENDENCY_REQUEST_CANCELLED",
  CIRCUIT_OPEN: "DEPENDENCY_CIRCUIT_OPEN",
  CONFIGURATION: "DEPENDENCY_CONFIGURATION_ERROR",
  INVALID_RESPONSE: "DEPENDENCY_INVALID_RESPONSE",
  NETWORK: "DEPENDENCY_NETWORK_ERROR",
  OVERLOADED: "DEPENDENCY_OVERLOADED",
  RESPONSE_TOO_LARGE: "DEPENDENCY_RESPONSE_TOO_LARGE",
  TIMEOUT: "DEPENDENCY_TIMEOUT",
  UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
  UPSTREAM_REJECTED: "DEPENDENCY_REQUEST_REJECTED"
});

const PUBLIC_MESSAGES = Object.freeze({
  [SERVICE_ERROR_CODES.CANCELLED]: "The dependency request was cancelled.",
  [SERVICE_ERROR_CODES.CIRCUIT_OPEN]: "A required service is recovering. Please retry shortly.",
  [SERVICE_ERROR_CODES.CONFIGURATION]: "A required service is not configured correctly.",
  [SERVICE_ERROR_CODES.INVALID_RESPONSE]: "A connected service returned an invalid response.",
  [SERVICE_ERROR_CODES.NETWORK]: "A connected service could not be reached.",
  [SERVICE_ERROR_CODES.OVERLOADED]: "A connected service is temporarily at capacity.",
  [SERVICE_ERROR_CODES.RESPONSE_TOO_LARGE]: "A connected service returned more data than can be processed safely.",
  [SERVICE_ERROR_CODES.TIMEOUT]: "A connected service did not respond in time.",
  [SERVICE_ERROR_CODES.UNAVAILABLE]: "A connected service is temporarily unavailable.",
  [SERVICE_ERROR_CODES.UPSTREAM_REJECTED]: "A connected service rejected the request."
});

const normalizeDependency = (value) => {
  const normalized = String(value || "external-service")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 80) || "external-service";
};

const sanitizeInternalErrorText = (value) => String(value || "")
  .replace(/:\/\/[^/@\s]+@/g, "://[redacted]@")
  .replace(/([?&](?:(?:access|refresh|id|session|auth|api)[_-]?token|api[_-]?key|authorization|code|credential|key|password|secret|sig|signature|token|x-amz-signature|x-goog-signature)=)[^&#\s]+/gi, "$1[redacted]")
  .replace(/\b(Basic|Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
  .replace(/\b((?:set-)?cookie)\s*:\s*[^\r\n]*/gi, "$1: [redacted]")
  .replace(/\b(password|secret|token|(?:access|refresh|id|session|auth|api)[_-]?token|api[_-]?key|access[_-]?key|client[_-]?secret|session[_-]?secret|authorization|cookie|set-cookie)["']?\s*[=:]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi, "$1=[redacted]")
  .slice(0, 8_000);

// Absent hints stay absent; Number(null) must not manufacture Retry-After: 1.
const normalizeRetryAfter = (value) => value !== null && value !== undefined && value !== ""
  && Number.isFinite(Number(value))
  ? Math.max(1, Math.min(86_400, Math.ceil(Number(value))))
  : null;

class ServiceBoundaryError extends Error {
  constructor(message, {
    code = SERVICE_ERROR_CODES.UNAVAILABLE,
    dependency = "external-service",
    operation = "request",
    retryable = false,
    statusCode = 502,
    retryAfterSeconds = null,
    upstreamStatus = null,
    cause = undefined
  } = {}) {
    super(message || PUBLIC_MESSAGES[code] || PUBLIC_MESSAGES[SERVICE_ERROR_CODES.UNAVAILABLE], { cause });
    this.name = "ServiceBoundaryError";
    this.code = code;
    this.dependency = normalizeDependency(dependency);
    this.operation = String(operation || "request").slice(0, 120);
    this.retryable = Boolean(retryable);
    this.statusCode = Number(statusCode) || 502;
    this.retryAfterSeconds = normalizeRetryAfter(retryAfterSeconds);
    this.upstreamStatus = upstreamStatus != null && Number.isInteger(Number(upstreamStatus))
      && Number(upstreamStatus) >= 100 && Number(upstreamStatus) <= 599 ? Number(upstreamStatus) : null;
    this.publicMessage = PUBLIC_MESSAGES[code] || PUBLIC_MESSAGES[SERVICE_ERROR_CODES.UNAVAILABLE];
  }

  toJSON() {
    return {
      code: this.code,
      dependency: this.dependency,
      operation: this.operation,
      retryable: this.retryable,
      statusCode: this.statusCode,
      retryAfterSeconds: this.retryAfterSeconds,
      upstreamStatus: this.upstreamStatus
    };
  }
}

const serviceError = (code, options = {}) => new ServiceBoundaryError(
  options.message || PUBLIC_MESSAGES[code],
  { ...options, code }
);

const isAbortLike = (error) => ["AbortError", "TimeoutError"].includes(error?.name)
  || ["ABORT_ERR", "UND_ERR_ABORTED"].includes(error?.code);

const NETWORK_FAILURE_CODES = new Set([
  "ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN", "EHOSTUNREACH",
  "ENETDOWN", "ENETUNREACH", "ENOTFOUND", "EPIPE", "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"
]);
const CONFIGURATION_FAILURE_CODES = new Set([
  "ERR_INVALID_URL", "ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_VALUE", "ERR_INVALID_HTTP_TOKEN",
  "ERR_HTTP_INVALID_HEADER_VALUE", "ERR_INVALID_CHAR", "ERR_UNESCAPED_CHARACTERS",
  "UND_ERR_INVALID_ARG", "UND_ERR_NOT_SUPPORTED", "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH",
  "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED", "CERT_SIGNATURE_FAILURE"
]);

// Node fetch may wrap DNS/socket failures in TypeError and AggregateError.
// Inspect only bounded error links, never request configs or arbitrary payloads.
const errorChain = error => {
  const queue = [{ error, depth: 0 }], seen = new Set(), errors = [];
  for (let index = 0; index < queue.length && errors.length < 32; index++) {
    const item = queue[index], current = item.error;
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current); errors.push(current);
    if (item.depth >= 4) continue;
    if (current.cause) queue.push({ error: current.cause, depth: item.depth + 1 });
    if (Array.isArray(current.errors)) for (const child of current.errors.slice(0, 5)) queue.push({ error: child, depth: item.depth + 1 });
  }
  return errors;
};

// Only a reviewed transport code is suitable for logs and trace metadata.
// Unknown codes can contain caller-controlled text or credentials.
const networkFailureCode = error => errorChain(error).find(item => NETWORK_FAILURE_CODES.has(item.code))?.code || null;
const configurationFailure = error => errorChain(error).some(item => CONFIGURATION_FAILURE_CODES.has(item.code)
  || /^(?:bad port|unknown scheme|unexpected redirect)$/i.test(String(item.message || "").trim()));
const nativeFetchFailure = error => errorChain(error).some(item => (item instanceof TypeError || item.name === "TypeError")
  && /^(?:fetch failed|failed to fetch|networkerror when attempting to fetch resource\.?|network request failed)$/i.test(String(item.message || "").trim()));
const isNetworkLike = error => !configurationFailure(error) && (networkFailureCode(error) !== null || nativeFetchFailure(error));

const classifyServiceFailure = (error, context = {}) => {
  if (error instanceof ServiceBoundaryError) return error;

  if (context.callerAborted) {
    return serviceError(SERVICE_ERROR_CODES.CANCELLED, {
      ...context,
      retryable: false,
      statusCode: 499,
      cause: error
    });
  }

  if (context.timedOut || isAbortLike(error)) {
    return serviceError(SERVICE_ERROR_CODES.TIMEOUT, {
      ...context,
      retryable: true,
      statusCode: 504,
      cause: error
    });
  }

  if (isNetworkLike(error)) {
    return serviceError(SERVICE_ERROR_CODES.NETWORK, {
      ...context,
      retryable: true,
      statusCode: 503,
      cause: error
    });
  }

  // Invalid request inputs and programming errors cannot recover by sending
  // the same request again. A generic TypeError is not evidence of an outage.
  if (configurationFailure(error) || ["TypeError", "SyntaxError", "ReferenceError", "RangeError"].includes(error?.name)) {
    return serviceError(SERVICE_ERROR_CODES.CONFIGURATION, {
      ...context,
      retryable: false,
      statusCode: 500,
      cause: error
    });
  }

  return serviceError(SERVICE_ERROR_CODES.UNAVAILABLE, {
    ...context,
    retryable: true,
    statusCode: 502,
    cause: error
  });
};

module.exports = {
  PUBLIC_MESSAGES,
  SERVICE_ERROR_CODES,
  ServiceBoundaryError,
  classifyServiceFailure,
  isAbortLike,
  isNetworkLike,
  networkFailureCode,
  normalizeDependency,
  normalizeRetryAfter,
  sanitizeInternalErrorText,
  serviceError
};
