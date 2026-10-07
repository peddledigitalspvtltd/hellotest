const Fastify = require("fastify");
const { LogController } = Fastify;
const { config } = require("./config");
const { generateRequestId } = require("./utils/token");
const { serializeDiagnosticError } = require("./utils/diagnosticErrorSerializer");

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    serializers: { err: serializeDiagnosticError, error: serializeDiagnosticError },
    redact: {
      censor: "[REDACTED]",
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-api-key",
        "req.headers.x-hellotest-recorder-token",
        "request.headers.authorization",
        "request.headers.cookie",
        "request.headers.x-api-key",
        "request.headers.x-hellotest-recorder-token",
        "res.headers.set-cookie",
        "response.headers.set-cookie",
        "password",
        "secret",
        "token",
        "apiKey",
        "accessKey",
        "refreshToken",
        "err.config.headers.Authorization",
        "error.config.headers.Authorization"
      ]
    }
  },
  logController: new LogController({
    requestIdLogLabel: "reqId",
    disableRequestLogging: true
  }),
  genReqId: () => generateRequestId(),
  // Schema initialization can exceed Fastify's 10-second plugin default on a cold database.
  pluginTimeout: config.startupTimeoutMs,
  requestTimeout: config.http.requestTimeoutMs,
  connectionTimeout: config.http.connectionTimeoutMs,
  keepAliveTimeout: config.http.keepAliveTimeoutMs,
  maxRequestsPerSocket: config.http.maxRequestsPerSocket,
  forceCloseConnections: "idle",
  bodyLimit: config.http.bodyLimitBytes
});

const cors = require("@fastify/cors");
const multipart = require("@fastify/multipart");
const { schemaMode, verifySchema } = require("./db/schemaReadiness");
const initializeSchema = (component) => {
  if (schemaMode() === "verify") return verifySchema(require(component === "main" ? "./db" : "./obsDb"), component);
  return component === "main" ? require("./db/bootstrap").ensureRuntimeSchema() : require("./obsDb/bootstrap").ensureRuntimeSchema();
};
const { routeEnabled } = require("./runtime/serviceProfile");

// Add request ID to all requests
fastify.addHook("onRequest", async (req, reply) => {
  req.id = req.id || generateRequestId();
  reply.header("X-Request-ID", req.id);
  // Add security headers
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("X-XSS-Protection", "1; mode=block");
  reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
});

// Improved CORS configuration
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
  : config.corsOrigins;

fastify.register(cors, {
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== "production") {
      cb(null, true);
    } else {
      cb(new Error("CORS not allowed"));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Request-ID", "X-Trace-ID", "Idempotency-Key", "X-HelloTest-Recorder-Token", "traceparent", "tracestate", "MCP-Protocol-Version", "Mcp-Method", "Mcp-Name"],
  exposedHeaders: ["X-Request-ID", "X-Trace-ID", "Location", "Retry-After", "traceparent", "MCP-Protocol-Version", "Mcp-Session-Id"],
  credentials: true,
  maxAge: 86400
});

fastify.register(multipart, {
  limits: {
    files: 1,
    fields: 10,
    fileSize: config.objectStorage.maxAttachmentBytes
  }
});

fastify.register(require("./plugins/errorHandler"));
fastify.register(require("./plugins/capacityGuard"));
fastify.register(require("./plugins/observability"));
fastify.register(require("./plugins/validator"));
fastify.register(require("./plugins/accessControl"));
fastify.register(require("./plugins/capabilityUi"));
fastify.register(require("@hellotest/mcp/backend/plugin"));
fastify.register(require("./routes"));
fastify.addHook("onReady", async function bootstrapRuntime() {
  const ownsAdministration = routeEnabled({ service: "platform" });
  for (const [phase, initialize] of [
    ["main schema", () => initializeSchema("main")],
    ["observability schema", () => initializeSchema("observability")],
    ...(ownsAdministration ? [["admin foundation", () =>
      require("@hellotest/platform/backend/services/adminPortal.service").ensureAdminFoundation()]] : [])
  ]) {
    const startedAt = Date.now();
    fastify.log.info({ phase }, "API initialization started");
    await initialize();
    fastify.log.info({ phase, durationMs: Date.now() - startedAt }, "API initialization completed");
  }
  if (ownsAdministration) {
    try {
      const setup = await require("@hellotest/platform/backend/services/instanceSetup.service").startConfigured();
      if (setup) fastify.log.info({ jobId: setup.job.id, status: setup.job.status }, "Instance setup receipt; follow progress in Administration");
    } catch (error) {
      // Optional sample content must not take an otherwise healthy API offline.
      fastify.log.error({ err: error }, "Automatic instance setup could not be queued; review HELLOTEST_INSTANCE_SETUP_MODULES or use Administration");
    }
  }
});
fastify.register(require("./plugins/backgroundTasks"));

module.exports = fastify;
