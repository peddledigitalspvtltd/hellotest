const db = require("../db");
const { randomUUID: uuid } = require("crypto");
const { buildVariablesForStorage, sanitizeVariablesForRead } = require("../utils/contextVariables");
const {
  TARGET_FIELDS,
  buildConfigurationTargetsForStorage,
  configurationTargetsForRead,
  parseStoredConfigurationTargets
} = require("../utils/configurationTargets");
const { validateProjectAppTypeScope } = require("./projectScope.service");

const hydrateConfiguration = (row) => ({
  ...row,
  variables: sanitizeVariablesForRead(row.variables),
  browser: row.browser || null,
  mobile_os: row.mobile_os || null,
  platform_version: row.platform_version || null,
  targets: configurationTargetsForRead(row.targets, row)
});

exports.createTestConfiguration = async ({ project_id, app_type_id, name, description, browser, mobile_os, platform_version, targets, variables }) => {
  if (!project_id || !name) {
    throw new Error("Missing required fields");
  }

  await validateProjectAppTypeScope(project_id, app_type_id);

  const id = uuid();
  const storedTargets = targets === undefined ? [] : buildConfigurationTargetsForStorage(targets);
  const primaryTarget = storedTargets[0] || null;

  await db.prepare(`
    INSERT INTO test_configurations (
      id,
      project_id,
      app_type_id,
      name,
      description,
      browser,
      mobile_os,
      platform_version,
      targets,
      variables
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    project_id,
    app_type_id || null,
    String(name).trim(),
    description || null,
    primaryTarget?.browser || browser || null,
    primaryTarget?.mobile_os || mobile_os || null,
    primaryTarget?.version || platform_version || null,
    storedTargets,
    buildVariablesForStorage(variables)
  );

  return { id };
};

exports.getTestConfigurations = async ({ project_id, app_type_id }) => {
  let query = `
    SELECT *
    FROM test_configurations
    WHERE 1 = 1
  `;
  const params = [];

  if (project_id) {
    query += ` AND project_id = ?`;
    params.push(project_id);
  }

  if (app_type_id) {
    query += ` AND (app_type_id = ? OR app_type_id IS NULL)`;
    params.push(app_type_id);
  }

  query += `
    ORDER BY
      CASE WHEN app_type_id IS NULL THEN 0 ELSE 1 END,
      name ASC,
      created_at DESC
  `;

  const rows = await db.prepare(query).all(...params);
  return rows.map(hydrateConfiguration);
};

exports.getTestConfiguration = async (id) => {
  const configuration = await db.prepare(`
    SELECT *
    FROM test_configurations
    WHERE id = ?
  `).get(id);

  if (!configuration) {
    throw new Error("Test configuration not found");
  }

  return hydrateConfiguration(configuration);
};

exports.updateTestConfiguration = async (id, data) => {
  const existing = await db.prepare(`
    SELECT *
    FROM test_configurations
    WHERE id = ?
  `).get(id);

  if (!existing) {
    throw new Error("Test configuration not found");
  }

  const projectId = data.project_id ?? existing.project_id;
  const appTypeId = data.app_type_id === undefined ? existing.app_type_id : data.app_type_id || null;
  const updatesTargets = Object.prototype.hasOwnProperty.call(data, "targets");
  const updatedLegacyTargetFields = [
    ["browser", "browser"],
    ["mobile_os", "mobile_os"],
    ["platform_version", "version"]
  ].filter(([legacyField]) => Object.prototype.hasOwnProperty.call(data, legacyField));
  let storedTargets = existing.targets;
  if (updatesTargets) {
    storedTargets = buildConfigurationTargetsForStorage(data.targets);
  } else if (updatedLegacyTargetFields.length) {
    const existingTargets = parseStoredConfigurationTargets(existing.targets);
    if (existingTargets.length) {
      const primary = { ...existingTargets[0] };
      updatedLegacyTargetFields.forEach(([legacyField, targetField]) => {
        primary[targetField] = String(data[legacyField] || "").trim();
      });
      const synchronizedTargets = TARGET_FIELDS.some((field) => primary[field])
        ? [primary, ...existingTargets.slice(1)]
        : existingTargets.slice(1);
      storedTargets = buildConfigurationTargetsForStorage(synchronizedTargets);
    }
  }
  const primaryTarget = updatesTargets ? storedTargets[0] || null : null;
  const resolveLegacyValue = (field, targetField) => {
    if (updatesTargets) return primaryTarget?.[targetField] || null;
    if (Object.prototype.hasOwnProperty.call(data, field)) return data[field] || null;
    return existing[field];
  };

  await validateProjectAppTypeScope(projectId, appTypeId);

  await db.prepare(`
    UPDATE test_configurations
    SET
      project_id = ?,
      app_type_id = ?,
      name = ?,
      description = ?,
      browser = ?,
      mobile_os = ?,
      platform_version = ?,
      targets = ?,
      variables = ?
    WHERE id = ?
  `).run(
    projectId,
    appTypeId,
    data.name !== undefined ? String(data.name).trim() : existing.name,
    data.description !== undefined ? data.description || null : existing.description,
    resolveLegacyValue("browser", "browser"),
    resolveLegacyValue("mobile_os", "mobile_os"),
    resolveLegacyValue("platform_version", "version"),
    storedTargets,
    data.variables !== undefined ? buildVariablesForStorage(data.variables, existing.variables) : existing.variables,
    id
  );

  return { updated: true };
};

exports.deleteTestConfiguration = async (id) => {
  const deleted = await db.prepare(`
    DELETE FROM test_configurations
    WHERE id = ?
    RETURNING id
  `).get(id);

  if (!deleted) {
    throw new Error("Test configuration not found");
  }

  return { deleted: true };
};
