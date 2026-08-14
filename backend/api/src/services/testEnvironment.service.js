const db = require("../db");
const { randomUUID: uuid } = require("crypto");
const { buildVariablesForStorage, sanitizeVariablesForRead } = require("../utils/contextVariables");
const { validateProjectAppTypeScope } = require("./projectScope.service");

const hydrateEnvironment = (row) => ({
  ...row,
  variables: sanitizeVariablesForRead(row.variables)
});

exports.createTestEnvironment = async ({ project_id, app_type_id, name, description, base_url, browser, notes, variables }) => {
  if (!project_id || !name) {
    throw new Error("Missing required fields");
  }

  await validateProjectAppTypeScope(project_id, app_type_id);

  const id = uuid();

  await db.prepare(`
    INSERT INTO test_environments (
      id,
      project_id,
      app_type_id,
      name,
      description,
      base_url,
      browser,
      notes,
      variables
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    project_id,
    app_type_id || null,
    String(name).trim(),
    description || null,
    base_url || null,
    browser || null,
    notes || null,
    buildVariablesForStorage(variables)
  );

  return { id };
};

exports.getTestEnvironments = async ({ project_id, app_type_id }) => {
  let query = `
    SELECT *
    FROM test_environments
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
  return rows.map(hydrateEnvironment);
};

exports.getTestEnvironment = async (id) => {
  const environment = await db.prepare(`
    SELECT *
    FROM test_environments
    WHERE id = ?
  `).get(id);

  if (!environment) {
    throw new Error("Test environment not found");
  }

  return hydrateEnvironment(environment);
};

exports.updateTestEnvironment = async (id, data) => {
  const existing = await db.prepare(`
    SELECT *
    FROM test_environments
    WHERE id = ?
  `).get(id);

  if (!existing) {
    throw new Error("Test environment not found");
  }

  const projectId = data.project_id ?? existing.project_id;
  const appTypeId = data.app_type_id === undefined ? existing.app_type_id : data.app_type_id || null;

  await validateProjectAppTypeScope(projectId, appTypeId);

  await db.prepare(`
    UPDATE test_environments
    SET
      project_id = ?,
      app_type_id = ?,
      name = ?,
      description = ?,
      base_url = ?,
      browser = ?,
      notes = ?,
      variables = ?
    WHERE id = ?
  `).run(
    projectId,
    appTypeId,
    data.name !== undefined ? String(data.name).trim() : existing.name,
    data.description !== undefined ? data.description || null : existing.description,
    data.base_url !== undefined ? data.base_url || null : existing.base_url,
    data.browser !== undefined ? data.browser || null : existing.browser,
    data.notes !== undefined ? data.notes || null : existing.notes,
    data.variables !== undefined ? buildVariablesForStorage(data.variables, existing.variables) : existing.variables,
    id
  );

  return { updated: true };
};

exports.deleteTestEnvironment = async (id) => {
  const deleted = await db.prepare(`
    DELETE FROM test_environments
    WHERE id = ?
    RETURNING id
  `).get(id);

  if (!deleted) {
    throw new Error("Test environment not found");
  }

  return { deleted: true };
};
