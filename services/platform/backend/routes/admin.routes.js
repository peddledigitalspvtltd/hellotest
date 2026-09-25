const db = require("../src/db");
const projectService = require("../services/project.service");
const attachmentService = require("../services/attachment.service");
const apiPackage = require("../package.json");
const { aggregateStatus, runtimeHealthService } = require("../src/services/runtimeHealth.service");

module.exports = async function (fastify) {
  fastify.get("/admin/health", async (req) => {
    await fastify.authenticate(req);
    await fastify.requirePermission("ops.view", { projectId: req.query.project_id || undefined })(req);
    const project = req.query.project_id ? await projectService.getProject(req.query.project_id, req.user.id) : null;
    const runtimeSnapshot = await runtimeHealthService.runChecks({ includeOptional: true });
    const checks = [...runtimeSnapshot.checks];

    const requiredTables = ["projects", "requirements", "test_cases", "test_suites", "executions", "execution_results", "feedback", "attachments", "entity_comments", "quality_dashboards"];
    const schemaRows = await db.prepare(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (${requiredTables.map(() => "?").join(",")})`).all(...requiredTables).catch(() => []);
    const availableTables = new Set(schemaRows.map((row) => row.table_name));
    const missingTables = requiredTables.filter((table) => !availableTables.has(table));
    checks.push({ key: "schema", label: "HelloTest schema", status: missingTables.length ? "blocked" : "ready", summary: missingTables.length ? `${missingTables.length} required table${missingTables.length === 1 ? " is" : "s are"} missing.` : "Core HelloTest tables are present.", detail: missingTables.length ? `Missing: ${missingTables.join(", ")}` : `${requiredTables.length} core tables verified.`, remediation: missingTables.length ? "Run the API runtime schema bootstrap against the configured database." : null, metrics: { required_tables: requiredTables.length, available_tables: availableTables.size, missing_tables: missingTables.length } });

    const attachmentMeta = attachmentService.meta();
    const storageStatus = checks.find((check) => check.key === "storage")?.status || "degraded";
    checks.push({ key: "attachments", label: "Attachment service", critical: false, status: attachmentMeta.enabled ? storageStatus : "degraded", summary: attachmentMeta.enabled ? "Upload, download, and deletion contracts follow the storage health state." : "Record evidence remains available without binary attachments.", detail: `Provider: ${attachmentMeta.provider}; upload limit: ${attachmentMeta.uploadLimit} bytes.`, remediation: attachmentMeta.enabled ? null : "Enable object storage when binary evidence is required.", metrics: { enabled: attachmentMeta.enabled, provider: attachmentMeta.provider, upload_limit_bytes: attachmentMeta.uploadLimit } });

    const permissionCount = await db.prepare("SELECT COUNT(*)::INTEGER AS count FROM permissions").get().catch(() => ({ count: 0 }));
    checks.push({ key: "permissions", label: "Access control", status: Number(permissionCount.count) > 0 ? "ready" : "blocked", summary: Number(permissionCount.count) > 0 ? "Role and permission catalog is loaded." : "Permission catalog is empty.", detail: `${Number(permissionCount.count || 0)} permission definitions available.`, remediation: Number(permissionCount.count) > 0 ? null : "Rerun schema bootstrap to seed the permission catalog.", metrics: { permission_definitions: Number(permissionCount.count || 0), project_scoped: Boolean(project), project_id: project?.id || null } });

    const status = aggregateStatus(checks);
    return { status, checked_at: new Date().toISOString(), version: apiPackage.version, checks };
  });
};
