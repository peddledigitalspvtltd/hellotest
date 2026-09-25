const { randomUUID: uuid } = require("crypto");
const db = require("../src/db");
const { requireEntityPermission } = require("./entityScope.service");

const serialize = (row) => ({
  id: row.id,
  body: row.body,
  created: row.created_at || null,
  updated: row.updated_at || null,
  author: {
    id: row.created_by || null,
    displayName: row.author_name || row.author_email || "HelloTest user",
    avatarUrls: row.avatar_data_url ? { "32x32": row.avatar_data_url } : {}
  }
});

const list = async ({ user, entityType, entityId, projectId }) => {
  const scope = await requireEntityPermission({
    user,
    permissionCode: "comment.view",
    entityType,
    entityId,
    projectId
  });
  const rows = await db.prepare(`
    SELECT entity_comments.*, users.name AS author_name, users.email AS author_email, users.avatar_data_url
    FROM entity_comments
    LEFT JOIN users ON users.id = entity_comments.created_by
    WHERE entity_comments.entity_type = ? AND entity_comments.entity_id = ? AND entity_comments.project_id = ?
    ORDER BY entity_comments.created_at ASC, entity_comments.id ASC
  `).all(scope.entityType, scope.entityId, scope.projectId);
  return rows.map(serialize);
};

const create = async ({ user, entityType, entityId, projectId, body }) => {
  const scope = await requireEntityPermission({
    user,
    permissionCode: "comment.create",
    entityType,
    entityId,
    projectId
  });
  const normalizedBody = String(body || "").trim();
  if (!normalizedBody) {
    const error = new Error("Comment text is required.");
    error.statusCode = 400;
    throw error;
  }
  if (normalizedBody.length > 5000) {
    const error = new Error("Comments must be 5,000 characters or fewer.");
    error.statusCode = 400;
    throw error;
  }

  const row = await db.prepare(`
    INSERT INTO entity_comments (id, project_id, entity_type, entity_id, body, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(uuid(), scope.projectId, scope.entityType, scope.entityId, normalizedBody, user.id);
  return serialize({
    ...row,
    author_name: user.name,
    author_email: user.email,
    avatar_data_url: user.avatar_data_url
  });
};

module.exports = {
  create,
  list
};
