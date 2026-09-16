const crypto = require("crypto");
const db = require("../db");
const { config } = require("../config");
const { reapplyRuntimeSchema } = require("../db/bootstrap");
const authService = require("./auth.service");
const featureFlagService = require("./featureFlag.service");
const { hashPassword } = require("../utils/token");
const { isProduction, validateProductionSecret } = require("../security/runtimeSecrets");

const BOOTSTRAP_EMAIL = "bootstrap.admin@hellotest.local";
const LEGACY_SAMPLE_PASSWORD_HASHES = Object.freeze([
  "7752a0a257bd37b43d32b6e22132d60c6b065798e1ad9fb2c0ee68e65cac741c0e2e7dd599e3754f1de07e5b8c9038a8766f292a37fb0cf685b2020dd9339b02",
  "4297827f5aa1cb1aba10577e664dcf1f5744f67c70f410f63f30da5c7493cf2c9f4bde7a197bd216d3da83e40c153d73c6cdb4ddb54b584575c3a8d4cb4d17f9"
]);
const REQUIRED_TABLES = [
  "users", "roles", "permissions", "projects", "project_members", "app_types",
  "requirements", "test_suites", "test_cases", "test_steps", "executions",
  "execution_results", "feedback", "integrations", "app_settings", "admin_audit_log"
];



const createError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const recordAudit = async ({ actorId = null, action, targetType = null, targetId = null, summary, metadata = {}, ipAddress = null }) => {
  await db.prepare(`
    INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, summary, metadata, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), actorId, action, targetType, targetId, summary, metadata, ipAddress);
};

const retireLegacySampleCredentials = async () => {
  if (!isProduction()) return 0;

  const legacy = await db.prepare(`
    SELECT COUNT(*)::INTEGER AS count
    FROM users
    WHERE password_hash IN (${LEGACY_SAMPLE_PASSWORD_HASHES.map(() => "?").join(", ")})
      AND (
        id IN ('u1', 'u2')
        OR LOWER(email) IN ('admin@hellotest.ai', 'member@hellotest.ai')
      )
  `).get(...LEGACY_SAMPLE_PASSWORD_HASHES);
  if (Number(legacy?.count || 0) === 0) return 0;

  const retired = await db.prepare(`
    UPDATE users
    SET
      password_hash = ?,
      status = 'suspended',
      is_workspace_admin = FALSE,
      must_change_password = TRUE
    WHERE password_hash IN (${LEGACY_SAMPLE_PASSWORD_HASHES.map(() => "?").join(", ")})
      AND (
        id IN ('u1', 'u2')
        OR LOWER(email) IN ('admin@hellotest.ai', 'member@hellotest.ai')
      )
  `).run(
    hashPassword(crypto.randomBytes(32).toString("hex")),
    ...LEGACY_SAMPLE_PASSWORD_HASHES
  );

  if (retired.changes > 0) {
    await recordAudit({
      action: "security.sample_credentials_retired",
      targetType: "user",
      summary: "Disabled legacy sample accounts that still used published development credentials.",
      metadata: { retired_accounts: retired.changes }
    });
  }

  return retired.changes;
};

const getSchemaState = async () => {
  const rows = await db.prepare(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (${REQUIRED_TABLES.map(() => "?").join(", ")})
  `).all(...REQUIRED_TABLES);
  const available = new Set(rows.map((row) => row.table_name));
  const missing = REQUIRED_TABLES.filter((table) => !available.has(table));

  return {
    status: missing.length ? "attention" : "ready",
    required_tables: REQUIRED_TABLES.length,
    available_tables: available.size,
    missing_tables: missing
  };
};

exports.ensureAdminFoundation = async () => {
  await db.prepare("INSERT INTO roles (id, name) VALUES ('role-admin', 'admin') ON CONFLICT (name) DO NOTHING").run();
  await db.prepare("INSERT INTO roles (id, name) VALUES ('role-member', 'member') ON CONFLICT (name) DO NOTHING").run();

  const adminRole = await db.prepare("SELECT id FROM roles WHERE LOWER(name) = 'admin' LIMIT 1").get();
  await db.prepare(`
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT ?, permissions.id FROM permissions
    ON CONFLICT (role_id, permission_id) DO NOTHING
  `).run(adminRole.id);

  await retireLegacySampleCredentials();

  if (!config.adminPortal.bootstrapEnabled) {
    return;
  }

  if (isProduction()) {
    validateProductionSecret(config.adminPortal.bootstrapPassword, "ADMIN_BOOTSTRAP_PASSWORD", 16);
    if (String(config.adminPortal.bootstrapUsername).trim().toLowerCase() === "admin") {
      throw createError("ADMIN_BOOTSTRAP_USERNAME must not use the default 'admin' identity in production", 500);
    }
  }

  const existing = await db.prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?)").get(config.adminPortal.bootstrapUsername);
  if (existing) {
    return;
  }

  await db.prepare(`
    INSERT INTO users (
      id, email, username, password_hash, name, is_workspace_admin, default_role_id,
      auth_provider, email_verified, status, must_change_password
    ) VALUES (?, ?, ?, ?, ?, TRUE, ?, 'local', TRUE, 'active', TRUE)
  `).run(
    crypto.randomUUID(),
    BOOTSTRAP_EMAIL,
    config.adminPortal.bootstrapUsername,
    hashPassword(config.adminPortal.bootstrapPassword),
    "Bootstrap Administrator",
    adminRole.id
  );
};

exports.retireLegacySampleCredentials = retireLegacySampleCredentials;

exports.getPublicStatus = async () => {
  let databaseReady = false;
  let adminCount = 0;

  try {
    await db.prepare("SELECT 1 AS ok").get();
    databaseReady = true;
    const count = await db.prepare("SELECT COUNT(*)::INTEGER AS count FROM users WHERE is_workspace_admin = TRUE").get();
    adminCount = Number(count.count || 0);
  } catch {
    databaseReady = false;
  }

  return {
    service: "HelloTest Administration",
    status: databaseReady ? "ready" : "blocked",
    database_ready: databaseReady,
    admin_configured: adminCount > 0,
    bootstrap_login_enabled: config.adminPortal.bootstrapEnabled,
    dedicated_port: config.adminPortal.port
  };
};

exports.login = async ({ username, password }) => {
  const normalizedIdentity = String(username || "").trim().toLowerCase();
  const user = await db.prepare(`
    SELECT id, email
    FROM users
    WHERE LOWER(COALESCE(username, '')) = ? OR LOWER(email) = ?
    LIMIT 1
  `).get(normalizedIdentity, normalizedIdentity);

  if (!user) {
    throw createError("Invalid administrator credentials", 401);
  }

  // Authenticate once using the shared asynchronous password verifier, then use
  // the fresh session role to enforce access to the administration portal.
  const session = await authService.login({ email: user.email, password });
  if (session.user.role !== "admin") {
    throw createError("Workspace administrator access is required", 403);
  }

  await recordAudit({ actorId: user.id, action: "admin.login", targetType: "session", summary: "Administrator signed in to the control plane." });
  return session;
};

exports.getOverview = async () => {
  const [schema, users, projects, integrations, recentAudit, flags] = await Promise.all([
    getSchemaState(),
    db.prepare("SELECT COUNT(*)::INTEGER AS total, COUNT(*) FILTER (WHERE is_workspace_admin)::INTEGER AS admins, COUNT(*) FILTER (WHERE status = 'suspended')::INTEGER AS suspended FROM users").get(),
    db.prepare("SELECT COUNT(*)::INTEGER AS total FROM projects").get(),
    db.prepare("SELECT COUNT(*)::INTEGER AS total, COUNT(*) FILTER (WHERE is_active)::INTEGER AS active FROM integrations").get(),
    db.prepare("SELECT COUNT(*)::INTEGER AS total FROM admin_audit_log WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'").get(),
    featureFlagService.getSnapshot()
  ]);
  const enabledFlags = Object.values(flags.flags).filter(Boolean).length;

  return {
    status: schema.status === "ready" ? "operational" : "attention",
    schema,
    metrics: {
      users: Number(users.total || 0),
      administrators: Number(users.admins || 0),
      suspended_users: Number(users.suspended || 0),
      projects: Number(projects.total || 0),
      integrations: Number(integrations.total || 0),
      active_integrations: Number(integrations.active || 0),
      enabled_features: enabledFlags,
      total_features: Object.keys(flags.flags).length,
      admin_events_24h: Number(recentAudit.total || 0)
    },
    runtime: {
      app_mode: config.appMode,
      api_port: config.port,
      admin_port: config.adminPortal.port,
      storage_provider: config.storageProvider,
      queue_provider: config.queueProvider,
      observability_enabled: config.enableObservability
    }
  };
};

exports.getPerformanceIndexing = () => require("./performanceIndexing.service").status();
exports.startPerformanceIndexing = (actor) => require("./performanceIndexing.service").start(actor);
exports.stopPerformanceIndexing = () => require("./performanceIndexing.service").close();

exports.applySchema = async ({ actorId, ipAddress }) => {
  const roles = await reapplyRuntimeSchema();
  const schema = { ...await getSchemaState(), roles };
  await db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('admin_schema_setup', ?, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `).run({ applied_at: new Date().toISOString(), status: schema.status });
  await recordAudit({ actorId, action: "schema.apply", targetType: "database", summary: "Validated and applied the runtime database schema.", metadata: schema, ipAddress });
  return schema;
};

const ensureSampleWorkspace = async (actorId) => {
  const adminRole = await db.prepare("SELECT id FROM roles WHERE LOWER(name) = 'admin' LIMIT 1").get();
  if (!adminRole?.id) {
    throw createError("Admin role is missing. Apply the schema setup before installing sample data.", 409);
  }

  await db.prepare(`
    INSERT INTO projects (id, display_id, name, description, visibility, created_by)
    VALUES ('sample-project', 'DEMO', 'HelloTest Launchpad', 'A guided workspace populated from Administration.', 'private', ?)
    ON CONFLICT (id) DO NOTHING
  `).run(actorId);
  await db.prepare(`
    UPDATE projects
    SET created_by = COALESCE(created_by, ?)
    WHERE id = 'sample-project'
  `).run(actorId);

  const administrators = await db.prepare(`
    SELECT DISTINCT users.id
    FROM users
    WHERE users.id = ?
       OR (
         COALESCE(users.status, 'active') <> 'suspended'
         AND COALESCE(users.is_workspace_admin, FALSE) = TRUE
       )
    ORDER BY users.id
  `).all(actorId);

  for (const administrator of administrators) {
    await db.prepare(`
      INSERT INTO project_members (id, project_id, user_id, role_id)
      VALUES (?, 'sample-project', ?, ?)
      ON CONFLICT (project_id, user_id)
      DO UPDATE SET role_id = EXCLUDED.role_id
    `).run(crypto.randomUUID(), administrator.id, adminRole.id);
  }

  for (const app of [
    ["sample-app-web", "Customer Portal", "web", false],
    ["sample-app-api", "Commerce API", "api", false],
    ["sample-app-mobile", "Mobile Experience", "unified", true]
  ]) {
    await db.prepare(`
      INSERT INTO app_types (id, project_id, name, type, is_unified)
      VALUES (?, 'sample-project', ?, ?, ?)
      ON CONFLICT (id) DO NOTHING
    `).run(...app);
  }

  return administrators.length;
};

exports.getSampleCatalog = () => require("./sampleData").getCatalog();

exports.seedSampleData = ({ modules, actorId, ipAddress }) => require("./sampleData").install({
  requestedModules: modules, actorId, ipAddress, ensureWorkspace: ensureSampleWorkspace, recordAudit
});

exports.listAudit = async ({ limit = 50 } = {}) => {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  return db.prepare(`
    SELECT admin_audit_log.*, users.name AS actor_name, users.email AS actor_email
    FROM admin_audit_log
    LEFT JOIN users ON users.id = admin_audit_log.actor_id
    ORDER BY admin_audit_log.created_at DESC
    LIMIT ?
  `).all(safeLimit);
};

exports.recordAudit = recordAudit;
