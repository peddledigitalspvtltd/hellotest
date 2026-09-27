// Pure translation from domain/provider failures to the public HTTP contract.
const { PUBLIC_MESSAGES, ServiceBoundaryError, sanitizeInternalErrorText, normalizeRetryAfter } = require("./serviceErrors");

const PG_CONFLICT_CODES = new Set(["23503", "23505", "23P01"]);
const PG_INPUT_CODES = new Set(["22001", "22003", "22007", "22P02", "23502", "23514"]);
const PG_TRANSIENT_CODES = new Set(["40001", "40P01", "55P03", "57P01", "57P02", "57P03", "53300"]);
const FASTIFY_CODE_MAP = Object.freeze({
  FST_ERR_CTP_BODY_TOO_LARGE: { statusCode: 413, code: "PAYLOAD_TOO_LARGE", message: "The request payload is too large." },
  FST_ERR_CTP_EMPTY_JSON_BODY: { statusCode: 400, code: "INVALID_REQUEST", message: "The JSON request body cannot be empty." },
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: { statusCode: 400, code: "INVALID_REQUEST", message: "The request has an invalid content length." },
  FST_ERR_CTP_INVALID_JSON_BODY: { statusCode: 400, code: "INVALID_REQUEST", message: "The JSON request body is invalid." },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: { statusCode: 415, code: "UNSUPPORTED_MEDIA_TYPE", message: "The request media type is not supported." },
  FST_ERR_VALIDATION: { statusCode: 400, code: "VALIDATION_ERROR", message: "The request did not pass validation." }
});

const STATUS_CODE_MAP = Object.freeze({
  400: { code: "INVALID_REQUEST", message: "The request is invalid." },
  401: { code: "AUTHENTICATION_REQUIRED", message: "Authentication is required." },
  403: { code: "ACCESS_DENIED", message: "You do not have permission to perform this action." },
  404: { code: "NOT_FOUND", message: "The requested resource was not found." },
  405: { code: "METHOD_NOT_ALLOWED", message: "The request method is not allowed." },
  408: { code: "REQUEST_TIMEOUT", message: "The request timed out." },
  409: { code: "CONFLICT", message: "The request conflicts with the current resource state." },
  412: { code: "PRECONDITION_FAILED", message: "A request precondition was not met." },
  413: { code: "PAYLOAD_TOO_LARGE", message: "The request payload is too large." },
  415: { code: "UNSUPPORTED_MEDIA_TYPE", message: "The request media type is not supported." },
  422: { code: "UNPROCESSABLE_REQUEST", message: "The request could not be processed." },
  429: { code: "RATE_LIMITED", message: "Too many requests were received. Please retry shortly." },
  499: { code: "REQUEST_CANCELLED", message: "The request was cancelled." },
  500: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." },
  502: { code: "DEPENDENCY_ERROR", message: "A connected service returned an error." },
  503: { code: "SERVICE_UNAVAILABLE", message: "The service is temporarily unavailable." },
  504: { code: "DEPENDENCY_TIMEOUT", message: "A connected service did not respond in time." }
});

const validStatusCode = (value) => Number.isInteger(Number(value)) && Number(value) >= 400 && Number(value) <= 599
  ? Number(value)
  : null;

const safeCustomCode = (value) => typeof value === "string"
  && /^[A-Z][A-Z0-9_]{2,80}$/.test(value)
  && !/^\d{5}$/.test(value)
  ? value
  : null;

const inferLegacyStatus = (message) => {
  const normalized = String(message || "").toLowerCase();
  if (!normalized) return 500;
  if (normalized.includes("access denied") || normalized.includes("admin access required") || normalized.includes("cors not allowed")) return 403;
  if (normalized.includes("not found")) return 404;
  if (normalized.includes("duplicate") || normalized.includes("already exists") || normalized.includes("unique")) return 409;
  if (
    normalized.includes("missing")
    || normalized.includes("invalid")
    || normalized.includes("required")
    || normalized.includes("must")
    || normalized.includes("unable to parse")
    || normalized.includes("unsupported")
  ) return 400;
  return 500;
};

const classifyError = (error = {}) => {
  if (error.code === "PJD01") {
    return { statusCode: 409, code: "PROJECT_DELETING", message: "This project is being deleted. Changes are temporarily unavailable.", retryable: false, errorType: "postgres.project_deleting" };
  }
  if (error instanceof ServiceBoundaryError) {
    const statusCode = validStatusCode(error.statusCode) || 502;
    return {
      statusCode,
      code: error.code,
      message: sanitizeInternalErrorText(error.publicMessage || PUBLIC_MESSAGES[error.code] || STATUS_CODE_MAP[statusCode]?.message),
      retryAfterSeconds: normalizeRetryAfter(error.retryAfterSeconds),
      retryable: error.retryable,
      errorType: error.code
    };
  }

  if (PG_CONFLICT_CODES.has(error.code)) {
    return { statusCode: 409, code: "DATA_CONFLICT", message: STATUS_CODE_MAP[409].message, retryable: false, errorType: "postgres.conflict" };
  }
  if (PG_INPUT_CODES.has(error.code)) {
    return { statusCode: 400, code: "INVALID_DATA", message: "One or more values are invalid.", retryable: false, errorType: "postgres.input" };
  }
  if (error.code === "57014" || error.message === "Query read timeout") {
    return { statusCode: 503, code: "DATABASE_TIMEOUT", message: "The data service could not complete this request in time.", retryAfterSeconds: 1, retryable: true, errorType: "postgres.timeout" };
  }
  if (["timeout exceeded when trying to connect", "Connection terminated due to connection timeout"].includes(error.message)) {
    return { statusCode: 503, code: "DATABASE_UNAVAILABLE", message: "The data service is temporarily unavailable.", retryAfterSeconds: 1, retryable: true, errorType: "postgres.capacity" };
  }
  if (PG_TRANSIENT_CODES.has(error.code) || String(error.code || "").startsWith("08")) {
    return { statusCode: 503, code: "DATABASE_UNAVAILABLE", message: "The data service is temporarily unavailable.", retryAfterSeconds: 1, retryable: true, errorType: "postgres.transient" };
  }
  // Unknown SQLSTATE errors are internal failures, even when the driver message
  // contains words such as "missing" or "not found" used by legacy validation.
  if (/^(?=.*\d)[A-Z0-9]{5}$/.test(String(error.code || ""))) {
    return { statusCode: 500, code: "DATABASE_ERROR", message: STATUS_CODE_MAP[500].message, retryable: false, errorType: "postgres.internal" };
  }

  const fastifyMapping = FASTIFY_CODE_MAP[error.code];
  if (fastifyMapping || Array.isArray(error.validation)) {
    return {
      ...(fastifyMapping || FASTIFY_CODE_MAP.FST_ERR_VALIDATION),
      retryable: false,
      errorType: "request.validation"
    };
  }

  if (["AbortError", "TimeoutError"].includes(error.name) || ["ABORT_ERR", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(error.code)) {
    return { statusCode: 504, code: "DEPENDENCY_TIMEOUT", message: STATUS_CODE_MAP[504].message, retryAfterSeconds: 1, retryable: true, errorType: "timeout" };
  }

  const statusCode = validStatusCode(error.statusCode) || inferLegacyStatus(error.message);
  const defaults = STATUS_CODE_MAP[statusCode] || STATUS_CODE_MAP[statusCode >= 500 ? 500 : 400];
  const exposeOriginalMessage = statusCode < 500 && typeof error.message === "string" && error.message.trim();
  return {
    statusCode,
    code: safeCustomCode(error.code) || defaults.code,
    message: sanitizeInternalErrorText(error.publicMessage || (exposeOriginalMessage ? error.message : defaults.message)),
    retryAfterSeconds: normalizeRetryAfter(error.retryAfterSeconds)
      ?? ([429, 503, 504].includes(statusCode) ? 1 : null),
    retryable: Boolean(error.retryable) || [429, 503, 504].includes(statusCode),
    errorType: statusCode >= 500 ? defaults.code.toLowerCase() : "request.rejected"
  };
};

module.exports = { classifyError, inferLegacyStatus, safeCustomCode };
