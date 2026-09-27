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

const isNetworkLike = (error) => {
  const code = error?.code || error?.cause?.code;
  return [
    "ECONNABORTED",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ENOTFOUND",
    "EPIPE",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET"
  ].includes(code) || error instanceof TypeError;
};

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
  normalizeDependency,
  normalizeRetryAfter,
  sanitizeInternalErrorText,
  serviceError
};
