const crypto = require("crypto");

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
const db = require("./db");
const { ensureRuntimeSchema } = require("./db/bootstrap");
const executionScheduleService = require("./services/executionSchedule.service");
const aiTestCaseGenerationService = require("./services/aiTestCaseGeneration.service");
const aiAutomationBuilderService = require("./services/aiAutomationBuilder.service");
const projectSyncService = require("./services/projectSync.service");
const batchProcessService = require("./services/batchProcess.service");
const { verifyToken, generateRequestId } = require("./utils/token");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const engineSecretMatches = (provided, expected) => {
  const left = String(provided || "").trim();
  const right = String(expected || "").trim();

  if (!left || !right || left.length !== right.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
  } catch {
    return false;
  }
};

const getCurrentUser = async (id) => {
  const user = await db.prepare(`
    SELECT id, email, name, avatar_data_url, auth_provider, email_verified, created_at, is_workspace_admin
    FROM users
    WHERE id = ?
  `).get(id);

  if (!user) {
    return null;
  }

  const { is_workspace_admin, ...rest } = user;

  const roleRow = await db.prepare(`
    SELECT EXISTS (
      SELECT 1
      FROM project_members
      JOIN roles ON roles.id = project_members.role_id
      WHERE project_members.user_id = ?
        AND LOWER(roles.name) = 'admin'
    ) AS has_admin_membership
  `).get(id);

  return {
    ...rest,
    role: is_workspace_admin || roleRow?.has_admin_membership ? "admin" : "member"
  };
};

fastify.decorate("validate", (schema, data = {}) => {
  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];
    const isMissing = value === undefined || value === null;

    if (rules.required && isMissing) {
      throw createError(`Field '${field}' is required`, 400);
    }

    if (isMissing) {
      continue;
    }

    if (rules.type === "string" && typeof value !== "string") {
      throw createError(`Field '${field}' must be a string`, 400);
    }

    if (rules.type === "number" && typeof value !== "number") {
      throw createError(`Field '${field}' must be a number`, 400);
    }

    if (rules.type === "boolean" && typeof value !== "boolean") {
      throw createError(`Field '${field}' must be a boolean`, 400);
    }

    if (rules.type === "array" && !Array.isArray(value)) {
      throw createError(`Field '${field}' must be an array`, 400);
    }

    if (rules.type === "object" && (typeof value !== "object" || Array.isArray(value))) {
      throw createError(`Field '${field}' must be an object`, 400);
    }

    if (rules.type === "array" && rules.items === "string" && !value.every((item) => typeof item === "string")) {
      throw createError(`Field '${field}' must contain only strings`, 400);
    }

    if (rules.minLength && typeof value === "string" && value.length < rules.minLength) {
      throw createError(`Field '${field}' must be at least ${rules.minLength} characters`, 400);
    }

    if (rules.enum && !rules.enum.includes(value)) {
      throw createError(`Field '${field}' must be one of: ${rules.enum.join(", ")}`, 400);
    }
  }
});

fastify.decorateRequest("user", null);

fastify.decorate("authenticate", async (req) => {
  const value = req.headers.authorization || "";

  if (!value.startsWith("Bearer ")) {
    throw createError("Missing bearer token", 401);
  }

  let payload;

  try {
    payload = verifyToken(value.slice("Bearer ".length));
  } catch (error) {
    throw createError(error.message || "Invalid token", 401);
  }

  const user = await getCurrentUser(payload.sub);

  if (!user) {
    throw createError("User not found", 404);
  }

  req.user = user;
});

fastify.decorate("requireAdmin", async (req) => {
  await fastify.authenticate(req);

  if (req.user.role !== "admin") {
    throw createError("Admin access required", 403);
  }
});

fastify.decorate("authenticateTestEngine", async (req) => {
  const provided =
    req.headers["x-qaira-testengine-secret"]
    || req.headers["x-testengine-secret"]
    || (typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ")
      ? req.headers.authorization.slice("Bearer ".length)
      : "");
  const expected =
    process.env.TESTENGINE_SHARED_SECRET
    || process.env.QAIRA_TESTENGINE_SECRET
    || "qaira-testengine-dev-secret";

  if (!engineSecretMatches(provided, expected)) {
    throw createError("Test Engine authentication failed", 401);
  }
});

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
  : ["http://localhost:5173", "http://localhost:8080"];

fastify.register(cors, {
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== "production") {
      cb(null, true);
    } else {
      cb(new Error("CORS not allowed"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID", "X-Trace-ID", "traceparent", "tracestate"],
  exposedHeaders: ["X-Request-ID", "X-Trace-ID", "traceparent"],
  credentials: true,
  maxAge: 86400
});

fastify.register(require("./plugins/errorHandler"));
fastify.register(require("./plugins/observability"));
fastify.register(require("./routes"));
fastify.addHook("onReady", async () => {
  await ensureRuntimeSchema();
});

let scheduleProcessorTimer = null;
let aiGenerationProcessorTimer = null;
let projectSyncTimer = null;
let batchProcessTimer = null;
let recorderCleanupTimer = null;

fastify.addHook("onReady", async () => {
  const runDueSchedules = async () => {
    try {
      await executionScheduleService.processDueSchedules();
    } catch (error) {
      fastify.log.error(error, "Unable to process due execution schedules");
    }
  };

  await runDueSchedules();
  scheduleProcessorTimer = setInterval(runDueSchedules, 60 * 1000);
});

fastify.addHook("onReady", async () => {
  const runQueuedAiGeneration = async () => {
    try {
      await aiTestCaseGenerationService.processQueuedJobs();
    } catch (error) {
      fastify.log.error(error, "Unable to process queued AI test case generation jobs");
    }
  };

  await runQueuedAiGeneration();
  aiGenerationProcessorTimer = setInterval(runQueuedAiGeneration, 15 * 1000);
});

fastify.addHook("onReady", async () => {
  const runProjectSyncs = async () => {
    try {
      await projectSyncService.processScheduledIntegrations();
      await projectSyncService.processQueuedSyncs();
    } catch (error) {
      fastify.log.error(error, "Unable to process queued project sync jobs");
    }
  };

  await runProjectSyncs();
  projectSyncTimer = setInterval(runProjectSyncs, 60 * 1000);
});

fastify.addHook("onReady", async () => {
  const runBatchProcesses = async () => {
    try {
      await batchProcessService.processQueuedJobs();
    } catch (error) {
      fastify.log.error(error, "Unable to process queued batch jobs");
    }
  };

  await runBatchProcesses();
  batchProcessTimer = setInterval(runBatchProcesses, 30 * 1000);
});

fastify.addHook("onReady", async () => {
  const cleanupRecorderSessions = async () => {
    try {
      await aiAutomationBuilderService.cleanupOrphanRecorderSessions();
    } catch (error) {
      fastify.log.error(error, "Unable to clean up orphan recorder sessions");
    }
  };

  recorderCleanupTimer = setInterval(cleanupRecorderSessions, 60 * 1000);
});

fastify.addHook("onClose", async () => {
  if (scheduleProcessorTimer) {
    clearInterval(scheduleProcessorTimer);
    scheduleProcessorTimer = null;
  }

  if (aiGenerationProcessorTimer) {
    clearInterval(aiGenerationProcessorTimer);
    aiGenerationProcessorTimer = null;
  }

  if (projectSyncTimer) {
    clearInterval(projectSyncTimer);
    projectSyncTimer = null;
  }

  if (batchProcessTimer) {
    clearInterval(batchProcessTimer);
    batchProcessTimer = null;
  }

  if (recorderCleanupTimer) {
    clearInterval(recorderCleanupTimer);
    recorderCleanupTimer = null;
  }
});

module.exports = fastify;
