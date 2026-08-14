const db = require("../db");
const projectService = require("../services/project.service");
const attachmentService = require("../services/attachment.service");
const objectStorage = require("../services/objectStorage.service");
const apiPackage = require("../../package.json");

module.exports = async function (fastify) {
  fastify.get("/admin/health", async (req) => {
    await fastify.authenticate(req);
    await fastify.requirePermission("ops.view", { projectId: req.query.project_id || undefined })(req);
    const project = req.query.project_id ? await projectService.getProject(req.query.project_id, req.user.id) : null;
    const checks = [];

    try {
      const database = await db.prepare("SELECT CURRENT_TIMESTAMP AS checked_at").get();
      checks.push({ key: "registry", label: "HelloTest database", status: "ready", summary: "PostgreSQL is accepting authenticated queries.", detail: `Database checked at ${database.checked_at}.`, remediation: null });
    } catch (error) {
      checks.push({ key: "registry", label: "HelloTest database", status: "blocked", summary: "PostgreSQL is unavailable.", detail: error.message, remediation: "Restore the configured PostgreSQL service and rerun the health check." });
    }

    const requiredTables = ["projects", "requirements", "test_cases", "test_suites", "executions", "execution_results", "feedback", "attachments", "entity_comments", "quality_dashboards"];
    const schemaRows = await db.prepare(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (${requiredTables.map(() => "?").join(",")})`).all(...requiredTables).catch(() => []);
    const availableTables = new Set(schemaRows.map((row) => row.table_name));
    const missingTables = requiredTables.filter((table) => !availableTables.has(table));
    checks.push({ key: "schema", label: "HelloTest schema", status: missingTables.length ? "blocked" : "ready", summary: missingTables.length ? `${missingTables.length} required table${missingTables.length === 1 ? " is" : "s are"} missing.` : "Core HelloTest tables are present.", detail: missingTables.length ? `Missing: ${missingTables.join(", ")}` : `${requiredTables.length} core tables verified.`, remediation: missingTables.length ? "Run the API runtime schema bootstrap against the configured database." : null, metrics: { required_tables: requiredTables.length, available_tables: availableTables.size, missing_tables: missingTables.length } });

    const attachmentMeta = attachmentService.meta();
    let storageStatus = attachmentMeta.enabled ? "ready" : "degraded";
    let storageDetail = attachmentMeta.enabled ? "Object storage is configured." : "Object storage is disabled.";
    if (attachmentMeta.enabled) {
      try { const bucket = await objectStorage.ensureBucket(); storageDetail = `Object storage bucket ${bucket} is reachable.`; }
      catch (error) { storageStatus = "blocked"; storageDetail = error.message; }
    }
    checks.push({ key: "storage", label: "Object storage", status: storageStatus, summary: storageStatus === "ready" ? "Attachment storage is ready." : storageStatus === "blocked" ? "Attachment storage is unavailable." : "Attachment storage is intentionally disabled.", detail: storageDetail, remediation: storageStatus === "blocked" ? "Verify the MinIO/S3 endpoint, credentials, network, and bucket permissions." : storageStatus === "degraded" ? "Configure MinIO or S3 to enable evidence attachments." : null, metrics: { enabled: attachmentMeta.enabled, provider: attachmentMeta.provider, upload_limit_bytes: attachmentMeta.uploadLimit } });
    checks.push({ key: "attachments", label: "Attachment service", status: attachmentMeta.enabled ? storageStatus : "degraded", summary: attachmentMeta.enabled ? "Upload, download, and deletion contracts are enabled." : "Record evidence remains available without binary attachments.", detail: `Provider: ${attachmentMeta.provider}; upload limit: ${attachmentMeta.uploadLimit} bytes.`, remediation: attachmentMeta.enabled ? null : "Enable object storage when binary evidence is required." });

    const permissionCount = await db.prepare("SELECT COUNT(*)::INTEGER AS count FROM permissions").get().catch(() => ({ count: 0 }));
    checks.push({ key: "permissions", label: "Access control", status: Number(permissionCount.count) > 0 ? "ready" : "blocked", summary: Number(permissionCount.count) > 0 ? "Role and permission catalog is loaded." : "Permission catalog is empty.", detail: `${Number(permissionCount.count || 0)} permission definitions available.`, remediation: Number(permissionCount.count) > 0 ? null : "Rerun schema bootstrap to seed the permission catalog.", metrics: { permission_definitions: Number(permissionCount.count || 0), project_scoped: Boolean(project), project_id: project?.id || null } });

    const status = checks.some((check) => check.status === "blocked") ? "blocked" : checks.some((check) => check.status === "degraded") ? "degraded" : "ready";
    return { status, checked_at: new Date().toISOString(), version: apiPackage.version, checks };
  });
};
