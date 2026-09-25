const db = require("../src/db");
const { randomUUID: uuid } = require("crypto");
const { APP_TYPE_VALUES } = require("../src/domain/catalog");
const displayIdService = require("./displayId.service");
const attachmentService = require("./attachment.service");
const { deleteProjectData } = require("./projectDeletion.repository");
const { assertProjectRoleAssignmentAllowed } = require("./projectRoleAssignment");

const VALID_APP_TYPES = new Set(APP_TYPE_VALUES);

const selectRoleByName = db.prepare(`
  SELECT id
  FROM roles
  WHERE name = ?
`);

const selectAdminUsers = db.prepare(`
  SELECT DISTINCT users.id
  FROM users
  WHERE COALESCE(users.is_workspace_admin, FALSE) = TRUE
`);

const insertProjectMember = db.prepare(`
  INSERT INTO project_members (id, project_id, user_id, role_id)
  VALUES (?, ?, ?, ?)
  ON CONFLICT (project_id, user_id) DO NOTHING
`);

const insertAppType = db.prepare(`
  INSERT INTO app_types (id, project_id, name, type, is_unified)
  VALUES (?, ?, ?, ?, ?)
`);

const selectUserById = db.prepare(`
  SELECT id, is_workspace_admin
  FROM users
  WHERE id = ?
`);
const selectRoleById = db.prepare(`SELECT id, name FROM roles WHERE id = ?`);

exports.createProject = async ({ name, description, visibility, created_by, members, member_ids, app_types }) => {
  if (!name || !created_by) throw new Error("Missing fields");

  const normalizedName = String(name).trim();
  if (!normalizedName) throw new Error("Project name is required");
  const normalizedVisibility = visibility === "public" ? "public" : "private";

  const id = uuid();
  const display_id = await displayIdService.createDisplayId("project");

  const user = await selectUserById.get(created_by);
  if (!user) throw new Error("Invalid user");

  const requestedMemberIds = Array.isArray(members)
    ? members.map((member) => member?.user_id)
    : member_ids;
  const normalizedMemberIds = normalizedVisibility === "public" && Array.isArray(requestedMemberIds)
    ? [...new Set(requestedMemberIds.map((value) => String(value || "").trim()).filter(Boolean))]
    : [];
  const requestedMemberRoles = new Map((Array.isArray(members) ? members : []).map((member) => [
    String(member?.user_id || "").trim(), String(member?.role_id || "").trim()
  ]));
  const normalizedAppTypes = Array.isArray(app_types)
    ? app_types
        .map((item = {}) => ({
          name: String(item.name || "").trim(),
          type: String(item.type || "").trim(),
          is_unified: Boolean(item.is_unified)
        }))
        .filter((item) => item.name || item.type)
    : [];

  const adminRole = await selectRoleByName.get("admin");
  const memberRole = await selectRoleByName.get("member");
  const creatorRoleId = user.is_workspace_admin ? (adminRole?.id || memberRole?.id) : (memberRole?.id || adminRole?.id);
  const selectedMemberRoleId = memberRole?.id || adminRole?.id;

  if (!creatorRoleId || !selectedMemberRoleId) {
    throw new Error("No project roles are configured");
  }

  if (!normalizedAppTypes.length) {
    throw new Error("At least one app type is required");
  }

  normalizedAppTypes.forEach((appType, index) => {
    if (!appType.name) {
      throw new Error(`App type ${index + 1} is missing a name`);
    }

    if (!VALID_APP_TYPES.has(appType.type)) {
      throw new Error(`App type ${index + 1} has an invalid type`);
    }
  });

  const selectedMemberRoles = new Map();
  for (const memberId of normalizedMemberIds) {
    const memberUser = await selectUserById.get(memberId);

    if (!memberUser) {
      throw new Error("One of the selected members no longer exists");
    }
    const roleId = requestedMemberRoles.get(memberId) || selectedMemberRoleId;
    const role = await selectRoleById.get(roleId);
    if (!role) {
      const error = new Error("One of the selected project roles no longer exists");
      error.statusCode = 400;
      throw error;
    }
    assertProjectRoleAssignmentAllowed(memberUser, role);
    selectedMemberRoles.set(memberId, role.id);
  }

  const adminUsers = normalizedVisibility === "public" ? await selectAdminUsers.all() : [];
  const memberships = new Map();

  for (const adminUser of adminUsers) {
    memberships.set(adminUser.id, adminRole?.id || creatorRoleId);
  }

  memberships.set(created_by, creatorRoleId);

  for (const memberId of normalizedMemberIds) {
    if (!memberships.has(memberId)) {
      memberships.set(memberId, selectedMemberRoles.get(memberId));
    }
  }

  const createProjectWithMemberships = db.transaction(async () => {
    await db.prepare(`
      INSERT INTO projects (id, display_id, name, description, visibility, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, display_id, normalizedName, description || null, normalizedVisibility, created_by);

    for (const [userId, roleId] of memberships.entries()) {
      await insertProjectMember.run(uuid(), id, userId, roleId);
    }

    for (const appType of normalizedAppTypes) {
      await insertAppType.run(uuid(), id, appType.name, appType.type, Boolean(appType.is_unified));
    }
  });

  await createProjectWithMemberships();

  return {
    id,
    display_id,
    name: normalizedName,
    description: description || null,
    visibility: normalizedVisibility,
    created_by,
    members_added: memberships.size,
    app_types_created: normalizedAppTypes.length
  };
};

exports.getProjectCatalog = async (userId, { projection } = {}) => {
  if (!userId) throw new Error("User is required");

  // Browsing must not scan every project's requirements, cases and Bugs. Exact
  // metrics have their own endpoint and project details are fetched on open.
  if (projection === "summary") {
    return db.prepare(`
      WITH catalog AS (
        SELECT p.id, p.display_id, p.name, p.description, p.visibility,
          p.created_by, p.created_at,
          EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?) AS has_access,
          EXISTS (SELECT 1 FROM project_favorites pf WHERE pf.project_id = p.id AND pf.user_id = ?) AS is_favorite
        FROM projects p
      )
      SELECT catalog.id, catalog.display_id, catalog.name,
        CASE WHEN catalog.has_access THEN LEFT(catalog.description, 1024) ELSE NULL END AS description,
        catalog.visibility,
        CASE WHEN catalog.has_access THEN catalog.created_by ELSE NULL END AS created_by,
        catalog.created_at, catalog.has_access, catalog.is_favorite
      FROM catalog
      ORDER BY catalog.created_at DESC, catalog.id
    `).all(userId, userId);
  }

  return db.prepare(`
    WITH catalog AS (
      SELECT
        p.*,
        EXISTS (
          SELECT 1
          FROM project_members pm
          WHERE pm.project_id = p.id
            AND pm.user_id = ?
        ) AS has_access,
        EXISTS (
          SELECT 1
          FROM project_favorites pf
          WHERE pf.project_id = p.id
            AND pf.user_id = ?
        ) AS is_favorite
      FROM projects p
    )
    SELECT
      catalog.id,
      catalog.display_id,
      catalog.name,
      CASE WHEN catalog.has_access THEN catalog.description ELSE NULL END AS description,
      catalog.visibility,
      CASE WHEN catalog.has_access THEN catalog.created_by ELSE NULL END AS created_by,
      catalog.created_at,
      catalog.has_access,
      catalog.is_favorite,
      CASE WHEN catalog.has_access THEN
        (SELECT COUNT(*)::INTEGER FROM requirements WHERE requirements.project_id = catalog.id)
      ELSE NULL END AS story_count,
      CASE WHEN catalog.has_access THEN (
        SELECT COUNT(*)::INTEGER
        FROM test_case_modules
        JOIN app_types ON app_types.id = test_case_modules.app_type_id
        WHERE app_types.project_id = catalog.id
      ) ELSE NULL END AS module_count,
      CASE WHEN catalog.has_access THEN (
        SELECT COUNT(*)::INTEGER
        FROM test_cases
        JOIN app_types ON app_types.id = test_cases.app_type_id
        WHERE app_types.project_id = catalog.id
      ) ELSE NULL END AS case_count,
      CASE WHEN catalog.has_access THEN
        (SELECT COUNT(*)::INTEGER FROM feedback WHERE feedback.project_id = catalog.id)
      ELSE NULL END AS bug_count
    FROM catalog
    ORDER BY catalog.created_at DESC
  `).all(userId, userId);
};

exports.favoriteProject = async (projectId, userId) => {
  await exports.getProject(projectId);
  await db.prepare(`
    INSERT INTO project_favorites (project_id, user_id)
    VALUES (?, ?)
    ON CONFLICT (project_id, user_id) DO NOTHING
  `).run(projectId, userId);
  return { updated: true, is_favorite: true };
};

exports.unfavoriteProject = async (projectId, userId) => {
  await db.prepare(`
    DELETE FROM project_favorites
    WHERE project_id = ? AND user_id = ?
  `).run(projectId, userId);
  return { updated: true, is_favorite: false };
};

// Get projects filtered by user membership
exports.getProjects = async (userId = null, { projection } = {}) => {
  if (projection === "summary") {
    return db.prepare(`
      SELECT p.id, p.display_id, p.name, LEFT(p.description, 1024) AS description,
        p.visibility, p.created_by, p.created_at
      FROM projects p
      ${userId ? `WHERE EXISTS (
        SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?
      )` : ""}
      ORDER BY p.created_at DESC, p.id
    `).all(...(userId ? [userId] : []));
  }

  if (!userId) {
    return db.prepare(`
      SELECT
        projects.*,
        (SELECT COUNT(*)::INTEGER FROM requirements WHERE requirements.project_id = projects.id) AS story_count,
        (
          SELECT COUNT(*)::INTEGER
          FROM test_case_modules
          JOIN app_types ON app_types.id = test_case_modules.app_type_id
          WHERE app_types.project_id = projects.id
        ) AS module_count,
        (
          SELECT COUNT(*)::INTEGER
          FROM test_cases
          JOIN app_types ON app_types.id = test_cases.app_type_id
          WHERE app_types.project_id = projects.id
        ) AS case_count,
        (SELECT COUNT(*)::INTEGER FROM feedback WHERE feedback.project_id = projects.id) AS bug_count
      FROM projects
      ORDER BY projects.created_at DESC
    `).all();
  }
  
  // Only return projects where user is a member
  return db.prepare(`
    SELECT
      p.*,
      (SELECT COUNT(*)::INTEGER FROM requirements WHERE requirements.project_id = p.id) AS story_count,
      (
        SELECT COUNT(*)::INTEGER
        FROM test_case_modules
        JOIN app_types ON app_types.id = test_case_modules.app_type_id
        WHERE app_types.project_id = p.id
      ) AS module_count,
      (
        SELECT COUNT(*)::INTEGER
        FROM test_cases
        JOIN app_types ON app_types.id = test_cases.app_type_id
        WHERE app_types.project_id = p.id
      ) AS case_count,
      (SELECT COUNT(*)::INTEGER FROM feedback WHERE feedback.project_id = p.id) AS bug_count
    FROM projects p
    WHERE EXISTS (
      SELECT 1
      FROM project_members pm
      WHERE pm.project_id = p.id
        AND pm.user_id = ?
    )
    ORDER BY p.created_at DESC
  `).all(userId);
};

exports.getProject = async (id, userId = null) => {
  const project = await db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!project) throw new Error("Project not found");
  
  // If userId provided, verify user is a member
  if (userId) {
    const membership = await db.prepare(`
      SELECT id FROM project_members 
      WHERE project_id = ? AND user_id = ?
    `).get(id, userId);
    
    if (!membership) {
      throw new Error("Access denied: You are not a member of this project");
    }
  }
  
  return project;
};

exports.updateProject = async (id, data) => {
  const existing = await exports.getProject(id);
  const nextName = data.name === undefined ? existing.name : String(data.name || "").trim();
  const nextDescription = data.description === undefined
    ? existing.description
    : String(data.description || "").trim() || null;

  if (!nextName) {
    const error = new Error("Project name is required");
    error.statusCode = 400;
    throw error;
  }

  await db.prepare(`
    UPDATE projects SET name = ?, description = ?
    WHERE id = ?
  `).run(nextName, nextDescription, id);

  return { updated: true };
};

exports.deleteProject = async (id) => {
  const executeDelete = db.transaction(async () => {
    if (!(await db.query("SELECT id FROM projects WHERE id = $1 FOR UPDATE", [id])).rows.length) {
      throw Object.assign(new Error("Project not found"), { statusCode: 404 });
    }
    const projectAttachmentObjects = await attachmentService.listProjectObjects(id);
    // db.query executes on the caller's AsyncLocalStorage transaction client.
    await deleteProjectData({ client: db, projectId: id });
    return projectAttachmentObjects;
  });
  const projectAttachmentObjects = await executeDelete();
  const attachmentCleanup = await attachmentService.purgeProjectObjects(id, projectAttachmentObjects);
  return { deleted: true, attachment_cleanup: attachmentCleanup };
};
