const db = require("../db");
const permissionService = require("./permission.service");

const ENTITY_SCOPES = {
  project: {
    query: "SELECT id, id AS project_id FROM projects WHERE id = ?"
  },
  requirement: {
    query: "SELECT id, project_id FROM requirements WHERE id = ?"
  },
  test_case: {
    query: `
      SELECT test_cases.id, app_types.project_id
      FROM test_cases
      JOIN app_types ON app_types.id = test_cases.app_type_id
      WHERE test_cases.id = ?
    `
  },
  test_suite: {
    query: `
      SELECT test_suites.id, app_types.project_id
      FROM test_suites
      JOIN app_types ON app_types.id = test_suites.app_type_id
      WHERE test_suites.id = ?
    `
  },
  shared_step_group: {
    query: `
      SELECT shared_step_groups.id, app_types.project_id
      FROM shared_step_groups
      JOIN app_types ON app_types.id = shared_step_groups.app_type_id
      WHERE shared_step_groups.id = ?
    `
  },
  execution: {
    query: "SELECT id, project_id FROM executions WHERE id = ?"
  },
  execution_result: {
    query: `
      SELECT execution_results.id, executions.project_id
      FROM execution_results
      JOIN executions ON executions.id = execution_results.execution_id
      WHERE execution_results.id = ?
    `
  },
  issue: {
    query: "SELECT id, project_id FROM feedback WHERE id = ?"
  },
  knowledge_source: {
    query: "SELECT id, project_id FROM ai_knowledge_sources WHERE id = ?"
  }
};

const normalizeEntityType = (value) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "feedback" || normalized === "bug" ? "issue" : normalized;
};

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const resolveEntityScope = async ({ entityType, entityId, projectId }) => {
  const normalizedType = normalizeEntityType(entityType);
  const definition = ENTITY_SCOPES[normalizedType];

  if (!definition) {
    throw createError("Unsupported attachment or comment entity type.", 400);
  }

  const normalizedEntityId = String(entityId || "").trim();
  if (!normalizedEntityId) {
    throw createError("Entity id is required.", 400);
  }

  const row = await db.prepare(definition.query).get(normalizedEntityId);
  if (!row) {
    throw createError("The requested HelloTest record was not found.", 404);
  }

  const resolvedProjectId = String(row.project_id || projectId || "").trim();
  if (!resolvedProjectId) {
    throw createError("Project scope is required for this record.", 400);
  }

  if (row.project_id && projectId && String(row.project_id) !== String(projectId)) {
    throw createError("The record does not belong to the selected project.", 403);
  }

  return {
    entityType: normalizedType,
    entityId: normalizedEntityId,
    projectId: resolvedProjectId
  };
};

const requireEntityPermission = async ({ user, permissionCode, ...scopeInput }) => {
  const scope = await resolveEntityScope(scopeInput);
  const allowed = await permissionService.hasPermission(user, permissionCode, scope.projectId);

  if (!allowed) {
    throw createError(`Permission required: ${permissionCode}`, 403);
  }

  return scope;
};

module.exports = {
  normalizeEntityType,
  requireEntityPermission,
  resolveEntityScope
};
