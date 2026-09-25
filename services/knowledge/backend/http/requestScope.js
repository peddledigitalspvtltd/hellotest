const appTypeService = require("@hellotest/platform/backend/public/applicationAccess");
const projectService = require("@hellotest/platform/backend/public/projectAccess");
const execution = require("../services/knowledgeExecution.service");
const { publicKnowledgeError } = require("@hellotest/platform/backend/src/utils/knowledgeAssistantErrors");


const parseJsonField = (value, fallback) => {
  if (!value) return fallback;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const validateAppTypeScope = async (projectId, appTypeId) => {
  if (!appTypeId) return;
  const appType = await appTypeService.getAppType(appTypeId);
  if (appType.project_id !== projectId) {
    const error = new Error("Selected app type must belong to the current project.");
    error.statusCode = 403;
    throw error;
  }
};

const getIdempotencyKey = (req) => {
  const value = String(req.headers["idempotency-key"] || "").trim();
  if (value && !/^[A-Za-z0-9._:-]{8,255}$/.test(value)) {
    const error = new Error("Idempotency-Key must be 8-255 characters using letters, numbers, dot, underscore, colon, or hyphen.");
    error.statusCode = 400;
    throw error;
  }
  return value || null;
};

const prepareKnowledgeRequest = async (req, reply, task) => {
  const controller = new AbortController();
  const disconnect = () => controller.abort();
  req.raw.once("aborted", disconnect);
  reply.raw.once("close", disconnect);
  if (req.raw.aborted || reply.raw.destroyed) controller.abort();
  try {
    return await execution.bounded(async () => {
      execution.assertActive();
      const input = await task();
      execution.assertActive();
      return input;
    }, { timeoutMs: 5_000, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw execution.abortError();
    if (error.code === "DEADLINE_EXCEEDED") {
      const code = "ASSISTANT_SETUP_TIMEOUT";
      const message = publicKnowledgeError({ code });
      throw Object.assign(new Error(message), { code, statusCode: 503, publicMessage: message });
    }
    throw error;
  } finally {
    req.raw.removeListener("aborted", disconnect);
    reply.raw.removeListener("close", disconnect);
  }
};

const createProjectAccess = (fastify) => {
const ensureProjectAccess = async (req, projectId, permissionCode, checkActive = () => {}) => {
    checkActive();
    await projectService.getProject(projectId, req.user.id);
    checkActive();
    await fastify.requirePermission(permissionCode, { projectId })(req);
    checkActive();
  };
return ensureProjectAccess;
};
module.exports = { parseJsonField, validateAppTypeScope, getIdempotencyKey, prepareKnowledgeRequest, createProjectAccess };
