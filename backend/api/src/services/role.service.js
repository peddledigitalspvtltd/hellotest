const db = require("../db");
const { randomUUID: uuid } = require("crypto");
const { DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS } = require("../security/permissions.catalog");
const featureFlagService = require("./featureFlag.service");

const normalizeRoleName = (name) => String(name || "").trim();

const resolveDefaultPermissionCodes = (name, explicitCodes) => {
  if (Array.isArray(explicitCodes)) {
    return explicitCodes;
  }

  return DEFAULT_ROLE_PERMISSIONS[normalizeRoleName(name).toLowerCase()] || DEFAULT_ROLE_PERMISSIONS.member || [];
};

const resolvePermissionsByCode = async (permissionCodes = []) => {
  if (!Array.isArray(permissionCodes)) {
    throw new Error("permission_codes must be an array");
  }

  const normalizedCodes = [...new Set(permissionCodes.map((code) => String(code || "").trim()).filter(Boolean))];
  const allPermissions = await db.prepare(`
    SELECT id, code, description
    FROM permissions
    ORDER BY code ASC
  `).all();
  const requestedCodeSet = new Set(normalizedCodes);
  const permissions = allPermissions.filter((permission) => requestedCodeSet.has(permission.code));
  const foundCodes = new Set(permissions.map((permission) => permission.code));
  const missingCodes = normalizedCodes.filter((code) => !foundCodes.has(code));

  if (missingCodes.length) {
    throw new Error(`Unknown permissions: ${missingCodes.join(", ")}`);
  }

  const disabledCodes = await featureFlagService.getDisabledPermissionCodes(normalizedCodes);

  if (disabledCodes.length) {
    throw new Error(`Permissions disabled by feature availability: ${disabledCodes.join(", ")}`);
  }

  return permissions;
};

const assignRolePermissions = async (id, permissions) => {
  await db.prepare(`DELETE FROM role_permissions WHERE role_id = ?`).run(id);

  for (const permission of permissions) {
    await db.prepare(`
      INSERT INTO role_permissions (role_id, permission_id)
      VALUES (?, ?)
      ON CONFLICT (role_id, permission_id) DO NOTHING
    `).run(id, permission.id);
  }
};

exports.createRole = async ({ name, permission_codes }) => {
  const normalizedName = normalizeRoleName(name);
  if (normalizedName.length < 2) {
    throw new Error("Role name must contain at least 2 characters");
  }

  const existing = await db.prepare(`
    SELECT id FROM roles WHERE LOWER(name) = LOWER(?)
  `).get(normalizedName);

  if (existing) throw new Error("Role already exists");

  const id = uuid();
  const permissions = await resolvePermissionsByCode(resolveDefaultPermissionCodes(normalizedName, permission_codes));

  await db.transaction(async () => {
    await db.prepare(`
      INSERT INTO roles (id, name)
      VALUES (?, ?)
    `).run(id, normalizedName);

    await assignRolePermissions(id, permissions);
  })();

  return { id };
};

exports.getRoles = async () => {
  return db.prepare(`
    SELECT * FROM roles
    ORDER BY name ASC
  `).all();
};

exports.getRole = async (id) => {
  const role = await db.prepare(`
    SELECT * FROM roles WHERE id = ?
  `).get(id);

  if (!role) throw new Error("Role not found");

  return role;
};

exports.getRolePermissions = async (id) => {
  await exports.getRole(id);

  const permissions = await db.prepare(`
    SELECT permissions.id, permissions.code, permissions.description
    FROM role_permissions
    JOIN permissions ON permissions.id = role_permissions.permission_id
    WHERE role_permissions.role_id = ?
    ORDER BY permissions.code ASC
  `).all(id);

  return featureFlagService.filterPermissionsByEnabledFeatures(permissions);
};

exports.listPermissions = async () => {
  const permissions = await db.prepare(`
    SELECT id, code, description
    FROM permissions
    ORDER BY code ASC
  `).all();

  const permissionByCode = new Map(permissions.map((permission) => [permission.code, permission]));

  const availablePermissionGroups = await featureFlagService.filterPermissionGroupsByEnabledFeatures(PERMISSION_GROUPS);

  return availablePermissionGroups.map((group) => ({
    key: group.key,
    label: group.label,
    permissions: group.permissions
      .map(([code, fallbackDescription]) => permissionByCode.get(code) || {
        id: `perm_${code.replace(/[^a-z0-9]+/g, "_")}`,
        code,
        description: fallbackDescription
      })
      .filter(Boolean)
  }));
};

exports.replaceRolePermissions = async (id, permissionCodes = []) => {
  await exports.getRole(id);

  const permissions = await resolvePermissionsByCode(permissionCodes);

  await db.transaction(async () => {
    await assignRolePermissions(id, permissions);
  })();

  return {
    updated: true,
    permission_codes: permissions.map((permission) => permission.code).sort()
  };
};

exports.updateRole = async (id, data) => {
  const existing = await exports.getRole(id);
  const normalizedName = data.name !== undefined ? normalizeRoleName(data.name) : existing.name;

  if (normalizedName.length < 2) {
    throw new Error("Role name must contain at least 2 characters");
  }

  if (normalizedName.toLowerCase() !== existing.name.toLowerCase()) {
    const duplicate = await db.prepare(`
      SELECT id FROM roles WHERE LOWER(name) = LOWER(?) AND id != ?
    `).get(normalizedName, id);

    if (duplicate) throw new Error("Role already exists");
  }

  await db.transaction(async () => {
    await db.prepare(`
      UPDATE roles
      SET name = ?
      WHERE id = ?
    `).run(normalizedName, id);

    if (Array.isArray(data.permission_codes)) {
      const permissions = await resolvePermissionsByCode(data.permission_codes);
      await assignRolePermissions(id, permissions);
    }
  })();

  return { updated: true };
};

exports.deleteRole = async (id) => {
  await exports.getRole(id);

  const used = await db.prepare(`
    SELECT id FROM project_members WHERE role_id = ?
    UNION ALL
    SELECT id FROM users WHERE default_role_id = ?
    LIMIT 1
  `).get(id, id);

  if (used) {
    throw new Error("Cannot delete a role while it is assigned to users or project members");
  }

  await db.prepare(`
    DELETE FROM roles WHERE id = ?
  `).run(id);

  return { deleted: true };
};
