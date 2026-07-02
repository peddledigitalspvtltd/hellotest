const fp = require("fastify-plugin");

async function errorHandlerPlugin(fastify) {
  const inferStatusCode = (err) => {
    if (err.statusCode) {
      return err.statusCode;
    }

    const message = String(err.message || "").toLowerCase();

    if (!message) {
      return 500;
    }

    if (message.includes("access denied") || message.includes("admin access required")) {
      return 403;
    }

    if (message.includes("not found")) {
      return 404;
    }

    if (message.includes("duplicate") || message.includes("already exists") || message.includes("unique")) {
      return 409;
    }

    if (
      message.includes("missing") ||
      message.includes("invalid") ||
      message.includes("required") ||
      message.includes("must") ||
      message.includes("unable to parse") ||
      message.includes("unsupported")
    ) {
      return 400;
    }

    return 500;
  };

  fastify.setErrorHandler((err, req, reply) => {
    const requestId = req.id || req.headers["x-request-id"] || "unknown";
    const statusCode = inferStatusCode(err);
    
    req.log.error({
      requestId,
      traceId: req.traceId || req.headers["x-trace-id"] || null,
      traceparent: req.traceparent || req.headers.traceparent || null,
      error: err.message,
      code: err.code,
      stack: err.stack,
      statusCode,
      method: req.method,
      url: req.url
    });

    const isDevelopment = process.env.NODE_ENV !== "production";

    reply.status(statusCode).send({
      success: false,
      message: err.message || "Internal Server Error",
      requestId,
      traceId: req.traceId || req.headers["x-trace-id"] || null,
      ...(isDevelopment && { stack: err.stack })
    });
  });
}

module.exports = fp(errorHandlerPlugin, {
  name: "qaira-error-handler"
});
