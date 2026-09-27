const { sanitizeInternalErrorText } = require("./serviceErrors");

/** Errors often carry full HTTP configs, SQL parameters or provider payloads.
 * Log only diagnostic fields, with a bounded and cycle-safe cause chain. */
function serializeDiagnosticError(error, seen = new Set(), depth = 0) {
  if (error == null) return error;
  if (typeof error !== "object") return { message: sanitizeInternalErrorText(error) };
  if (seen.has(error)) return { message: "[circular cause]" };
  if (depth >= 4) return { message: "[cause depth limit]" };
  seen.add(error);
  const result = {
    type: sanitizeInternalErrorText(error.name || "Error"),
    message: sanitizeInternalErrorText(error.message),
    stack: sanitizeInternalErrorText(error.stack)
  };
  for (const key of ["code", "statusCode", "dependency", "operation", "retryable", "upstreamStatus"]) {
    const value = error[key];
    if (typeof value === "string") result[key] = sanitizeInternalErrorText(value);
    else if (typeof value === "number" || typeof value === "boolean") result[key] = value;
  }
  if (error.cause) result.cause = serializeDiagnosticError(error.cause, seen, depth + 1);
  if (Array.isArray(error.errors)) {
    result.errors = error.errors.slice(0, 5).map((entry) => serializeDiagnosticError(entry, seen, depth + 1));
  }
  return result;
}

module.exports = { serializeDiagnosticError };
