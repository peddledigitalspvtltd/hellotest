const db = require("../db");
const { randomUUID: uuid } = require("crypto");
const { TEST_DATA_SET_MODE_VALUES } = require("../domain/catalog");
const { validateProjectAppTypeScope } = require("./projectScope.service");

const INVALID_DATA_SET_CHAR_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const DEFAULT_DATA_SET_MODE = TEST_DATA_SET_MODE_VALUES.includes("table") ? "table" : TEST_DATA_SET_MODE_VALUES[0];

const normalizeMode = (mode) => (TEST_DATA_SET_MODE_VALUES.includes(mode) ? mode : DEFAULT_DATA_SET_MODE);

const sanitizeDataSetText = (value) =>
  String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(INVALID_DATA_SET_CHAR_PATTERN, "");

const normalizeName = (value) => sanitizeDataSetText(value).trim();

const parseJsonArray = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
};

const normalizeColumns = (mode, columns = [], rows = []) => {
  if (mode === "key_value") {
    return ["key", "value"];
  }

  const normalizedColumns = Array.isArray(columns)
    ? [...new Set(columns.map((column) => normalizeName(column)).filter(Boolean))]
    : [];

  if (normalizedColumns.length) {
    return normalizedColumns;
  }

  const firstRow = Array.isArray(rows) ? rows.find((row) => row && typeof row === "object") : null;
  return firstRow ? Object.keys(firstRow).map((column) => normalizeName(column)).filter(Boolean) : [];
};

const normalizeRows = (mode, rows = [], columns = []) => {
  if (!Array.isArray(rows)) {
    return [];
  }

  if (mode === "key_value") {
    return rows
      .map((row = {}) => ({
        key: normalizeName(row.key || ""),
        value: sanitizeDataSetText(row.value || "")
      }))
      .filter((row) => row.key);
  }

  return rows
    .map((row = {}) => {
      const normalizedRow = {};

      columns.forEach((column) => {
        normalizedRow[column] = sanitizeDataSetText(row[column] ?? "");
      });

      return normalizedRow;
    })
    .filter((row) => Object.values(row).some((value) => String(value || "").trim()));
};

const hydrateDataSet = (row) => ({
  ...row,
  mode: normalizeMode(row.mode),
  columns: parseJsonArray(row.columns).map((column) => normalizeName(column)).filter(Boolean),
  rows: parseJsonArray(row.rows)
});

exports.createTestDataSet = async ({ project_id, app_type_id, name, description, mode, columns, rows }) => {
  if (!project_id || !name) {
    throw new Error("Missing required fields");
  }

  await validateProjectAppTypeScope(project_id, app_type_id);

  const normalizedMode = normalizeMode(mode);
  const normalizedColumns = normalizeColumns(normalizedMode, columns, rows);
  const normalizedRows = normalizeRows(normalizedMode, rows, normalizedColumns);
  const id = uuid();

  await db.prepare(`
    INSERT INTO test_data_sets (
      id,
      project_id,
      app_type_id,
      name,
      description,
      mode,
      columns,
      rows
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    project_id,
    app_type_id || null,
    normalizeName(name),
    sanitizeDataSetText(description) || null,
    normalizedMode,
    normalizedColumns,
    normalizedRows
  );

  return { id };
};

exports.getTestDataSets = async ({ project_id, app_type_id }) => {
  let query = `
    SELECT *
    FROM test_data_sets
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
  return rows.map(hydrateDataSet);
};

exports.getTestDataSet = async (id) => {
  const dataSet = await db.prepare(`
    SELECT *
    FROM test_data_sets
    WHERE id = ?
  `).get(id);

  if (!dataSet) {
    throw new Error("Test data set not found");
  }

  return hydrateDataSet(dataSet);
};

exports.updateTestDataSet = async (id, data) => {
  const existing = await exports.getTestDataSet(id);
  const projectId = data.project_id ?? existing.project_id;
  const appTypeId = data.app_type_id === undefined ? existing.app_type_id : data.app_type_id || null;

  await validateProjectAppTypeScope(projectId, appTypeId);

  const nextMode = normalizeMode(data.mode ?? existing.mode);
  const nextColumns = normalizeColumns(
    nextMode,
    data.columns !== undefined ? data.columns : existing.columns,
    data.rows !== undefined ? data.rows : existing.rows
  );
  const nextRows = normalizeRows(
    nextMode,
    data.rows !== undefined ? data.rows : existing.rows,
    nextColumns
  );

  await db.prepare(`
    UPDATE test_data_sets
    SET
      project_id = ?,
      app_type_id = ?,
      name = ?,
      description = ?,
      mode = ?,
      columns = ?,
      rows = ?
    WHERE id = ?
  `).run(
    projectId,
    appTypeId,
    data.name !== undefined ? normalizeName(data.name) : existing.name,
    data.description !== undefined ? sanitizeDataSetText(data.description) || null : existing.description,
    nextMode,
    nextColumns,
    nextRows,
    id
  );

  return { updated: true };
};

exports.deleteTestDataSet = async (id) => {
  const deleted = await db.prepare(`
    DELETE FROM test_data_sets
    WHERE id = ?
    RETURNING id
  `).get(id);

  if (!deleted) {
    throw new Error("Test data set not found");
  }

  return { deleted: true };
};
