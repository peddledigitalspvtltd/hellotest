const crypto = require("crypto");
const path = require("path");
const { PassThrough, Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { createGunzip, createGzip, constants: zlibConstants } = require("zlib");
const { randomUUID: uuid } = require("crypto");
const db = require("../db");
const { config } = require("../config");
const objectStorage = require("./objectStorage.service");
const { requireEntityPermission } = require("./entityScope.service");
const permissionService = require("./permission.service");

const assertExecutionAttachmentAccess = async ({ user, scope, operation }) => {
  if (!["execution", "execution_result"].includes(scope.entityType)) return;
  const permissionCode = ["list", "download"].includes(operation) ? "result.view" : "result.manage";
  if (!await permissionService.hasPermission(user, permissionCode, scope.projectId)) {
    const error = new Error(`Permission required: ${permissionCode}`);
    error.statusCode = 403;
    throw error;
  }
};

const shouldCompress = (mimeType, fileName) => {
  const mime = String(mimeType || "").split(";", 1)[0].trim().toLowerCase();
  return mime.startsWith("text/")
    || /^(application\/(?:json|xml|javascript|x-javascript|sql|x-ndjson)|image\/svg\+xml)$/.test(mime)
    || /\.(?:txt|log|csv|json|jsonl|ndjson|xml|yaml|yml|md|sql|js|css|svg)$/i.test(fileName);
};

const assertKnowledgeSourceAttachmentAccess = async ({ user, entityType, entityId, permissionCode, operation }) => {
  if (String(entityType || "").trim().toLowerCase().replace(/[\s-]+/g, "_") !== "knowledge_source") return;
  // A managed ingestion downloads its staged object with knowledge.manage,
  // while a user-facing file download uses knowledge.view. Both are Knowledge
  // endpoint capabilities; generic attachment permissions must stay blocked.
  const allowedBasePermissions = operation === "download"
    ? new Set(["knowledge.view", "knowledge.manage"])
    : new Set([operation === "list" ? "knowledge.view" : "knowledge.manage"]);
  if (!allowedBasePermissions.has(permissionCode)) {
    const error = new Error("Managed Knowledge Repo files are available only through Knowledge endpoints.");
    error.statusCode = 403;
    throw error;
  }
  const source = await db.prepare(`
    SELECT project_id, required_permission
    FROM ai_knowledge_sources WHERE id = ?
  `).get(entityId);
  if (!source) {
    const error = new Error("Knowledge source not found.");
    error.statusCode = 404;
    throw error;
  }
  if (!await permissionService.hasPermission(user, permissionCode, source.project_id)
    || (source.required_permission && !await permissionService.hasPermission(user, source.required_permission, source.project_id))) {
    const error = new Error("Permission required for this managed Knowledge source file.");
    error.statusCode = 403;
    throw error;
  }
};

const safeFileName = (value) => {
  const base = path.basename(String(value || "attachment"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?\"<>|]+/g, "-")
    .trim();
  return (base || "attachment").slice(0, 240);
};

const serialize = (row) => ({
  id: row.id,
  project_id: row.project_id,
  entity_type: row.entity_type,
  entity_id: row.entity_id,
  filename: row.file_name,
  mimeType: row.mime_type || "application/octet-stream",
  size: Number(row.size_bytes || 0),
  storedSize: Number(row.stored_size_bytes || row.size_bytes || 0),
  compression: row.compression || "none",
  savedBytes: Math.max(0, Number(row.size_bytes || 0) - Number(row.stored_size_bytes || row.size_bytes || 0)),
  checksum: row.checksum_sha256 || null,
  created: row.created_at || null,
  thumbnail: null,
  author: row.author_name || row.author_email
    ? { displayName: row.author_name || row.author_email }
    : null
});

const getRow = async (id) => {
  const row = await db.prepare(`
    SELECT attachments.*, users.name AS author_name, users.email AS author_email
    FROM attachments
    LEFT JOIN users ON users.id = attachments.created_by
    WHERE attachments.id = ?
  `).get(id);

  if (!row) {
    const error = new Error("Attachment not found.");
    error.statusCode = 404;
    throw error;
  }

  return row;
};

const list = async ({ user, entityType, entityId, projectId }) => {
  await assertKnowledgeSourceAttachmentAccess({ user, entityType, entityId, permissionCode: "attachment.view", operation: "list" });
  const scope = await requireEntityPermission({
    user,
    permissionCode: "attachment.view",
    entityType,
    entityId,
    projectId
  });
  await assertExecutionAttachmentAccess({ user, scope, operation: "list" });
  const rows = await db.prepare(`
    SELECT attachments.*, users.name AS author_name, users.email AS author_email
    FROM attachments
    LEFT JOIN users ON users.id = attachments.created_by
    WHERE attachments.entity_type = ? AND attachments.entity_id = ? AND attachments.project_id = ?
    ORDER BY attachments.created_at DESC, attachments.id DESC
  `).all(scope.entityType, scope.entityId, scope.projectId);
  return rows.map(serialize);
};

const upload = async ({ user, entityType, entityId, projectId, fileName, mimeType, stream, permissionCode = "attachment.create", maxBytes, onStored }) => {
  await assertKnowledgeSourceAttachmentAccess({ user, entityType, entityId, permissionCode, operation: "upload" });
  const scope = await requireEntityPermission({
    user,
    permissionCode,
    entityType,
    entityId,
    projectId
  });
  await assertExecutionAttachmentAccess({ user, scope, operation: "upload" });
  const id = uuid();
  const normalizedFileName = safeFileName(fileName);
  const objectName = `${scope.projectId}/${scope.entityType}/${scope.entityId}/${id}-${normalizedFileName}`;
  const hash = crypto.createHash("sha256");
  const byteLimit = Math.min(config.objectStorage.maxAttachmentBytes, Number(maxBytes) > 0 ? Number(maxBytes) : config.objectStorage.maxAttachmentBytes);
  const compression = shouldCompress(mimeType, normalizedFileName) ? "gzip" : "none";
  let bytes = 0;
  const monitored = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > byteLimit) {
        const error = new Error("Attachment exceeds the configured upload limit.");
        error.statusCode = 413;
        callback(error);
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  const storageStream = compression === "gzip" ? createGzip({ level: zlibConstants.Z_BEST_SPEED }) : new PassThrough();

  let stored;
  try {
    const [object] = await Promise.all([
      objectStorage.putObject({ objectName, stream: storageStream, mimeType: compression === "gzip" ? "application/gzip" : mimeType }),
      pipeline(stream, monitored, storageStream)
    ]);
    stored = object;

    if (stream.truncated || bytes <= 0 || bytes > byteLimit) {
      const error = new Error(stream.truncated ? "Attachment exceeds the configured upload limit." : "Attachment must be non-empty.");
      error.statusCode = stream.truncated ? 413 : 400;
      throw error;
    }

    const persist = async () => {
      const row = await db.prepare(`
      INSERT INTO attachments (
        id, project_id, entity_type, entity_id, bucket_name, object_name,
        file_name, mime_type, size_bytes, stored_size_bytes, compression,
        etag, checksum_sha256, created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      id,
      scope.projectId,
      scope.entityType,
      scope.entityId,
      stored.bucket,
      objectName,
      normalizedFileName,
      String(mimeType || "application/octet-stream").slice(0, 200),
      bytes,
      stored.size,
      compression,
      stored.etag,
      hash.digest("hex"),
      user.id
    );
      const attachment = serialize({ ...row, author_name: user.name, author_email: user.email });
      if (onStored) await onStored(attachment);
      return attachment;
    };
    return onStored ? await db.transaction(persist)() : await persist();
  } catch (error) {
    storageStream.destroy();
    await objectStorage.removeObject({ bucket: stored?.bucket || config.objectStorage.bucket, objectName }).catch(() => undefined);
    throw error;
  }
};

const download = async ({ user, id, permissionCode = "attachment.view" }) => {
  const row = await getRow(id);
  await assertKnowledgeSourceAttachmentAccess({ user, entityType: row.entity_type, entityId: row.entity_id, permissionCode, operation: "download" });
  const scope = await requireEntityPermission({
    user,
    permissionCode,
    entityType: row.entity_type,
    entityId: row.entity_id,
    projectId: row.project_id
  });
  await assertExecutionAttachmentAccess({ user, scope, operation: "download" });
  const storedStream = await objectStorage.getObject({ bucket: row.bucket_name, objectName: row.object_name });
  const stream = row.compression === "gzip" ? storedStream.pipe(createGunzip()) : storedStream;
  return {
    row,
    stream
  };
};

// Background Knowledge ingestion has already passed project permission checks
// and owns a leased job. Re-authorizing through a partial worker user object made
// staged files fragile (and previously rejected knowledge.manage as a download).
// This internal reader instead binds the object to the exact project + source.
const downloadManagedKnowledgeObject = async ({ id, projectId, sourceId }) => {
  const row = await getRow(id);
  const entityType = String(row.entity_type || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (entityType !== "knowledge_source"
    || String(row.entity_id) !== String(sourceId)
    || String(row.project_id) !== String(projectId)) {
    const error = new Error("The staged Knowledge file no longer matches its project source.");
    error.statusCode = 409;
    error.code = "KNOWLEDGE_ATTACHMENT_SCOPE_MISMATCH";
    throw error;
  }
  const storedStream = await objectStorage.getObject({ bucket: row.bucket_name, objectName: row.object_name });
  return {
    row,
    stream: row.compression === "gzip" ? storedStream.pipe(createGunzip()) : storedStream
  };
};

const listProjectObjects = async (projectId) => db.prepare(`
    SELECT bucket_name, object_name
    FROM attachments
    WHERE project_id = ?
  `).all(projectId);

const purgeProjectObjects = async (projectId, knownRows) => {
  const rows = Array.isArray(knownRows) ? knownRows : await listProjectObjects(projectId);
  const results = await Promise.allSettled(rows.map((row) => objectStorage.removeObject({
    bucket: row.bucket_name,
    objectName: row.object_name
  })));
  return {
    attempted: rows.length,
    failed: results.filter((result) => result.status === "rejected").length
  };
};

const remove = async ({ user, id, permissionCode = "attachment.delete", expectedEntityType, expectedEntityId }) => {
  const row = await getRow(id);
  if ((expectedEntityType && row.entity_type !== expectedEntityType) || (expectedEntityId && row.entity_id !== expectedEntityId)) {
    const error = new Error("Attachment does not belong to this record.");
    error.statusCode = 404;
    throw error;
  }
  await assertKnowledgeSourceAttachmentAccess({ user, entityType: row.entity_type, entityId: row.entity_id, permissionCode, operation: "remove" });
  const scope = await requireEntityPermission({
    user,
    permissionCode,
    entityType: row.entity_type,
    entityId: row.entity_id,
    projectId: row.project_id
  });
  await assertExecutionAttachmentAccess({ user, scope, operation: "remove" });
  await objectStorage.removeObject({ bucket: row.bucket_name, objectName: row.object_name });
  const persist = async () => {
    await db.prepare("DELETE FROM attachments WHERE id = ?").run(id);
    if (scope.entityType !== "execution_result") return undefined;
    const result = await db.prepare("SELECT logs, revision FROM execution_results WHERE id = ? FOR UPDATE").get(scope.entityId);
    if (!result) return undefined;
    let logs;
    try { logs = typeof result.logs === "string" ? JSON.parse(result.logs) : result.logs; } catch { return Number(result.revision || 1); }
    const evidence = logs?.stepEvidence;
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return Number(result.revision || 1);
    const retained = Object.fromEntries(Object.entries(evidence).filter(([, value]) => value?.attachmentId !== id));
    if (Object.keys(retained).length === Object.keys(evidence).length) return Number(result.revision || 1);
    logs.stepEvidence = retained;
    const revision = Number(result.revision || 1) + 1;
    await db.prepare("UPDATE execution_results SET logs = ?, revision = ? WHERE id = ?").run(JSON.stringify(logs), revision, scope.entityId);
    return revision;
  };
  const revision = await db.transaction(persist)();
  return { deleted: true, id, ...(revision !== undefined ? { revision } : {}) };
};

module.exports = {
  assertKnowledgeSourceAttachmentAccess,
  assertExecutionAttachmentAccess,
  download,
  downloadManagedKnowledgeObject,
  list,
  meta: () => ({
    enabled: objectStorage.isEnabled(),
    provider: config.storageProvider,
    uploadLimit: config.objectStorage.maxAttachmentBytes,
    compression: "gzip",
    compressionPolicy: "Text and structured files are compressed; already-compressed media and archives retain their bytes."
  }),
  listProjectObjects,
  purgeProjectObjects,
  remove,
  safeFileName,
  shouldCompress,
  upload
};
