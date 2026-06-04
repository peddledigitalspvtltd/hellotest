const db = require("../db");
const { v4: uuid } = require("uuid");
const { DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS } = require("../security/permissions.catalog");

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
  if (!name) {
    throw new Error("Missing required fields");
  }

  const normalizedName = normalizeRoleName(name);
  const existing = await db.prepare(`
    SELECT id FROM roles WHERE name = ?
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

  return db.prepare(`
    SELECT permissions.id, permissions.code, permissions.description
    FROM role_permissions
    JOIN permissions ON permissions.id = role_permissions.permission_id
    WHERE role_permissions.role_id = ?
    ORDER BY permissions.code ASC
  `).all(id);
};

exports.listPermissions = async () => {
  const permissions = await db.prepare(`
    SELECT id, code, description
    FROM permissions
    ORDER BY code ASC
  `).all();

  const permissionByCode = new Map(permissions.map((permission) => [permission.code, permission]));

  return PERMISSION_GROUPS.map((group) => ({
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

  if (data.name && data.name !== existing.name) {
    const duplicate = await db.prepare(`
      SELECT id FROM roles WHERE name = ? AND id != ?
    `).get(data.name, id);

    if (duplicate) throw new Error("Role already exists");
  }

  await db.transaction(async () => {
    await db.prepare(`
      UPDATE roles
      SET name = ?
      WHERE id = ?
    `).run(data.name ?? existing.name, id);

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
  `).get(id);

  if (used) {
    throw new Error("Cannot delete role assigned to project members");
  }

  await db.prepare(`
    DELETE FROM roles WHERE id = ?
  `).run(id);

  return { deleted: true };
};
