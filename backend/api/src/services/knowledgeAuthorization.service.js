const db = require("../db");
const permissionService = require("./permission.service");
const { randomUUID: uuid } = require("crypto");

const error = (message, statusCode = 403) => Object.assign(new Error(message), { statusCode });
const precedence = (binding) => (binding.inherited ? 0 : 2) + (binding.effect === "DENY" ? 2 : 1);
const principalsFor = (user, projectId, roleIds = []) => [
  { type: "PROJECT", id: String(projectId) },
  { type: "EVERYONE", id: "*" },
  ...(user?.id ? [{ type: "USER", id: String(user.id) }] : []),
  ...roleIds.map((id) => ({ type: "ROLE", id: String(id) }))
];

// Explicit DENY > explicit ALLOW > inherited DENY > inherited ALLOW > DENY.
// Project membership and source-kind permissions remain mandatory outer gates.
const canRead = ({ bindings = [], user, projectId, roleIds = [] }) => {
  const principals = principalsFor(user, projectId, roleIds);
  const applicable = bindings.filter((binding) => binding.permission === "READ"
    && binding.project_id === projectId
    && principals.some((principal) => principal.type === binding.principal_type && principal.id === binding.principal_id));
  applicable.sort((left, right) => precedence(right) - precedence(left));
  return applicable[0]?.effect === "ALLOW";
};

const predicate = ({ user, projectId, source = "sources", document = null, chunk = null }) => {
  for (const alias of [source, document, chunk].filter(Boolean)) {
    if (!/^[a-z_]+$/i.test(alias)) throw new Error("Invalid knowledge authorization SQL alias");
  }
  return {
    sql: `COALESCE((
      SELECT bindings.effect FROM ai_knowledge_security_bindings bindings
      WHERE bindings.project_id = ${source}.project_id AND bindings.source_id = ${source}.id
        AND bindings.permission = 'READ'
        AND (bindings.document_id IS NULL ${document ? `OR bindings.document_id = ${document}.id` : ""})
        AND (bindings.chunk_id IS NULL ${chunk ? `OR bindings.chunk_id = ${chunk}.id` : ""})
        AND (EXISTS (SELECT 1 FROM jsonb_to_recordset(?::jsonb) AS principals(type TEXT, id TEXT)
          WHERE principals.type = bindings.principal_type AND principals.id = bindings.principal_id)
          OR (bindings.principal_type = 'ROLE' AND EXISTS (
            SELECT 1 FROM users acl_users
            LEFT JOIN project_members acl_members
              ON acl_members.user_id = acl_users.id AND acl_members.project_id = ${source}.project_id
            JOIN roles acl_roles ON acl_roles.id = acl_users.default_role_id OR acl_roles.id = acl_members.role_id
            WHERE acl_users.id = ? AND acl_users.status = 'active'
              AND (bindings.principal_id = acl_roles.id OR bindings.principal_id = acl_roles.name)
          )))
      ORDER BY CASE WHEN bindings.inherited THEN 0 ELSE 2 END
        + CASE WHEN bindings.effect = 'DENY' THEN 2 ELSE 1 END DESC
      LIMIT 1
    ), 'DENY') = 'ALLOW'`,
    // Resolve roles in the same query as evidence: a changed project assignment
    // takes effect immediately, without trusting stale token/client role arrays.
    params: [principalsFor(user, projectId), user?.id || null]
  };
};

const assertHistoricalAccess = async (user, projectId) => {
  if (!await permissionService.hasPermission(user, "knowledge.manage", projectId)) {
    throw error("Historical knowledge requires knowledge.manage permission.");
  }
};

const replaceBindings = async ({ sourceId, bindings, user }) => {
  const source = await db.prepare("SELECT id, project_id FROM ai_knowledge_sources WHERE id = ?").get(sourceId);
  if (!source) throw error("Knowledge source not found.", 404);
  await assertHistoricalAccess(user, source.project_id);
  if (!Array.isArray(bindings) || bindings.length > 250) throw error("Up to 250 security bindings are supported.", 400);
  return db.transaction(async () => {
    await db.prepare("SELECT id FROM ai_knowledge_sources WHERE id = ? FOR UPDATE").get(source.id);
    const normalized = [];
    for (const binding of bindings) {
      if (!binding || typeof binding !== "object" || Array.isArray(binding)
        || !["USER", "ROLE", "PROJECT", "EVERYONE"].includes(binding.principal_type)
        || !["ALLOW", "DENY"].includes(binding.effect) || !String(binding.principal_id || "").trim()) {
        throw error("A valid principal and ALLOW or DENY effect are required.", 400);
      }
      if (binding.inherited !== undefined && typeof binding.inherited !== "boolean") {
        throw error("Security binding inherited must be a boolean.", 400);
      }
      const documentId = binding.document_id || null;
      const chunkId = binding.chunk_id || null;
      if (documentId && !await db.prepare("SELECT id FROM ai_knowledge_documents WHERE id = ? AND source_id = ?").get(documentId, source.id)) {
        throw error("Security binding revision does not belong to this source.", 400);
      }
      if (chunkId && !await db.prepare(`SELECT id FROM ai_knowledge_chunks WHERE id = ? AND source_id = ?
        AND (?::TEXT IS NULL OR document_id = ?)` ).get(chunkId, source.id, documentId, documentId)) {
        throw error("Security binding fragment does not belong to this revision/source.", 400);
      }
      normalized.push({ ...binding, document_id: documentId, chunk_id: chunkId });
    }
    await db.prepare("DELETE FROM ai_knowledge_security_bindings WHERE source_id = ? AND id <> ?").run(source.id, `${source.id}:project-read`);
    for (const binding of normalized) {
      await db.prepare(`INSERT INTO ai_knowledge_security_bindings
        (id, project_id, source_id, document_id, chunk_id, principal_type, principal_id, effect, inherited, policy_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ).run(
        uuid(), source.project_id, source.id, binding.document_id, binding.chunk_id,
        binding.principal_type, String(binding.principal_id).trim(), binding.effect, Boolean(binding.inherited), String(binding.policy_version || "1")
      );
    }
    return { source_id: source.id, binding_count: normalized.length, policy_updated: true };
  })();
};

const getEvidenceAccess = async ({ projectId, user, evidence = [], asOf } = {}) => {
  if (asOf) await assertHistoricalAccess(user, projectId);
  const items = Array.isArray(evidence) ? evidence.slice(0, 1_000) : [];
  const identity = (item) => item?.fragment_id || item?.chunk_id || item?.citation?.fragment_id || item?.citation?.chunk_id || item?.id;
  const productHelp = (item) => (item?.source_id || item?.citation?.source_id) === "hellotest-product-help";
  const ids = [...new Set(items.filter((item) => !productHelp(item)).map(identity).filter(Boolean))];
  const allowedIds = new Set();
  if (ids.length) {
    const acl = predicate({ user, projectId, document: "documents", chunk: "chunks" });
    const rows = await db.prepare(`SELECT chunks.id, sources.required_permission
      FROM ai_knowledge_chunks chunks
      JOIN ai_knowledge_sources sources ON sources.id = chunks.source_id
      JOIN ai_knowledge_documents documents ON documents.id = chunks.document_id
      JOIN ai_knowledge_index_states indexes ON indexes.document_id = documents.id
      WHERE sources.project_id = ? AND chunks.project_id = ? AND documents.project_id = ?
        AND sources.extraction_status = 'ready' AND indexes.required_indexes_ready = TRUE
        ${asOf ? "AND documents.effective_from <= ?::timestamptz AND (documents.effective_to IS NULL OR documents.effective_to > ?::timestamptz)" : "AND documents.is_active = TRUE"}
        AND chunks.id IN (${ids.map(() => "?").join(",")}) AND ${acl.sql}`
    ).all(projectId, projectId, projectId, ...(asOf ? [asOf, asOf] : []), ...ids, ...acl.params);
    const permissions = new Map();
    for (const row of rows) {
      if (!row.required_permission) allowedIds.add(row.id);
      else {
        if (!permissions.has(row.required_permission)) permissions.set(row.required_permission,
          await permissionService.hasPermission(user, row.required_permission, projectId));
        if (permissions.get(row.required_permission)) allowedIds.add(row.id);
      }
    }
  }
  const allowed = items.filter((item) => productHelp(item) || allowedIds.has(identity(item)));
  const deniedIds = items.filter((item) => !productHelp(item) && !allowedIds.has(identity(item))).map(identity).filter(Boolean);
  return { allowed, denied_ids: deniedIds, partial: allowed.length !== items.length || evidence.length > 1_000 };
};

module.exports = { assertHistoricalAccess, canRead, getEvidenceAccess, predicate, principalsFor, replaceBindings };
