const crypto = require("crypto");
const { v4: uuid } = require("uuid");
const db = require("../db");

const API_KEY_PREFIX = "qaira_";
const API_KEY_BYTES = 32;

const API_KEY_SCOPES = [
  {
    value: "user",
    label: "User access",
    description: "Default. Uses the current user's normal permissions for every mapped API."
  },
  {
    value: "read",
    label: "Read only",
    description: "Allows GET and HEAD requests only, still limited by the user's access."
  },
  {
    value: "design",
    label: "Design",
    description: "Requirements, test cases, suites, shared steps, and test data APIs."
  },
  {
    value: "automation",
    label: "Automation",
    description: "Automation build, object repository, recorder, and workflow APIs."
  },
  {
    value: "runs",
    label: "Runs",
    description: "Execution, schedules, results, reports, and issue APIs."
  },
  {
    value: "environment",
    label: "Environment",
    description: "Test environments, configurations, app types, and data sets."
  },
  {
    value: "integrations",
    label: "Integrations",
    description: "Integrations, AI knowledge, and prompt template APIs."
  },
  {
    value: "admin",
    label: "Admin",
    description: "Users, roles, project members, workspace settings, and ops APIs."
  }
];

const API_KEY_SCOPE_VALUES = new Set(API_KEY_SCOPES.map((scope) => scope.value));

const READ_METHODS = new Set(["GET", "HEAD"]);
const COMMON_READ_PERMISSIONS = new Set(["workspace.view", "project.view", "app_type.view"]);

const SCOPE_RULES = {
  design: {
    prefixes: ["requirement.", "testcase.", "step.", "shared_step.", "suite.", "data."],
    readPermissions: COMMON_READ_PERMISSIONS
  },
  automation: {
    prefixes: ["automation.", "agentic_workflow."],
    readPermissions: new Set([...COMMON_READ_PERMISSIONS, "testcase.view"])
  },
  runs: {
    prefixes: ["run.", "result.", "schedule.", "feedback."],
    readPermissions: new Set([...COMMON_READ_PERMISSIONS, "testcase.view", "suite.view"])
  },
  environment: {
    prefixes: ["environment.", "configuration.", "data.", "app_type."],
    readPermissions: new Set(["workspace.view", "project.view"])
  },
  integrations: {
    prefixes: ["integration.", "knowledge.", "prompt_template."],
    readPermissions: COMMON_READ_PERMISSIONS
  },
  admin: {
    prefixes: ["user.", "role.", "project_member.", "integration.", "transaction.", "ops."],
    exact: new Set(["workspace.view", "settings.manage", "project.view", "project.create", "project.update", "project.delete", "project.sync"])
  }
};

const normalizeText = (value) => String(value || "").trim();

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const hashApiKey = (value) => crypto.createHash("sha256").update(value).digest("hex");

const generateApiKey = () => `${API_KEY_PREFIX}${crypto.randomBytes(API_KEY_BYTES).toString("base64url")}`;

const normalizeScope = (scope) => {
  const normalized = normalizeText(scope).toLowerCase();
  return API_KEY_SCOPE_VALUES.has(normalized) ? normalized : "user";
};

const normalizeName = (name) => {
  const normalized = normalizeText(name);

  if (normalized.length < 2) {
    throw createError("API key name must be at least 2 characters.", 400);
  }

  if (normalized.length > 80) {
    throw createError("API key name must be 80 characters or fewer.", 400);
  }

  return normalized;
};

const serializeApiKey = (row) => {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    key_prefix: row.key_prefix,
    scope: row.scope,
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at
  };
};

const getHeaderValue = (value) => {
  if (Array.isArray(value)) {
    return normalizeText(value[0]);
  }

  return normalizeText(value);
};

const extractApiKeyFromRequest = (req) => {
  const explicitHeader = getHeaderValue(req.headers["x-api-key"]);

  if (explicitHeader) {
    return explicitHeader;
  }

  const authorization = getHeaderValue(req.headers.authorization);

  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  const token = authorization.slice("Bearer ".length).trim();
  return token.startsWith(API_KEY_PREFIX) ? token : "";
};

const isApiKeyToken = (value) => normalizeText(value).startsWith(API_KEY_PREFIX);

const listApiKeys = async (userId) => {
  const rows = await db.prepare(`
    SELECT id, name, key_prefix, scope, is_active, created_at, last_used_at, revoked_at
    FROM user_api_keys
    WHERE user_id = ?
    ORDER BY created_at DESC, id ASC
  `).all(userId);

  return rows.map(serializeApiKey);
};

const createApiKey = async ({ user_id, name, scope }) => {
  if (!user_id) {
    throw createError("User is required.", 400);
  }

  const apiKey = generateApiKey();
  const id = uuid();
  const keyHash = hashApiKey(apiKey);
  const keyPrefix = `${apiKey.slice(0, 14)}...`;
  const normalizedScope = normalizeScope(scope);
  const normalizedName = normalizeName(name);

  const row = await db.prepare(`
    INSERT INTO user_api_keys (id, user_id, name, key_hash, key_prefix, scope, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING id, name, key_prefix, scope, is_active, created_at, last_used_at, revoked_at
  `).get(id, user_id, normalizedName, keyHash, keyPrefix, normalizedScope);

  return {
    key: apiKey,
    api_key: serializeApiKey(row),
    authorization_header: `Bearer ${apiKey}`,
    x_api_key_header: apiKey
  };
};

const revokeApiKey = async ({ user_id, id }) => {
  if (!user_id || !id) {
    throw createError("API key id is required.", 400);
  }

  const result = await db.prepare(`
    UPDATE user_api_keys
    SET is_active = FALSE,
        revoked_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND user_id = ?
      AND is_active = TRUE
    RETURNING id, name, key_prefix, scope, is_active, created_at, last_used_at, revoked_at
  `).get(id, user_id);

  if (!result) {
    throw createError("API key not found.", 404);
  }

  return {
    revoked: true,
    api_key: serializeApiKey(result)
  };
};

const verifyApiKey = async (apiKey) => {
  const normalized = normalizeText(apiKey);

  if (!isApiKeyToken(normalized)) {
    return null;
  }

  const row = await db.prepare(`
    SELECT id, user_id, name, key_prefix, scope, is_active, created_at, last_used_at, revoked_at
    FROM user_api_keys
    WHERE key_hash = ?
      AND is_active = TRUE
      AND revoked_at IS NULL
  `).get(hashApiKey(normalized));

  if (!row) {
    return null;
  }

  await db.prepare(`
    UPDATE user_api_keys
    SET last_used_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(row.id);

  return {
    ...serializeApiKey(row),
    user_id: row.user_id
  };
};

const isScopeAllowed = (scope, permissionCode, method) => {
  const normalizedScope = normalizeScope(scope);
  const normalizedPermission = normalizeText(permissionCode);
  const normalizedMethod = normalizeText(method).toUpperCase();

  if (!normalizedPermission) {
    return false;
  }

  if (normalizedScope === "user") {
    return true;
  }

  if (normalizedScope === "read") {
    return READ_METHODS.has(normalizedMethod);
  }

  const rule = SCOPE_RULES[normalizedScope];

  if (!rule) {
    return false;
  }

  if (rule.exact?.has(normalizedPermission)) {
    return true;
  }

  if (READ_METHODS.has(normalizedMethod) && rule.readPermissions?.has(normalizedPermission)) {
    return true;
  }

  return rule.prefixes?.some((prefix) => normalizedPermission.startsWith(prefix)) || false;
};

module.exports = {
  API_KEY_PREFIX,
  API_KEY_SCOPES,
  createApiKey,
  extractApiKeyFromRequest,
  isApiKeyToken,
  isScopeAllowed,
  listApiKeys,
  revokeApiKey,
  verifyApiKey
};
