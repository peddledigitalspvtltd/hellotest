const db = require("../db");
const obsDb = require("../obsDb");
const { randomUUID: uuid } = require("crypto");
const workspaceTransactionService = require("./workspaceTransaction.service");
const { hashPassword, verifyPassword } = require("../utils/token");

const normalizeEmail = (email) => {
  return email.toLowerCase().trim();
};

const normalizeName = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Name must be a string");
  }

  const normalized = value.trim();
  return normalized || null;
};

const IMAGE_DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i;
const MAX_AVATAR_DATA_URL_LENGTH = 2_000_000;

const selectRoleById = db.prepare(`
  SELECT id, name FROM roles WHERE id = ?
`);

const selectRoleByName = db.prepare(`
  SELECT id, name FROM roles WHERE LOWER(name) = LOWER(?)
`);

const selectUserById = db.prepare(`
  SELECT id, email, name, is_workspace_admin
  FROM users
  WHERE id = ?
`);

const selectUserPasswordById = db.prepare(`
  SELECT id, password_hash, auth_provider
  FROM users
  WHERE id = ?
`);

const selectProjectsCreatedByUser = db.prepare(`
  SELECT id, name
  FROM projects
  WHERE created_by = ?
  ORDER BY created_at ASC NULLS LAST, id ASC
`);

const selectAdminProjectsForUser = db.prepare(`
  SELECT DISTINCT projects.id, projects.name
  FROM project_members
  JOIN roles ON roles.id = project_members.role_id
  JOIN projects ON projects.id = project_members.project_id
  WHERE project_members.user_id = ?
    AND LOWER(roles.name) = 'admin'
  ORDER BY projects.name ASC, projects.id ASC
`);

const selectOtherProjectAdmin = db.prepare(`
  SELECT project_members.id, project_members.user_id
  FROM project_members
  JOIN roles ON roles.id = project_members.role_id
  WHERE project_members.project_id = ?
    AND project_members.user_id != ?
    AND LOWER(roles.name) = 'admin'
  ORDER BY project_members.id ASC
  LIMIT 1
`);

const selectWorkspaceAdminUsers = db.prepare(`
  SELECT users.id
  FROM users
  WHERE users.id != ?
    AND COALESCE(users.is_workspace_admin, FALSE) = TRUE
  ORDER BY users.id ASC
  LIMIT 1
`);

const selectProjectMembership = db.prepare(`
  SELECT id, role_id
  FROM project_members
  WHERE project_id = ? AND user_id = ?
`);

const insertProjectMembership = db.prepare(`
  INSERT INTO project_members (id, project_id, user_id, role_id)
  VALUES (?, ?, ?, ?)
`);

const updateProjectMembershipRole = db.prepare(`
  UPDATE project_members
  SET role_id = ?
  WHERE id = ?
`);

const updateProjectCreator = db.prepare(`
  UPDATE projects
  SET created_by = ?
  WHERE id = ? AND created_by = ?
`);

const clearExecutionAssignments = db.prepare(`
  UPDATE executions
  SET assigned_to = NULL
  WHERE assigned_to = ?
`);

const clearExecutionCaseAssignments = db.prepare(`
  UPDATE execution_case_snapshots
  SET assigned_to = NULL
  WHERE assigned_to = ?
`);

const clearExecutionScheduleAssignments = db.prepare(`
  UPDATE execution_schedules
  SET assigned_to = NULL
  WHERE assigned_to = ?
`);

const clearIssueAssignees = db.prepare(`
  UPDATE feedback
  SET assignee_id = NULL
  WHERE assignee_id = ?
`);

const clearExecutionsCreatedBy = db.prepare(`
  UPDATE executions
  SET created_by = NULL
  WHERE created_by = ?
`);

const clearExecutionResultExecutors = db.prepare(`
  UPDATE execution_results
  SET executed_by = NULL
  WHERE executed_by = ?
`);

const clearWorkspaceTransactionCreators = obsDb.prepare(`
  UPDATE workspace_transactions
  SET created_by = NULL
  WHERE created_by = ?
`);

const deleteFeedbackForUser = db.prepare(`
  DELETE FROM feedback
  WHERE user_id = ?
`);

const deleteProjectMembershipsForUser = db.prepare(`
  DELETE FROM project_members
  WHERE user_id = ?
`);

const deleteUserById = db.prepare(`
  DELETE FROM users
  WHERE id = ?
`);

const normalizeAvatarDataUrl = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Avatar image must be provided as a data URL");
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length > MAX_AVATAR_DATA_URL_LENGTH) {
    throw new Error("Avatar image is too large. Upload a smaller image and try again.");
  }

  if (!IMAGE_DATA_URL_PATTERN.test(normalized)) {
    throw new Error("Avatar image must be a valid base64-encoded image data URL.");
  }

  return normalized;
};

const isAdminRole = (role) => String(role?.name || "").trim().toLowerCase() === "admin";

exports.createUser = async ({ email, password, password_hash, name, role_id }) => {
  const resolvedPasswordHash = password ? hashPassword(password) : password_hash;

  if (!email || !resolvedPasswordHash || !role_id) {
    throw new Error("Missing required fields");
  }

  const normalizedEmail = normalizeEmail(email);

  const existing = await db.prepare(`
    SELECT id FROM users WHERE LOWER(email) = ?
  `).get(normalizedEmail);

  if (existing) throw new Error("User already exists");

  const role = await db.prepare(`
    SELECT id, name FROM roles WHERE id = ?
  `).get(role_id);

  if (!role) throw new Error("Role not found");

  const id = uuid();

  const createUserStatement = db.prepare(`
    INSERT INTO users (id, email, password_hash, name, is_workspace_admin, default_role_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const projects = await db.prepare(`SELECT id FROM projects`).all();
  const createMembership = db.prepare(`
    INSERT INTO project_members (id, project_id, user_id, role_id)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(async () => {
    await createUserStatement.run(id, normalizedEmail, resolvedPasswordHash, normalizeName(name), isAdminRole(role), role_id);

    for (const project of projects) {
      await createMembership.run(uuid(), project.id, id, role_id);
    }
  });

  await transaction();

  return { id };
};

exports.getUsers = async () => {
  return db.prepare(`
    SELECT users.id, users.email, users.name, users.username, users.avatar_data_url, users.auth_provider,
      users.email_verified, users.status, users.must_change_password, users.last_login_at, users.created_at,
      COALESCE(representative_role.id, default_role.id) AS role_id,
      COALESCE(representative_role.name, default_role.name) AS role_name,
      CASE
        WHEN COALESCE(users.is_workspace_admin, FALSE) THEN 'admin'
        ELSE 'member'
      END AS role
    FROM users
    LEFT JOIN LATERAL (
      SELECT roles.id, roles.name
      FROM project_members
      JOIN roles ON roles.id = project_members.role_id
      WHERE project_members.user_id = users.id
      ORDER BY CASE WHEN LOWER(roles.name) = 'admin' THEN 0 ELSE 1 END, roles.name ASC
      LIMIT 1
    ) representative_role ON TRUE
    LEFT JOIN roles default_role ON default_role.id = users.default_role_id
    ORDER BY created_at DESC
  `).all();
};

exports.getUser = async (id) => {
  const user = await db.prepare(`
    SELECT users.id, users.email, users.name, users.username, users.avatar_data_url, users.auth_provider,
      users.email_verified, users.status, users.must_change_password, users.last_login_at, users.created_at,
      COALESCE(representative_role.id, default_role.id) AS role_id,
      COALESCE(representative_role.name, default_role.name) AS role_name,
      CASE
        WHEN COALESCE(users.is_workspace_admin, FALSE) THEN 'admin'
        ELSE 'member'
      END AS role
    FROM users
    LEFT JOIN LATERAL (
      SELECT roles.id, roles.name
      FROM project_members
      JOIN roles ON roles.id = project_members.role_id
      WHERE project_members.user_id = users.id
      ORDER BY CASE WHEN LOWER(roles.name) = 'admin' THEN 0 ELSE 1 END, roles.name ASC
      LIMIT 1
    ) representative_role ON TRUE
    LEFT JOIN roles default_role ON default_role.id = users.default_role_id
    WHERE users.id = ?
  `).get(id);

  if (!user) throw new Error("User not found");

  return user;
};

exports.updateUser = async (id, data) => {
  const existing = await db.prepare(`
    SELECT * FROM users WHERE id = ?
  `).get(id);

  if (!existing) throw new Error("User not found");

  if (data.email && data.email !== existing.email) {
    const normalizedNewEmail = normalizeEmail(data.email);
    const normalizedExistingEmail = normalizeEmail(existing.email);
    
    if (normalizedNewEmail !== normalizedExistingEmail) {
      const duplicate = await db.prepare(`
        SELECT id FROM users WHERE LOWER(email) = ? AND id != ?
      `).get(normalizedNewEmail, id);

      if (duplicate) throw new Error("User email already exists");
    }
  }

  let nextRole = null;

  if (data.role_id) {
    nextRole = await db.prepare(`
      SELECT id, name FROM roles WHERE id = ?
    `).get(data.role_id);

    if (!nextRole) throw new Error("Role not found");
  }

  const nextAvatarDataUrl =
    data.avatar_data_url !== undefined
      ? normalizeAvatarDataUrl(data.avatar_data_url)
      : existing.avatar_data_url;
  const nextName =
    data.name !== undefined
      ? normalizeName(data.name)
      : existing.name;
  const nextPasswordHash = data.password ? hashPassword(data.password) : data.password_hash;

  const updateUserStatement = db.prepare(`
    UPDATE users
    SET email = ?, password_hash = ?, name = ?, avatar_data_url = ?, is_workspace_admin = ?, default_role_id = ?
    WHERE id = ?
  `);
  const updateMembershipRoles = db.prepare(`
    UPDATE project_members
    SET role_id = ?
    WHERE user_id = ?
  `);

  const transaction = db.transaction(async () => {
    const emailToUpdate = data.email ? normalizeEmail(data.email) : existing.email;
    await updateUserStatement.run(
      emailToUpdate,
      nextPasswordHash ?? existing.password_hash,
      nextName,
      nextAvatarDataUrl,
      nextRole ? isAdminRole(nextRole) : existing.is_workspace_admin,
      nextRole?.id || existing.default_role_id || null,
      id
    );

    if (data.role_id) {
      await updateMembershipRoles.run(data.role_id, id);
    }
  });

  await transaction();

  return { updated: true };
};

exports.changeOwnPassword = async ({ id, current_password, new_password }) => {
  if (!id) {
    throw new Error("User is required");
  }

  if (!current_password || !new_password) {
    throw new Error("Current password and new password are required");
  }

  if (new_password.length < 6) {
    throw new Error("New password must be at least 6 characters");
  }

  if (new_password.length > 128) {
    throw new Error("New password must be no more than 128 characters");
  }

  const user = await selectUserPasswordById.get(id);

  if (!user) {
    throw new Error("User not found");
  }

  if (user.auth_provider === "google") {
    const error = new Error("Google Sign-In accounts do not use a local password.");
    error.statusCode = 400;
    throw error;
  }

  if (!verifyPassword(current_password, user.password_hash)) {
    const error = new Error("Current password is incorrect");
    error.statusCode = 400;
    throw error;
  }

  await db.prepare(`
    UPDATE users
    SET password_hash = ?, must_change_password = FALSE
    WHERE id = ?
  `).run(hashPassword(new_password), id);

  return { updated: true };
};

exports.deleteUser = async (id) => {
  const user = await selectUserById.get(id);

  if (!user) throw new Error("User not found");

  const adminRole = await selectRoleByName.get("admin");

  if (!adminRole) {
    throw new Error("Admin role not found");
  }

  const affectedProjects = new Map();
  const createdProjects = await selectProjectsCreatedByUser.all(id);
  const adminProjects = await selectAdminProjectsForUser.all(id);

  createdProjects.forEach((project) => {
    affectedProjects.set(project.id, project);
  });
  adminProjects.forEach((project) => {
    affectedProjects.set(project.id, project);
  });

  const fallbackAdminByProjectId = new Map();

  for (const project of affectedProjects.values()) {
    const existingProjectAdmin = await selectOtherProjectAdmin.get(project.id, id);

    if (existingProjectAdmin?.user_id) {
      fallbackAdminByProjectId.set(project.id, existingProjectAdmin.user_id);
      continue;
    }

    const workspaceAdmin = await selectWorkspaceAdminUsers.get(id);

    if (!workspaceAdmin?.id) {
      throw new Error(`Cannot delete ${user.name || user.email} because project "${project.name}" would be left without an admin.`);
    }

    fallbackAdminByProjectId.set(project.id, workspaceAdmin.id);
  }

  const transaction = db.transaction(async () => {
    for (const [projectId, fallbackAdminId] of fallbackAdminByProjectId.entries()) {
      const existingProjectAdmin = await selectOtherProjectAdmin.get(projectId, id);

      if (!existingProjectAdmin) {
        const membership = await selectProjectMembership.get(projectId, fallbackAdminId);

        if (membership?.id) {
          if (membership.role_id !== adminRole.id) {
            await updateProjectMembershipRole.run(adminRole.id, membership.id);
          }
        } else {
          await insertProjectMembership.run(uuid(), projectId, fallbackAdminId, adminRole.id);
        }
      }

      await updateProjectCreator.run(fallbackAdminId, projectId, id);
    }

    await clearExecutionAssignments.run(id);
    await clearExecutionCaseAssignments.run(id);
    await clearExecutionScheduleAssignments.run(id);
    await clearIssueAssignees.run(id);
    await clearExecutionsCreatedBy.run(id);
    await clearExecutionResultExecutors.run(id);
    await deleteFeedbackForUser.run(id);
    await deleteProjectMembershipsForUser.run(id);
    await deleteUserById.run(id);
  });

  const obsTransaction = obsDb.transaction(async () => {
    await clearWorkspaceTransactionCreators.run(id);
  });

  await obsTransaction();
  await transaction();

  return { deleted: true };
};

const normalizeImportValue = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
};

const resolveImportRoleId = async (row, defaultRoleId) => {
  const directRoleId = normalizeImportValue(row?.role_id ?? row?.roleId);

  if (directRoleId) {
    const role = await selectRoleById.get(directRoleId);

    if (!role) {
      throw new Error(`Role not found: ${directRoleId}`);
    }

    return role.id;
  }

  const roleName = normalizeImportValue(row?.role);

  if (roleName) {
    const role = await selectRoleByName.get(roleName);

    if (!role) {
      throw new Error(`Role not found: ${roleName}`);
    }

    return role.id;
  }

  if (defaultRoleId) {
    const role = await selectRoleById.get(defaultRoleId);

    if (!role) {
      throw new Error("Default role not found");
    }

    return role.id;
  }

  throw new Error("Each imported user must include a role or you must choose a default role.");
};

const resolveImportPasswordHash = (row) => {
  const existingHash = normalizeImportValue(row?.password_hash ?? row?.passwordHash);

  if (existingHash) {
    return existingHash;
  }

  const password = normalizeImportValue(row?.password);

  if (!password) {
    throw new Error("Each imported user must include a password or password hash.");
  }

  return hashPassword(password);
};

exports.bulkImportUsers = async ({ rows = [], default_role_id, created_by, transaction_id } = {}) => {
  const defaultRoleId = normalizeImportValue(default_role_id);

  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("At least one CSV row is required");
  }

  if (defaultRoleId) {
    const role = await selectRoleById.get(defaultRoleId);

    if (!role) {
      throw new Error("Default role not found");
    }
  }

  const transaction = transaction_id
    ? await workspaceTransactionService.updateTransaction(transaction_id, {
        category: "bulk_import",
        action: "user_import",
        status: "running",
        title: "Bulk user import",
        description: `Importing ${rows.length} user${rows.length === 1 ? "" : "s"} from CSV.`,
        metadata: {
          import_source: "csv",
          total_rows: rows.length,
          total_items: rows.length,
          processed_items: 0,
          progress_percent: 0,
          current_phase: "prepare"
        },
        started_at: new Date().toISOString()
      })
    : await workspaceTransactionService.createTransaction({
        category: "bulk_import",
        action: "user_import",
        status: "running",
        title: "Bulk user import",
        description: `Importing ${rows.length} user${rows.length === 1 ? "" : "s"} from CSV.`,
        metadata: {
          import_source: "csv",
          total_rows: rows.length,
          total_items: rows.length,
          processed_items: 0,
          progress_percent: 0,
          current_phase: "prepare"
        },
        created_by,
        started_at: new Date().toISOString()
      });
  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    phase: "prepare",
    message: `Started user import for ${rows.length} CSV row${rows.length === 1 ? "" : "s"}.`,
    details: {
      import_source: "csv",
      total_rows: rows.length,
      default_role_id: defaultRoleId
    }
  });

  const created = [];
  const errors = [];

  for (const [index, row] of rows.entries()) {
    const email = normalizeImportValue(row?.email);

    try {
      if (!email) {
        throw new Error("Email is required");
      }

      const roleId = await resolveImportRoleId(row, defaultRoleId);
      const password_hash = resolveImportPasswordHash(row);
      const response = await exports.createUser({
        email,
        password_hash,
        name: normalizeImportValue(row?.name),
        role_id: roleId
      });

      created.push({
        row: index + 1,
        id: response.id,
        email
      });
    } catch (error) {
      errors.push({
        row: index + 1,
        email,
        message: error.message || "Unable to import user"
      });
    }

    const processed = index + 1;

    if (processed === 1 || processed === rows.length || processed % 10 === 0) {
      await workspaceTransactionService.updateTransaction(transaction.id, {
        description: `Imported ${created.length} of ${rows.length} user${rows.length === 1 ? "" : "s"} so far.`,
        metadata: {
          processed_items: processed,
          total_items: rows.length,
          imported: created.length,
          failed: errors.length,
          progress_percent: rows.length ? Math.round((processed / rows.length) * 100) : 0,
          current_phase: "import"
        }
      });
      await workspaceTransactionService.appendTransactionEvent(transaction.id, {
        phase: "import",
        message: `Processed ${processed} of ${rows.length} user row${rows.length === 1 ? "" : "s"}.`,
        details: {
          processed_items: processed,
          total_items: rows.length,
          imported: created.length,
          failed: errors.length
        }
      });
    }
  }

  await workspaceTransactionService.updateTransaction(transaction.id, {
    status: created.length ? "completed" : "failed",
    description: created.length
      ? `Imported ${created.length} of ${rows.length} user${rows.length === 1 ? "" : "s"} from CSV.`
      : "No users were imported from the CSV file.",
    metadata: {
      import_source: "csv",
      total_rows: rows.length,
      total_items: rows.length,
      processed_items: rows.length,
      imported: created.length,
      failed: errors.length,
      progress_percent: 100,
      current_phase: "completed",
      default_role_id: defaultRoleId
    },
    completed_at: new Date().toISOString()
  });
  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    level: created.length ? "success" : "error",
    phase: "complete",
    message: created.length
      ? `Imported ${created.length} user${created.length === 1 ? "" : "s"} with ${errors.length} failure${errors.length === 1 ? "" : "s"}.`
      : "User import completed with no created accounts.",
    details: {
      imported: created.length,
      failed: errors.length,
      sample_errors: errors.slice(0, 10)
    }
  });

  return {
    imported: created.length,
    failed: errors.length,
    created,
    errors
  };
};
