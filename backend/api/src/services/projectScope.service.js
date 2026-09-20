const db = require("../db");

const selectProjectAppTypeScope = db.prepare(`
  SELECT
    projects.id AS project_id,
    app_types.id AS app_type_id,
    app_types.project_id AS app_type_project_id,
    EXISTS (
      SELECT 1 FROM project_deletion_jobs
      WHERE project_id = projects.id AND status IN ('queued', 'running', 'cleanup')
    ) AS deletion_active
  FROM projects
  LEFT JOIN app_types ON app_types.id = ?
  WHERE projects.id = ?
`);

/**
 * Validates the project aggregate and its optional child app type in one
 * database round-trip. Domain services depend on this policy rather than
 * duplicating persistence checks.
 */
exports.validateProjectAppTypeScope = async (projectId, appTypeId) => {
  const scope = await selectProjectAppTypeScope.get(appTypeId || null, projectId);

  if (!scope) {
    throw new Error("Project not found");
  }

  if (scope.deletion_active) {
    throw Object.assign(new Error("This project is being deleted. Changes are temporarily unavailable."), {
      statusCode: 409,
      code: "PROJECT_DELETING"
    });
  }

  if (!appTypeId) {
    return { project_id: scope.project_id, app_type_id: null };
  }

  if (!scope.app_type_id) {
    throw new Error("App type not found");
  }

  if (scope.app_type_project_id !== projectId) {
    throw new Error("App type must belong to the selected project");
  }

  return { project_id: scope.project_id, app_type_id: scope.app_type_id };
};
