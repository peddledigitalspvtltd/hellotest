const db = require("../src/db");
const { randomUUID } = require("crypto");
const { DEFAULT_ROLE_PRESETS, normalizePresetRoleName } = require("../src/security/rolePresets.catalog");

const placeholders = values => values.map(() => "?").join(", ");
const readRoles = (presets = DEFAULT_ROLE_PRESETS) => db.prepare(`
  SELECT roles.id, roles.name,
    COALESCE(json_agg(DISTINCT permissions.code) FILTER (WHERE permissions.code IS NOT NULL), '[]'::json) AS permission_codes
  FROM roles
  LEFT JOIN role_permissions ON role_permissions.role_id = roles.id
  LEFT JOIN permissions ON permissions.id = role_permissions.permission_id
  WHERE LOWER(BTRIM(roles.name)) IN (${placeholders(presets)})
  GROUP BY roles.id, roles.name
  ORDER BY roles.name, roles.id
`).all(...presets.map(role => normalizePresetRoleName(role.name)));

const matchRole = (rows, preset) => rows.find(role => role.name === preset.name)
  || rows.find(role => normalizePresetRoleName(role.name) === normalizePresetRoleName(preset.name));

async function getSetupRoleCatalog(presets = DEFAULT_ROLE_PRESETS) {
  const rows = await readRoles(presets);
  return presets.map(preset => {
    const role = matchRole(rows, preset);
    const current = [...new Set(role?.permission_codes || [])].sort();
    const matches = current.length === preset.permission_codes.length
      && current.every((code, index) => code === preset.permission_codes[index]);
    return {
      ...preset,
      permission_codes: [...preset.permission_codes],
      role_id: role?.id || null,
      status: !role ? "not_installed" : matches ? "installed" : "customized",
      current_permission_codes: current
    };
  });
}

async function ensureSetupRoles(presets = DEFAULT_ROLE_PRESETS) {
  return db.transaction(async () => {
    // Also safe when called inside the schema or sample-install transaction.
    await db.prepare("SELECT pg_advisory_xact_lock(hashtext('hellotest:default-role-presets:v1'))").get();
    const existing = await readRoles(presets);
    const missing = presets.filter(preset => !matchRole(existing, preset));
    const requestedCodes = [...new Set(missing.flatMap(role => role.permission_codes))];
    if (requestedCodes.length) {
      const permissions = await db.prepare(`SELECT id, code FROM permissions WHERE code IN (${placeholders(requestedCodes)})`).all(...requestedCodes);
      const available = new Set(permissions.map(permission => permission.code));
      const unavailable = requestedCodes.filter(code => !available.has(code));
      if (unavailable.length) {
        throw Object.assign(new Error(`Default roles require the current permission schema. Missing permissions: ${unavailable.join(", ")}`), { statusCode: 409 });
      }
    }

    const created = [], retained = [];
    for (const preset of presets) {
      const existingRole = matchRole(existing, preset);
      if (existingRole) {
        retained.push({ id: existingRole.id, name: existingRole.name });
        continue;
      }
      const role = await db.prepare(`
        INSERT INTO roles (id, name)
        SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM roles WHERE LOWER(BTRIM(name)) = ?)
        ON CONFLICT DO NOTHING
        RETURNING id, name
      `).get(preset.id || randomUUID(), preset.name, normalizePresetRoleName(preset.name));
      if (!role) {
        const racedRole = await db.prepare("SELECT id, name FROM roles WHERE LOWER(BTRIM(name)) = ? ORDER BY id LIMIT 1").get(normalizePresetRoleName(preset.name));
        if (!racedRole) throw new Error(`Unable to create default role ${preset.name}`);
        retained.push({ id: racedRole.id, name: racedRole.name });
        continue;
      }
      // Only a row returned by this INSERT receives default grants. An existing
      // role with zero grants is intentional custom access, not an incomplete seed.
      await db.prepare(`
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT ?, permissions.id FROM permissions
        WHERE permissions.code IN (${placeholders(preset.permission_codes)})
        ON CONFLICT (role_id, permission_id) DO NOTHING
      `).run(role.id, ...preset.permission_codes);
      created.push({ id: role.id, name: role.name });
    }
    return { created, retained };
  })();
}

module.exports = { ensureSetupRoles, getSetupRoleCatalog };
