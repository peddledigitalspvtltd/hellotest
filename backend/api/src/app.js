const Fastify = require("fastify");
const { LogController } = Fastify;
const { config } = require("./config");
const { generateRequestId } = require("./utils/token");

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    redact: {
      censor: "[REDACTED]",
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-api-key",
        "request.headers.authorization",
        "request.headers.cookie",
        "request.headers.x-api-key",
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
  requestTimeout: config.http.requestTimeoutMs,
  connectionTimeout: config.http.connectionTimeoutMs,
  keepAliveTimeout: config.http.keepAliveTimeoutMs,
  maxRequestsPerSocket: config.http.maxRequestsPerSocket,
  forceCloseConnections: "idle",
  bodyLimit: config.http.bodyLimitBytes
});

const cors = require("@fastify/cors");
const multipart = require("@fastify/multipart");
const { ensureRuntimeSchema: ensureMainRuntimeSchema } = require("./db/bootstrap");
const { ensureRuntimeSchema: ensureObsRuntimeSchema } = require("./obsDb/bootstrap");
const adminPortalService = require("./services/adminPortal.service");

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
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Request-ID", "X-Trace-ID", "Idempotency-Key", "traceparent", "tracestate"],
  exposedHeaders: ["X-Request-ID", "X-Trace-ID", "Location", "Retry-After", "traceparent"],
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
fastify.register(require("./routes"));
fastify.addHook("onReady", async () => {
  await ensureMainRuntimeSchema();
  await ensureObsRuntimeSchema();
  await adminPortalService.ensureAdminFoundation();
});
fastify.register(require("./plugins/backgroundTasks"));

module.exports = fastify;
