const crypto = require("crypto");
const db = require("../db");
const { config } = require("../config");
const { reapplyRuntimeSchema } = require("../db/bootstrap");
const authService = require("./auth.service");
const featureFlagService = require("./featureFlag.service");
const { hashPassword, verifyPassword } = require("../utils/token");

const BOOTSTRAP_EMAIL = "bootstrap.admin@hellotest.local";
const REQUIRED_TABLES = [
  "users", "roles", "permissions", "projects", "project_members", "app_types",
  "requirements", "test_suites", "test_cases", "test_steps", "executions",
  "execution_results", "feedback", "integrations", "app_settings", "admin_audit_log"
];

const SAMPLE_MODULES = [
  { key: "workspace", label: "Workspace", description: "A launch-ready sample project and Web, API, and Mobile application scopes.", tables: ["projects", "app_types"] },
  { key: "design", label: "Design", description: "Requirements, a test module, suites, test cases, and reusable execution steps.", tables: ["requirements", "test_case_modules", "test_suites", "test_cases", "test_steps"] },
  { key: "environments", label: "Environments", description: "A staging environment, browser configuration, and representative test data.", tables: ["test_environments", "test_configurations", "test_data_sets"] },
  { key: "execution", label: "Execution", description: "A completed smoke run with a passing result for dashboard validation.", tables: ["executions", "execution_results"] },
  { key: "issues", label: "Issues", description: "A realistic open quality issue linked to the sample project.", tables: ["feedback"] }
];

const createError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const recordAudit = async ({ actorId = null, action, targetType = null, targetId = null, summary, metadata = {}, ipAddress = null }) => {
  await db.prepare(`
    INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, summary, metadata, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), actorId, action, targetType, targetId, summary, metadata, ipAddress);
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

  if (!config.adminPortal.bootstrapEnabled) {
    return;
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
    SELECT id, email, password_hash, status, is_workspace_admin
    FROM users
    WHERE LOWER(COALESCE(username, '')) = ? OR LOWER(email) = ?
    LIMIT 1
  `).get(normalizedIdentity, normalizedIdentity);

  if (!user || !verifyPassword(password, user.password_hash)) {
    throw createError("Invalid administrator credentials", 401);
  }
  if (user.status === "suspended") {
    throw createError("This administrator account is suspended", 403);
  }
  if (!user.is_workspace_admin) {
    throw createError("Workspace administrator access is required", 403);
  }

  const session = await authService.login({ email: user.email, password });
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

exports.applySchema = async ({ actorId, ipAddress }) => {
  await reapplyRuntimeSchema();
  const schema = await getSchemaState();
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
    LEFT JOIN roles ON roles.id = users.default_role_id
    WHERE users.id = ?
       OR (
         COALESCE(users.status, 'active') <> 'suspended'
         AND (
           COALESCE(users.is_workspace_admin, FALSE) = TRUE
           OR LOWER(COALESCE(roles.name, '')) = 'admin'
         )
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

const seedDesign = async (actorId) => {
  for (const requirement of [
    ["sample-req-auth", "DEMO-R1", "Secure customer sign-in", "Customers can sign in with verified credentials."],
    ["sample-req-checkout", "DEMO-R2", "Reliable checkout", "Customers can complete checkout with clear recovery paths."],
    ["sample-req-accessibility", "DEMO-R3", "Accessible core journeys", "Core journeys meet WCAG interaction expectations."]
  ]) {
    await db.prepare(`
      INSERT INTO requirements (id, display_id, project_id, title, description, priority, status, created_by)
      VALUES (?, ?, 'sample-project', ?, ?, 1, 'ready', ?)
      ON CONFLICT (id) DO NOTHING
    `).run(...requirement, actorId);
  }
  await db.prepare(`INSERT INTO test_case_modules (id, display_id, app_type_id, name, description, created_by) VALUES ('sample-module-smoke', 'DEMO-M1', 'sample-app-web', 'Release smoke', 'Critical customer journeys.', ?) ON CONFLICT (id) DO NOTHING`).run(actorId);
  await db.prepare(`INSERT INTO test_suites (id, display_id, app_type_id, name, labels, created_by) VALUES ('sample-suite-smoke', 'DEMO-S1', 'sample-app-web', 'Release smoke suite', '["smoke","release"]'::jsonb, ?) ON CONFLICT (id) DO NOTHING`).run(actorId);
  const cases = [
    ["sample-case-login", "DEMO-T1", "Customer signs in", "sample-req-auth", "yes"],
    ["sample-case-checkout", "DEMO-T2", "Customer completes checkout", "sample-req-checkout", "no"],
    ["sample-case-keyboard", "DEMO-T3", "Checkout supports keyboard navigation", "sample-req-accessibility", "no"]
  ];
  for (const item of cases) {
    await db.prepare(`
      INSERT INTO test_cases (id, display_id, app_type_id, suite_id, title, description, automated, automation_status, requirement_id, status)
      VALUES (?, ?, 'sample-app-web', 'sample-suite-smoke', ?, 'Generated sample coverage.', ?, CASE WHEN ? = 'yes' THEN 'ready' ELSE 'not_automated' END, ?, 'active')
      ON CONFLICT (id) DO NOTHING
    `).run(item[0], item[1], item[2], item[4], item[4], item[3]);
    await db.prepare(`INSERT INTO test_case_module_cases (module_id, test_case_id, sort_order) VALUES ('sample-module-smoke', ?, 1) ON CONFLICT DO NOTHING`).run(item[0]);
    await db.prepare(`INSERT INTO suite_test_cases (suite_id, test_case_id, sort_order) VALUES ('sample-suite-smoke', ?, 1) ON CONFLICT DO NOTHING`).run(item[0]);
  }
  await db.prepare(`INSERT INTO test_steps (id, test_case_id, step_order, action, expected_result, step_type) VALUES ('sample-step-login-1', 'sample-case-login', 1, 'Open the sign-in page and submit valid credentials.', 'The customer dashboard opens.', 'web') ON CONFLICT (id) DO NOTHING`).run();
};

const seedEnvironments = async () => {
  await db.prepare(`INSERT INTO test_data_sets (id, project_id, app_type_id, name, description, mode, columns, rows) VALUES ('sample-data-customers', 'sample-project', 'sample-app-web', 'Customer personas', 'Safe synthetic launch data.', 'table', '["email","segment"]'::jsonb, '[{"email":"alex@example.test","segment":"standard"}]'::jsonb) ON CONFLICT (id) DO NOTHING`).run();
  await db.prepare(`INSERT INTO test_environments (id, project_id, app_type_id, name, description, base_url, browser, variables) VALUES ('sample-env-staging', 'sample-project', 'sample-app-web', 'Staging', 'Pre-production validation environment.', 'https://staging.example.test', 'Chrome', '[{"key":"REGION","value":"us-east"}]'::jsonb) ON CONFLICT (id) DO NOTHING`).run();
  await db.prepare(`INSERT INTO test_configurations (id, project_id, app_type_id, name, description, browser, variables) VALUES ('sample-config-chrome', 'sample-project', 'sample-app-web', 'Chrome desktop', 'Primary release browser.', 'Chrome', '[]'::jsonb) ON CONFLICT (id) DO NOTHING`).run();
};

const seedExecution = async (actorId) => {
  await db.prepare(`INSERT INTO executions (id, project_id, app_type_id, name, trigger, status, execution_mode, duration_ms, created_by) VALUES ('sample-run-smoke', 'sample-project', 'sample-app-web', 'Launch readiness smoke', 'manual', 'completed', 'remote', 1840, ?) ON CONFLICT (id) DO NOTHING`).run(actorId);
  await db.prepare(`INSERT INTO execution_results (id, execution_id, test_case_id, test_case_title, suite_id, suite_name, app_type_id, status, duration_ms, executed_by) VALUES ('sample-result-login', 'sample-run-smoke', 'sample-case-login', 'Customer signs in', 'sample-suite-smoke', 'Release smoke suite', 'sample-app-web', 'passed', 1840, ?) ON CONFLICT (id) DO NOTHING`).run(actorId);
};

const seedIssues = async (actorId) => {
  await db.prepare(`INSERT INTO feedback (id, display_id, project_id, user_id, title, message, severity, priority, environment, status) VALUES ('sample-issue-checkout', 'DEMO-B1', 'sample-project', ?, 'Checkout focus indicator is unclear', 'Keyboard focus is difficult to see on the payment action.', 'medium', 'medium', 'Staging / Chrome', 'open') ON CONFLICT (id) DO NOTHING`).run(actorId);
};

exports.getSampleCatalog = async () => {
  const project = await db.prepare("SELECT id FROM projects WHERE id = 'sample-project'").get();
  return { project_id: project?.id || null, modules: SAMPLE_MODULES };
};

exports.seedSampleData = async ({ modules, actorId, ipAddress }) => {
  const selected = [...new Set((Array.isArray(modules) && modules.length ? modules : SAMPLE_MODULES.map((item) => item.key)).map(String))];
  const invalid = selected.filter((key) => !SAMPLE_MODULES.some((module) => module.key === key));
  if (invalid.length) throw createError(`Unknown sample modules: ${invalid.join(", ")}`, 400);

  let administratorMemberships = 0;
  await db.transaction(async () => {
    administratorMemberships = await ensureSampleWorkspace(actorId);
    if (selected.includes("design") || selected.includes("execution")) await seedDesign(actorId);
    if (selected.includes("environments")) await seedEnvironments();
    if (selected.includes("execution")) await seedExecution(actorId);
    if (selected.includes("issues")) await seedIssues(actorId);
  })();

  await recordAudit({ actorId, action: "sample_data.seed", targetType: "project", targetId: "sample-project", summary: `Installed sample data for ${selected.length} module${selected.length === 1 ? "" : "s"}.`, metadata: { modules: selected, administrator_memberships: administratorMemberships }, ipAddress });
  return { installed: selected, project_id: "sample-project", administrator_memberships: administratorMemberships, idempotent: true };
};

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
