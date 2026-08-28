const db = require("../db");

const WORKSPACE_ONLY_PERMISSION_CODES = new Set([
  "workspace.view",
  "settings.view",
  "settings.manage",
  "workspace_preferences.manage",
  "api_key.manage",
  "localization.manage",
  "ai_prompt.manage",
  "feature_flag.manage",
  "integration.view",
  "integration.manage",
  "integration.import_export",
  "notification.view",
  "notification.manage",
  "user.view",
  "user.manage",
  "user.import",
  "role.view",
  "role.manage",
  "project.create"
]);

const hasPermission = async (user, permissionCode, projectId = null) => {
  if (!user || !permissionCode) {
    return false;
  }

  if (user.role === "admin" || user.is_workspace_admin) {
    return true;
  }

  let row;
  if (WORKSPACE_ONLY_PERMISSION_CODES.has(permissionCode)) {
    row = await db.prepare(`
      SELECT EXISTS (
        SELECT 1
        FROM users
        JOIN role_permissions ON role_permissions.role_id = users.default_role_id
        JOIN permissions ON permissions.id = role_permissions.permission_id
        WHERE users.id = ?
          AND permissions.code = ?
      ) AS allowed
    `).get(user.id, permissionCode);
  } else if (projectId) {
    row = await db.prepare(`
      SELECT EXISTS (
        SELECT 1
        FROM project_members
        JOIN role_permissions ON role_permissions.role_id = project_members.role_id
        JOIN permissions ON permissions.id = role_permissions.permission_id
        WHERE project_members.user_id = ?
          AND project_members.project_id = ?
          AND permissions.code = ?
      ) AS allowed
    `).get(user.id, projectId, permissionCode);
  } else {
    row = await db.prepare(`
      SELECT EXISTS (
        SELECT 1 FROM project_members
        JOIN role_permissions ON role_permissions.role_id = project_members.role_id
        JOIN permissions ON permissions.id = role_permissions.permission_id
        WHERE project_members.user_id = ?
          AND permissions.code = ?
      ) AS allowed
    `).get(user.id, permissionCode);
  }

  return Boolean(row?.allowed);
};

module.exports = {
  WORKSPACE_ONLY_PERMISSION_CODES,
  hasPermission
};
