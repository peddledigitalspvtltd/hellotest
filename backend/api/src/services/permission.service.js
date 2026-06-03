const db = require("../db");

const hasPermission = async (user, permissionCode, projectId = null) => {
  if (!user || !permissionCode) {
    return false;
  }

  if (user.role === "admin" || user.is_workspace_admin) {
    return true;
  }

  const row = await db.prepare(`
    SELECT EXISTS (
      SELECT 1
      FROM project_members
      JOIN role_permissions ON role_permissions.role_id = project_members.role_id
      JOIN permissions ON permissions.id = role_permissions.permission_id
      WHERE project_members.user_id = ?
        AND permissions.code = ?
        AND (?::text IS NULL OR project_members.project_id = ?::text)
    ) AS allowed
  `).get(user.id, permissionCode, projectId, projectId);

  return Boolean(row?.allowed);
};

module.exports = {
  hasPermission
};
