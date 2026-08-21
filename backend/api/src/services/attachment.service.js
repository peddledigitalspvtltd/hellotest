const crypto = require("crypto");
const path = require("path");
const { Transform } = require("stream");
const { createGunzip, createGzip, constants: zlibConstants } = require("zlib");
const { randomUUID: uuid } = require("crypto");
const db = require("../db");
const { config } = require("../config");
const objectStorage = require("./objectStorage.service");
const { requireEntityPermission } = require("./entityScope.service");

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
  const scope = await requireEntityPermission({
    user,
    permissionCode: "attachment.view",
    entityType,
    entityId,
    projectId
  });
  const rows = await db.prepare(`
    SELECT attachments.*, users.name AS author_name, users.email AS author_email
    FROM attachments
    LEFT JOIN users ON users.id = attachments.created_by
    WHERE attachments.entity_type = ? AND attachments.entity_id = ? AND attachments.project_id = ?
    ORDER BY attachments.created_at DESC, attachments.id DESC
  `).all(scope.entityType, scope.entityId, scope.projectId);
  return rows.map(serialize);
};

const upload = async ({ user, entityType, entityId, projectId, fileName, mimeType, stream }) => {
  const scope = await requireEntityPermission({
    user,
    permissionCode: "attachment.create",
    entityType,
    entityId,
    projectId
  });
  const id = uuid();
  const normalizedFileName = safeFileName(fileName);
  const objectName = `${scope.projectId}/${scope.entityType}/${scope.entityId}/${id}-${normalizedFileName}`;
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  const monitored = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  const compressor = createGzip({
    level: zlibConstants.Z_BEST_SPEED
  });
  stream.once("error", (error) => monitored.destroy(error));
  monitored.once("error", (error) => compressor.destroy(error));
  stream.pipe(monitored).pipe(compressor);

  let stored;
  try {
    stored = await objectStorage.putObject({
      objectName,
      stream: compressor,
      mimeType: "application/gzip"
    });

    if (stream.truncated || bytes <= 0 || bytes > config.objectStorage.maxAttachmentBytes) {
      await objectStorage.removeObject({ bucket: stored.bucket, objectName }).catch(() => undefined);
      const error = new Error(stream.truncated ? "Attachment exceeds the configured upload limit." : "Attachment must be non-empty.");
      error.statusCode = 400;
      throw error;
    }

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
      "gzip",
      stored.etag,
      hash.digest("hex"),
      user.id
    );
    return serialize({ ...row, author_name: user.name, author_email: user.email });
  } catch (error) {
    if (stored) {
      await objectStorage.removeObject({ bucket: stored.bucket, objectName }).catch(() => undefined);
    }
    throw error;
  }
};

const download = async ({ user, id }) => {
  const row = await getRow(id);
  await requireEntityPermission({
    user,
    permissionCode: "attachment.view",
    entityType: row.entity_type,
    entityId: row.entity_id,
    projectId: row.project_id
  });
  const storedStream = await objectStorage.getObject({ bucket: row.bucket_name, objectName: row.object_name });
  const stream = row.compression === "gzip" ? storedStream.pipe(createGunzip()) : storedStream;
  return {
    row,
    stream
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

const remove = async ({ user, id }) => {
  const row = await getRow(id);
  await requireEntityPermission({
    user,
    permissionCode: "attachment.delete",
    entityType: row.entity_type,
    entityId: row.entity_id,
    projectId: row.project_id
  });
  await objectStorage.removeObject({ bucket: row.bucket_name, objectName: row.object_name });
  await db.prepare("DELETE FROM attachments WHERE id = ?").run(id);
  return { deleted: true, id };
};

module.exports = {
  download,
  list,
  meta: () => ({
    enabled: objectStorage.isEnabled(),
    provider: config.storageProvider,
    uploadLimit: config.objectStorage.maxAttachmentBytes,
    compression: "gzip"
  }),
  listProjectObjects,
  purgeProjectObjects,
  remove,
  safeFileName,
  upload
};
