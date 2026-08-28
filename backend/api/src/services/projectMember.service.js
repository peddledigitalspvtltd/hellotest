const db = require("../db");
const { randomUUID: uuid } = require("crypto");

const selectRoleById = db.prepare(`
  SELECT id, name
  FROM roles
  WHERE id = ?
`);

const selectUserById = db.prepare(`
  SELECT id, COALESCE(is_workspace_admin, FALSE) AS is_workspace_admin
  FROM users
  WHERE id = ?
`);

const assertProjectRoleAssignmentAllowed = (user, role) => {
  if (String(role?.name || "").trim().toLowerCase() === "admin" && !user?.is_workspace_admin) {
    const error = new Error("The workspace administrator role cannot be assigned through project membership");
    error.statusCode = 403;
    throw error;
  }
};

exports.createProjectMember = async ({ project_id, user_id, role_id }) => {
  if (!project_id || !user_id || !role_id) {
    throw new Error("Missing required fields");
  }

  const project = await db.prepare(`
    SELECT id FROM projects WHERE id = ?
  `).get(project_id);
  if (!project) throw new Error("Project not found");

  const user = await selectUserById.get(user_id);
  if (!user) throw new Error("User not found");

  const role = await selectRoleById.get(role_id);
  if (!role) throw new Error("Role not found");
  assertProjectRoleAssignmentAllowed(user, role);

  const existing = await db.prepare(`
    SELECT id FROM project_members WHERE project_id = ? AND user_id = ?
  `).get(project_id, user_id);

  if (existing) {
    throw new Error("Project member already exists");
  }

  const id = uuid();

  await db.prepare(`
    INSERT INTO project_members (id, project_id, user_id, role_id)
    VALUES (?, ?, ?, ?)
  `).run(id, project_id, user_id, role_id);

  return { id };
};

exports.getProjectMembers = async ({ project_id, user_id, role_id }) => {
  let query = `
    SELECT project_members.*,
           users.name AS user_name,
           users.email AS user_email
    FROM project_members
    JOIN users ON users.id = project_members.user_id
    WHERE 1=1
  `;
  const params = [];

  if (project_id) {
    query += ` AND project_members.project_id = ?`;
    params.push(project_id);
  }

  if (user_id) {
    query += ` AND project_members.user_id = ?`;
    params.push(user_id);
  }

  if (role_id) {
    query += ` AND project_members.role_id = ?`;
    params.push(role_id);
  }

  query += ` ORDER BY project_members.created_at DESC`;

  return db.prepare(query).all(...params);
};

exports.getProjectMember = async (id) => {
  const member = await db.prepare(`
    SELECT project_members.*,
           users.name AS user_name,
           users.email AS user_email
    FROM project_members
    JOIN users ON users.id = project_members.user_id
    WHERE project_members.id = ?
  `).get(id);

  if (!member) throw new Error("Project member not found");

  return member;
};

exports.updateProjectMember = async (id, data) => {
  const existing = await exports.getProjectMember(id);

  if (data.project_id) {
    const project = await db.prepare(`
      SELECT id FROM projects WHERE id = ?
    `).get(data.project_id);
    if (!project) throw new Error("Project not found");
  }

  let nextRole = null;

  if (data.role_id) {
    nextRole = await selectRoleById.get(data.role_id);
    if (!nextRole) throw new Error("Role not found");
  }

  const nextProjectId = data.project_id ?? existing.project_id;
  const nextUserId = data.user_id ?? existing.user_id;
  const targetUser = await selectUserById.get(nextUserId);
  if (!targetUser) throw new Error("User not found");
  const targetRole = nextRole || await selectRoleById.get(existing.role_id);
  if (!targetRole) throw new Error("Role not found");
  assertProjectRoleAssignmentAllowed(targetUser, targetRole);
  const duplicate = await db.prepare(`
    SELECT id FROM project_members
    WHERE project_id = ? AND user_id = ? AND id != ?
  `).get(nextProjectId, nextUserId, id);

  if (duplicate) {
    throw new Error("Project member already exists");
  }

  await db.prepare(`
    UPDATE project_members
    SET project_id = ?, user_id = ?, role_id = ?
    WHERE id = ?
  `).run(
    nextProjectId,
    nextUserId,
    data.role_id ?? existing.role_id,
    id
  );

  return { updated: true };
};

exports.deleteProjectMember = async (id) => {
  await exports.getProjectMember(id);

  await db.prepare(`
    DELETE FROM project_members WHERE id = ?
  `).run(id);

  return { deleted: true };
};
