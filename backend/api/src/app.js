const fastify = require("fastify")({ 
  logger: {
    level: process.env.LOG_LEVEL || "info"
  },
  requestIdLogLabel: "reqId",
  disableRequestLogging: false,
  requestTimeout: 120000,
  bodyLimit: 128 * 1024 * 1024
});

const cors = require("@fastify/cors");
const { config } = require("./config");
const { ensureRuntimeSchema: ensureMainRuntimeSchema } = require("./db/bootstrap");
const { ensureRuntimeSchema: ensureObsRuntimeSchema } = require("./obsDb/bootstrap");
const { generateRequestId } = require("./utils/token");

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
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Request-ID", "X-Trace-ID", "traceparent", "tracestate"],
  exposedHeaders: ["X-Request-ID", "X-Trace-ID", "traceparent"],
  credentials: true,
  maxAge: 86400
});

fastify.register(require("./plugins/errorHandler"));
fastify.register(require("./plugins/observability"));
fastify.register(require("./plugins/validator"));
fastify.register(require("./plugins/accessControl"));
fastify.register(require("./routes"));
fastify.addHook("onReady", async () => {
  await ensureMainRuntimeSchema();
  await ensureObsRuntimeSchema();
});
fastify.register(require("./plugins/backgroundTasks"));

module.exports = fastify;
