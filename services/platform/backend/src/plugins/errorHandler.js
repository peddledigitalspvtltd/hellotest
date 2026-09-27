const fp = require("fastify-plugin");
const {
  SERVICE_ERROR_CODES,
  sanitizeInternalErrorText
} = require("../utils/serviceErrors");

const { classifyError, inferLegacyStatus, safeCustomCode } = require("../utils/httpErrorPolicy");

const requestPath = (request) => request.routeOptions?.url
  || String(request.raw?.url || request.url || "unknown").split("?")[0]
  || "unknown";

async function errorHandlerPlugin(fastify) {
  fastify.setErrorHandler((error, request, reply) => {
    const requestId = request.id || request.headers["x-request-id"] || "unknown";
    const traceId = request.traceId || request.headers["x-trace-id"] || null;
    const classified = classifyError(error);

    request.log[classified.statusCode >= 500 ? "error" : "warn"]({
      event: "request_failed",
      request_id: requestId,
      trace_id: traceId,
      traceparent: request.traceparent || request.headers.traceparent || null,
      error_type: classified.errorType,
      error_code: classified.code,
      error_message: sanitizeInternalErrorText(error.message),
      error_stack: sanitizeInternalErrorText(error.stack),
      cause: error.cause ? sanitizeInternalErrorText(error.cause?.stack || error.cause?.message || error.cause) : null,
      status_code: classified.statusCode,
      method: request.method,
      route: requestPath(request),
      retryable: classified.retryable
    }, "Request failed");

    if (classified.retryAfterSeconds) {
      reply.header("Retry-After", String(classified.retryAfterSeconds));
    }

    const payload = {
      success: false,
      code: classified.code,
      message: classified.message,
      requestId,
      traceId,
      retryable: classified.retryable
    };
    if (classified.statusCode < 500 && Number.isSafeInteger(error.current_revision)) {
      payload.current_revision = error.current_revision;
    }

    reply.status(classified.statusCode).send(payload);
  });
}

module.exports = fp(errorHandlerPlugin, {
  name: "hellotest-error-handler"
});
module.exports._internals = {
  classifyError,
  inferLegacyStatus,
  requestPath,
  safeCustomCode
};
module.exports.SERVICE_ERROR_CODES = SERVICE_ERROR_CODES;
