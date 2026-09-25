const db = require("../src/db");

// Workspace navigation needs only identifiers and labels. Project management,
// metrics and configuration stay behind their own permissions and features.
exports.getWorkspaceScopes = async (user) => {
  if (!user?.id) throw Object.assign(new Error("Authentication required"), { statusCode: 401 });
  const projects = await db.prepare(`
    SELECT projects.id, projects.display_id, projects.name
    FROM projects
    WHERE ? = TRUE OR EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = projects.id
        AND project_members.user_id = ?
    )
    ORDER BY projects.name, projects.id
  `).all(user.role === "admin" || Boolean(user.is_workspace_admin), user.id);
  return { projects };
};
