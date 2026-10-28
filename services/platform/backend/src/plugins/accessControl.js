const crypto = require("crypto");
const fp = require("fastify-plugin");
const db = require("../db");
const permissionService = require("@hellotest/platform/backend/services/permission.service");
const apiKeyService = require("@hellotest/platform/backend/services/apiKey.service");
const featureFlagService = require("@hellotest/platform/backend/services/featureFlag.service");
const { ROUTE_PERMISSIONS } = require("../security/permissions.catalog");
const { resolveTestEngineSecret } = require("../security/runtimeSecrets");
const { verifyToken } = require("../utils/token");

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
    SELECT id, email, name, avatar_data_url, auth_provider, email_verified, status, created_at, is_workspace_admin
    FROM users
    WHERE id = ?
  `).get(id);

  if (!user) {
    return null;
  }

  const { is_workspace_admin, ...rest } = user;

  return {
    ...rest,
    role: is_workspace_admin ? "admin" : "member"
  };
};

const getBearerToken = (headers) => {
  const value = typeof headers.authorization === "string" ? headers.authorization : "";

  if (!value.startsWith("Bearer ")) {
    return "";
  }

  return value.slice("Bearer ".length).trim();
};

const getRouteUrl = (req) => req.routeOptions?.url || req.routerPath || "";

const getRoutePermissionCode = (req) => {
  const routeUrl = getRouteUrl(req);

  if (!routeUrl) {
    return "";
  }

  const method = String(req.method || "").toUpperCase();
  return ROUTE_PERMISSIONS.get(`${method === "HEAD" ? "GET" : method} ${routeUrl}`) || "";
};

const enforceApiKeyScope = (req) => {
  if (!req.apiKey) {
    return;
  }

  const routeUrl = getRouteUrl(req);

  if (routeUrl.startsWith("/settings/api-keys")) {
    throw createError("API key management requires a signed-in browser session.", 403);
  }

  const permissionCode = getRoutePermissionCode(req);

  if (!apiKeyService.isScopeAllowed(req.apiKey.scope, permissionCode, req.method)) {
    throw createError("API key scope does not allow this endpoint.", 403);
  }
};

const enforceApiKeyPermissionScope = (req, permissionCode) => {
  if (!req.apiKey) return;
  if (!apiKeyService.isScopeAllowed(req.apiKey.scope, permissionCode, req.method)) {
    throw createError(`API key scope does not allow permission: ${permissionCode}`, 403);
  }
};

const enforceFeatureFlagAccess = async (req, permissionCode) => {
  // Revoking feature availability must not prevent an authorized operator from
  // stopping work already in flight. Authentication, project grants and API-key
  // scopes are still checked before reaching this narrow cleanup exception.
  if (permissionCode === "agentic_workflow.run" && String(req.method).toUpperCase() === "POST" && [
    "/repository-agents/runs/:id/cancel",
    "/agentic-workflow-runs/:id/cancel"
  ].includes(getRouteUrl(req))) return;

  const featureKeys = [...new Set([
    ...featureFlagService.getFeatureKeysForPermission(permissionCode),
    ...featureFlagService.getFeatureKeysForRoute(req.method, getRouteUrl(req))
  ])];

  if (!featureKeys.length) {
    return;
  }

  const allowed = await featureFlagService.areEnabled(featureKeys, { user: req.user });

  if (!allowed) {
    throw Object.assign(createError("This feature is disabled for the workspace.", 403), { code: "FEATURE_DISABLED" });
  }
};

async function accessControlPlugin(fastify) {
  fastify.decorateRequest("user", null);
  fastify.decorateRequest("apiKey", null);
  fastify.decorateRequest("authMethod", null);

  fastify.decorate("authenticate", async (req) => {
    if (req.user) {
      enforceApiKeyScope(req);
      return;
    }

    const providedApiKey = apiKeyService.extractApiKeyFromRequest(req);

    if (providedApiKey) {
      const apiKey = await apiKeyService.verifyApiKey(providedApiKey);

      if (!apiKey) {
        throw createError("Invalid API key", 401);
      }

      const user = await getCurrentUser(apiKey.user_id);

      if (!user) {
        throw createError("User not found", 404);
      }

      if (user.status === "suspended") {
        throw createError("This account is suspended", 403);
      }

      if (!await featureFlagService.areEnabled(["hellotest.api.keys"], { user })) {
        throw Object.assign(createError("API key access is disabled for the workspace.", 403), { code: "FEATURE_DISABLED" });
      }

      req.user = user;
      req.apiKey = apiKey;
      req.authMethod = "api_key";
      enforceApiKeyScope(req);
      return;
    }

    const bearerToken = getBearerToken(req.headers);

    if (!bearerToken) {
      throw createError("Missing bearer token", 401);
    }

    let payload;

    try {
      payload = verifyToken(bearerToken);
    } catch (error) {
      throw createError(error.message || "Invalid token", 401);
    }

    const user = await getCurrentUser(payload.sub);

    if (!user) {
      throw createError("User not found", 404);
    }

    if (user.status === "suspended") {
      throw createError("This account is suspended", 403);
    }

    req.user = user;
    req.authMethod = "session";
  });

  fastify.decorate("requireAdmin", async (req) => {
    await fastify.authenticate(req);

    if (req.user.role !== "admin") {
      throw createError("Admin access required", 403);
    }
  });

  fastify.decorate("requirePermission", (permissionCode, options = {}) => async (req) => {
    await fastify.authenticate(req);
    enforceApiKeyPermissionScope(req, permissionCode);

    let projectId = typeof options.projectId === "function"
      ? await options.projectId(req)
      : options.projectId || req.params?.project_id || req.params?.projectId || req.body?.project_id || req.query?.project_id || null;

    if (!projectId) {
      const appTypeId = req.params?.app_type_id
        || req.params?.appTypeId
        || req.body?.app_type_id
        || req.query?.app_type_id
        || null;
      if (appTypeId) {
        const appType = await db.prepare("SELECT project_id FROM app_types WHERE id = ?").get(appTypeId);
        if (!appType?.project_id) throw createError("Application scope was not found.", 404);
        projectId = appType?.project_id || null;
      }
    }

    const allowed = await permissionService.hasPermission(req.user, permissionCode, projectId);

    if (!allowed) {
      throw createError(`Permission required: ${permissionCode}`, 403);
    }

    await enforceFeatureFlagAccess(req, permissionCode);

    const method = String(req.method || "GET").toUpperCase();
    const isDeletionRequest = method === "DELETE" && getRouteUrl(req) === "/projects/:id";
    if (projectId && !["GET", "HEAD", "OPTIONS"].includes(method) && !isDeletionRequest) {
      const deletion = await db.prepare(`
        SELECT EXISTS (
          SELECT 1 FROM project_deletion_jobs
          WHERE project_id = ? AND status IN ('queued', 'running', 'cleanup')
        ) AS active
      `).get(projectId);
      if (deletion?.active) {
        throw Object.assign(createError("This project is being deleted. Changes are temporarily unavailable.", 409), {
          code: "PROJECT_DELETING"
        });
      }
    }
  });

  fastify.addHook("onRoute", (routeOptions) => {
    const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
    const url = routeOptions.url;

    for (const method of methods) {
      const normalizedMethod = String(method).toUpperCase();
      const permissionCode = ROUTE_PERMISSIONS.get(`${normalizedMethod === "HEAD" ? "GET" : normalizedMethod} ${url}`);

      if (!permissionCode) {
        continue;
      }

      // Project deletion keeps its own durable requester authorization after
      // project memberships disappear. Its service invokes the normal scoped
      // guard while the project exists; a global grant would block cleanup
      // retries for someone whose only project has just been deleted.
      if ((normalizedMethod === "DELETE" && url === "/projects/:id")
        || (["GET", "HEAD"].includes(normalizedMethod) && url === "/projects/:id/deletion")) {
        continue;
      }

      const existingPreHandlers = routeOptions.preHandler
        ? Array.isArray(routeOptions.preHandler)
          ? routeOptions.preHandler
          : [routeOptions.preHandler]
        : [];

      const permissionHandler = async (req) => {
        if (permissionCode === "user.manage" && String(method).toUpperCase() === "PUT" && url === "/users/:id") {
          await fastify.authenticate(req);

          if (req.user?.id === req.params?.id) {
            return;
          }
        }

        await fastify.requirePermission(permissionCode)(req);
      };

      routeOptions.preHandler = [
        ...existingPreHandlers,
        permissionHandler
      ];
    }
  });

  fastify.decorate("authenticateTestEngine", async (req) => {
    const provided =
      req.headers["x-hellotest-testengine-secret"]
      || req.headers["x-testengine-secret"]
      || (typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ")
        ? req.headers.authorization.slice("Bearer ".length)
        : "");
    const expected = resolveTestEngineSecret();

    if (!engineSecretMatches(provided, expected)) {
      throw createError("Test Engine authentication failed", 401);
    }
  });
}

module.exports = fp(accessControlPlugin, {
  name: "hellotest-access-control"
});
